import { describe, it, expect, beforeEach } from 'vitest';
import { bootstrapAgents, capabilityDefToRecord } from './engine.js';
import { bootstrapIntelligence } from '../intelligence/index.js';
import { createFirehose } from '../firehose/index.js';
import { getRecord, listRecords } from '../repository/index.js';
import type { AgentCapability, AgentProfile, AgentState, Firehose } from '../schemas/types.js';
import type { IntelligenceBootstrapResult } from '../intelligence/index.js';

let firehose: Firehose;
let intelligence: IntelligenceBootstrapResult;

beforeEach(() => {
  firehose = createFirehose();
  intelligence = bootstrapIntelligence(firehose);
});

describe('bootstrapAgents()', () => {
  it('creates exactly 6 agents', () => {
    const result = bootstrapAgents(firehose, intelligence);
    expect(result.agents).toHaveLength(6);
  });

  it('each agent has a valid did:key DID', () => {
    const result = bootstrapAgents(firehose, intelligence);
    for (const agent of result.agents) {
      expect(agent.identity.did).toMatch(/^did:key:z6Mk/);
    }
  });

  it('all agent DIDs are distinct', () => {
    const result = bootstrapAgents(firehose, intelligence);
    const dids = result.agents.map((a) => a.identity.did);
    expect(new Set(dids).size).toBe(6);
  });

  it('each agent has an agent.profile record written', () => {
    const result = bootstrapAgents(firehose, intelligence);
    for (const agent of result.agents) {
      const stored = getRecord(agent.repo, 'network.mycelium.agent.profile', 'self');
      expect(stored.content).toBeTruthy();
      const profile = stored.content as AgentProfile;
      expect(profile.$type).toBe('network.mycelium.agent.profile');
      expect(profile.did).toBe(agent.identity.did);
    }
  });

  it('atlas has agentType "worker" and maxConcurrentTasks 2', () => {
    const result = bootstrapAgents(firehose, intelligence);
    const atlas = result.agents.find((a) => a.def.handle === 'atlas.mycelium.local')!;
    const stored = getRecord(atlas.repo, 'network.mycelium.agent.profile', 'self');
    const profile = stored.content as AgentProfile;
    expect(profile.agentType).toBe('worker');
    expect(profile.maxConcurrentTasks).toBe(2);
  });

  it('forge has maxConcurrentTasks 3', () => {
    const result = bootstrapAgents(firehose, intelligence);
    const forge = result.agents.find((a) => a.def.handle === 'forge.mycelium.local')!;
    const stored = getRecord(forge.repo, 'network.mycelium.agent.profile', 'self');
    const profile = stored.content as AgentProfile;
    expect(profile.maxConcurrentTasks).toBe(3);
  });

  it('each agent has exactly 3 capability records', () => {
    const result = bootstrapAgents(firehose, intelligence);
    for (const agent of result.agents) {
      const caps = listRecords(agent.repo, 'network.mycelium.agent.capability');
      expect(caps).toHaveLength(3);
    }
  });

  it('atlas react-development capability has domain "frontend" and proficiency "expert"', () => {
    const result = bootstrapAgents(firehose, intelligence);
    const atlas = result.agents.find((a) => a.def.handle === 'atlas.mycelium.local')!;
    const stored = getRecord(atlas.repo, 'network.mycelium.agent.capability', 'react-development');
    const cap = stored.content as AgentCapability;
    expect(cap.domain).toBe('frontend');
    expect(cap.proficiencyLevel).toBe('expert');
  });

  it('forge react-development capability has proficiency "intermediate"', () => {
    const result = bootstrapAgents(firehose, intelligence);
    const forge = result.agents.find((a) => a.def.handle === 'forge.mycelium.local')!;
    const stored = getRecord(forge.repo, 'network.mycelium.agent.capability', 'react-development');
    const cap = stored.content as AgentCapability;
    expect(cap.proficiencyLevel).toBe('intermediate');
  });

  it('each agent has an initial agent.state record with status "idle"', () => {
    const result = bootstrapAgents(firehose, intelligence);
    for (const agent of result.agents) {
      const stored = getRecord(agent.repo, 'network.mycelium.agent.state', 'self');
      const state = stored.content as AgentState;
      expect(state.status).toBe('idle');
      expect(state.activeTasks).toEqual([]);
      expect(state.completedToday).toBe(0);
    }
  });

  it('atlas intelligenceRefs[0].providerDid equals githubModels provider DID', () => {
    const result = bootstrapAgents(firehose, intelligence);
    const atlas = result.agents.find((a) => a.def.handle === 'atlas.mycelium.local')!;
    const stored = getRecord(atlas.repo, 'network.mycelium.agent.profile', 'self');
    const profile = stored.content as AgentProfile;
    expect(profile.intelligenceRefs).toHaveLength(1);
    expect(profile.intelligenceRefs[0]!.providerDid).toBe(
      intelligence.providers.githubModels.identity.did,
    );
    expect(profile.intelligenceRefs[0]!.modelDid).toBe(intelligence.models.claudeSonnet4.did);
  });

  it('forge intelligenceRefs[0].providerDid equals ollama provider DID', () => {
    const result = bootstrapAgents(firehose, intelligence);
    const forge = result.agents.find((a) => a.def.handle === 'forge.mycelium.local')!;
    const stored = getRecord(forge.repo, 'network.mycelium.agent.profile', 'self');
    const profile = stored.content as AgentProfile;
    expect(profile.intelligenceRefs[0]!.providerDid).toBe(
      intelligence.providers.ollama.identity.did,
    );
    expect(profile.intelligenceRefs[0]!.modelDid).toBe(intelligence.models.llama3.did);
  });

  it('cipher intelligenceRefs[0].modelDid equals gpt4.did', () => {
    const result = bootstrapAgents(firehose, intelligence);
    const cipher = result.agents.find((a) => a.def.handle === 'cipher.mycelium.local')!;
    const stored = getRecord(cipher.repo, 'network.mycelium.agent.profile', 'self');
    const profile = stored.content as AgentProfile;
    expect(profile.intelligenceRefs[0]!.modelDid).toBe(intelligence.models.gpt4.did);
  });

  it('bootstrapAgents emits firehose events for all written records', () => {
    const before = firehose.log.length;
    bootstrapAgents(firehose, intelligence);
    const after = firehose.log.length;
    // 6 agents × (1 profile + 3 capabilities + 1 state) = 30 events
    expect(after - before).toBe(30);
  });
});

describe('capabilityDefToRecord()', () => {
  it('converts a CapabilityDef to a valid AgentCapability object', () => {
    const cap: AgentCapability = capabilityDefToRecord(
      {
        rkey: 'react-development',
        name: 'React Development',
        domain: 'frontend',
        description: 'React components',
        proficiencyLevel: 'expert',
        tags: ['react', 'typescript'],
        tools: ['React', 'TypeScript'],
      },
      'did:key:z6Mk...',
    );
    expect(cap.$type).toBe('network.mycelium.agent.capability');
    expect(cap.slug).toBe('react-development');
    expect(cap.domain).toBe('frontend');
    expect(cap.proficiencyLevel).toBe('expert');
    expect(cap.tags).toContain('react');
  });
});
