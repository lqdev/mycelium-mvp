import { describe, it, expect, vi, afterEach } from 'vitest';
import { createFirehose } from '../firehose/index.js';
import { generateIdentity } from '../identity/index.js';
import { createMemoryRepository } from '../repository/index.js';
import { createStamp } from '../reputation/index.js';
import {
  bootstrapToolProviders,
  invokeToolProvider,
  selectTool,
  sha256,
} from './index.js';
import type { ToolProvider, ToolDefinition, ToolInvocation } from '../schemas/types.js';

// ─── Bootstrap tests ──────────────────────────────────────────────────────────

describe('bootstrapToolProviders()', () => {
  it('writes a valid tool.provider record to the firehose', () => {
    const firehose = createFirehose();
    bootstrapToolProviders(firehose);

    const providerEvents = firehose.log.filter(
      (e) => e.collection === 'network.mycelium.tool.provider',
    );
    expect(providerEvents).toHaveLength(1);

    const provider = providerEvents[0].record as ToolProvider;
    expect(provider.$type).toBe('network.mycelium.tool.provider');
    expect(provider.did).toMatch(/^did:key:/);
    expect(provider.name).toBeTruthy();
    expect(provider.endpoint).toBeTruthy();
  });

  it('writes tool.definition records to the firehose', () => {
    const firehose = createFirehose();
    bootstrapToolProviders(firehose);

    const defEvents = firehose.log.filter(
      (e) => e.collection === 'network.mycelium.tool.definition',
    );
    expect(defEvents.length).toBeGreaterThan(0);

    const def = defEvents[0].record as ToolDefinition;
    expect(def.$type).toBe('network.mycelium.tool.definition');
    expect(def.providerDid).toMatch(/^did:key:/);
    expect(def.name).toBeTruthy();
    expect(def.inputSchema).toBeDefined();
    expect(['retrieval', 'execution', 'communication', 'generation']).toContain(def.category);
    expect(typeof def.sideEffects).toBe('boolean');
  });

  it('returns providers with definitions having AT URIs', () => {
    const firehose = createFirehose();
    const { providers } = bootstrapToolProviders(firehose);

    expect(providers).toHaveLength(1);
    const tp = providers[0];
    expect(tp.definitions.length).toBeGreaterThan(0);

    for (const entry of tp.definitions) {
      expect(entry.uri).toMatch(/^at:\/\//);
      expect(entry.definition.name).toBeTruthy();
    }
  });

  it('reuses existing identity when savedIdentities provided', () => {
    const firehose = createFirehose();
    const { providers: first, newIdentities } = bootstrapToolProviders(firehose);
    const savedIdentities = new Map([[newIdentities[0].handle, newIdentities[0]]]);

    const firehose2 = createFirehose();
    const { providers: second, newIdentities: newIds2 } = bootstrapToolProviders(
      firehose2,
      savedIdentities,
    );

    expect(second[0].identity.did).toBe(first[0].identity.did);
    expect(newIds2).toHaveLength(0);
  });

  it('includes general-assistance tool in mock mode', () => {
    const firehose = createFirehose();
    const { providers } = bootstrapToolProviders(firehose);
    const names = providers[0].definitions.map((d) => d.definition.name);
    expect(names).toContain('general-assistance');
  });

  it('tool.definition providerDid matches provider identity', () => {
    const firehose = createFirehose();
    const { providers } = bootstrapToolProviders(firehose);
    const tp = providers[0];
    for (const entry of tp.definitions) {
      expect(entry.definition.providerDid).toBe(tp.identity.did);
    }
  });
});

// ─── Invocation tests ─────────────────────────────────────────────────────────

describe('invokeToolProvider()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns success in mock mode (no TOOL_ENDPOINT) without throwing', async () => {
    const firehose = createFirehose();
    const { providers } = bootstrapToolProviders(firehose);
    const tp = providers[0];
    const toolUri = tp.definitions[0].uri;

    const result = await invokeToolProvider(tp, toolUri, { taskUri: 'at://did:key:z1/task/t1' });
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('never throws on unreachable TOOL_ENDPOINT', async () => {
    vi.stubEnv('TOOL_ENDPOINT', 'http://unreachable.invalid');
    const firehose = createFirehose();
    const { providers } = bootstrapToolProviders(firehose);
    const tp = providers[0];
    const toolUri = tp.definitions[0].uri;

    await expect(
      invokeToolProvider(tp, toolUri, { taskUri: 'at://did:key:z1/task/t1' }),
    ).resolves.not.toThrow();

    const result = await invokeToolProvider(tp, toolUri, { taskUri: 'at://did:key:z1/task/t1' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('ENDPOINT_UNREACHABLE');
  });
});

// ─── selectTool tests ─────────────────────────────────────────────────────────

describe('selectTool()', () => {
  it('returns general-assistance as fallback for unmatched capabilities', () => {
    const firehose = createFirehose();
    const { providers } = bootstrapToolProviders(firehose);
    const tp = providers[0];

    const selected = selectTool(tp, [{ domain: 'xyzzy', tags: ['unknown'] }]);
    expect(selected).toBeDefined();
    expect(selected!.definition.name).toBe('general-assistance');
  });

  it('returns matching definition when domain matches tool name', () => {
    const firehose = createFirehose();
    const { providers } = bootstrapToolProviders(firehose);
    const tp = providers[0];

    const selected = selectTool(tp, [{ domain: 'code', tags: ['analysis'] }]);
    expect(selected).toBeDefined();
    expect(selected!.uri).toMatch(/^at:\/\//);
  });

  it('returns undefined when provider has no definitions', () => {
    const firehose = createFirehose();
    const { providers } = bootstrapToolProviders(firehose);
    const emptyProvider = { ...providers[0], definitions: [] };

    const selected = selectTool(emptyProvider, [{ domain: 'backend', tags: ['api'] }]);
    expect(selected).toBeUndefined();
  });
});

// ─── sha256 helper ────────────────────────────────────────────────────────────

describe('sha256()', () => {
  it('returns a deterministic hex string', () => {
    const h1 = sha256('hello world');
    const h2 = sha256('hello world');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns different hashes for different inputs', () => {
    expect(sha256('foo')).not.toBe(sha256('bar'));
  });
});

// ─── Reputation stamp toolRefs ────────────────────────────────────────────────

describe('reputation stamp with toolRefs', () => {
  it('createStamp includes toolRefs when provided', () => {
    const firehose = createFirehose();
    const attestorId = generateIdentity('mayor.tooltest', 'Mayor');
    const attestorRepo = createMemoryRepository(attestorId, firehose);
    const subjectId = generateIdentity('agent.tooltest', 'Agent');

    const toolRefs = [
      {
        toolDid: 'did:key:ztool123',
        toolUri: 'at://did:key:ztool123/network.mycelium.tool.definition/tool-code-analysis',
        success: true,
      },
    ];

    const { stamp } = createStamp({
      attestorRepo,
      subjectDid: subjectId.did,
      taskUri: 'at://did:key:z1/network.mycelium.task.posting/t3',
      completionUri: 'at://did:key:z1/network.mycelium.task.completion/c3',
      taskDomain: 'backend',
      dimensions: { codeQuality: 9, reliability: 9, communication: 9, creativity: 9, efficiency: 9 },
      toolRefs,
    });

    expect(stamp.toolRefs).toBeDefined();
    expect(stamp.toolRefs).toHaveLength(1);
    expect(stamp.toolRefs![0].toolUri).toContain('tool-code-analysis');
    expect(stamp.toolRefs![0].success).toBe(true);
  });

  it('createStamp includes both knowledgeRefs and toolRefs together', () => {
    const firehose = createFirehose();
    const attestorId = generateIdentity('mayor.both', 'Mayor');
    const attestorRepo = createMemoryRepository(attestorId, firehose);
    const subjectId = generateIdentity('agent.both', 'Agent');

    const knowledgeRefs = [
      { providerDid: 'did:key:zkb', queryHash: sha256('query'), verificationLevel: 'claimed' as const },
    ];
    const toolRefs = [
      { toolDid: 'did:key:ztool', toolUri: 'at://did:key:ztool/network.mycelium.tool.definition/t1', success: true },
    ];

    const { stamp } = createStamp({
      attestorRepo,
      subjectDid: subjectId.did,
      taskUri: 'at://did:key:z1/network.mycelium.task.posting/t4',
      completionUri: 'at://did:key:z1/network.mycelium.task.completion/c4',
      taskDomain: 'security',
      dimensions: { codeQuality: 7, reliability: 8, communication: 8, creativity: 7, efficiency: 9 },
      knowledgeRefs,
      toolRefs,
    });

    expect(stamp.knowledgeRefs).toHaveLength(1);
    expect(stamp.toolRefs).toHaveLength(1);

    // Verify the stamp record appears in the firehose
    const stampEvent = firehose.log.find(
      (e) => e.collection === 'network.mycelium.reputation.stamp',
    );
    expect(stampEvent).toBeDefined();
    const written = stampEvent!.record as typeof stamp;
    expect(written.knowledgeRefs).toBeDefined();
    expect(written.toolRefs).toBeDefined();
  });
});
