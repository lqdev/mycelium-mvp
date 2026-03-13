# Mycelium MVP — Technical Architecture

> Companion to [README.md](./README.md). Defines the component architecture, data flows, and integration points for the E2E MVP.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        MVP SYSTEM                                │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Agent A  │  │ Agent B  │  │ Agent C  │  │ Agent D  │  ...   │
│  │ (DID+Repo)│ │ (DID+Repo)│ │ (DID+Repo)│ │ (DID+Repo)│       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │              │              │              │              │
│       └──────────────┴──────┬───────┴──────────────┘              │
│                             │                                     │
│                    ┌────────▼────────┐                            │
│                    │   Event Bus     │ ← "Firehose"              │
│                    │   (Pub/Sub)     │                            │
│                    └────────┬────────┘                            │
│                             │                                     │
│              ┌──────────────┼──────────────┐                     │
│              │              │              │                      │
│     ┌────────▼───────┐ ┌───▼──────┐ ┌─────▼──────┐             │
│     │  Orchestrator  │ │ Wanted   │ │ Reputation │              │
│     │  ("Mayor")     │ │ Board    │ │ Aggregator │              │
│     └────────────────┘ └──────────┘ └────────────┘              │
│                                                                  │
│     ┌─────────────────────────────────────────────┐             │
│     │            Web Dashboard / CLI               │             │
│     └─────────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

> **Note:** Intelligence Providers and Models (not shown above) are first-class entities with their own DIDs and repositories. Agents reference intelligence models via DID, and task completions attribute work to the intelligence that powered it. See §2.5.

---

## Component Architecture

### 1. Identity Module (`src/identity/`)

Generates and manages agent identities using `did:key` method with Ed25519 keypairs.

**Responsibilities:**
- Generate Ed25519 keypair for each agent
- Derive `did:key` identifier from public key
- Sign records with private key
- Verify signatures from other agents
- Map human-readable handles to DIDs (e.g., `frontend-agent.mycelium.local`)

**Key Types:**
```typescript
interface AgentIdentity {
  did: string;                    // e.g., "did:key:z6Mkr..."
  handle: string;                 // e.g., "atlas.mycelium.local"
  displayName: string;            // e.g., "Atlas (Frontend Specialist)"
  publicKey: Uint8Array;
  privateKey: Uint8Array;         // Only held by the agent itself
  createdAt: string;              // ISO 8601
}

interface SignedRecord<T> {
  record: T;
  sig: string;                    // Base64-encoded Ed25519 signature
  signerDid: string;              // DID of the signing agent
}
```

**Note:** The same `AgentIdentity` structure is used for intelligence providers and models — all entities in Mycelium have DIDs and can sign records. The term "agent" in `AgentIdentity` is generic; providers and models use the same identity mechanism.

**MVP Simplification:** Uses `did:key` (self-describing, no resolution infrastructure needed) instead of `did:plc` (requires PLC directory server). Upgrade path: swap key generation for PLC registration.

#### DID Generation Algorithm

Step-by-step process for generating a `did:key` identifier from an Ed25519 keypair:

```
Input:  None (generates fresh keypair)
Output: { did, publicKey, privateKey }

1. Generate Ed25519 keypair:
   privateKey = crypto.getRandomValues(32 bytes)
   publicKey  = ed25519.getPublicKey(privateKey)

2. Prepend multicodec prefix for Ed25519-pub (0xed01):
   multicodecBytes = [0xed, 0x01, ...publicKey]    // 34 bytes total

3. Encode as base58-btc with multibase prefix 'z':
   encoded = 'z' + base58btc.encode(multicodecBytes)

4. Construct DID:
   did = 'did:key:' + encoded
   // Result: "did:key:z6Mk..."

5. didToKeyFragment(did):
   return did.split(':')[2]   // Returns "z6Mk..." portion
   // Used for: database filenames, short display
```

**Library mapping:**
- Step 1: `@noble/ed25519` → `ed25519.utils.randomPrivateKey()` + `ed25519.getPublicKey()`
- Step 2: Manual byte concatenation (2-byte prefix + 32-byte key)
- Step 3: Use `@noble/hashes/utils` or `bs58` package for base58-btc encoding
- Step 4: String concatenation

#### Signing & Verification Algorithm

All records stored in repositories are cryptographically signed.

**Signing (on write):**
```
Input:  identity (AgentIdentity), record (any valid record object)
Output: { sig, signerDid }

1. Canonical serialization:
   canonical = canonicalize(record)
   // Recursively sorts all object keys alphabetically at every nesting level.
   // See canonicalize() implementation below.

2. Convert to bytes:
   bytes = new TextEncoder().encode(canonical)

3. Sign with Ed25519:
   signature = ed25519.sign(bytes, identity.privateKey)

4. Encode signature:
   sig = base64url(signature)    // URL-safe base64, no padding

5. Return:
   { sig, signerDid: identity.did }
```

**Verification (on read / import):**
```
Input:  did (string), record (object), sig (string)
Output: boolean

1. Extract public key from DID:
   encoded = did.split(':')[2]            // "z6Mk..."
   multicodecBytes = base58btc.decode(encoded.slice(1))  // Remove 'z' prefix
   publicKey = multicodecBytes.slice(2)   // Remove 0xed01 prefix → 32-byte key

2. Reconstruct canonical bytes:
   canonical = canonicalize(record)
   bytes = new TextEncoder().encode(canonical)

3. Decode signature:
   signature = base64url.decode(sig)

4. Verify:
   return ed25519.verify(signature, bytes, publicKey)
```

**Canonical JSON Implementation:**

```typescript
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(item => canonicalize(item)).join(',') + ']';
  }
  const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
  const entries = sortedKeys.map(key =>
    JSON.stringify(key) + ':' + canonicalize((value as Record<string, unknown>)[key])
  );
  return '{' + entries.join(',') + '}';
}
```

This recursively sorts keys at every nesting depth, producing deterministic output regardless of property insertion order. `JSON.stringify`'s replacer array does **not** work for this — it only filters top-level keys and does not sort nested objects.

**Base64url encoding:** Use Node.js built-in `Buffer.from(signature).toString('base64url')` (available since Node 16+). For decoding: `Buffer.from(sig, 'base64url')`. No external package needed.

---

### 2. Repository Module (`src/repository/`)

In-memory record store implementing the "Personal Data Server" concept. Each agent gets its own isolated store backed by DuckDB for persistence.

**Responsibilities:**
- Create and manage per-agent in-memory stores (Map + Array)
- Store typed records organized by collection (NSID)
- Maintain a commit log (simplified Merkle chain)
- Emit events to the Firehose on record creation/update/deletion
- Support full repository export (for portability demos)
- Async write-through to DuckDB for durability

**Key Types:**
```typescript
interface AgentRepository {
  did: string;          // DID of the entity that owns this repo
  store: InMemoryStore; // Map<key, StoredRecordRow> + CommitRow[]
  identity: AgentIdentity;         // For signing records on write
  firehose: Firehose | null;       // If set, emits events on write. Null for isolated repos (tests).
}

interface RecordResult {
  uri: string;                     // AT URI: "at://{did}/{collection}/{rkey}"
  cid: string;                     // Content hash (SHA-256 of canonical JSON)
  commit: {
    seq: number;                   // Commit sequence number in this repo
    operation: "create" | "update";
    repoRootHash: string;          // New rolling hash after this commit
  };
}
```

**Repository creation:** `createRepository` receives the identity (for signing) and optionally a Firehose reference. If firehose is provided, every `putRecord` call automatically emits a `FirehoseEvent` after the write succeeds. The `./data/` directory is auto-created if it does not exist (use `fs.mkdirSync(dir, { recursive: true })`).

```typescript
// Core operations:
// - createRepository(identity: AgentIdentity, firehose?: Firehose) → AgentRepository
// - putRecord(repo, collection, rkey, content) → RecordResult      // upsert: creates OR updates
// - getRecord(repo, collection, rkey) → Record | null
// - listRecords(repo, collection) → Record[]
// - deleteRecord(repo, collection, rkey) → void
// - exportRepository(repo) → RepositoryExport
// - importRepository(exportData, identity, firehose?) → AgentRepository
// - getCommitLog(repo) → Commit[]
```

**`putRecord` is an upsert:** If a record with the same `(collection, rkey)` already exists, it is updated (the commit log entry will have `operation: "update"`). If it doesn't exist, it's created (`operation: "create"`). The repo checks for existence via `SELECT 1 FROM records WHERE collection = ? AND rkey = ?` before deciding.

**Signing happens inside `putRecord`:** The repo holds the `identity` and signs every record automatically. The caller passes plain `content`; the repo calls `signRecord(repo.identity, content)` and stores the resulting `sig` alongside the content. This keeps signing centralized and prevents unsigned writes.

**Storage Schema:**
```sql
-- Each agent has its own SQLite database: ./data/{did-fragment}.db

CREATE TABLE records (
  uri TEXT PRIMARY KEY,            -- "at://{did}/{collection}/{rkey}"
  collection TEXT NOT NULL,        -- NSID, e.g., "network.mycelium.agent.capability"
  rkey TEXT NOT NULL,              -- Record key within collection
  content TEXT NOT NULL,           -- JSON record content
  sig TEXT NOT NULL,               -- Ed25519 signature of content
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE commits (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL,         -- "create" | "update" | "delete"
  record_uri TEXT NOT NULL,
  content_hash TEXT NOT NULL,      -- SHA-256 of content (simplified MST)
  repo_root_hash TEXT NOT NULL,    -- Rolling hash of all records
  timestamp TEXT NOT NULL
);

CREATE INDEX idx_records_collection ON records(collection);
CREATE INDEX idx_commits_timestamp ON commits(timestamp);
```

**AT URI Format:** `at://{did}/{collection}/{rkey}`
- Example: `at://did:key:z6Mkr.../network.mycelium.agent.capability/frontend-dev`

**MVP Simplification:** Uses SHA-256 rolling hash instead of full Merkle Search Tree. The commit log captures the same semantics (tamper detection, audit trail) without the MST complexity.

#### Commit Hash Chain Algorithm

Each write operation appends a commit to the log, forming a tamper-evident chain.

```
Input:  operation ("create"|"update"|"delete"), recordUri, content, previousCommit
Output: Commit record

1. Hash the record content:
   contentHash = SHA-256(canonicalize(content))
   // Uses the same canonicalize() function as signing

2. Compute repo root hash (chain link):
   if previousCommit exists:
     repoRootHash = SHA-256(previousCommit.repoRootHash + ":" + contentHash)
   else:
     repoRootHash = contentHash   // First commit in repo

3. Create commit:
   commit = {
     seq: autoincrement,
     operation,
     record_uri: recordUri,
     content_hash: contentHash,
     repo_root_hash: repoRootHash,
     timestamp: new Date().toISOString()
   }
```

**Verification on import:**
```
1. Replay all commits in sequence order
2. For each commit, verify:
   a. content_hash matches SHA-256 of the corresponding record
   b. repo_root_hash matches SHA-256(prev.repo_root_hash + ":" + content_hash)
3. If any hash doesn't match → import rejected, data tampered
```

**Export format:**
```json
{
  "did": "did:key:z6Mk...",
  "exportedAt": "2026-03-11T00:00:00Z",
  "records": [ { "uri": "at://...", "collection": "...", "content": {}, "sig": "..." } ],
  "commits": [ { "seq": 1, "operation": "create", "record_uri": "...", "content_hash": "...", "repo_root_hash": "..." } ],
  "finalRootHash": "sha256-..."
}
```

---

### 2.5 Intelligence Module (`src/intelligence/`)

Manages intelligence provider and model identities. Providers and models are first-class entities with their own DIDs, enabling verifiable attribution of AI-powered work.

**Responsibilities:**
- Generate DIDs for intelligence providers and models
- Store provider and model records in provider-owned repositories
- Enable agents to reference intelligences by DID (not hard-coded strings)
- Support intelligence discovery (find models by capability/domain)

**Key Types (abbreviated — [SCHEMAS.md](./SCHEMAS.md) is authoritative for full field definitions including `$type`, `operator`, `trustSignals`, timestamps):**
```typescript
interface IntelligenceProvider {
  did: string;                          // Provider's DID
  name: string;                         // e.g., "GitHub Models", "Local Ollama"
  providerType: "cloud" | "local" | "hybrid";
  endpoint?: string;                    // e.g., "https://api.github.com/models" or "http://localhost:11434"
  modelsOffered: string[];              // DIDs of intelligence.model records
}

interface IntelligenceModel {
  did: string;                          // Model's DID
  providerDid: string;                  // DID of the provider
  name: string;                         // e.g., "Claude Sonnet 4"
  slug: string;                         // e.g., "claude-sonnet-4"
  capabilities: string[];              // e.g., ["code-generation", "analysis"]
  domains: string[];                    // e.g., ["frontend", "backend"]
  modelOrigin?: string;                 // Original provider if different (e.g., "Anthropic", "OpenAI") — informational only
}
```

**Design Rationale:**
- Intelligence gets DIDs because the AT Protocol philosophy is "everything is addressable, everything has identity"
- This enables: intelligence reputation tracking, trust chain verification (who did the work AND what powered it), agent-intelligence composition (one agent using multiple models)
- Providers own model records — they attest to their models' capabilities
- Agents reference models by DID in their profiles and task completions

**MVP Provider Strategy:**
For prototyping, we use a **two-provider architecture**:
1. **GitHub Models** (`providerType: "cloud"`) — Unified cloud gateway for commercial models
   - Includes Claude (Anthropic), GPT (OpenAI), Phi (Microsoft), Mistral, and others from GitHub's public catalog
   - Single point of control for cloud-based AI in the MVP
   - Endpoint: GitHub Models API (documented but mocked in MVP)
2. **Local Ollama** (`providerType: "local"`) — Self-hosted local inference
   - Includes Llama 3 (70B), CodeLlama, and other open-source models
   - Endpoint: `http://localhost:11434` (configurable)
   - For local-first experimentation

This split reflects how teams actually prototype: reliable cloud access via GitHub, local exploration via Ollama. Both providers demonstrate multi-provider federation while keeping the setup simple.

---

### 3. Schema & Validation Module (`src/schemas/`)

Defines all Mycelium record types as JSON Schema and validates records before storage.

**Record Types (Lexicon NSIDs):**

| NSID | Purpose | Stored In |
|------|---------|-----------|
| `network.mycelium.agent.profile` | Agent identity & description | Agent's repo |
| `network.mycelium.agent.capability` | What the agent can do | Agent's repo |
| `network.mycelium.agent.state` | Current operational state | Agent's repo |
| `network.mycelium.task.posting` | Task on the Wanted Board | Requester's repo |
| `network.mycelium.task.claim` | Agent claiming a task | Claiming agent's repo |
| `network.mycelium.task.completion` | Completed work record | Completing agent's repo |
| `network.mycelium.reputation.stamp` | Reputation attestation | Attestor's repo |
| `network.mycelium.intelligence.provider` | Intelligence provider identity | Provider's repo |
| `network.mycelium.intelligence.model` | AI model capability declaration | Provider's repo |

9 record types define the full Mycelium data model.

Full schema definitions: [SCHEMAS.md](./SCHEMAS.md)

---

### 4. Event Bus / Firehose Module (`src/firehose/`)

In-process pub/sub system that simulates the AT Protocol Firehose. Every record creation, update, or deletion is broadcast as an event.

**Responsibilities:**
- Accept events from all agent repositories
- Broadcast events to all subscribers
- Support filtered subscriptions (by collection, by DID)
- Maintain an ordered event log (for replay)

**Event Structure:**
```typescript
interface FirehoseEvent {
  seq: number;                     // Global sequence number
  type: "commit";
  operation: "create" | "update" | "delete";
  did: string;                     // DID of the agent whose repo changed
  collection: string;              // NSID of the record type
  rkey: string;                    // Record key
  record: unknown;                 // The record content (for create/update)
  timestamp: string;
}

interface FirehoseSubscription {
  id: string;                      // crypto.randomUUID()
  filter?: {
    collections?: string[];        // Only receive events for these NSIDs
    dids?: string[];               // Only receive events from these agents
  };
  handler: (event: FirehoseEvent) => void | Promise<void>;
}

// Container type — the Firehose instance itself
interface Firehose {
  seq: number;                     // Current sequence counter (starts at 1)
  log: FirehoseEvent[];            // Append-only event log (for replay via getEventLog)
  subscriptions: Map<string, FirehoseSubscription>;
}
```

**Filter semantics:** When both `collections` and `dids` are provided, they combine as **AND** — an event must match at least one listed collection AND at least one listed DID. If only one filter is provided, only that filter is checked. If no filter is provided, the subscriber receives all events.

**Subscription lifecycle:** `subscribe()` returns the subscription ID (UUID). `unsubscribe()` removes the subscription by ID — if a handler is currently mid-execution when `unsubscribe` is called, it finishes the current event but receives no further events.

**MVP Simplification:** In-process EventEmitter instead of WebSocket stream. Same event semantics, no network layer. Upgrade path: replace EventEmitter with WebSocket server + Jetstream-style filtering.

---

### 5. Wanted Board / Task Lifecycle (`src/orchestrator/`)

Implements the Wanted Board protocol — the decentralized task marketplace where work is posted, discovered, claimed, and completed.

**State Machine:**

> **Note:** The diagram below shows **conceptual** stages. The actual `task.posting.status` field uses only the values defined in [SCHEMAS.md](./SCHEMAS.md): `open | claimed | assigned | in_progress | completed | accepted | closed`. "POSTED" maps to `open` (initial state). "DISCOVERED" is not a status — it's an internal agent evaluation that doesn't change the record.

```
                    ┌─────────────┐
                    │    OPEN     │ ← task.posting created (status: "open")
                    └──────┬──────┘
                           │ agent discovers via firehose (no status change)
                           │ agent evaluates capabilities
                           │ agent creates task.claim
                    ┌──────▼──────┐
                    │   CLAIMED   │ ← first claim received
                    └──────┬──────┘
                           │ orchestrator assigns
                    ┌──────▼──────┐
                    │  ASSIGNED   │ ← agent begins work
                    └──────┬──────┘
                           │ agent self-transitions on receipt of assignment
                    ┌──────▼──────┐
                    │ IN_PROGRESS │ ← agent working
                    └──────┬──────┘
                           │ agent creates task.completion
                    ┌──────▼──────┐
                    │  COMPLETED  │ ← orchestrator reviews
                    └──────┬──────┘
                           │ orchestrator accepts
                    ┌──────▼──────┐
                    │  ACCEPTED   │ ← reputation.stamp created
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   CLOSED    │
                    └─────────────┘
```

**Terminology Note:** "Orchestrator" and "Mayor" are synonymous throughout the codebase. The module lives at `src/orchestrator/mayor.ts`. The term "Mayor" is used in narrative descriptions; "Orchestrator" is used in architectural descriptions. When you see either term, it refers to the same component.

**Orchestrator ("Mayor") Logic:**
1. Receives a high-level project request
2. Decomposes into atomic tasks with required capabilities
3. Posts each task as a `task.posting` record
4. Monitors firehose for `task.claim` events
5. Evaluates claims against agent reputation
6. Assigns tasks (updates posting with assignee)
7. Monitors for `task.completion` events
8. Reviews and accepts/rejects completions
9. Issues `reputation.stamp` for accepted work

**`agentType` field values in `agent.profile`:**
- `"worker"` — A task-executing agent (all 6 demo agents)
- `"orchestrator"` — The Mayor (decomposes + assigns work)
- `"supervisor"` and `"labeler"` — **Reserved for future use; not implemented in the MVP.** A `supervisor` would oversee a group of workers; a `labeler` would independently verify task quality. These types are valid in the schema but will never appear in the demo bootstrap.

---

### 6. Reputation Module (`src/reputation/`)

Manages the creation and aggregation of multidimensional reputation stamps.

**Design Principles (from research):**
- Reputation is **multidimensional** ("character sheet", not single karma score)
- Stamps are stored in the **attestor's** repo (not the attested agent's)
- Stamps are **cryptographically signed** (prevents forgery)
- Reputation is **aggregatable** across multiple attestors
- Reputation is **portable** (travels with the agent's DID)

**Reputation Dimensions:**
```typescript
interface ReputationDimensions {
  codeQuality: number;      // 0-100: correctness, best practices
  reliability: number;      // 0-100: delivers on time, doesn't abandon tasks
  communication: number;    // 0-100: clear updates, asks good questions
  creativity: number;       // 0-100: novel approaches, elegant solutions
  efficiency: number;       // 0-100: speed relative to complexity
}

interface AggregatedReputation {
  did: string;
  totalTasks: number;
  averageScores: ReputationDimensions;
  overallScore: number;               // Weighted aggregate: codeQuality×0.30 + reliability×0.25 + efficiency×0.20 + communication×0.15 + creativity×0.10
  taskBreakdown: Record<string, { count: number; avgScore: number }>;  // domain → stats
  recentTrend: "improving" | "stable" | "declining";
  trustLevel: "newcomer" | "established" | "trusted" | "expert";
}
```

**Trust Bootstrapping:**
- New agents start at `newcomer` level (0 tasks, no reputation)
- After 3+ tasks with avg > 60: `established`
- After 10+ tasks with avg > 75: `trusted`
- After 25+ tasks with avg > 85: `expert`

---

### 7. Agent Simulation (`src/agents/`)

Mock agents with predefined capabilities, behaviors, and simulated task execution.

**Agent Roster (Mock Data):**

| Handle | Role | Capabilities | Personality |
|--------|------|-------------|-------------|
| `atlas` | Frontend Specialist | React, CSS, accessibility, UI testing | Methodical, quality-focused |
| `beacon` | Backend Engineer | Node.js, APIs, databases, auth | Fast, pragmatic |
| `cipher` | Security Analyst | Auth, encryption, vulnerability assessment | Thorough, cautious |
| `delta` | DevOps Engineer | Docker, CI/CD, monitoring, infrastructure | Reliable, systematic |
| `echo` | QA/Testing | Unit testing, integration testing, E2E testing | Detail-oriented |
| `forge` | Full-Stack Generalist | Frontend + backend (lower depth) | Versatile, adaptive |

**Simulated Behaviors:**
- Agents check capabilities against task requirements before claiming
- Execution time varies by task complexity (simulated with delays)
- Quality scores have slight randomization around agent tendencies
- Agents occasionally decline tasks outside their expertise

---

### 8. Demo Runner & Dashboard (`src/demo/`)

**CLI Mode:** Runs the full scenario with formatted console output showing each step.

**Web Dashboard:** Simple HTML/JS page served locally that visualizes:
- Agent cards with identities, capabilities, and reputation
- Wanted Board with task states (color-coded by lifecycle stage)
- Firehose event stream (scrolling log)
- Reputation leaderboard / character sheets
- Task flow diagram (animated transitions)

---

## Data Flow: End-to-End

```
1. BOOTSTRAP
   ├─ Generate 6 agent identities (did:key + keypair)
   ├─ Create per-agent SQLite repositories
   ├─ Generate intelligence provider identities (GitHub Models + Local Ollama)
   ├─ Create provider repositories
   ├─ Write intelligence.provider records (2 providers)
   ├─ Write intelligence.model records (cloud + local models) → Firehose broadcasts
   ├─ Write agent.profile records
   └─ Write agent.capability records → Firehose broadcasts

2. TASK POSTING
   ├─ Mayor orchestrator creates project plan
   ├─ Decomposes into 5-8 atomic tasks
   └─ Writes task.posting records → Firehose broadcasts

3. DISCOVERY & MATCHING
   ├─ Agents receive task.posting events from Firehose
   ├─ Each agent evaluates: "Do my capabilities match?"
   └─ Qualified agents write task.claim records → Firehose broadcasts

4. ASSIGNMENT
   ├─ Orchestrator receives task.claim events
   ├─ Evaluates claims (reputation + capability fit)
   └─ Updates task.posting with assignee DID

5. EXECUTION (SIMULATED)
   ├─ Assigned agent "works" on the task (delay + mock output)
   ├─ Agent writes task.completion record → Firehose broadcasts
   └─ Task completion includes intelligenceUsed attribution

6. REVIEW & REPUTATION
   ├─ Orchestrator receives task.completion event
   ├─ "Reviews" completion (simulated quality assessment)
   ├─ Writes reputation.stamp to own repo → Firehose broadcasts
   ├─ Reputation stamp includes intelligenceDid for trust chain
   └─ Reputation aggregator updates agent scores

7. PORTABILITY DEMO
   ├─ Export agent's full repository (all records + commits)
   ├─ "Migrate" to a new orchestrator context
   └─ Show reputation and history intact in new context
```

---

## Module Dependency Graph

Use this graph to determine **build order**: implement lower layers before higher layers. No circular dependencies.

```
Layer 0 — Leaf nodes (external deps only, no internal imports)
  schemas/types.ts       ← zod (external)
  identity/index.ts      ← @noble/ed25519, @noble/hashes, bs58 (external)

Layer 1 — Depends on Layer 0
  schemas/index.ts       ← schemas/types.ts, zod
  repository/index.ts    ← identity/, schemas/types.ts
  firehose/index.ts      ← schemas/types.ts
  reputation/formulas.ts ← schemas/types.ts
  orchestrator/state-machine.ts  ← schemas/types.ts

Layer 2 — Depends on Layer 1
  intelligence/index.ts          ← identity/, repository/, schemas/
  reputation/index.ts            ← identity/, repository/, firehose/, schemas/, reputation/formulas.ts
  orchestrator/wanted-board.ts   ← repository/, firehose/, schemas/, orchestrator/state-machine.ts

Layer 3 — Depends on Layer 2
  agents/roster.ts               ← schemas/types.ts, intelligence/
  orchestrator/mayor.ts          ← orchestrator/wanted-board.ts, reputation/, repository/,
                                    firehose/, schemas/, agents/roster.ts

Layer 4 — Depends on Layer 3
  agents/engine.ts               ← identity/, repository/, firehose/,
                                    orchestrator/wanted-board.ts, schemas/, agents/roster.ts

Layer 5 — Integration (imports everything)
  demo/run.ts                    ← ALL modules
  demo/dashboard/server.ts       ← firehose/, orchestrator/, reputation/, agents/, intelligence/
  demo/dashboard/api.ts          ← firehose/, orchestrator/, reputation/, agents/
```

**Key rules:**
1. `schemas/types.ts` is the universal shared type file — **every module can import it**
2. `firehose` is created at program startup and passed as a parameter; modules don't import each other's instances
3. `demo/run.ts` is the only file that wires everything together — all other modules are independent

---

## Firehose Event Ordering

- `seq` is a **strictly increasing integer counter**, starting at 1, managed by the in-memory Firehose instance
- Events are emitted synchronously during `putRecord()` calls (same tick), so ordering matches write order
- The event log is **append-only** — no retractions or updates; a record update emits a new event
- Subscribers **cannot rewind** to earlier events after subscribing — they only receive events emitted after their subscription is registered. Exception: the dashboard calls `getEventLog()` on startup to replay history
- **Backpressure:** MVP uses synchronous EventEmitter handlers. If a handler is slow, it blocks the emitter. For MVP simplicity this is acceptable — all handlers complete quickly (no real I/O)
- **Error handling:** If a subscriber handler throws, the Firehose catches the error, logs it with `console.error`, and continues delivering to other subscribers. It does **not** propagate the error to the record writer

---

## Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Language | TypeScript (Node.js) | AT Protocol ecosystem alignment |
| Storage | @duckdb/node-api | Columnar analytics, Parquet export, per-agent persistence |
| Schema Validation | Zod | TypeScript-native, composable schemas |
| Event Bus | EventEmitter (Node.js) | Simple pub/sub, upgradable to WebSocket |
| Crypto | @noble/ed25519 | Ed25519 for DID and signing |
| DID | did:key (multicodec) | Self-describing, no infrastructure needed |
| Web Dashboard | Vanilla HTML + CSS + JS + SSE | Zero build step, no framework |
| CLI Output | chalk + cli-table3 | Formatted terminal output |
| Build | tsup or tsx | Fast TypeScript execution |
| Test | vitest | Fast, TypeScript-native |

---

## Upgrade Path to Production

Each MVP component maps to a production AT Protocol component:

| MVP Component | Production Upgrade |
|---------------|-------------------|
| `did:key` | `did:plc` with PLC directory |
| SQLite repos | Full AT Protocol PDS |
| JSON Schema / Zod | Lexicon compiler + `@atproto/lexicon` |
| EventEmitter firehose | AT Protocol Firehose + Jetstream |
| In-process orchestrator | App View service |
| Mock agents | Real LLM-powered agents |
| SQLite reputation | Labeler service + App View aggregation |
| In-process intelligence registry | Intelligence marketplace / federated model discovery |
| Local dashboard | Federated web application |
| — | ActivityPub bridge (Bridgy Fed) |
| — | Matrix encrypted rooms (Layer 3.5) |
| — | Compute cooperatives (Layer -1) |
