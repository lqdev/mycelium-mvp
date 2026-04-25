import { describe, it, expect } from 'vitest';
import {
  AgentProfileSchema,
  AgentCapabilitySchema,
  AgentStateSchema,
  IntelligenceProviderSchema,
  IntelligenceModelSchema,
  TaskPostingSchema,
  TaskClaimSchema,
  TaskCompletionSchema,
  ReputationStampSchema,
  SCHEMA_REGISTRY,
  validateRecord,
} from './index.js';
import { SchemaValidationError } from '../errors.js';

const NOW = '2026-01-01T00:00:00.000Z';
const DID_A = 'did:key:z6MkagentAAAA';
const DID_B = 'did:key:z6MkagentBBBB';
const TASK_URI = 'at://did:key:z6MkagentAAAA/network.mycelium.task.posting/abc';
const CLAIM_URI = 'at://did:key:z6MkagentBBBB/network.mycelium.task.claim/xyz';

// ─── AgentProfile ─────────────────────────────────────────────────────────────

describe('AgentProfileSchema', () => {
  const valid = {
    $type: 'network.mycelium.agent.profile',
    did: DID_A,
    handle: 'atlas.mycelium.local',
    displayName: 'Atlas',
    description: 'Frontend specialist',
    agentType: 'worker',
    intelligenceRefs: [
      { modelDid: DID_B, providerDid: DID_B, role: 'primary', usedFor: ['code-gen'] },
    ],
    operator: { name: 'Demo', contactUri: 'mailto:demo@test.com' },
    maxConcurrentTasks: 2,
    availabilityStatus: 'available',
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('accepts a valid profile', () => {
    expect(() => AgentProfileSchema.parse(valid)).not.toThrow();
  });

  it('rejects missing required field', () => {
    const { displayName: _, ...missing } = valid;
    expect(() => AgentProfileSchema.parse(missing)).toThrow();
  });

  it('rejects invalid agentType', () => {
    expect(() => AgentProfileSchema.parse({ ...valid, agentType: 'bot' })).toThrow();
  });

  it('rejects maxConcurrentTasks < 1', () => {
    expect(() => AgentProfileSchema.parse({ ...valid, maxConcurrentTasks: 0 })).toThrow();
  });
});

// ─── AgentCapability ──────────────────────────────────────────────────────────

describe('AgentCapabilitySchema', () => {
  const valid = {
    $type: 'network.mycelium.agent.capability',
    name: 'React Development',
    slug: 'react-development',
    domain: 'frontend',
    description: 'Build React apps',
    proficiencyLevel: 'advanced',
    tags: ['react', 'typescript'],
    tools: ['vite', 'vitest'],
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('accepts a valid capability', () => {
    expect(() => AgentCapabilitySchema.parse(valid)).not.toThrow();
  });

  it('accepts optional inputSpec and outputSpec', () => {
    const withSpecs = {
      ...valid,
      inputSpec: { description: 'A PR', requiredFields: ['title'] },
      outputSpec: { description: 'Working code', artifacts: ['src/'] },
    };
    expect(() => AgentCapabilitySchema.parse(withSpecs)).not.toThrow();
  });

  it('rejects invalid proficiencyLevel', () => {
    expect(() => AgentCapabilitySchema.parse({ ...valid, proficiencyLevel: 'god' })).toThrow();
  });
});

// ─── AgentState ───────────────────────────────────────────────────────────────

describe('AgentStateSchema', () => {
  const valid = {
    $type: 'network.mycelium.agent.state',
    status: 'idle',
    activeTasks: [],
    queuedTasks: [],
    completedToday: 0,
    lastActivityAt: NOW,
    updatedAt: NOW,
  };

  it('accepts a valid state', () => {
    expect(() => AgentStateSchema.parse(valid)).not.toThrow();
  });

  it('rejects invalid status', () => {
    expect(() => AgentStateSchema.parse({ ...valid, status: 'available' })).toThrow();
  });

  it('rejects negative completedToday', () => {
    expect(() => AgentStateSchema.parse({ ...valid, completedToday: -1 })).toThrow();
  });
});

// ─── IntelligenceProvider ─────────────────────────────────────────────────────

describe('IntelligenceProviderSchema', () => {
  const valid = {
    $type: 'network.mycelium.intelligence.provider',
    did: DID_A,
    name: 'GitHub Models',
    providerType: 'cloud',
    description: 'Aggregated cloud models',
    operator: { name: 'GitHub' },
    modelsOffered: [DID_B],
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('accepts a valid provider', () => {
    expect(() => IntelligenceProviderSchema.parse(valid)).not.toThrow();
  });

  it('accepts optional trustSignals', () => {
    const withTrust = {
      ...valid,
      trustSignals: { verified: true, uptime: 99.9 },
    };
    expect(() => IntelligenceProviderSchema.parse(withTrust)).not.toThrow();
  });

  it('rejects uptime > 100', () => {
    const badTrust = {
      ...valid,
      trustSignals: { verified: true, uptime: 101 },
    };
    expect(() => IntelligenceProviderSchema.parse(badTrust)).toThrow();
  });
});

// ─── IntelligenceModel ────────────────────────────────────────────────────────

describe('IntelligenceModelSchema', () => {
  const valid = {
    $type: 'network.mycelium.intelligence.model',
    did: DID_A,
    providerDid: DID_B,
    name: 'Claude Sonnet 4',
    slug: 'claude-sonnet-4',
    capabilities: ['code-generation', 'reasoning'],
    domains: ['frontend', 'backend'],
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('accepts a valid model', () => {
    expect(() => IntelligenceModelSchema.parse(valid)).not.toThrow();
  });

  it('rejects negative contextWindow', () => {
    expect(() => IntelligenceModelSchema.parse({ ...valid, contextWindow: 0 })).toThrow();
  });
});

// ─── TaskPosting ──────────────────────────────────────────────────────────────

describe('TaskPostingSchema', () => {
  const valid = {
    $type: 'network.mycelium.task.posting',
    title: 'Build auth module',
    description: 'Implement JWT authentication',
    requiredCapabilities: [
      { domain: 'backend', tags: ['nodejs'], minProficiency: 'intermediate' },
    ],
    complexity: 'medium',
    priority: 'high',
    context: { projectName: 'Demo', projectDescription: 'MVP project' },
    deliverables: ['src/auth.ts'],
    status: 'open',
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('accepts a valid task posting', () => {
    expect(() => TaskPostingSchema.parse(valid)).not.toThrow();
  });

  it('rejects invalid status', () => {
    expect(() => TaskPostingSchema.parse({ ...valid, status: 'paused' })).toThrow();
  });

  it('rejects invalid complexity', () => {
    expect(() => TaskPostingSchema.parse({ ...valid, complexity: 'extreme' })).toThrow();
  });
});

// ─── TaskClaim ────────────────────────────────────────────────────────────────

describe('TaskClaimSchema', () => {
  const valid = {
    $type: 'network.mycelium.task.claim',
    taskUri: TASK_URI,
    taskTitle: 'Build auth module',
    claimerDid: DID_B,
    proposal: {
      approach: 'Use JWT with refresh tokens',
      estimatedDuration: 'PT2H',
      confidenceLevel: 'high',
    },
    matchingCapabilities: ['react-development'],
    status: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('accepts a valid claim', () => {
    expect(() => TaskClaimSchema.parse(valid)).not.toThrow();
  });

  it('rejects taskUri not starting with at://', () => {
    expect(() => TaskClaimSchema.parse({ ...valid, taskUri: 'http://bad' })).toThrow();
  });
});

// ─── TaskCompletion ───────────────────────────────────────────────────────────

describe('TaskCompletionSchema', () => {
  const valid = {
    $type: 'network.mycelium.task.completion',
    taskUri: TASK_URI,
    claimUri: CLAIM_URI,
    completerDid: DID_B,
    summary: 'Implemented JWT auth module with refresh tokens',
    artifacts: [
      {
        name: 'auth.ts',
        type: 'code',
        contentHash: 'sha256-abc123',
        size: 1024,
        description: 'Auth module',
      },
    ],
    metrics: { executionTime: 'PT1H30M', linesOfCode: 320, testsPassed: 24, testsTotal: 24 },
    createdAt: NOW,
  };

  it('accepts a valid completion', () => {
    expect(() => TaskCompletionSchema.parse(valid)).not.toThrow();
  });

  it('rejects coveragePercent > 100', () => {
    const bad = { ...valid, metrics: { ...valid.metrics, coveragePercent: 101 } };
    expect(() => TaskCompletionSchema.parse(bad)).toThrow();
  });
});

// ─── ReputationStamp ──────────────────────────────────────────────────────────

describe('ReputationStampSchema', () => {
  const valid = {
    $type: 'network.mycelium.reputation.stamp',
    subjectDid: DID_B,
    attestorDid: DID_A,
    taskUri: TASK_URI,
    completionUri: CLAIM_URI,
    taskDomain: 'backend',
    dimensions: {
      codeQuality: 8.5,
      reliability: 9,
      communication: 7,
      creativity: 8,
      efficiency: 9,
    },
    overallScore: 83,   // 0–100 scale (weighted average × 10)
    assessment: 'strong',
    createdAt: NOW,
  };

  it('accepts a valid stamp', () => {
    expect(() => ReputationStampSchema.parse(valid)).not.toThrow();
  });

  it('rejects overallScore > 100', () => {
    expect(() => ReputationStampSchema.parse({ ...valid, overallScore: 101 })).toThrow();
  });

  it('rejects overallScore < 0', () => {
    expect(() => ReputationStampSchema.parse({ ...valid, overallScore: -1 })).toThrow();
  });

  it('rejects invalid assessment value', () => {
    expect(() => ReputationStampSchema.parse({ ...valid, assessment: 'good' })).toThrow();
  });
});

// ─── SCHEMA_REGISTRY ──────────────────────────────────────────────────────────

describe('SCHEMA_REGISTRY', () => {
  it('contains all 15 record type schemas', () => {
    expect(SCHEMA_REGISTRY.size).toBe(15);
    const expectedNsids = [
      'network.mycelium.agent.profile',
      'network.mycelium.agent.capability',
      'network.mycelium.agent.state',
      'network.mycelium.intelligence.provider',
      'network.mycelium.intelligence.model',
      'network.mycelium.task.posting',
      'network.mycelium.task.claim',
      'network.mycelium.task.completion',
      'network.mycelium.reputation.stamp',
      'network.mycelium.knowledge.provider',
      'network.mycelium.knowledge.document',
      'network.mycelium.knowledge.query',
      'network.mycelium.tool.provider',
      'network.mycelium.tool.definition',
      'network.mycelium.tool.invocation',
    ];
    for (const nsid of expectedNsids) {
      expect(SCHEMA_REGISTRY.has(nsid), `Missing schema: ${nsid}`).toBe(true);
    }
  });
});

// ─── validateRecord() ─────────────────────────────────────────────────────────

describe('validateRecord()', () => {
  it('passes valid content without throwing', () => {
    expect(() =>
      validateRecord('network.mycelium.agent.state', {
        $type: 'network.mycelium.agent.state',
        status: 'idle',
        activeTasks: [],
        queuedTasks: [],
        completedToday: 0,
        lastActivityAt: NOW,
        updatedAt: NOW,
      }),
    ).not.toThrow();
  });

  it('throws SchemaValidationError for invalid content', () => {
    expect(() =>
      validateRecord('network.mycelium.agent.state', { status: 'INVALID' }),
    ).toThrow(SchemaValidationError);
  });

  it('passes through unknown collections without validation', () => {
    expect(() =>
      validateRecord('net.unknown.collection', { anything: true }),
    ).not.toThrow();
  });
});
