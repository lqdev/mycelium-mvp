// Knowledge module: bootstrap providers + documents, query helpers.
// Mirrors the intelligence module pattern: bootstrap writes AT Protocol records,
// query provides graceful degradation (never throws).

import { createHash } from 'node:crypto';
import type {
  AgentIdentity,
  AgentRepository,
  Firehose,
  KnowledgeDocument,
  KnowledgeProvider,
} from '../schemas/types.js';
import { generateIdentity } from '../identity/index.js';
import { createMemoryRepository, putRecord } from '../repository/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KnowledgeQueryResult {
  resultCount: number;
  context: string;
  contextCids?: string[];
  error?: string;
}

export interface BootstrappedKnowledgeProvider {
  identity: AgentIdentity;
  repo: AgentRepository;
  provider: KnowledgeProvider;
  /** AT URIs of published knowledge.document records, keyed by contentHash */
  documentUris: Map<string, string>;
}

export interface KnowledgeBootstrapResult {
  providers: BootstrappedKnowledgeProvider[];
  newIdentities: AgentIdentity[];
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Bootstrap knowledge providers.
 * When KB_ENDPOINT is set, attempts to fetch documents from /api/documents.
 * Falls back to a mock provider with zero documents (verificationMethod: 'none').
 *
 * @param savedIdentities If provided, reuses existing identities by handle.
 */
export function bootstrapKnowledgeProviders(
  firehose: Firehose,
  savedIdentities?: Map<string, AgentIdentity>,
): KnowledgeBootstrapResult {
  const now = new Date().toISOString();
  const newIdentities: AgentIdentity[] = [];

  function getOrGenerate(handle: string, displayName: string): AgentIdentity {
    const existing = savedIdentities?.get(handle);
    if (existing) return existing;
    const id = generateIdentity(handle, displayName);
    newIdentities.push(id);
    return id;
  }

  const kbEndpoint = process.env['KB_ENDPOINT'];
  const handle = 'knowledge.mycelium.local';
  const identity = getOrGenerate(handle, 'Mycelium Knowledge Base');
  const repo = createMemoryRepository(identity, firehose);
  const documentUris = new Map<string, string>();

  const providerRecord: KnowledgeProvider = {
    $type: 'network.mycelium.knowledge.provider',
    did: identity.did,
    name: 'Mycelium Knowledge Base',
    description: 'General-purpose knowledge base for the Mycelium agent network.',
    endpoint: kbEndpoint ?? 'http://knowledge.mycelium.local',
    capabilities: ['nl-question-answering', 'document-retrieval'],
    domains: ['general', 'AI', 'distributed-systems', 'AT-protocol'],
    verificationMethod: kbEndpoint ? 'cid' : 'none',
    createdAt: now,
    updatedAt: now,
  };

  putRecord(repo, 'network.mycelium.knowledge.provider', 'self', providerRecord);

  // Publish built-in seed documents so there's something to query in demo mode
  const seedDocuments = buildSeedDocuments(identity.did, now);
  for (const doc of seedDocuments) {
    const result = putRecord(repo, 'network.mycelium.knowledge.document', `doc-${doc.contentHash.slice(0, 8)}`, doc);
    documentUris.set(doc.contentHash, result.uri);
  }

  return {
    providers: [{ identity, repo, provider: providerRecord, documentUris }],
    newIdentities,
  };
}

/** Seed documents used in mock / demo mode. */
function buildSeedDocuments(providerDid: string, now: string): KnowledgeDocument[] {
  const docs: Array<Omit<KnowledgeDocument, 'contentHash'>> = [
    {
      $type: 'network.mycelium.knowledge.document',
      providerDid,
      title: 'AT Protocol Overview',
      content:
        'AT Protocol (Authenticated Transfer Protocol) is an open, decentralized social networking protocol. ' +
        'It uses DIDs for identity, PDS repos for data storage, and Jetstream/firehose for event distribution. ' +
        'Records are stored in a Merkle Search Tree (MST) that assigns CIDs to every record.',
      domains: ['AT-protocol', 'distributed-systems'],
      version: '1.0',
      createdAt: now,
      updatedAt: now,
    },
    {
      $type: 'network.mycelium.knowledge.document',
      providerDid,
      title: 'Mycelium Agent Capabilities',
      content:
        'Mycelium agents specialize in domains: frontend, backend, security, devops, testing, and architecture. ' +
        'Each agent has a DID, publishes capability records, and earns reputation stamps for completed tasks. ' +
        'Agents discover tasks via the firehose and compete through a claim auction ranked by capability + reputation.',
      domains: ['general', 'AI'],
      version: '1.0',
      createdAt: now,
      updatedAt: now,
    },
    {
      $type: 'network.mycelium.knowledge.document',
      providerDid,
      title: 'Knowledge Provider Verification Levels',
      content:
        'Level 1 (claimed): agent asserts it queried a KB — no verification. ' +
        'Level 2 (cid): agent provides CIDs of specific knowledge.document records used. ' +
        'Level 3 (proof): MST verifyRecordProof() cryptographically proves document existed in PDS repo.',
      domains: ['general', 'distributed-systems'],
      version: '1.0',
      createdAt: now,
      updatedAt: now,
    },
  ];

  return docs.map((d) => ({
    ...d,
    contentHash: `sha256-${createHash('sha256').update(d.content).digest('hex').slice(0, 32)}`,
  }));
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Query a knowledge provider for context relevant to a task.
 * When KB_ENDPOINT is set, attempts HTTP GET; otherwise uses built-in seed matching.
 * Never throws — returns empty context + error code on failure.
 */
export async function queryKnowledgeProvider(
  provider: BootstrappedKnowledgeProvider,
  question: string,
): Promise<KnowledgeQueryResult> {
  const kbEndpoint = process.env['KB_ENDPOINT'];

  if (!kbEndpoint) {
    // Mock path: match seed documents by keyword overlap
    return mockQuery(provider, question);
  }

  // Live path: call KB_ENDPOINT/api/ask
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${kbEndpoint}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { resultCount: 0, context: '', error: 'ENDPOINT_UNREACHABLE' };
    }

    const data = (await response.json()) as {
      results?: Array<{ text: string; cid?: string }>;
    };

    const results = data.results ?? [];
    const context = results.map((r) => r.text).join('\n\n');
    const contextCids = results.flatMap((r) => (r.cid ? [r.cid] : []));

    return {
      resultCount: results.length,
      context,
      contextCids: contextCids.length > 0 ? contextCids : undefined,
    };
  } catch {
    return { resultCount: 0, context: '', error: 'ENDPOINT_UNREACHABLE' };
  }
}

/** Keyword-based mock query against seed documents. */
function mockQuery(provider: BootstrappedKnowledgeProvider, question: string): KnowledgeQueryResult {
  const questionLower = question.toLowerCase();
  const keywords = questionLower.split(/\W+/).filter((w) => w.length > 3);

  const matches: Array<{ doc: KnowledgeDocument; score: number; uri: string }> = [];

  for (const event of provider.repo.firehose.log) {
    if (event.collection !== 'network.mycelium.knowledge.document') continue;
    const doc = event.record as KnowledgeDocument;
    if (!doc || doc.providerDid !== provider.identity.did) continue;

    const docText = `${doc.title} ${doc.content}`.toLowerCase();
    const score = keywords.filter((kw) => docText.includes(kw)).length;
    if (score > 0) {
      const uri = provider.documentUris.get(doc.contentHash) ?? '';
      matches.push({ doc, score, uri });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  const topMatches = matches.slice(0, 2);

  const context = topMatches.map((m) => `[${m.doc.title}]\n${m.doc.content}`).join('\n\n');
  // In mock mode, the "CID" is the AT URI rkey — a stand-in for the real MST CID
  const contextCids = topMatches.map((m) => m.uri).filter(Boolean);

  return {
    resultCount: topMatches.length,
    context,
    contextCids: contextCids.length > 0 ? contextCids : undefined,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute SHA-256 hex hash of a string. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
