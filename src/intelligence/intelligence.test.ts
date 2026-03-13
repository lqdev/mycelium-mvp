import { describe, it, expect, beforeEach } from 'vitest';
import { bootstrapIntelligence, listModels, resolveModelDid } from './index.js';
import { createFirehose } from '../firehose/index.js';
import type { Firehose, IntelligenceModel, IntelligenceProvider } from '../schemas/types.js';
import { getRecord, listRecords } from '../repository/index.js';

let firehose: Firehose;

beforeEach(() => {
  firehose = createFirehose();
});

describe('bootstrapIntelligence()', () => {
  it('creates 2 providers with distinct DIDs', () => {
    const result = bootstrapIntelligence(firehose);
    const ghDid = result.providers.githubModels.identity.did;
    const olDid = result.providers.ollama.identity.did;
    expect(ghDid).toMatch(/^did:key:z6Mk/);
    expect(olDid).toMatch(/^did:key:z6Mk/);
    expect(ghDid).not.toBe(olDid);
  });

  it('GitHub Models provider has providerType cloud and correct endpoint', () => {
    const result = bootstrapIntelligence(firehose);
    const stored = getRecord(
      result.providers.githubModels.repo,
      'network.mycelium.intelligence.provider',
      'self',
    );
    const provider = stored.content as IntelligenceProvider;
    expect(provider.providerType).toBe('cloud');
    expect(provider.endpoint).toBe('https://api.github.com/models');
    expect(provider.name).toBe('GitHub Models');
  });

  it('Ollama provider has providerType local and correct endpoint', () => {
    const result = bootstrapIntelligence(firehose);
    const stored = getRecord(
      result.providers.ollama.repo,
      'network.mycelium.intelligence.provider',
      'self',
    );
    const provider = stored.content as IntelligenceProvider;
    expect(provider.providerType).toBe('local');
    expect(provider.endpoint).toBe('http://localhost:11434');
    expect(provider.name).toBe('Local Ollama');
  });

  it('creates 6 model identities with distinct DIDs', () => {
    const result = bootstrapIntelligence(firehose);
    const dids = Object.values(result.models).map((m) => m.did);
    const unique = new Set(dids);
    expect(unique.size).toBe(6);
    for (const did of dids) {
      expect(did).toMatch(/^did:key:z6Mk/);
    }
  });

  it('GitHub Models repo contains 4 model records', () => {
    const result = bootstrapIntelligence(firehose);
    const models = listRecords(
      result.providers.githubModels.repo,
      'network.mycelium.intelligence.model',
    );
    expect(models).toHaveLength(4);
  });

  it('Ollama repo contains 2 model records', () => {
    const result = bootstrapIntelligence(firehose);
    const models = listRecords(
      result.providers.ollama.repo,
      'network.mycelium.intelligence.model',
    );
    expect(models).toHaveLength(2);
  });

  it('each GitHub model record has correct providerDid', () => {
    const result = bootstrapIntelligence(firehose);
    const models = listModels(result.providers.githubModels.repo);
    for (const model of models) {
      expect(model.providerDid).toBe(result.providers.githubModels.identity.did);
    }
  });

  it('each Ollama model record has correct providerDid', () => {
    const result = bootstrapIntelligence(firehose);
    const models = listModels(result.providers.ollama.repo);
    for (const model of models) {
      expect(model.providerDid).toBe(result.providers.ollama.identity.did);
    }
  });

  it('GitHub Models provider.modelsOffered contains 4 DIDs matching model DIDs', () => {
    const result = bootstrapIntelligence(firehose);
    const stored = getRecord(
      result.providers.githubModels.repo,
      'network.mycelium.intelligence.provider',
      'self',
    );
    const provider = stored.content as IntelligenceProvider;
    expect(provider.modelsOffered).toHaveLength(4);
    expect(provider.modelsOffered).toContain(result.models.claudeSonnet4.did);
    expect(provider.modelsOffered).toContain(result.models.claudeHaiku4.did);
    expect(provider.modelsOffered).toContain(result.models.gpt4.did);
    expect(provider.modelsOffered).toContain(result.models.phi4.did);
  });

  it('Ollama provider.modelsOffered contains 2 DIDs matching model DIDs', () => {
    const result = bootstrapIntelligence(firehose);
    const stored = getRecord(
      result.providers.ollama.repo,
      'network.mycelium.intelligence.provider',
      'self',
    );
    const provider = stored.content as IntelligenceProvider;
    expect(provider.modelsOffered).toHaveLength(2);
    expect(provider.modelsOffered).toContain(result.models.llama3.did);
    expect(provider.modelsOffered).toContain(result.models.codellama.did);
  });

  it('emits firehose events for provider and model records', () => {
    bootstrapIntelligence(firehose);
    // 4 github models + 2 ollama models + 2 provider records = 8 total
    // (provider records are writes → create events)
    const modelEvents = firehose.log.filter(
      (e) => e.collection === 'network.mycelium.intelligence.model',
    );
    const providerEvents = firehose.log.filter(
      (e) => e.collection === 'network.mycelium.intelligence.provider',
    );
    expect(modelEvents).toHaveLength(6);
    expect(providerEvents).toHaveLength(2);
  });
});

describe('listModels()', () => {
  it('returns IntelligenceModel objects from a provider repo', () => {
    const result = bootstrapIntelligence(firehose);
    const models = listModels(result.providers.githubModels.repo);
    expect(models).toHaveLength(4);
    for (const m of models) {
      expect(m.$type).toBe('network.mycelium.intelligence.model');
      expect(m.contextWindow).toBeGreaterThan(0);
    }
  });

  it('returns models in Ollama repo with local-first capability', () => {
    const result = bootstrapIntelligence(firehose);
    const models = listModels(result.providers.ollama.repo);
    expect(models.every((m) => m.capabilities.includes('local-first'))).toBe(true);
  });
});

describe('resolveModelDid()', () => {
  it('resolves claude-sonnet-4 to claudeSonnet4.did', () => {
    const result = bootstrapIntelligence(firehose);
    expect(resolveModelDid(result.models, 'claude-sonnet-4')).toBe(result.models.claudeSonnet4.did);
  });

  it('resolves gpt-4 to gpt4.did', () => {
    const result = bootstrapIntelligence(firehose);
    expect(resolveModelDid(result.models, 'gpt-4')).toBe(result.models.gpt4.did);
  });

  it('resolves llama-3-70b to llama3.did', () => {
    const result = bootstrapIntelligence(firehose);
    expect(resolveModelDid(result.models, 'llama-3-70b')).toBe(result.models.llama3.did);
  });

  it('resolves codellama to codellama.did', () => {
    const result = bootstrapIntelligence(firehose);
    expect(resolveModelDid(result.models, 'codellama')).toBe(result.models.codellama.did);
  });

  it('returns undefined for an unknown slug', () => {
    const result = bootstrapIntelligence(firehose);
    expect(resolveModelDid(result.models, 'unknown-model')).toBeUndefined();
  });
});
