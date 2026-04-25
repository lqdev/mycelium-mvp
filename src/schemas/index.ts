// Zod schemas for all 9 Mycelium record types.
// Mirrors the TypeScript interfaces in src/schemas/types.ts.
// Used by putRecord() to validate content before writing.

import { z } from 'zod';
import { SchemaValidationError } from '../errors.js';

// ─── Shared primitives ────────────────────────────────────────────────────────

const isoDateTime = z.string().min(1);
const did = z.string().startsWith('did:');
const atUri = z.string().startsWith('at://');

// ─── 1. AgentProfile ──────────────────────────────────────────────────────────

export const AgentProfileSchema = z.object({
  $type: z.literal('network.mycelium.agent.profile'),
  did,
  handle: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  agentType: z.enum(['worker', 'orchestrator', 'supervisor', 'labeler']),
  intelligenceRefs: z.array(
    z.object({
      modelDid: did,
      providerDid: did,
      role: z.enum(['primary', 'secondary', 'specialized']),
      usedFor: z.array(z.string()).optional(),
    }),
  ),
  operator: z.object({
    name: z.string().min(1),
    contactUri: z.string().optional(),
  }),
  maxConcurrentTasks: z.number().int().min(1),
  availabilityStatus: z.enum(['available', 'busy', 'offline']),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

// ─── 2. AgentCapability ───────────────────────────────────────────────────────

export const AgentCapabilitySchema = z.object({
  $type: z.literal('network.mycelium.agent.capability'),
  name: z.string().min(1),
  slug: z.string().min(1),
  domain: z.string().min(1),
  description: z.string().min(1),
  proficiencyLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
  tags: z.array(z.string()),
  tools: z.array(z.string()),
  inputSpec: z
    .object({
      description: z.string().min(1),
      requiredFields: z.array(z.string()),
    })
    .optional(),
  outputSpec: z
    .object({
      description: z.string().min(1),
      artifacts: z.array(z.string()),
    })
    .optional(),
  constraints: z
    .object({
      maxComplexity: z.enum(['low', 'medium', 'high']).optional(),
      estimatedDuration: z.string().optional(),
      requiresHumanReview: z.boolean().optional(),
    })
    .optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

// ─── 3. AgentState ────────────────────────────────────────────────────────────

export const AgentStateSchema = z.object({
  $type: z.literal('network.mycelium.agent.state'),
  status: z.enum(['idle', 'working', 'reviewing', 'offline']),
  activeTasks: z.array(
    z.object({
      taskUri: atUri,
      claimUri: atUri,
      startedAt: isoDateTime,
      estimatedCompletion: isoDateTime.optional(),
    }),
  ),
  queuedTasks: z.array(z.string()),
  completedToday: z.number().int().min(0),
  lastActivityAt: isoDateTime,
  updatedAt: isoDateTime,
});

// ─── 4. IntelligenceProvider ──────────────────────────────────────────────────

export const IntelligenceProviderSchema = z.object({
  $type: z.literal('network.mycelium.intelligence.provider'),
  did,
  name: z.string().min(1),
  providerType: z.enum(['cloud', 'local', 'hybrid']),
  description: z.string().min(1),
  endpoint: z.string().optional(),
  operator: z.object({
    name: z.string().min(1),
    contactUri: z.string().optional(),
  }),
  modelsOffered: z.array(z.string()),
  trustSignals: z
    .object({
      verified: z.boolean(),
      uptime: z.number().min(0).max(100).optional(),
      dataRetentionPolicy: z.string().optional(),
    })
    .optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

// ─── 5. IntelligenceModel ─────────────────────────────────────────────────────

export const IntelligenceModelSchema = z.object({
  $type: z.literal('network.mycelium.intelligence.model'),
  did,
  providerDid: did,
  name: z.string().min(1),
  slug: z.string().min(1),
  version: z.string().optional(),
  modelOrigin: z.string().optional(),
  capabilities: z.array(z.string()),
  domains: z.array(z.string()),
  contextWindow: z.number().int().positive().optional(),
  constraints: z
    .object({
      maxTokensPerRequest: z.number().int().positive().optional(),
      rateLimitRpm: z.number().int().positive().optional(),
      costTier: z.enum(['free', 'standard', 'premium']).optional(),
    })
    .optional(),
  benchmarks: z.record(z.number()).optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

// ─── 6. TaskPosting ───────────────────────────────────────────────────────────

export const TaskPostingSchema = z.object({
  $type: z.literal('network.mycelium.task.posting'),
  title: z.string().min(1),
  description: z.string().min(1),
  requiredCapabilities: z.array(
    z.object({
      domain: z.string().min(1),
      tags: z.array(z.string()),
      minProficiency: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
    }),
  ),
  complexity: z.enum(['low', 'medium', 'high']),
  priority: z.enum(['low', 'normal', 'high', 'critical']),
  deadline: isoDateTime.optional(),
  context: z.object({
    projectName: z.string().min(1),
    projectDescription: z.string().min(1),
    relatedTaskUris: z.array(z.string()).optional(),
    resources: z
      .array(
        z.object({
          name: z.string().min(1),
          uri: z.string().min(1),
          type: z.enum(['document', 'api', 'repository', 'design']),
        }),
      )
      .optional(),
  }),
  deliverables: z.array(z.string()),
  status: z.enum([
    'open',
    'claimed',
    'assigned',
    'in_progress',
    'completed',
    'accepted',
    'closed',
  ]),
  assigneeDid: did.optional(),
  claimUris: z.array(z.string()).optional(),
  completionUri: z.string().optional(),
  requesterDid: did.optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

// ─── 7. TaskClaim ─────────────────────────────────────────────────────────────

export const TaskClaimSchema = z.object({
  $type: z.literal('network.mycelium.task.claim'),
  taskUri: atUri,
  taskTitle: z.string().min(1),
  claimerDid: did,
  proposal: z.object({
    approach: z.string().min(1),
    estimatedDuration: z.string().min(1),
    confidenceLevel: z.enum(['low', 'medium', 'high']),
  }),
  matchingCapabilities: z.array(z.string()),
  status: z.enum(['pending', 'accepted', 'rejected', 'withdrawn']),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

// ─── 8. TaskCompletion ────────────────────────────────────────────────────────

export const TaskCompletionSchema = z.object({
  $type: z.literal('network.mycelium.task.completion'),
  taskUri: atUri,
  claimUri: atUri,
  completerDid: did,
  summary: z.string().min(1),
  artifacts: z.array(
    z.object({
      name: z.string().min(1),
      type: z.enum(['code', 'document', 'test', 'config', 'other']),
      contentHash: z.string().min(1),
      size: z.number().int().min(0),
      description: z.string().min(1),
    }),
  ),
  metrics: z.object({
    executionTime: z.string().min(1),
    linesOfCode: z.number().int().min(0).optional(),
    testsPassed: z.number().int().min(0).optional(),
    testsTotal: z.number().int().min(0).optional(),
    coveragePercent: z.number().min(0).max(100).optional(),
  }),
  notes: z.string().optional(),
  intelligenceUsed: z
    .object({
      modelDid: did,
      providerDid: did,
    })
    .optional(),
  createdAt: isoDateTime,
});

// ─── 9. ReputationStamp ───────────────────────────────────────────────────────

const reputationScore = z.number().min(0).max(10);

export const ReputationStampSchema = z.object({
  $type: z.literal('network.mycelium.reputation.stamp'),
  subjectDid: did,
  attestorDid: did,
  taskUri: atUri,
  completionUri: atUri,
  taskDomain: z.string().min(1),
  intelligenceDid: did.optional(),
  knowledgeRefs: z.array(z.object({
    providerDid: did,
    queryHash: z.string().min(1),
    verificationLevel: z.string().min(1),
  })).optional(),
  toolRefs: z.array(z.object({
    toolDid: did,
    toolUri: atUri,
    success: z.boolean(),
  })).optional(),
  attestorType: z.enum(['mayor', 'requester', 'peer', 'verifier']).optional(),
  dimensions: z.object({
    codeQuality: reputationScore,
    reliability: reputationScore,
    communication: reputationScore,
    creativity: reputationScore,
    efficiency: reputationScore,
  }),
  overallScore: z.number().min(0).max(100), // 0–100 (weighted sum of 0–10 dims × 10)
  assessment: z.enum([
    'exceptional',
    'strong',
    'satisfactory',
    'needs_improvement',
    'unsatisfactory',
  ]),
  comment: z.string().optional(),
  createdAt: isoDateTime,
});

// ─── 10. KnowledgeProvider ────────────────────────────────────────────────────

export const KnowledgeProviderSchema = z.object({
  $type: z.literal('network.mycelium.knowledge.provider'),
  did: did,
  name: z.string().min(1),
  description: z.string().min(1),
  endpoint: z.string().url(),
  capabilities: z.array(z.string().min(1)),
  domains: z.array(z.string().min(1)),
  verificationMethod: z.enum(['none', 'cid']),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

// ─── 11. KnowledgeDocument ────────────────────────────────────────────────────

export const KnowledgeDocumentSchema = z.object({
  $type: z.literal('network.mycelium.knowledge.document'),
  providerDid: did,
  title: z.string().min(1),
  content: z.string().min(1),
  domains: z.array(z.string().min(1)),
  contentHash: z.string().min(1),
  version: z.string().min(1),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

// ─── 12. KnowledgeQuery ───────────────────────────────────────────────────────

export const KnowledgeQuerySchema = z.object({
  $type: z.literal('network.mycelium.knowledge.query'),
  taskUri: atUri,
  providerDid: did,
  queryHash: z.string().min(1),
  contextCids: z.array(z.string().min(1)).optional(),
  resultCount: z.number().int().min(0),
  success: z.boolean(),
  errorCode: z.string().optional(),
  verificationLevel: z.enum(['claimed', 'cid']),
  createdAt: isoDateTime,
});

// ─── 13. ToolProvider ─────────────────────────────────────────────────────────

export const ToolProviderSchema = z.object({
  $type: z.literal('network.mycelium.tool.provider'),
  did: did,
  name: z.string().min(1),
  description: z.string().min(1),
  endpoint: z.string().url(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

// ─── 14. ToolDefinition ───────────────────────────────────────────────────────

export const ToolDefinitionSchema = z.object({
  $type: z.literal('network.mycelium.tool.definition'),
  providerDid: did,
  name: z.string().min(1),
  description: z.string().min(1),
  inputSchema: z.record(z.unknown()),
  outputSchema: z.record(z.unknown()).optional(),
  category: z.enum(['retrieval', 'execution', 'communication', 'generation']),
  sideEffects: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

// ─── 15. ToolInvocation ───────────────────────────────────────────────────────

export const ToolInvocationSchema = z.object({
  $type: z.literal('network.mycelium.tool.invocation'),
  taskUri: atUri,
  toolDid: did,
  toolUri: atUri,
  inputHash: z.string().min(1),
  success: z.boolean(),
  errorCode: z.string().optional(),
  createdAt: isoDateTime,
});

// ─── 16. TaskReview ───────────────────────────────────────────────────────────

export const TaskReviewSchema = z.object({
  $type: z.literal('network.mycelium.task.review'),
  taskUri: atUri,
  reviewerDid: did,
  outcome: z.enum(['accepted', 'rejected', 'partial']),
  score: z.number().min(0).max(100),
  comment: z.string().optional(),
  createdAt: isoDateTime,
});

// ─── Schema Registry ──────────────────────────────────────────────────────────

export const SCHEMA_REGISTRY = new Map<string, z.ZodObject<z.ZodRawShape>>([
  ['network.mycelium.agent.profile', AgentProfileSchema],
  ['network.mycelium.agent.capability', AgentCapabilitySchema],
  ['network.mycelium.agent.state', AgentStateSchema],
  ['network.mycelium.intelligence.provider', IntelligenceProviderSchema],
  ['network.mycelium.intelligence.model', IntelligenceModelSchema],
  ['network.mycelium.task.posting', TaskPostingSchema],
  ['network.mycelium.task.claim', TaskClaimSchema],
  ['network.mycelium.task.completion', TaskCompletionSchema],
  ['network.mycelium.reputation.stamp', ReputationStampSchema],
  ['network.mycelium.knowledge.provider', KnowledgeProviderSchema],
  ['network.mycelium.knowledge.document', KnowledgeDocumentSchema],
  ['network.mycelium.knowledge.query', KnowledgeQuerySchema],
  ['network.mycelium.tool.provider', ToolProviderSchema],
  ['network.mycelium.tool.definition', ToolDefinitionSchema],
  ['network.mycelium.tool.invocation', ToolInvocationSchema],
  ['network.mycelium.task.review', TaskReviewSchema],
]);

/**
 * Validate a record against its registered Zod schema.
 * Unknown collections (not in the registry) pass through without validation.
 *
 * @throws SchemaValidationError if validation fails
 */
export function validateRecord(collection: string, content: unknown): void {
  const schema = SCHEMA_REGISTRY.get(collection);
  if (!schema) return;

  const result = schema.safeParse(content);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new SchemaValidationError(collection, issues);
  }
}
