// Agent bootstrap and execution engine.
// bootstrapAgents: creates identities, repos, profile/capability/state records.
// createAgentRunner: subscription-based agent that claims, executes, and completes tasks.

import { randomUUID } from 'node:crypto';
import type {
  AgentCapability,
  AgentIdentity,
  AgentRepository,
  AgentState,
  Firehose,
  ReputationDimensions,
  TaskPosting,
} from '../schemas/types.js';
import { generateIdentity } from '../identity/index.js';
import { createMemoryRepository, getRecord, putRecord } from '../repository/index.js';
import { subscribe } from '../firehose/index.js';
import { claimTask, completeTask, shouldClaim, startTask } from '../orchestrator/wanted-board.js';
import type { CompletionResults } from '../orchestrator/wanted-board.js';
import {
  GITHUB_MODELS_SLUGS,
  type IntelligenceBootstrapResult,
  resolveModelDid,
} from '../intelligence/index.js';
import { callModel } from '../intelligence/client.js';
import { buildSystemPrompt, buildUserPrompt, parseTaskCompletionResponse } from '../intelligence/prompts.js';
import { AGENT_ROSTER, TASK_ARTIFACTS, type AgentDefinition, type CapabilityDef } from './roster.js';
import { CONSTANTS } from '../constants.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BootstrappedAgent {
  def: AgentDefinition;
  identity: AgentIdentity;
  repo: AgentRepository;
}

export interface AgentBootstrapResult {
  agents: BootstrappedAgent[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a CapabilityDef (from roster) into a full AgentCapability record object. */
export function capabilityDefToRecord(cap: CapabilityDef, agentDid: string): AgentCapability {
  const now = new Date().toISOString();
  return {
    $type: 'network.mycelium.agent.capability',
    name: cap.name,
    slug: cap.rkey,
    domain: cap.domain,
    description: cap.description,
    proficiencyLevel: cap.proficiencyLevel,
    tags: cap.tags,
    tools: cap.tools,
    createdAt: now,
    updatedAt: now,
  };
}

/** Determine artifact file type from file extension. */
function getArtifactType(name: string): 'code' | 'document' | 'test' | 'config' | 'other' {
  if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) return 'test';
  if (name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.js')) return 'code';
  if (
    name.endsWith('.yaml') ||
    name.endsWith('.yml') ||
    name.endsWith('.env') ||
    name.endsWith('.sh') ||
    name === 'Dockerfile'
  )
    return 'config';
  if (name.endsWith('.md') || name.endsWith('.txt')) return 'document';
  return 'other';
}

/** Clamp a number to [0, 10]. */
function clamp10(v: number): number {
  return Math.min(10, Math.max(0, v));
}

/** Generate quality dimension scores with variance around the agent's center values. */
export function generateQualityDimensions(def: AgentDefinition): ReputationDimensions {
  const c = def.behavior.qualityCenter;
  const v = def.behavior.qualityVariance;
  return {
    codeQuality: clamp10(c.codeQuality + (Math.random() * 2 - 1) * v.codeQuality),
    reliability: clamp10(c.reliability + (Math.random() * 2 - 1) * v.reliability),
    communication: clamp10(c.communication + (Math.random() * 2 - 1) * v.communication),
    creativity: clamp10(c.creativity + (Math.random() * 2 - 1) * v.creativity),
    efficiency: clamp10(c.efficiency + (Math.random() * 2 - 1) * v.efficiency),
  };
}

// ─── Agent state helpers ──────────────────────────────────────────────────────

function updateAgentStateAdd(repo: AgentRepository, taskUri: string, claimUri: string): void {
  try {
    const stored = getRecord(repo, 'network.mycelium.agent.state', 'self');
    const state = stored.content as AgentState;
    const now = new Date().toISOString();
    putRecord(repo, 'network.mycelium.agent.state', 'self', {
      ...state,
      status: 'working' as const,
      activeTasks: [...state.activeTasks, { taskUri, claimUri, startedAt: now }],
      lastActivityAt: now,
      updatedAt: now,
    });
  } catch {
    // State record missing — no-op
  }
}

function updateAgentStateRemove(repo: AgentRepository, taskUri: string): void {
  try {
    const stored = getRecord(repo, 'network.mycelium.agent.state', 'self');
    const state = stored.content as AgentState;
    const now = new Date().toISOString();
    const remaining = state.activeTasks.filter((t) => t.taskUri !== taskUri);
    putRecord(repo, 'network.mycelium.agent.state', 'self', {
      ...state,
      status: remaining.length > 0 ? ('working' as const) : ('idle' as const),
      activeTasks: remaining,
      completedToday: state.completedToday + 1,
      lastActivityAt: now,
      updatedAt: now,
    });
  } catch {
    // State record missing — no-op
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Create all 6 agent identities, repos, and initial records.
 * Writes agent.profile, agent.capability, and agent.state to each agent's repo.
 * Mayor must be subscribed to the firehose before calling this.
 *
 * @param savedIdentities If provided, reuses existing identities instead of generating new ones.
 *   New identities are indicated by returning `newIdentities` for the caller to persist.
 */
export function bootstrapAgents(
  firehose: Firehose,
  intelligence: IntelligenceBootstrapResult,
  savedIdentities?: Map<string, AgentIdentity>,
): AgentBootstrapResult & { newIdentities: AgentIdentity[] } {
  const agents: BootstrappedAgent[] = [];
  const newIdentities: AgentIdentity[] = [];

  for (const def of AGENT_ROSTER) {
    const existing = savedIdentities?.get(def.handle);
    const identity = existing ?? generateIdentity(def.handle, def.displayName);
    if (!existing) newIdentities.push(identity);
    const repo = createMemoryRepository(identity, firehose);

    const now = new Date().toISOString();

    // Resolve model + provider DIDs for intelligenceRefs
    const modelDid = resolveModelDid(intelligence.models, def.primaryModelSlug);
    const providerDid = GITHUB_MODELS_SLUGS.has(def.primaryModelSlug)
      ? intelligence.providers.githubModels.identity.did
      : intelligence.providers.ollama.identity.did;

    // Write agent.profile
    putRecord(repo, 'network.mycelium.agent.profile', 'self', {
      $type: 'network.mycelium.agent.profile',
      did: identity.did,
      handle: identity.handle,
      displayName: identity.displayName,
      description: def.description,
      agentType: def.agentType,
      intelligenceRefs: modelDid
        ? [{ modelDid, providerDid, role: 'primary', usedFor: def.intelligenceUsedFor }]
        : [],
      operator: { name: 'Mycelium Demo' },
      maxConcurrentTasks: def.maxConcurrentTasks,
      availabilityStatus: 'available',
      createdAt: now,
      updatedAt: now,
    });

    // Write agent.capability records
    for (const capDef of def.capabilities) {
      putRecord(
        repo,
        'network.mycelium.agent.capability',
        capDef.rkey,
        capabilityDefToRecord(capDef, identity.did),
      );
    }

    // Write initial agent.state
    putRecord(repo, 'network.mycelium.agent.state', 'self', {
      $type: 'network.mycelium.agent.state',
      status: 'idle',
      activeTasks: [],
      queuedTasks: [],
      completedToday: 0,
      lastActivityAt: now,
      updatedAt: now,
    });

    agents.push({ def, identity, repo });
  }

  return { agents, newIdentities };
}

// ─── Agent runner ─────────────────────────────────────────────────────────────

/**
 * Create a subscription-based agent runner.
 * Call start() to begin observing firehose events and claiming/executing tasks.
 *
 * @param executionDelayMs Override execution delay (0 = synchronous; omit for realistic delays)
 * @param options.forceAccept When true, bypass the stochastic acceptRate check so every
 *   qualified task is always claimed. Useful for demos that must reliably complete.
 */
export function createAgentRunner(
  def: AgentDefinition,
  identity: AgentIdentity,
  repo: AgentRepository,
  mayorRepo: AgentRepository,
  firehose: Firehose,
  intelligence: IntelligenceBootstrapResult,
  executionDelayMs?: number,
  options: { forceAccept?: boolean } = {},
): { start(): void } {
  // Map taskUri → { claimUri, taskTitle } for tracking active claims
  const claimTracker = new Map<string, { claimUri: string; taskTitle: string }>();

  const agentCapabilities: AgentCapability[] = def.capabilities.map((c) =>
    capabilityDefToRecord(c, identity.did),
  );

  const modelDid = resolveModelDid(intelligence.models, def.primaryModelSlug);
  const providerDid = GITHUB_MODELS_SLUGS.has(def.primaryModelSlug)
    ? intelligence.providers.githubModels.identity.did
    : intelligence.providers.ollama.identity.did;

  async function executeTask(task: TaskPosting, taskUri: string, claimUri: string): Promise<void> {
    // The rkey is the last segment of the task URI; matches TASK_ARTIFACTS keys
    const taskId = taskUri.split('/').pop() ?? taskUri;
    const artifactNames = TASK_ARTIFACTS[taskId] ?? [`output-${taskId}.ts`];

    const simulatedMins = Math.round(
      CONSTANTS.SIMULATED_DURATION_MINUTES[task.complexity] * def.behavior.speedMultiplier,
    );

    // Try real LLM inference; fall back to simulated output if unavailable or disabled.
    let llmResult = null;
    try {
      const matchCap =
        def.capabilities.find((c) => task.requiredCapabilities.some((r) => r.domain === c.domain)) ??
        def.capabilities[0];
      const rawResponse = await callModel(
        [
          {
            role: 'system',
            content: buildSystemPrompt(matchCap?.domain ?? 'general', def.displayName, matchCap?.tools ?? []),
          },
          { role: 'user', content: buildUserPrompt(task, artifactNames) },
        ],
        def.primaryModelSlug,
      );
      if (rawResponse) llmResult = parseTaskCompletionResponse(rawResponse);
    } catch {
      // callModel already returns null on failure; this guards against unexpected throws
    }

    const results: CompletionResults = {
      summary:
        llmResult?.summary ??
        `Completed: ${task.title}. Implemented using ${agentCapabilities[0]?.tools?.join(', ') ?? 'standard tools'}.`,
      artifacts: artifactNames.map((name, i) => ({
        name,
        type: getArtifactType(name),
        contentHash: `sha256-${randomUUID().slice(0, 16)}-${i}`,
        size: 40 + Math.floor(Math.random() * 80),
        description: `${name} — generated by ${def.handle}`,
      })),
      metrics: {
        executionTime: `PT${simulatedMins}M`,
        linesOfCode: llmResult?.linesOfCode ?? artifactNames.length * (40 + Math.floor(Math.random() * 80)),
        testsPassed: llmResult?.testsPassed ?? (8 + Math.floor(Math.random() * 17)),
        testsTotal: llmResult?.testsTotal ?? (10 + Math.floor(Math.random() * 15)),
        coveragePercent: llmResult?.coveragePercent ?? (82 + Math.floor(Math.random() * 14)),
      },
      // Only attribute intelligence when real inference was actually used
      intelligenceUsed: llmResult && modelDid ? { modelDid, providerDid } : undefined,
    };

    try {
      completeTask(repo, claimUri, taskUri, results);
    } finally {
      updateAgentStateRemove(repo, taskUri);
    }
  }

  function handleTaskEvent(event: { operation: string; record: unknown; did: string; collection: string; rkey: string }): void {
    const task = event.record as TaskPosting;
    const taskUri = `at://${event.did}/${event.collection}/${event.rkey}`;

    if (event.operation === 'create') {
      // Evaluate whether to claim this task
      if (!shouldClaim(agentCapabilities, task)) return;
      if (!options.forceAccept && Math.random() >= def.behavior.acceptRate) return;

      // Build claim proposal
      const matchCap = def.capabilities.find((c) =>
        task.requiredCapabilities.some((r) => r.domain === c.domain),
      );
      const matchingCapRkeys = def.capabilities
        .filter((c) => task.requiredCapabilities.some((r) => r.domain === c.domain))
        .map((c) => c.rkey);

      const approach = `${def.displayName} will use ${matchCap?.tools.join(', ') ?? 'available tools'}`;
      const simulatedMins = Math.round(
        CONSTANTS.SIMULATED_DURATION_MINUTES[task.complexity] * def.behavior.speedMultiplier,
      );
      const estimatedDuration = `PT${simulatedMins}M`;
      const confidenceLevel: 'high' | 'medium' =
        matchCap?.proficiencyLevel === 'expert' ? 'high' : 'medium';

      const result = claimTask(repo, taskUri, task.title, { approach, estimatedDuration, confidenceLevel }, matchingCapRkeys);
      claimTracker.set(taskUri, { claimUri: result.uri, taskTitle: task.title });
    } else if (event.operation === 'update') {
      // Check if we've been assigned this task
      if (task.assigneeDid !== identity.did || task.status !== 'assigned') return;

      const tracked = claimTracker.get(taskUri);
      if (!tracked) return;

      // Transition task to in_progress
      try {
        startTask(mayorRepo, taskUri);
      } catch {
        return; // Task may have been transitioned already
      }

      updateAgentStateAdd(repo, taskUri, tracked.claimUri);

      // Schedule execution
      const delay =
        executionDelayMs !== undefined
          ? executionDelayMs
          : Math.round(
              CONSTANTS.BASE_EXECUTION_TIME_MS[task.complexity] *
                def.behavior.speedMultiplier *
                (CONSTANTS.EXECUTION_JITTER_MIN +
                  Math.random() *
                    (CONSTANTS.EXECUTION_JITTER_MAX - CONSTANTS.EXECUTION_JITTER_MIN)),
            );

      setTimeout(() => void executeTask(task, taskUri, tracked.claimUri), delay);
    }
  }

  return {
    start(): void {
      subscribe(firehose, { collections: ['network.mycelium.task.posting'] }, (event) => {
        handleTaskEvent(event);
      });
    },
  };
}
