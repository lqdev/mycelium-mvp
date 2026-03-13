// Mayor orchestrator: monitors firehose, assigns tasks, reviews completions, issues stamps.

import type {
  AgentCapability,
  AgentProfile,
  AgentRepository,
  AggregatedReputation,
  DecompositionTemplate,
  Firehose,
  FirehoseEvent,
  Mayor,
  AgentIdentity,
  ReputationDimensions,
  TaskClaim,
  TaskCompletion,
  TaskPosting,
} from '../schemas/types.js';
import { subscribe } from '../firehose/index.js';
import { putRecord, getRecord } from '../repository/index.js';
import { postTask, assignTask, reviewCompletion, transitionTask, getTask } from './wanted-board.js';
import { createStamp, aggregateReputation, rankClaims } from '../reputation/index.js';
import { getStampsForAgent } from '../reputation/index.js';
import type { ClaimCandidate } from '../reputation/index.js';

// ─── Demo template ────────────────────────────────────────────────────────────

/** Pre-defined decomposition template for "Build the Mycelium Dashboard". */
export const DASHBOARD_TEMPLATE: DecompositionTemplate = {
  projectPattern: 'Build the Mycelium Dashboard',
  tasks: [
    {
      id: 'task-001',
      title: 'Design component library',
      description: 'Build a reusable React component library with TypeScript.',
      requiredCapabilities: [
        { domain: 'frontend', tags: ['react', 'typescript', 'components'], minProficiency: 'advanced' },
      ],
      complexity: 'medium',
      priority: 'high',
      dependsOn: [],
    },
    {
      id: 'task-002',
      title: 'Build REST API for agent data',
      description: 'Create a REST API that serves agent data to the dashboard.',
      requiredCapabilities: [
        { domain: 'backend', tags: ['api-design', 'node-js'], minProficiency: 'intermediate' },
      ],
      complexity: 'medium',
      priority: 'high',
      dependsOn: [],
    },
    {
      id: 'task-003',
      title: 'Implement authentication',
      description: 'Add JWT-based authentication to the REST API.',
      requiredCapabilities: [
        { domain: 'security', tags: ['authentication', 'backend'], minProficiency: 'advanced' },
      ],
      complexity: 'high',
      priority: 'high',
      dependsOn: ['task-002'],
    },
    {
      id: 'task-004',
      title: 'Set up CI/CD pipeline',
      description: 'Configure GitHub Actions CI/CD pipeline with Docker.',
      requiredCapabilities: [
        { domain: 'devops', tags: ['ci-cd', 'docker'], minProficiency: 'intermediate' },
      ],
      complexity: 'medium',
      priority: 'normal',
      dependsOn: [],
    },
    {
      id: 'task-005',
      title: 'Create agent profile cards',
      description: 'Design and implement agent profile card components.',
      requiredCapabilities: [
        { domain: 'frontend', tags: ['react', 'frontend'], minProficiency: 'beginner' },
      ],
      complexity: 'low',
      priority: 'normal',
      dependsOn: ['task-001'],
    },
    {
      id: 'task-006',
      title: 'Build firehose event stream UI',
      description: 'Create a real-time event stream UI using WebSocket/SSE.',
      requiredCapabilities: [
        { domain: 'frontend', tags: ['react', 'websocket', 'typescript'], minProficiency: 'advanced' },
      ],
      complexity: 'high',
      priority: 'high',
      dependsOn: ['task-001'],
    },
    {
      id: 'task-007',
      title: 'Write integration tests',
      description: 'Write comprehensive integration and E2E tests.',
      requiredCapabilities: [
        { domain: 'testing', tags: ['integration-testing', 'e2e-testing'], minProficiency: 'intermediate' },
      ],
      complexity: 'medium',
      priority: 'normal',
      dependsOn: ['task-002', 'task-003', 'task-005', 'task-006'],
    },
    {
      id: 'task-008',
      title: 'Deploy to staging',
      description: 'Deploy the application to the staging environment.',
      requiredCapabilities: [
        { domain: 'devops', tags: ['deployment', 'devops'], minProficiency: 'beginner' },
      ],
      complexity: 'low',
      priority: 'normal',
      dependsOn: ['task-004', 'task-007'],
    },
  ],
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create the Mayor orchestrator and register its firehose subscription.
 * Mayor.subscribeToFirehose() is called internally — must be invoked BEFORE
 * any agent.profile records are written so the registry is populated correctly.
 */
export function createMayor(
  identity: AgentIdentity,
  repo: AgentRepository,
  firehose: Firehose,
  template: DecompositionTemplate,
): Mayor {
  const mayor: Mayor = {
    identity,
    repo,
    firehose,
    template,
    agentRegistry: new Map(),
    postedTasks: new Map(),
  };

  // Closure-based pending claims (not on Mayor struct to keep it clean)
  const pendingClaims = new Map<string, TaskClaim[]>();

  subscribe(firehose, undefined, (event) => {
    handleFirehoseEvent(mayor, pendingClaims, event);
  });

  return mayor;
}

// ─── Firehose handler ─────────────────────────────────────────────────────────

function handleFirehoseEvent(
  mayor: Mayor,
  pendingClaims: Map<string, TaskClaim[]>,
  event: FirehoseEvent,
): void {
  if (event.collection === 'network.mycelium.agent.profile') {
    // Don't register the mayor itself
    if (event.did === mayor.identity.did) return;

    const profile = event.record as AgentProfile;
    const existing = mayor.agentRegistry.get(event.did);
    if (existing) {
      existing.handle = profile.handle;
    } else {
      mayor.agentRegistry.set(event.did, {
        did: event.did,
        handle: profile.handle,
        capabilities: [],
        activeTasks: [],
        reputation: null,
      });
    }
  } else if (event.collection === 'network.mycelium.agent.capability') {
    const cap = event.record as AgentCapability;
    const entry = mayor.agentRegistry.get(event.did);
    if (entry) {
      const idx = entry.capabilities.findIndex((c) => c.slug === cap.slug);
      if (idx >= 0) {
        entry.capabilities[idx] = cap;
      } else {
        entry.capabilities.push(cap);
      }
    }
  } else if (event.collection === 'network.mycelium.task.claim') {
    const claim = event.record as TaskClaim;
    const claimUri = `at://${event.did}/${event.collection}/${event.rkey}`;
    const claimWithUri = { ...claim, _claimUri: claimUri };
    const existing = pendingClaims.get(claim.taskUri) ?? [];
    existing.push(claimWithUri as unknown as TaskClaim);
    pendingClaims.set(claim.taskUri, existing);
    // Schedule claim processing after all synchronous claim writes settle
    setTimeout(() => processClaimsForTask(mayor, pendingClaims, claim.taskUri), 0);
  } else if (event.collection === 'network.mycelium.task.completion') {
    const completion = event.record as TaskCompletion;
    const completionUri = `at://${event.did}/${event.collection}/${event.rkey}`;
    handleCompletion(mayor, completion, completionUri);
  }
}

// ─── Claim processing ─────────────────────────────────────────────────────────

function processClaimsForTask(
  mayor: Mayor,
  pendingClaims: Map<string, TaskClaim[]>,
  taskUri: string,
): void {
  const claims = pendingClaims.get(taskUri);
  if (!claims || claims.length === 0) return;
  pendingClaims.delete(taskUri);

  // Fetch current task state
  let task: TaskPosting;
  try {
    task = getTask(mayor.repo, taskUri);
  } catch {
    return; // Task not in mayor's repo
  }

  // Only assign if still open or claimed
  if (task.status !== 'open' && task.status !== 'claimed') return;

  // Build ranking candidates
  const candidates: ClaimCandidate[] = claims.map((claim) => {
    const entry = mayor.agentRegistry.get(claim.claimerDid);
    return {
      did: claim.claimerDid,
      claim: { proposal: { confidenceLevel: claim.proposal.confidenceLevel } },
      capabilities: entry?.capabilities ?? [],
      activeTasks: entry?.activeTasks.length ?? 0,
      reputation: entry?.reputation ?? null,
    };
  });

  const ranked = rankClaims(candidates, task);
  const best = ranked[0];

  // Assign best available candidate even if score is negative (e.g. newcomer on high task).
  // The negative score already penalises preference — but blocking causes permanent stall
  // when no established agent is available (common early in a demo run).
  if (best) {
    try {
      assignTask(mayor.repo, taskUri, best.did);
      const entry = mayor.agentRegistry.get(best.did);
      if (entry) entry.activeTasks.push(taskUri);
    } catch {
      // Assignment may fail if task was already assigned
    }
  }
}

// ─── Completion handling ──────────────────────────────────────────────────────

function handleCompletion(
  mayor: Mayor,
  completion: TaskCompletion,
  completionUri: string,
): void {
  const { taskUri } = completion;

  // Transition task: in_progress → completed
  try {
    transitionTask(mayor.repo, taskUri, 'completed', { completionUri });
  } catch {
    return; // Task may not be in in_progress state (rework path or duplicate event)
  }

  // Review: always accept in MVP
  reviewCompletion(mayor.repo, taskUri, true);

  // Determine task domain for the reputation stamp
  let task: TaskPosting;
  try {
    task = getTask(mayor.repo, taskUri);
  } catch {
    return;
  }
  const taskDomain = task.requiredCapabilities[0]?.domain ?? 'general';

  // Generate quality dimensions (Mayor's assessment)
  const dims: ReputationDimensions = {
    codeQuality: 7.5 + Math.random() * 2,
    reliability: 7.5 + Math.random() * 2,
    communication: 7.5 + Math.random() * 2,
    creativity: 7.5 + Math.random() * 2,
    efficiency: 7.5 + Math.random() * 2,
  };

  // Issue reputation stamp
  createStamp(
    mayor.repo,
    completion.completerDid,
    taskUri,
    completionUri,
    taskDomain,
    dims,
    completion.intelligenceUsed?.modelDid,
  );

  // Update agent registry: remove from activeTasks, refresh reputation
  const entry = mayor.agentRegistry.get(completion.completerDid);
  if (entry) {
    entry.activeTasks = entry.activeTasks.filter((t) => t !== taskUri);
    const stamps = getStampsForAgent(mayor.firehose, completion.completerDid);
    entry.reputation = stamps.length > 0 ? aggregateReputation(stamps) : null;
  }

  // Mark task as accepted in postedTasks tracking
  for (const [taskId, info] of mayor.postedTasks) {
    if (info.uri === taskUri) {
      info.status = 'accepted';
      break;
    }
  }

  // Post newly unblocked tasks
  checkAndPostUnblockedTasks(mayor);
}

// ─── Project management ───────────────────────────────────────────────────────

/**
 * Post the initial tasks (those with no dependencies) to kick off the project.
 * Mayor monitors subsequent completions to post dependency-gated tasks.
 */
export function startProject(mayor: Mayor, projectDescription: string): void {
  for (const taskDef of mayor.template.tasks) {
    if (mayor.postedTasks.has(taskDef.id)) continue;
    if (taskDef.dependsOn.length === 0) {
      const result = postTask(
        mayor.repo,
        {
          title: taskDef.title,
          description: taskDef.description,
          requiredCapabilities: taskDef.requiredCapabilities,
          complexity: taskDef.complexity,
          priority: taskDef.priority,
          context: {
            projectName: mayor.template.projectPattern,
            projectDescription,
          },
          deliverables: [],
        },
        taskDef.id,
      );
      mayor.postedTasks.set(taskDef.id, { status: 'open', uri: result.uri });
    }
  }
}

function checkAndPostUnblockedTasks(mayor: Mayor): void {
  for (const taskDef of mayor.template.tasks) {
    if (mayor.postedTasks.has(taskDef.id)) continue;

    const allDepsResolved = taskDef.dependsOn.every((depId) => {
      const dep = mayor.postedTasks.get(depId);
      return dep && (dep.status === 'accepted' || dep.status === 'closed');
    });

    if (allDepsResolved) {
      const result = postTask(
        mayor.repo,
        {
          title: taskDef.title,
          description: taskDef.description,
          requiredCapabilities: taskDef.requiredCapabilities,
          complexity: taskDef.complexity,
          priority: taskDef.priority,
          context: {
            projectName: mayor.template.projectPattern,
            projectDescription: mayor.template.projectPattern,
          },
          deliverables: [],
        },
        taskDef.id,
      );
      mayor.postedTasks.set(taskDef.id, { status: 'open', uri: result.uri });
    }
  }
}
