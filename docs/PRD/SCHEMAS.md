# Mycelium MVP — Lexicon Schema Definitions

> Defines all record types used in the MVP. These mirror the proposed `network.mycelium.*` Lexicon NSIDs from the research, expressed as TypeScript types with JSON Schema semantics.

---

## Namespace Convention

All Mycelium records use the `network.mycelium.*` namespace (reverse-DNS), following AT Protocol Lexicon conventions. The MVP defines **16 record types** organized across 6 domains: `agent`, `intelligence`, `task`, `reputation`, `knowledge`, and `tool`.

```
network.mycelium.{domain}.{type}
```

Records are stored at AT URIs: `at://{did}/{collection}/{rkey}`

---

## 1. Agent Profile

**NSID:** `network.mycelium.agent.profile`
**Purpose:** Singleton record describing an agent's identity and operational parameters.
**Stored in:** Agent's own repository.
**rkey:** `self` (singleton — one per agent)

```typescript
interface AgentProfile {
  $type: "network.mycelium.agent.profile";
  did: string;                          // Agent's DID
  handle: string;                       // Human-readable handle
  displayName: string;                  // Friendly name
  description: string;                  // What this agent does
  agentType: "worker" | "orchestrator" | "supervisor" | "labeler";
  intelligenceRefs: Array<{             // What intelligence powers this agent (DID-linked)
    modelDid: string;                   // DID of the intelligence.model record
    providerDid: string;                // DID of the intelligence.provider
    role: "primary" | "secondary" | "specialized";
    usedFor?: string[];                 // e.g., ["code-generation", "review"]
  }>;
  operator: {                           // Who operates this agent
    name: string;
    contactUri?: string;                // e.g., "mailto:..." or DID
  };
  maxConcurrentTasks: number;           // How many tasks can run in parallel
  availabilityStatus: "available" | "busy" | "offline";
  createdAt: string;                    // ISO 8601
  updatedAt: string;
}
```

**Example:**
```json
{
  "$type": "network.mycelium.agent.profile",
  "did": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  "handle": "atlas.mycelium.local",
  "displayName": "Atlas (Frontend Specialist)",
  "description": "Specializes in React/TypeScript frontend development with a focus on accessibility and responsive design.",
  "agentType": "worker",
  "intelligenceRefs": [{
    "modelDid": "did:key:z6MkCS4model1...",
    "providerDid": "did:key:z6MkGitHubModels...",
    "role": "primary",
    "usedFor": ["code-generation", "code-review"]
  }],
  "operator": {
    "name": "Mycelium Demo",
    "contactUri": "mailto:demo@mycelium.network"
  },
  "maxConcurrentTasks": 2,
  "availabilityStatus": "available",
  "createdAt": "2026-03-11T00:00:00Z",
  "updatedAt": "2026-03-11T00:00:00Z"
}
```

---

## 2. Agent Capability

**NSID:** `network.mycelium.agent.capability`
**Purpose:** Declares a specific capability the agent possesses, with structured input/output specs.
**Stored in:** Agent's own repository.
**rkey:** Capability slug (e.g., `react-development`, `api-design`)

**Tag normalization rules:**
- All tags are **kebab-case, lowercase** (e.g., `"code-generation"`, `"ci-cd"`)
- Tag matching is **exact string equality** — no fuzzy matching, no pluralization
- Use only the closed vocabulary defined in [INTELLIGENCE.md — Capability Tag Vocabulary](./INTELLIGENCE.md#capability-tag-vocabulary)

```typescript
interface AgentCapability {
  $type: "network.mycelium.agent.capability";
  name: string;                         // Human-readable capability name
  slug: string;                         // URL-safe identifier
  domain: string;                       // Category: "frontend", "backend", "devops", etc.
  description: string;                  // What this capability entails
  proficiencyLevel: "beginner" | "intermediate" | "advanced" | "expert";
  tags: string[];                       // Searchable tags
  tools: string[];                      // Tools/frameworks the agent can use
  inputSpec?: {                         // What inputs the agent needs
    description: string;
    requiredFields: string[];
  };
  outputSpec?: {                        // What outputs the agent produces
    description: string;
    artifacts: string[];                // Types of artifacts produced
  };
  constraints?: {                       // Operational constraints
    maxComplexity?: "low" | "medium" | "high";
    estimatedDuration?: string;         // ISO 8601 duration, e.g., "PT30M"
    requiresHumanReview?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}
```

**Example:**
```json
{
  "$type": "network.mycelium.agent.capability",
  "name": "React Component Development",
  "slug": "react-development",
  "domain": "frontend",
  "description": "Build React components with TypeScript, including state management, hooks, and responsive design.",
  "proficiencyLevel": "expert",
  "tags": ["react", "typescript", "frontend", "components", "hooks"],
  "tools": ["React 18+", "TypeScript", "Tailwind CSS", "Storybook"],
  "inputSpec": {
    "description": "Component specification with requirements, design mockup reference, and API contract",
    "requiredFields": ["componentName", "requirements", "apiContract"]
  },
  "outputSpec": {
    "description": "React component with tests and documentation",
    "artifacts": ["component.tsx", "component.test.tsx", "component.stories.tsx"]
  },
  "constraints": {
    "maxComplexity": "high",
    "estimatedDuration": "PT2H",
    "requiresHumanReview": false
  },
  "createdAt": "2026-03-11T00:00:00Z",
  "updatedAt": "2026-03-11T00:00:00Z"
}
```

---

## 3. Intelligence Provider

**NSID:** `network.mycelium.intelligence.provider`
**Purpose:** Represents an entity that operates AI models — could be a unified cloud gateway (GitHub Models), a self-hosted deployment (Ollama), or a compute cooperative.
**Stored in:** Provider's own repository.
**rkey:** `self` (singleton per provider)

```typescript
interface IntelligenceProvider {
  $type: "network.mycelium.intelligence.provider";
  did: string;                          // Provider's DID
  name: string;                         // e.g., "GitHub Models", "Local Ollama"
  providerType: "cloud" | "local" | "hybrid";
  description: string;                  // What this provider offers
  endpoint?: string;                    // API endpoint (optional, for discovery)
  operator: {
    name: string;
    contactUri?: string;
  };
  modelsOffered: string[];              // DIDs of intelligence.model records
  trustSignals?: {
    verified: boolean;                  // Has the provider been verified?
    uptime?: number;                    // 0-100 availability percentage
    dataRetentionPolicy?: string;       // e.g., "none", "30-days", "permanent"
  };
  createdAt: string;
  updatedAt: string;
}
```

**Example:**
```json
{
  "$type": "network.mycelium.intelligence.provider",
  "did": "did:key:z6MkGitHubModels...",
  "name": "GitHub Models",
  "providerType": "cloud",
  "description": "Unified cloud gateway aggregating models from Anthropic, OpenAI, Microsoft, Meta, and other providers through GitHub's API.",
  "endpoint": "https://api.github.com/models",
  "operator": {
    "name": "GitHub",
    "contactUri": "https://github.com"
  },
  "modelsOffered": [
    "did:key:z6MkCS4model1...",
    "did:key:z6MkCS4model2...",
    "did:key:z6MkGP4model1...",
    "did:key:z6MkPH4model1..."
  ],
  "trustSignals": {
    "verified": true,
    "uptime": 99.9,
    "dataRetentionPolicy": "minimal"
  },
  "createdAt": "2026-03-11T00:00:00Z",
  "updatedAt": "2026-03-11T00:00:00Z"
}
```

---

## 4. Intelligence Model

**NSID:** `network.mycelium.intelligence.model`
**Purpose:** Represents a specific AI model that can power agents. Each model has its own DID and declared capabilities.
**Stored in:** Provider's repository (provider attests to the model's capabilities).
**rkey:** Model slug (e.g., `claude-sonnet-4`, `gpt-4`)

> **Complete model specifications** (all 6 models with full capability lists, provider assignments, and agent-to-model mappings) are in [INTELLIGENCE.md](./INTELLIGENCE.md). The schema below defines the record shape; INTELLIGENCE.md defines the concrete values used at bootstrap.

```typescript
interface IntelligenceModel {
  $type: "network.mycelium.intelligence.model";
  did: string;                          // Model's DID
  providerDid: string;                  // DID of the provider offering this model (e.g., GitHub Models, Ollama)
  name: string;                         // e.g., "Claude Sonnet 4", "GPT-4"
  slug: string;                         // e.g., "claude-sonnet-4", "gpt-4"
  version?: string;                     // e.g., "2026-03-01"
  modelOrigin?: string;                 // Original creator if different from provider (e.g., "Anthropic", "OpenAI") — informational only
  capabilities: string[];               // e.g., ["code-generation", "analysis", "reasoning", "conversation"]
  domains: string[];                    // e.g., ["frontend", "backend", "security"] — what it's good at
  contextWindow?: number;               // Token limit
  constraints?: {
    maxTokensPerRequest?: number;
    rateLimitRpm?: number;              // Requests per minute
    costTier?: "free" | "standard" | "premium";
  };
  benchmarks?: Record<string, number>;  // e.g., {"code-quality": 92, "reasoning": 88}
  createdAt: string;
  updatedAt: string;
}
```

**Example:**
```json
{
  "$type": "network.mycelium.intelligence.model",
  "did": "did:key:z6MkCS4model1...",
  "providerDid": "did:key:z6MkGitHubModels...",
  "name": "Claude Sonnet 4",
  "slug": "claude-sonnet-4",
  "version": "2026-03-01",
  "modelOrigin": "Anthropic",
  "capabilities": ["code-generation", "code-review", "analysis", "reasoning"],
  "domains": ["frontend", "backend", "security", "testing"],
  "contextWindow": 200000,
  "constraints": {
    "maxTokensPerRequest": 8192,
    "rateLimitRpm": 60,
    "costTier": "standard"
  },
  "benchmarks": {
    "code-quality": 92,
    "reasoning": 95,
    "instruction-following": 90
  },
  "createdAt": "2026-03-11T00:00:00Z",
  "updatedAt": "2026-03-11T00:00:00Z"
}
```

---

## 5. Agent State

**NSID:** `network.mycelium.agent.state`
**Purpose:** Tracks the agent's current operational state — what it's working on, its queue, etc.
**Stored in:** Agent's own repository.
**rkey:** `self` (singleton)

```typescript
interface AgentState {
  $type: "network.mycelium.agent.state";
  status: "idle" | "working" | "reviewing" | "offline";
  activeTasks: Array<{
    taskUri: string;                    // AT URI of the task.posting
    claimUri: string;                   // AT URI of this agent's task.claim
    startedAt: string;
    estimatedCompletion?: string;
  }>;
  queuedTasks: string[];               // AT URIs of tasks claimed but not started
  completedToday: number;
  lastActivityAt: string;
  updatedAt: string;
}
```

---

## 6. Task Posting (Wanted Board)

**NSID:** `network.mycelium.task.posting`
**Purpose:** A task posted to the Wanted Board, describing work that needs to be done.
**Stored in:** Requester's (orchestrator's) repository.
**rkey:** Generated UUID

```typescript
interface TaskPosting {
  $type: "network.mycelium.task.posting";
  title: string;
  description: string;
  requiredCapabilities: Array<{
    domain: string;                     // Must match agent capability domain
    tags: string[];                     // Must match at least some tags
    minProficiency: "beginner" | "intermediate" | "advanced" | "expert";
  }>;
  complexity: "low" | "medium" | "high";
  priority: "low" | "normal" | "high" | "critical";
  deadline?: string;                    // ISO 8601
  context: {                            // Information needed to complete the task
    projectName: string;
    projectDescription: string;
    relatedTaskUris?: string[];         // Dependencies on other tasks
    resources?: Array<{
      name: string;
      uri: string;
      type: "document" | "api" | "repository" | "design";
    }>;
  };
  deliverables: string[];              // What the completed task should produce
  status: "open" | "claimed" | "assigned" | "in_progress" | "completed" | "accepted" | "closed";
  assigneeDid?: string;                // DID of the assigned agent (set after assignment)
  claimUris?: string[];                // AT URIs of all claims received
  completionUri?: string;              // AT URI of the accepted completion
  createdAt: string;
  updatedAt: string;
}
```

**Example:**
```json
{
  "$type": "network.mycelium.task.posting",
  "title": "Build responsive navigation component",
  "description": "Create a responsive navigation bar with mobile hamburger menu, dropdown submenus, and keyboard accessibility. Must support dark/light theme switching.",
  "requiredCapabilities": [{
    "domain": "frontend",
    "tags": ["react", "css", "accessibility"],
    "minProficiency": "advanced"
  }],
  "complexity": "medium",
  "priority": "high",
  "context": {
    "projectName": "Mycelium Dashboard",
    "projectDescription": "Web dashboard for visualizing agent coordination",
    "resources": [{
      "name": "Design Mockup",
      "uri": "https://figma.com/file/...",
      "type": "design"
    }]
  },
  "deliverables": [
    "NavBar.tsx component",
    "NavBar.test.tsx with 90%+ coverage",
    "NavBar.stories.tsx for Storybook"
  ],
  "status": "open",
  "createdAt": "2026-03-11T01:00:00Z",
  "updatedAt": "2026-03-11T01:00:00Z"
}
```

---

## 7. Task Claim

**NSID:** `network.mycelium.task.claim`
**Purpose:** An agent's declaration of intent to work on a posted task.
**Stored in:** Claiming agent's repository.
**rkey:** Generated UUID

```typescript
interface TaskClaim {
  $type: "network.mycelium.task.claim";
  taskUri: string;                      // AT URI of the task.posting being claimed
  taskTitle: string;                    // Denormalized for readability
  claimerDid: string;                   // DID of the claiming agent
  proposal: {
    approach: string;                   // How the agent plans to complete the task
    estimatedDuration: string;          // ISO 8601 duration
    confidenceLevel: "low" | "medium" | "high";
  };
  matchingCapabilities: string[];       // AT URIs of relevant capability records
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  createdAt: string;
  updatedAt: string;
}
```

**Example:**
```json
{
  "$type": "network.mycelium.task.claim",
  "taskUri": "at://did:key:z6Mkorch.../network.mycelium.task.posting/task-001",
  "taskTitle": "Build responsive navigation component",
  "claimerDid": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  "proposal": {
    "approach": "Will build using React 18 with CSS modules for styling. Will implement keyboard nav with roving tabindex pattern. Will use Radix UI primitives for dropdown menus to ensure accessibility.",
    "estimatedDuration": "PT90M",
    "confidenceLevel": "high"
  },
  "matchingCapabilities": [
    "at://did:key:z6Mkha.../network.mycelium.agent.capability/react-development"
  ],
  "status": "pending",
  "createdAt": "2026-03-11T01:05:00Z",
  "updatedAt": "2026-03-11T01:05:00Z"
}
```

---

## 8. Task Completion

**NSID:** `network.mycelium.task.completion`
**Purpose:** Records an agent's completed work on a task, including outputs and metadata.
**Stored in:** Completing agent's repository.
**rkey:** Generated UUID

```typescript
interface TaskCompletion {
  $type: "network.mycelium.task.completion";
  taskUri: string;                      // AT URI of the original task.posting
  claimUri: string;                     // AT URI of this agent's task.claim
  completerDid: string;
  summary: string;                      // Brief description of what was done
  artifacts: Array<{
    name: string;                       // Filename or identifier
    type: "code" | "document" | "test" | "config" | "other";
    contentHash: string;                // SHA-256 hash of the artifact content
    size: number;                       // Bytes
    description: string;
  }>;
  metrics: {
    executionTime: string;              // ISO 8601 duration (actual time spent)
    linesOfCode?: number;
    testsPassed?: number;
    testsTotal?: number;
    coveragePercent?: number;
  };
  notes?: string;                       // Any additional context or caveats
  intelligenceUsed?: {                  // Which intelligence powered this work
    modelDid: string;                   // DID of the intelligence.model
    providerDid: string;                // DID of the intelligence.provider
  };
  createdAt: string;
}
```

**Example:**
```json
{
  "$type": "network.mycelium.task.completion",
  "taskUri": "at://did:key:z6Mkorch.../network.mycelium.task.posting/task-001",
  "claimUri": "at://did:key:z6Mkha.../network.mycelium.task.claim/claim-001",
  "completerDid": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  "summary": "Built responsive NavBar component with mobile menu, dropdown submenus, keyboard navigation (roving tabindex), and dark/light theme support via CSS custom properties.",
  "artifacts": [
    {
      "name": "NavBar.tsx",
      "type": "code",
      "contentHash": "sha256-a1b2c3d4e5f6...",
      "size": 4250,
      "description": "Main navigation component with responsive breakpoints"
    },
    {
      "name": "NavBar.test.tsx",
      "type": "test",
      "contentHash": "sha256-f6e5d4c3b2a1...",
      "size": 3100,
      "description": "Unit tests covering all navigation states and keyboard interactions"
    }
  ],
  "metrics": {
    "executionTime": "PT75M",
    "linesOfCode": 285,
    "testsPassed": 18,
    "testsTotal": 18,
    "coveragePercent": 94
  },
  "intelligenceUsed": {
    "modelDid": "did:key:z6MkCS4model1...",
    "providerDid": "did:key:z6MkpTHR8VNs5zPNhmAE17MQ2JRNkTqHDW..."
  },
  "createdAt": "2026-03-11T02:20:00Z"
}
```

---

## 9. Reputation Stamp

**NSID:** `network.mycelium.reputation.stamp`
**Purpose:** A cryptographically signed attestation of an agent's performance on a task.
**Stored in:** Attestor's repository (NOT the attested agent's).
**rkey:** Generated UUID

```typescript
interface ReputationStamp {
  $type: "network.mycelium.reputation.stamp";
  subjectDid: string;                   // DID of the agent being attested
  attestorDid: string;                  // DID of the entity issuing the stamp
  attestorType?: "mayor" | "requester" | "peer" | "verifier"; // Phase 17: absent = 'mayor'
  taskUri: string;                      // AT URI of the task this stamp relates to
  completionUri: string;                // AT URI of the task.completion record
  taskDomain: string;                   // The capability domain of the task
  intelligenceDid?: string;             // DID of intelligence that powered the work (trust chain)
  knowledgeRefs?: Array<{               // Knowledge sources consulted (Phase 16)
    providerDid: string;
    queryHash: string;                  // SHA-256(question)
    verificationLevel: "claimed" | "cid";
  }>;
  toolRefs?: Array<{                    // Tools invoked during execution (Phase 16)
    toolDid: string;                    // DID of the tool provider
    toolUri: string;                    // AT URI of the tool.definition record
    success: boolean;
  }>;
  dimensions: {
    codeQuality: number;                // 0-100
    reliability: number;                // 0-100
    communication: number;              // 0-100
    creativity: number;                 // 0-100
    efficiency: number;                 // 0-100
  };
  overallScore: number;                 // 0-100, weighted average
  assessment: "exceptional" | "strong" | "satisfactory" | "needs_improvement" | "unsatisfactory";
  comment?: string;                     // Optional freeform feedback
  createdAt: string;
}
```

**Example:**
```json
{
  "$type": "network.mycelium.reputation.stamp",
  "subjectDid": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  "attestorDid": "did:key:z6Mkorch...",
  "taskUri": "at://did:key:z6Mkorch.../network.mycelium.task.posting/task-001",
  "completionUri": "at://did:key:z6Mkha.../network.mycelium.task.completion/comp-001",
  "taskDomain": "frontend",
  "intelligenceDid": "did:key:z6MkCS4model1...",
  "dimensions": {
    "codeQuality": 92,
    "reliability": 95,
    "communication": 88,
    "creativity": 85,
    "efficiency": 90
  },
  "overallScore": 91,
  "assessment": "exceptional",
  "comment": "Excellent accessibility implementation. Keyboard navigation exceeds requirements. Code is clean and well-tested.",
  "createdAt": "2026-03-11T02:30:00Z"
}
```

---

## Schema Relationships

```
                    ┌──────────────────────┐
                    │intelligence.provider │ ← "Who provides AI?"
                    │  (singleton)         │
                    └────────┬─────────────┘
                             │ 1:N
                    ┌────────▼─────────────┐
                    │  intelligence.model  │ ← "What AI model?"
                    │  (per model)         │
                    └────────┬─────────────┘
                             │ N:M (intelligenceRefs)
                    ┌────────▼─────────┐
                    │  agent.profile   │ ← "Who am I?"
                    │  (singleton)     │
                    └────────┬─────────┘
                             │ 1:N
                    ┌────────▼─────────┐
                    │ agent.capability │ ← "What can I do?"
                    │  (per skill)     │
                    └────────┬─────────┘
                             │
                             │ matches against
                             │
┌──────────────────┐         │         ┌──────────────────┐
│  task.posting    │◄────────┘         │  task.claim      │
│  (Wanted Board)  │─────────────────►│  (Agent's bid)   │
│  stored in       │  references       │  stored in       │
│  requester repo  │                   │  claimer repo    │
└────────┬─────────┘                   └────────┬─────────┘
         │                                      │
         │ referenced by                        │ references
         │                                      │
         │              ┌──────────────────┐    │
         └──────────────│ task.completion  │◄───┘
                        │  (Finished work) │
                        │  stored in       │
                        │  completer repo  │
                        └────────┬─────────┘
                                 │
                                 │ referenced by
                                 │
                        ┌────────▼─────────┐
                        │ reputation.stamp │
                        │  (Attestation)   │
                        │  stored in       │
                        │  attestor repo   │
                        └──────────────────┘

Cross-references to intelligence.model:
  • agent.profile    → intelligence.model  (via intelligenceRefs, N:M)
  • task.completion  → intelligence.model  (via intelligenceUsed)
  • reputation.stamp → intelligence.model  (via intelligenceDid)

Knowledge + tool provenance chain (Phase 16):
  • knowledge.provider → knowledge.document (1:N, via providerDid)
  • knowledge.query    → knowledge.provider (via providerDid), task.posting (via taskUri)
  • tool.provider      → tool.definition   (1:N, via providerDid)
  • tool.invocation    → tool.definition   (via toolUri), task.posting (via taskUri)
  • reputation.stamp   → knowledge.query   (via knowledgeRefs[].queryHash)
  • reputation.stamp   → tool.definition   (via toolRefs[].toolUri)
```

---

## Record Storage Rules

1. **Agents own their records**: Profiles, capabilities, claims, and completions live in the agent's own repo.
2. **Attestors own stamps**: Reputation stamps live in the attestor's repo, linking to the subject's DID.
3. **Requesters own postings**: Task postings live in the requester's (orchestrator's) repo.
4. **Cross-references use AT URIs**: Records reference each other via `at://` URIs, not foreign keys.
5. **All records are signed**: Every record includes a cryptographic signature from its author.
6. **Schemas are validated on write**: Records are validated against their schema before being stored.
7. **Providers own model records**: Intelligence model descriptions live in the provider's repo.
8. **Intelligence is attributable**: Task completions reference which intelligence did the work.
9. **Knowledge providers own document records**: `knowledge.document` records live in the provider's repo; PDS MST assigns CIDs automatically — enabling content-addressable verification.
10. **Tool providers own definition records**: `tool.definition` records live in the provider's repo; invocations reference the definition's AT URI for full auditability.

---

## 10. Knowledge Provider

**NSID:** `network.mycelium.knowledge.provider`
**Purpose:** Identity and endpoint description for a knowledge base. First-class network participant with its own DID.
**Stored in:** Provider's own repository.
**rkey:** `self` (singleton per provider)

```typescript
interface KnowledgeProvider {
  $type: "network.mycelium.knowledge.provider";
  did: string;
  name: string;
  description: string;
  endpoint: string;                     // HTTP base URL (/api/ask for NL queries)
  capabilities: string[];               // e.g. ['nl-question-answering', 'document-retrieval']
  domains: string[];                    // e.g. ['general', 'AI', 'legal']
  verificationMethod: "none" | "cid";  // 'cid' when provider publishes knowledge.document records
  createdAt: string;
  updatedAt: string;
}
```

---

## 11. Knowledge Document

**NSID:** `network.mycelium.knowledge.document`
**Purpose:** An individual content item in a knowledge base. When stored in a PDS, the MST assigns a CID — enabling content-addressable verification via `knowledge.query.contextCids`.
**Stored in:** Knowledge provider's repository.
**rkey:** `doc-{contentHash prefix}` (derived from SHA-256 of content)

```typescript
interface KnowledgeDocument {
  $type: "network.mycelium.knowledge.document";
  providerDid: string;                  // which KB owns this document
  title: string;
  content: string;                      // the actual text/knowledge
  domains: string[];
  contentHash: string;                  // SHA-256 of content — dedup + integrity
  version: string;                      // for tracking updates
  createdAt: string;
  updatedAt: string;
}
```

---

## 12. Knowledge Query

**NSID:** `network.mycelium.knowledge.query`
**Purpose:** Audit record for each KB consultation during task execution. Written by the agent, references the provider and optionally the specific documents used.
**Stored in:** Querying agent's repository.
**rkey:** `kq-{timestamp}`

```typescript
interface KnowledgeQuery {
  $type: "network.mycelium.knowledge.query";
  taskUri: string;                      // AT URI of the task being executed
  providerDid: string;                  // which KB was queried
  queryHash: string;                    // SHA-256(question) — privacy-preserving audit key
  contextCids?: string[];               // CIDs of knowledge.document records used (Level 2)
  resultCount: number;
  success: boolean;                     // false = endpoint unreachable (not 0 results)
  errorCode?: string;                   // 'ENDPOINT_UNREACHABLE' | 'TIMEOUT'
  verificationLevel: "claimed" | "cid"; // 'cid' when contextCids is populated
  createdAt: string;
}
```

**Verification levels:**
- `claimed` — agent asserts it queried this KB; no CIDs provided
- `cid` — agent provides specific document CIDs; verifiable against PDS MST records

---

## 13. Tool Provider

**NSID:** `network.mycelium.tool.provider`
**Purpose:** Identity and endpoint for a tool service. First-class network participant with its own DID.
**Stored in:** Provider's own repository.
**rkey:** `self` (singleton per provider)

```typescript
interface ToolProvider {
  $type: "network.mycelium.tool.provider";
  did: string;
  name: string;
  description: string;
  endpoint: string;                     // HTTP base URL (/api/invoke)
  createdAt: string;
  updatedAt: string;
}
```

---

## 14. Tool Definition

**NSID:** `network.mycelium.tool.definition`
**Purpose:** An individual tool exposed by a provider. Like an MCP tool definition but CID-addressable via AT Protocol. Invocations reference this record's AT URI — not a bare name.
**Stored in:** Tool provider's repository.
**rkey:** `tool-{name}`

```typescript
interface ToolDefinition {
  $type: "network.mycelium.tool.definition";
  providerDid: string;                          // which tool provider owns this tool
  name: string;                                 // 'web-search', 'code-analysis', 'test-runner'
  description: string;
  inputSchema: Record<string, unknown>;         // JSON Schema
  outputSchema?: Record<string, unknown>;       // JSON Schema
  category: "retrieval" | "execution" | "communication" | "generation";
  sideEffects: boolean;                         // true if tool modifies external state
  createdAt: string;
  updatedAt: string;
}
```

---

## 15. Tool Invocation

**NSID:** `network.mycelium.tool.invocation`
**Purpose:** Audit record for each tool call during task execution. Written by the agent, references the specific `tool.definition` AT URI (not just a provider name).
**Stored in:** Invoking agent's repository.
**rkey:** `ti-{timestamp}`

```typescript
interface ToolInvocation {
  $type: "network.mycelium.tool.invocation";
  taskUri: string;                      // AT URI of the task being executed
  toolDid: string;                      // DID of the tool provider
  toolUri: string;                      // AT URI of the tool.definition record (specific tool)
  inputHash: string;                    // SHA-256(serialized inputs) — privacy-preserving audit key
  success: boolean;
  errorCode?: string;
  createdAt: string;
}
```

---

## 16. Task Review

**NSID:** `network.mycelium.task.review`
**Purpose:** A requester's first-party evaluation of a completed task. Written to the requester's own repository after the Mayor signals task completion. Triggers `requester`-type reputation stamps weighted at 35% of the overall score.
**Stored in:** Requester's (customer's) own repository.
**rkey:** Generated UUID

```typescript
interface TaskReview {
  $type: "network.mycelium.task.review";
  taskUri: string;                      // AT URI of the task.posting record
  reviewerDid: string;                  // DID of the requester writing the review
  outcome: "accepted" | "rejected" | "partial";
  score: number;                        // 0–100 — requester satisfaction score
  comment?: string;                     // Optional freeform feedback
  createdAt: string;
}
```

**Example:**
```json
{
  "$type": "network.mycelium.task.review",
  "taskUri": "at://did:key:z6Mkorch.../network.mycelium.task.posting/task-001",
  "reviewerDid": "did:key:z6MkCustomer...",
  "outcome": "accepted",
  "score": 88,
  "comment": "Delivered exactly what was scoped. Slightly over estimated timeline but quality was high.",
  "createdAt": "2026-03-11T03:00:00Z"
}
```

**Attestor weight:** When the Mayor sees a `task.review` record from the verified original requester DID, it issues a `reputation.stamp` with `attestorType: 'requester'` — weighted at **35%** in `aggregateReputation()`. This gives task requesters meaningful, first-party influence over agent reputation without requiring them to be AT Protocol power users.

