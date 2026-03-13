// Intelligence module: bootstrap providers + models, lookup helpers.
// All endpoints are stored as metadata only — no real HTTP calls in MVP.

import type {
  AgentIdentity,
  AgentRepository,
  Firehose,
  IntelligenceModel,
  IntelligenceProvider,
} from '../schemas/types.js';
import { generateIdentity } from '../identity/index.js';
import { createMemoryRepository, listRecords, putRecord } from '../repository/index.js';

// ─── Result type ──────────────────────────────────────────────────────────────

export interface IntelligenceBootstrapResult {
  providers: {
    githubModels: { identity: AgentIdentity; repo: AgentRepository };
    ollama: { identity: AgentIdentity; repo: AgentRepository };
  };
  models: {
    claudeSonnet4: AgentIdentity;
    claudeHaiku4: AgentIdentity;
    gpt4: AgentIdentity;
    phi4: AgentIdentity;
    llama3: AgentIdentity;
    codellama: AgentIdentity;
  };
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Bootstrap both intelligence providers and all 6 models.
 * Writes intelligence.provider and intelligence.model records to provider repos.
 * Returns all identities and repos for use by the agent bootstrap.
 */
export function bootstrapIntelligence(firehose: Firehose): IntelligenceBootstrapResult {
  const now = new Date().toISOString();

  // Step 1: Create provider identities + repos
  const githubModelsIdentity = generateIdentity('github-models.mycelium.local', 'GitHub Models');
  const ollamaIdentity = generateIdentity('ollama.mycelium.local', 'Local Ollama');

  const githubModelsRepo = createMemoryRepository(githubModelsIdentity, firehose);
  const ollamaRepo = createMemoryRepository(ollamaIdentity, firehose);

  // Step 2: Create model identities
  const claudeSonnet4 = generateIdentity('claude-sonnet-4.github-models.local', 'Claude Sonnet 4');
  const claudeHaiku4 = generateIdentity('claude-haiku-4.github-models.local', 'Claude Haiku 4');
  const gpt4 = generateIdentity('gpt-4.github-models.local', 'GPT-4');
  const phi4 = generateIdentity('phi-4.github-models.local', 'Phi-4');
  const llama3 = generateIdentity('llama-3-70b.ollama.local', 'Llama 3 70B');
  const codellama = generateIdentity('codellama.ollama.local', 'CodeLlama');

  // Step 3: Write model records to provider repos
  const githubModelDids: string[] = [];
  const ollamaModelDids: string[] = [];

  const githubModelRecords: IntelligenceModel[] = [
    {
      $type: 'network.mycelium.intelligence.model',
      did: claudeSonnet4.did,
      providerDid: githubModelsIdentity.did,
      name: 'Claude Sonnet 4',
      slug: 'claude-sonnet-4',
      version: '2026-03',
      modelOrigin: 'Anthropic',
      capabilities: ['code-generation', 'code-review', 'architecture-design', 'reasoning', 'analysis'],
      domains: ['frontend', 'backend', 'architecture', 'testing', 'security'],
      contextWindow: 200000,
      constraints: { maxTokensPerRequest: 8192, costTier: 'standard' },
      benchmarks: { 'code-quality': 94, reasoning: 92, analysis: 91 },
      createdAt: now,
      updatedAt: now,
    },
    {
      $type: 'network.mycelium.intelligence.model',
      did: claudeHaiku4.did,
      providerDid: githubModelsIdentity.did,
      name: 'Claude Haiku 4',
      slug: 'claude-haiku-4',
      version: '2026-03',
      modelOrigin: 'Anthropic',
      capabilities: ['code-generation', 'fast-inference', 'summarization', 'scripting'],
      domains: ['devops', 'scripting', 'documentation', 'backend'],
      contextWindow: 200000,
      constraints: { maxTokensPerRequest: 4096, costTier: 'standard' },
      benchmarks: { 'code-quality': 84, speed: 96, summarization: 90 },
      createdAt: now,
      updatedAt: now,
    },
    {
      $type: 'network.mycelium.intelligence.model',
      did: gpt4.did,
      providerDid: githubModelsIdentity.did,
      name: 'GPT-4',
      slug: 'gpt-4',
      version: '2024-11',
      modelOrigin: 'OpenAI',
      capabilities: ['code-generation', 'security-analysis', 'analysis', 'conversation'],
      domains: ['security', 'backend', 'general', 'architecture'],
      contextWindow: 128000,
      constraints: { maxTokensPerRequest: 8192, costTier: 'standard' },
      benchmarks: { 'code-quality': 89, 'security-analysis': 93, reasoning: 90 },
      createdAt: now,
      updatedAt: now,
    },
    {
      $type: 'network.mycelium.intelligence.model',
      did: phi4.did,
      providerDid: githubModelsIdentity.did,
      name: 'Phi-4',
      slug: 'phi-4',
      version: '2024-12',
      modelOrigin: 'Microsoft',
      capabilities: ['reasoning', 'instruction-following', 'code-generation', 'general-purpose'],
      domains: ['general', 'research', 'scripting'],
      contextWindow: 16384,
      constraints: { maxTokensPerRequest: 4096, costTier: 'free' },
      benchmarks: { reasoning: 85, 'instruction-following': 88 },
      createdAt: now,
      updatedAt: now,
    },
  ];

  const ollamaModelRecords: IntelligenceModel[] = [
    {
      $type: 'network.mycelium.intelligence.model',
      did: llama3.did,
      providerDid: ollamaIdentity.did,
      name: 'Llama 3 70B',
      slug: 'llama-3-70b',
      version: '2024-07',
      modelOrigin: 'Meta',
      capabilities: ['code-generation', 'conversation', 'general-purpose', 'local-first'],
      domains: ['general', 'frontend', 'backend'],
      contextWindow: 8192,
      constraints: { maxTokensPerRequest: 4096, costTier: 'free' },
      benchmarks: { 'code-quality': 76, reasoning: 78, general: 82 },
      createdAt: now,
      updatedAt: now,
    },
    {
      $type: 'network.mycelium.intelligence.model',
      did: codellama.did,
      providerDid: ollamaIdentity.did,
      name: 'CodeLlama',
      slug: 'codellama',
      version: '2023-08',
      modelOrigin: 'Meta',
      capabilities: ['code-generation', 'code-completion', 'local-first'],
      domains: ['backend', 'scripting', 'devops'],
      contextWindow: 4096,
      constraints: { maxTokensPerRequest: 2048, costTier: 'free' },
      benchmarks: { 'code-quality': 74, 'code-completion': 83 },
      createdAt: now,
      updatedAt: now,
    },
  ];

  for (const model of githubModelRecords) {
    putRecord(githubModelsRepo, 'network.mycelium.intelligence.model', model.slug!, model);
    githubModelDids.push(model.did);
  }

  for (const model of ollamaModelRecords) {
    putRecord(ollamaRepo, 'network.mycelium.intelligence.model', model.slug!, model);
    ollamaModelDids.push(model.did);
  }

  // Step 4: Write provider records (now modelsOffered is populated)
  const githubModelsRecord: IntelligenceProvider = {
    $type: 'network.mycelium.intelligence.provider',
    did: githubModelsIdentity.did,
    name: 'GitHub Models',
    providerType: 'cloud',
    description:
      'Unified cloud gateway aggregating models from Anthropic, OpenAI, Microsoft, Meta, and other providers through GitHub\'s API.',
    endpoint: 'https://api.github.com/models',
    operator: { name: 'GitHub', contactUri: 'https://github.com' },
    modelsOffered: githubModelDids,
    trustSignals: { verified: true, uptime: 99.9, dataRetentionPolicy: 'minimal' },
    createdAt: now,
    updatedAt: now,
  };

  const ollamaRecord: IntelligenceProvider = {
    $type: 'network.mycelium.intelligence.provider',
    did: ollamaIdentity.did,
    name: 'Local Ollama',
    providerType: 'local',
    description:
      'Self-hosted local AI inference. Serves open-source models without external API dependencies.',
    endpoint: 'http://localhost:11434',
    operator: { name: 'Mycelium Demo', contactUri: 'mailto:demo@mycelium.network' },
    modelsOffered: ollamaModelDids,
    trustSignals: { verified: false, uptime: 95.0, dataRetentionPolicy: 'none' },
    createdAt: now,
    updatedAt: now,
  };

  putRecord(githubModelsRepo, 'network.mycelium.intelligence.provider', 'self', githubModelsRecord);
  putRecord(ollamaRepo, 'network.mycelium.intelligence.provider', 'self', ollamaRecord);

  return {
    providers: {
      githubModels: { identity: githubModelsIdentity, repo: githubModelsRepo },
      ollama: { identity: ollamaIdentity, repo: ollamaRepo },
    },
    models: { claudeSonnet4, claudeHaiku4, gpt4, phi4, llama3, codellama },
  };
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/** List all intelligence.model records stored in a provider's repository. */
export function listModels(providerRepo: AgentRepository): IntelligenceModel[] {
  return listRecords(providerRepo, 'network.mycelium.intelligence.model').map(
    (r) => r.content as IntelligenceModel,
  );
}

/** Resolve a model slug (e.g. 'claude-sonnet-4') to a DID. Returns undefined if not found. */
export function resolveModelDid(
  models: IntelligenceBootstrapResult['models'],
  slug: string,
): string | undefined {
  const slugToKey: Record<string, keyof IntelligenceBootstrapResult['models']> = {
    'claude-sonnet-4': 'claudeSonnet4',
    'claude-haiku-4': 'claudeHaiku4',
    'gpt-4': 'gpt4',
    'phi-4': 'phi4',
    'llama-3-70b': 'llama3',
    codellama: 'codellama',
  };
  const key = slugToKey[slug];
  return key ? models[key].did : undefined;
}

/** Slugs served by GitHub Models (cloud). Others go to Ollama (local). */
export const GITHUB_MODELS_SLUGS = new Set([
  'claude-sonnet-4',
  'claude-haiku-4',
  'gpt-4',
  'phi-4',
]);
