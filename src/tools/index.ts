// Tools module: bootstrap providers + definitions, invocation helpers.
// Mirrors the knowledge module pattern: bootstrap writes AT Protocol records,
// invoke provides graceful degradation (never throws).

import { createHash } from 'node:crypto';
import type {
  AgentIdentity,
  AgentRepository,
  Firehose,
  ToolDefinition,
  ToolProvider,
} from '../schemas/types.js';
import { generateIdentity } from '../identity/index.js';
import { createMemoryRepository, putRecord } from '../repository/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ToolInvocationResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface BootstrappedToolProvider {
  identity: AgentIdentity;
  repo: AgentRepository;
  provider: ToolProvider;
  /** Definition records, keyed by tool name. Value includes the AT URI of the definition. */
  definitions: Array<{ definition: ToolDefinition; uri: string }>;
}

export interface ToolBootstrapResult {
  providers: BootstrappedToolProvider[];
  newIdentities: AgentIdentity[];
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Bootstrap tool providers.
 * When TOOL_ENDPOINT is set, publishes definition records for all discovered tools.
 * Falls back to a mock provider with a single 'general-assistance' tool.
 *
 * @param savedIdentities If provided, reuses existing identities by handle.
 */
export function bootstrapToolProviders(
  firehose: Firehose,
  savedIdentities?: Map<string, AgentIdentity>,
): ToolBootstrapResult {
  const now = new Date().toISOString();
  const newIdentities: AgentIdentity[] = [];

  function getOrGenerate(handle: string, displayName: string): AgentIdentity {
    const existing = savedIdentities?.get(handle);
    if (existing) return existing;
    const id = generateIdentity(handle, displayName);
    newIdentities.push(id);
    return id;
  }

  const toolEndpoint = process.env['TOOL_ENDPOINT'];
  const handle = 'tools.mycelium.local';
  const identity = getOrGenerate(handle, 'Mycelium Tool Provider');
  const repo = createMemoryRepository(identity, firehose);

  const providerRecord: ToolProvider = {
    $type: 'network.mycelium.tool.provider',
    did: identity.did,
    name: 'Mycelium Tool Provider',
    description: 'Built-in tools available to Mycelium agents during task execution.',
    endpoint: toolEndpoint ?? 'http://tools.mycelium.local',
    createdAt: now,
    updatedAt: now,
  };

  putRecord(repo, 'network.mycelium.tool.provider', 'self', providerRecord);

  // Publish tool definitions — the "inventory" of what this provider offers
  const toolSpecs = buildToolDefinitions(identity.did, now);
  const definitions: BootstrappedToolProvider['definitions'] = [];

  for (const def of toolSpecs) {
    const rkey = `tool-${def.name}`;
    const result = putRecord(repo, 'network.mycelium.tool.definition', rkey, def);
    definitions.push({ definition: def, uri: result.uri });
  }

  return {
    providers: [{ identity, repo, provider: providerRecord, definitions }],
    newIdentities,
  };
}

/** Built-in tool definitions for the mock provider. */
function buildToolDefinitions(providerDid: string, now: string): ToolDefinition[] {
  return [
    {
      $type: 'network.mycelium.tool.definition',
      providerDid,
      name: 'general-assistance',
      description: 'General-purpose assistance tool for tasks that need supplemental processing.',
      inputSchema: {
        type: 'object',
        properties: {
          taskUri: { type: 'string', description: 'AT URI of the task to assist with.' },
          context: { type: 'string', description: 'Optional context for the tool.' },
        },
        required: ['taskUri'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          notes: { type: 'string' },
        },
      },
      category: 'retrieval',
      sideEffects: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      $type: 'network.mycelium.tool.definition',
      providerDid,
      name: 'code-analysis',
      description: 'Static analysis tool for reviewing code artifacts.',
      inputSchema: {
        type: 'object',
        properties: {
          taskUri: { type: 'string' },
          artifactHash: { type: 'string', description: 'SHA-256 of the artifact to analyze.' },
        },
        required: ['taskUri'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          issues: { type: 'array', items: { type: 'string' } },
        },
      },
      category: 'execution',
      sideEffects: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      $type: 'network.mycelium.tool.definition',
      providerDid,
      name: 'test-runner',
      description: 'Execute test suites against task artifacts.',
      inputSchema: {
        type: 'object',
        properties: {
          taskUri: { type: 'string' },
          testSuite: { type: 'string', description: 'Name of the test suite to run.' },
        },
        required: ['taskUri'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          passed: { type: 'number' },
          failed: { type: 'number' },
        },
      },
      category: 'execution',
      sideEffects: false,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

// ─── Invocation ───────────────────────────────────────────────────────────────

/**
 * Invoke a specific tool from a provider.
 * When TOOL_ENDPOINT is set, calls the live endpoint; otherwise returns a mock success.
 * Never throws — returns { success: false, error } on failure.
 */
export async function invokeToolProvider(
  provider: BootstrappedToolProvider,
  toolUri: string,
  inputs: Record<string, unknown>,
): Promise<ToolInvocationResult> {
  const toolEndpoint = process.env['TOOL_ENDPOINT'];

  if (!toolEndpoint) {
    // Mock path: always succeed
    return { success: true, result: { notes: 'mock invocation' } };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${toolEndpoint}/api/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolUri, inputs }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { success: false, error: 'ENDPOINT_UNREACHABLE' };
    }

    const data = (await response.json()) as { success: boolean; result?: unknown };
    return { success: data.success, result: data.result };
  } catch {
    return { success: false, error: 'ENDPOINT_UNREACHABLE' };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute SHA-256 hex hash of a string. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Find the best matching tool definition for a task's required capabilities.
 * Returns the first definition whose name overlaps any required capability domain/tag.
 * Falls back to the 'general-assistance' definition.
 */
export function selectTool(
  provider: BootstrappedToolProvider,
  requiredCapabilities: Array<{ domain: string; tags: string[] }>,
): { definition: ToolDefinition; uri: string } | undefined {
  const domains = requiredCapabilities.map((c) => c.domain.toLowerCase());
  const tags = requiredCapabilities.flatMap((c) => c.tags.map((t) => t.toLowerCase()));

  // Try domain/tag match first
  for (const entry of provider.definitions) {
    const name = entry.definition.name.toLowerCase();
    if (domains.some((d) => name.includes(d)) || tags.some((t) => name.includes(t))) {
      return entry;
    }
  }

  // Fall back to general-assistance
  return provider.definitions.find((e) => e.definition.name === 'general-assistance');
}
