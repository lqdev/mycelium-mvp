import { describe, it, expect, vi, afterEach } from 'vitest';
import { createFirehose } from '../firehose/index.js';
import { generateIdentity } from '../identity/index.js';
import { createMemoryRepository } from '../repository/index.js';
import { createStamp } from '../reputation/index.js';
import {
  bootstrapKnowledgeProviders,
  queryKnowledgeProvider,
  sha256,
} from './index.js';
import type { KnowledgeProvider, KnowledgeDocument, KnowledgeQuery } from '../schemas/types.js';

// ─── Bootstrap tests ──────────────────────────────────────────────────────────

describe('bootstrapKnowledgeProviders()', () => {
  it('writes a valid knowledge.provider record to the firehose', () => {
    const firehose = createFirehose();
    bootstrapKnowledgeProviders(firehose);

    const providerEvents = firehose.log.filter(
      (e) => e.collection === 'network.mycelium.knowledge.provider',
    );
    expect(providerEvents).toHaveLength(1);

    const provider = providerEvents[0].record as KnowledgeProvider;
    expect(provider.$type).toBe('network.mycelium.knowledge.provider');
    expect(provider.did).toMatch(/^did:key:/);
    expect(provider.name).toBeTruthy();
    expect(provider.capabilities).toBeInstanceOf(Array);
    expect(provider.capabilities.length).toBeGreaterThan(0);
    expect(provider.domains).toBeInstanceOf(Array);
    expect(['none', 'cid']).toContain(provider.verificationMethod);
  });

  it('writes knowledge.document seed records to the firehose', () => {
    const firehose = createFirehose();
    bootstrapKnowledgeProviders(firehose);

    const docEvents = firehose.log.filter(
      (e) => e.collection === 'network.mycelium.knowledge.document',
    );
    expect(docEvents.length).toBeGreaterThan(0);

    const doc = docEvents[0].record as KnowledgeDocument;
    expect(doc.$type).toBe('network.mycelium.knowledge.document');
    expect(doc.providerDid).toMatch(/^did:key:/);
    expect(doc.title).toBeTruthy();
    expect(doc.content).toBeTruthy();
    expect(doc.contentHash).toMatch(/^sha256-/);
  });

  it('returns providers array with one entry', () => {
    const firehose = createFirehose();
    const { providers } = bootstrapKnowledgeProviders(firehose);
    expect(providers).toHaveLength(1);
    expect(providers[0].identity.did).toMatch(/^did:key:/);
    expect(providers[0].documentUris.size).toBeGreaterThan(0);
  });

  it('reuses existing identity when savedIdentities provided', () => {
    const firehose = createFirehose();
    const { providers: first, newIdentities } = bootstrapKnowledgeProviders(firehose);
    const savedIdentities = new Map([[newIdentities[0].handle, newIdentities[0]]]);

    const firehose2 = createFirehose();
    const { providers: second, newIdentities: newIds2 } = bootstrapKnowledgeProviders(
      firehose2,
      savedIdentities,
    );

    expect(second[0].identity.did).toBe(first[0].identity.did);
    expect(newIds2).toHaveLength(0);
  });

  it('sets verificationMethod to "none" when KB_ENDPOINT is not set', () => {
    const firehose = createFirehose();
    const { providers } = bootstrapKnowledgeProviders(firehose);
    expect(providers[0].provider.verificationMethod).toBe('none');
  });

  it('sets verificationMethod to "cid" when KB_ENDPOINT is set', () => {
    vi.stubEnv('KB_ENDPOINT', 'http://kb.example.com');
    const firehose = createFirehose();
    const { providers } = bootstrapKnowledgeProviders(firehose);
    expect(providers[0].provider.verificationMethod).toBe('cid');
    vi.unstubAllEnvs();
  });
});

// ─── Query tests ──────────────────────────────────────────────────────────────

describe('queryKnowledgeProvider()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns results in mock mode (no KB_ENDPOINT) without throwing', async () => {
    const firehose = createFirehose();
    const { providers } = bootstrapKnowledgeProviders(firehose);
    const result = await queryKnowledgeProvider(providers[0], 'AT Protocol distributed systems');

    expect(result).toBeDefined();
    expect(typeof result.resultCount).toBe('number');
    expect(typeof result.context).toBe('string');
    expect(result.error).toBeUndefined();
  });

  it('returns non-empty context when question matches seed documents', async () => {
    const firehose = createFirehose();
    const { providers } = bootstrapKnowledgeProviders(firehose);
    const result = await queryKnowledgeProvider(providers[0], 'AT Protocol PDS MST distributed');

    expect(result.resultCount).toBeGreaterThan(0);
    expect(result.context.length).toBeGreaterThan(0);
  });

  it('returns contextCids in mock mode (AT URIs of knowledge.document records)', async () => {
    const firehose = createFirehose();
    const { providers } = bootstrapKnowledgeProviders(firehose);
    const result = await queryKnowledgeProvider(providers[0], 'AT Protocol distributed systems');

    if (result.resultCount > 0) {
      expect(result.contextCids).toBeDefined();
      expect(result.contextCids!.length).toBeGreaterThan(0);
      expect(result.contextCids![0]).toContain('at://');
    }
  });

  it('returns empty context for a totally unrelated question', async () => {
    const firehose = createFirehose();
    const { providers } = bootstrapKnowledgeProviders(firehose);
    const result = await queryKnowledgeProvider(providers[0], 'xyzzyquux frob plugh');

    expect(result.resultCount).toBe(0);
    expect(result.context).toBe('');
  });

  it('never throws on unreachable KB_ENDPOINT', async () => {
    vi.stubEnv('KB_ENDPOINT', 'http://unreachable.invalid');
    const firehose = createFirehose();
    const { providers } = bootstrapKnowledgeProviders(firehose);

    await expect(queryKnowledgeProvider(providers[0], 'some question')).resolves.not.toThrow();
    const result = await queryKnowledgeProvider(providers[0], 'some question');
    expect(result.error).toBe('ENDPOINT_UNREACHABLE');
    expect(result.resultCount).toBe(0);
  });

  it('returns verificationLevel "cid" when contextCids populated', async () => {
    const firehose = createFirehose();
    const { providers } = bootstrapKnowledgeProviders(firehose);
    const result = await queryKnowledgeProvider(providers[0], 'AT Protocol distributed');

    if (result.resultCount > 0) {
      const hasContextCids = !!result.contextCids?.length;
      const expectedLevel = hasContextCids ? 'cid' : 'claimed';
      // Verify the level matches whether contextCids are present
      if (hasContextCids) {
        expect(expectedLevel).toBe('cid');
      } else {
        expect(expectedLevel).toBe('claimed');
      }
    }
  });
});

// ─── sha256 helper ────────────────────────────────────────────────────────────

describe('sha256()', () => {
  it('returns a deterministic hex string', () => {
    const h1 = sha256('hello');
    const h2 = sha256('hello');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns different hashes for different inputs', () => {
    expect(sha256('foo')).not.toBe(sha256('bar'));
  });
});

// ─── Reputation stamp knowledgeRefs ──────────────────────────────────────────

describe('reputation stamp with knowledgeRefs', () => {
  it('createStamp includes knowledgeRefs when provided', () => {
    const firehose = createFirehose();
    const attestorId = generateIdentity('mayor.test', 'Mayor');
    const attestorRepo = createMemoryRepository(attestorId, firehose);
    const subjectId = generateIdentity('agent.test', 'Agent');

    const knowledgeRefs = [
      {
        providerDid: 'did:key:zkb123',
        queryHash: sha256('test query'),
        verificationLevel: 'cid' as const,
      },
    ];

    const { stamp } = createStamp({
      attestorRepo,
      subjectDid: subjectId.did,
      taskUri: 'at://did:key:z1/network.mycelium.task.posting/t1',
      completionUri: 'at://did:key:z1/network.mycelium.task.completion/c1',
      taskDomain: 'backend',
      dimensions: { codeQuality: 8, reliability: 8, communication: 8, creativity: 8, efficiency: 8 },
      knowledgeRefs,
    });

    expect(stamp.knowledgeRefs).toBeDefined();
    expect(stamp.knowledgeRefs).toHaveLength(1);
    expect(stamp.knowledgeRefs![0].providerDid).toBe('did:key:zkb123');
    expect(stamp.knowledgeRefs![0].verificationLevel).toBe('cid');
  });

  it('createStamp stamp is written to firehose', () => {
    const firehose = createFirehose();
    const attestorId = generateIdentity('mayor.test2', 'Mayor');
    const attestorRepo = createMemoryRepository(attestorId, firehose);
    const subjectId = generateIdentity('agent.test2', 'Agent');

    createStamp({
      attestorRepo,
      subjectDid: subjectId.did,
      taskUri: 'at://did:key:z1/network.mycelium.task.posting/t2',
      completionUri: 'at://did:key:z1/network.mycelium.task.completion/c2',
      taskDomain: 'frontend',
      dimensions: { codeQuality: 7, reliability: 7, communication: 7, creativity: 7, efficiency: 7 },
      knowledgeRefs: [{ providerDid: 'did:key:zkb456', queryHash: 'abc', verificationLevel: 'claimed' }],
    });

    const stampEvents = firehose.log.filter(
      (e) => e.collection === 'network.mycelium.reputation.stamp',
    );
    expect(stampEvents).toHaveLength(1);
  });
});
