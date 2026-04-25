// All Mycelium MVP TypeScript interfaces.
// This is the single source of truth for types — all modules import from here.
// Zod schemas live in src/schemas/index.ts and mirror these interfaces.

// ─── Identity ─────────────────────────────────────────────────────────────────

export interface AgentIdentity {
  did: string;            // e.g., "did:key:z6Mkr..." — signing key; used for internal firehose + AT URIs
  plcDid?: string;        // e.g., "did:plc:abc123" — PDS-assigned DID; used for external PDS/Jetstream routing
  handle: string;         // e.g., "atlas.mycelium.local"
  displayName: string;    // e.g., "Atlas (Frontend Specialist)"
  publicKey: Uint8Array;
  privateKey: Uint8Array; // Only held by the agent itself; never stored
  createdAt: string;      // ISO 8601
}

export interface SignedRecord<T> {
  record: T;
  sig: string;       // Base64url-encoded Ed25519 signature
  signerDid: string; // DID of the signing agent
}

// ─── Firehose ─────────────────────────────────────────────────────────────────

export interface FirehoseEvent {
  seq: number;
  type: 'commit';
  operation: 'create' | 'update' | 'delete';
  did: string;        // DID of the agent whose repo changed
  collection: string; // NSID of the record type
  rkey: string;
  record: unknown;    // The record content (for create/update)
  timestamp: string;
}

export interface FirehoseFilter {
  collections?: string[]; // Only receive events for these NSIDs
  dids?: string[];        // Only receive events from these agents
}

export interface FirehoseSubscription {
  id: string;
  filter?: FirehoseFilter;
  handler: (event: FirehoseEvent) => void | Promise<void>;
}

export interface Firehose {
  seq: number; // Current sequence counter (starts at CONSTANTS.FIREHOSE_SEQ_START)
  log: FirehoseEvent[];
  subscriptions: Map<string, FirehoseSubscription>;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export interface StoredRecordRow {
  uri: string;
  collection: string;
  rkey: string;
  content: string; // JSON string
  sig: string;
  created_at: string;
  updated_at: string;
}

export interface CommitRow {
  seq: number;
  operation: 'create' | 'update' | 'delete';
  record_uri: string;
  content_hash: string;
  repo_root_hash: string;
  timestamp: string;
}

export interface InMemoryStore {
  records: Map<string, StoredRecordRow>;
  commits: CommitRow[];
  seq: number;
}

// ─── Repository ───────────────────────────────────────────────────────────────

export interface AgentRepository {
  did: string;
  store: InMemoryStore;
  identity: AgentIdentity;
  firehose: Firehose | null;
}

export interface RecordResult {
  uri: string; // AT URI: "at://{did}/{collection}/{rkey}"
  cid: string; // SHA-256 hex of canonical JSON content
  commit: {
    seq: number;
    operation: 'create' | 'update';
    repoRootHash: string;
  };
}

/** @deprecated Use CommitRow */
export type Commit = CommitRow;

export interface StoredRecord {
  uri: string;
  collection: string;
  rkey: string;
  content: unknown;
  sig: string;
  created_at: string;
  updated_at: string;
}

export interface RepositoryExport {
  did: string;
  exportedAt: string;
  records: Array<{
    uri: string;
    collection: string;
    rkey: string;
    content: unknown;
    sig: string;
  }>;
  commits: Commit[];
  finalRootHash: string;
}

// ─── Record Types ─────────────────────────────────────────────────────────────

export interface AgentProfile {
  $type: 'network.mycelium.agent.profile';
  did: string;
  handle: string;
  displayName: string;
  description: string;
  agentType: 'worker' | 'orchestrator' | 'supervisor' | 'labeler';
  intelligenceRefs: Array<{
    modelDid: string;
    providerDid: string;
    role: 'primary' | 'secondary' | 'specialized';
    usedFor?: string[];
  }>;
  operator: {
    name: string;
    contactUri?: string;
  };
  maxConcurrentTasks: number;
  availabilityStatus: 'available' | 'busy' | 'offline';
  createdAt: string;
  updatedAt: string;
}

export interface AgentCapability {
  $type: 'network.mycelium.agent.capability';
  name: string;
  slug: string;
  domain: string;
  description: string;
  proficiencyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  tags: string[];
  tools: string[];
  inputSpec?: {
    description: string;
    requiredFields: string[];
  };
  outputSpec?: {
    description: string;
    artifacts: string[];
  };
  constraints?: {
    maxComplexity?: 'low' | 'medium' | 'high';
    estimatedDuration?: string;
    requiresHumanReview?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AgentState {
  $type: 'network.mycelium.agent.state';
  status: 'idle' | 'working' | 'reviewing' | 'offline';
  activeTasks: Array<{
    taskUri: string;
    claimUri: string;
    startedAt: string;
    estimatedCompletion?: string;
  }>;
  queuedTasks: string[];
  completedToday: number;
  lastActivityAt: string;
  updatedAt: string;
}

export interface IntelligenceProvider {
  $type: 'network.mycelium.intelligence.provider';
  did: string;
  name: string;
  providerType: 'cloud' | 'local' | 'hybrid';
  description: string;
  endpoint?: string;
  operator: {
    name: string;
    contactUri?: string;
  };
  modelsOffered: string[];
  trustSignals?: {
    verified: boolean;
    uptime?: number;
    dataRetentionPolicy?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface IntelligenceModel {
  $type: 'network.mycelium.intelligence.model';
  did: string;
  providerDid: string;
  name: string;
  slug: string;
  version?: string;
  modelOrigin?: string;
  capabilities: string[];
  domains: string[];
  contextWindow?: number;
  constraints?: {
    maxTokensPerRequest?: number;
    rateLimitRpm?: number;
    costTier?: 'free' | 'standard' | 'premium';
  };
  benchmarks?: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface TaskPosting {
  $type: 'network.mycelium.task.posting';
  title: string;
  description: string;
  requiredCapabilities: Array<{
    domain: string;
    tags: string[];
    minProficiency: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  }>;
  complexity: 'low' | 'medium' | 'high';
  priority: 'low' | 'normal' | 'high' | 'critical';
  deadline?: string;
  context: {
    projectName: string;
    projectDescription: string;
    relatedTaskUris?: string[];
    resources?: Array<{
      name: string;
      uri: string;
      type: 'document' | 'api' | 'repository' | 'design';
    }>;
  };
  deliverables: string[];
  status: 'open' | 'claimed' | 'assigned' | 'in_progress' | 'completed' | 'accepted' | 'closed';
  assigneeDid?: string;
  claimUris?: string[];
  completionUri?: string;
  requesterDid?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskReview {
  $type: 'network.mycelium.task.review';
  taskUri: string;
  reviewerDid: string;
  outcome: 'accepted' | 'rejected' | 'partial';
  score: number;
  comment?: string;
  createdAt: string;
}

export interface TaskClaim {
  $type: 'network.mycelium.task.claim';
  taskUri: string;
  taskTitle: string;
  claimerDid: string;
  proposal: {
    approach: string;
    estimatedDuration: string;
    confidenceLevel: 'low' | 'medium' | 'high';
  };
  matchingCapabilities: string[];
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  createdAt: string;
  updatedAt: string;
}

export interface TaskCompletion {
  $type: 'network.mycelium.task.completion';
  taskUri: string;
  claimUri: string;
  completerDid: string;
  summary: string;
  artifacts: Array<{
    name: string;
    type: 'code' | 'document' | 'test' | 'config' | 'other';
    contentHash: string;
    size: number;
    description: string;
  }>;
  metrics: {
    executionTime: string;
    linesOfCode?: number;
    testsPassed?: number;
    testsTotal?: number;
    coveragePercent?: number;
  };
  notes?: string;
  intelligenceUsed?: {
    modelDid: string;
    providerDid: string;
  };
  knowledgeUsed?: Array<{ providerDid: string; queryHash: string; verificationLevel: string }>;
  toolsUsed?: Array<{ toolDid: string; toolUri: string; success: boolean }>;
  createdAt: string;
}

export interface ReputationDimensions {
  codeQuality: number;
  reliability: number;
  communication: number;
  creativity: number;
  efficiency: number;
}

export interface ReputationStamp {
  $type: 'network.mycelium.reputation.stamp';
  subjectDid: string;
  attestorDid: string;
  taskUri: string;
  completionUri: string;
  taskDomain: string;
  intelligenceDid?: string;
  knowledgeRefs?: Array<{ providerDid: string; queryHash: string; verificationLevel: string }>;
  toolRefs?: Array<{ toolDid: string; toolUri: string; success: boolean }>;
  attestorType?: 'mayor' | 'requester' | 'peer' | 'verifier';
  dimensions: ReputationDimensions;
  overallScore: number;
  assessment: 'exceptional' | 'strong' | 'satisfactory' | 'needs_improvement' | 'unsatisfactory';
  comment?: string;
  createdAt: string;
}

export interface AggregatedReputation {
  did: string;
  totalTasks: number;
  averageScores: ReputationDimensions;
  overallScore: number;
  taskBreakdown: Record<string, { count: number; avgScore: number }>;
  breakdownByAttestor?: Record<string, { count: number; avgScore: number }>;
  recentTrend: 'improving' | 'stable' | 'declining';
  trustLevel: 'newcomer' | 'established' | 'trusted' | 'expert';
}

// ─── Knowledge Providers ──────────────────────────────────────────────────────

export interface KnowledgeProvider {
  $type: 'network.mycelium.knowledge.provider';
  did: string;
  name: string;
  description: string;
  endpoint: string;
  capabilities: string[];
  domains: string[];
  verificationMethod: 'none' | 'cid';
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocument {
  $type: 'network.mycelium.knowledge.document';
  providerDid: string;
  title: string;
  content: string;
  domains: string[];
  contentHash: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeQuery {
  $type: 'network.mycelium.knowledge.query';
  taskUri: string;
  providerDid: string;
  queryHash: string;
  contextCids?: string[];
  resultCount: number;
  success: boolean;
  errorCode?: string;
  verificationLevel: 'claimed' | 'cid';
  createdAt: string;
}

// ─── Tool Providers ───────────────────────────────────────────────────────────

export interface ToolProvider {
  $type: 'network.mycelium.tool.provider';
  did: string;
  name: string;
  description: string;
  endpoint: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolDefinition {
  $type: 'network.mycelium.tool.definition';
  providerDid: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  category: 'retrieval' | 'execution' | 'communication' | 'generation';
  sideEffects: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolInvocation {
  $type: 'network.mycelium.tool.invocation';
  taskUri: string;
  toolDid: string;
  toolUri: string;
  inputHash: string;
  success: boolean;
  errorCode?: string;
  createdAt: string;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export interface AgentRegistryEntry {
  did: string;
  handle: string;
  capabilities: AgentCapability[];
  activeTasks: string[];
  reputation: AggregatedReputation | null;
}

export interface DecompositionTemplate {
  projectPattern: string;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    requiredCapabilities: Array<{
      domain: string;
      tags: string[];
      minProficiency: 'beginner' | 'intermediate' | 'advanced' | 'expert';
    }>;
    complexity: 'low' | 'medium' | 'high';
    priority: 'low' | 'normal' | 'high' | 'critical';
    dependsOn: string[];
  }>;
}

export interface Mayor {
  identity: AgentIdentity;
  repo: AgentRepository;
  firehose: Firehose;
  template: DecompositionTemplate;
  agentRegistry: Map<string, AgentRegistryEntry>;
  postedTasks: Map<string, { status: string; uri: string; attempts: number; completionUri?: string; completerDid?: string }>;
  /** taskUri → list of rejection events for demo display */
  rejectionLog: Map<string, Array<{ agentDid: string; reason: string }>>;
  /** URI of the external customer task.posting that triggered startProject */
  externalTaskUri?: string;
  /** DID of the external requester who posted the project task */
  externalTaskPosterDid?: string;
}
