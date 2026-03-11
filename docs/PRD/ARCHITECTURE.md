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

**MVP Simplification:** Uses `did:key` (self-describing, no resolution infrastructure needed) instead of `did:plc` (requires PLC directory server). Upgrade path: swap key generation for PLC registration.

---

### 2. Repository Module (`src/repository/`)

SQLite-backed record store implementing the "Personal Data Server" concept. Each agent gets its own database file.

**Responsibilities:**
- Create and manage per-agent SQLite databases
- Store typed records organized by collection (NSID)
- Maintain a commit log (simplified Merkle chain)
- Emit events on record creation/update/deletion
- Support full repository export (for portability demos)

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
  id: string;
  filter?: {
    collections?: string[];        // Only receive events for these NSIDs
    dids?: string[];               // Only receive events from these agents
  };
  handler: (event: FirehoseEvent) => void | Promise<void>;
}
```

**MVP Simplification:** In-process EventEmitter instead of WebSocket stream. Same event semantics, no network layer. Upgrade path: replace EventEmitter with WebSocket server + Jetstream-style filtering.

---

### 5. Wanted Board / Task Lifecycle (`src/orchestrator/`)

Implements the Wanted Board protocol — the decentralized task marketplace where work is posted, discovered, claimed, and completed.

**State Machine:**
```
                    ┌─────────────┐
                    │   POSTED    │ ← task.posting created
                    └──────┬──────┘
                           │ agent discovers via firehose
                    ┌──────▼──────┐
                    │  DISCOVERED │ ← agent evaluates capabilities
                    └──────┬──────┘
                           │ agent creates task.claim
                    ┌──────▼──────┐
                    │   CLAIMED   │ ← orchestrator reviews claims
                    └──────┬──────┘
                           │ orchestrator assigns
                    ┌──────▼──────┐
                    │  ASSIGNED   │ ← agent begins work
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
  taskBreakdown: Record<string, number>;  // capability → count
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
   └─ Agent writes task.completion record → Firehose broadcasts

6. REVIEW & REPUTATION
   ├─ Orchestrator receives task.completion event
   ├─ "Reviews" completion (simulated quality assessment)
   ├─ Writes reputation.stamp to own repo → Firehose broadcasts
   └─ Reputation aggregator updates agent scores

7. PORTABILITY DEMO
   ├─ Export agent's full repository (all records + commits)
   ├─ "Migrate" to a new orchestrator context
   └─ Show reputation and history intact in new context
```

---

## Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Language | TypeScript (Node.js) | AT Protocol ecosystem alignment |
| Storage | better-sqlite3 | Local-first, per-agent databases |
| Schema Validation | Zod | TypeScript-native, composable schemas |
| Event Bus | EventEmitter (Node.js) | Simple pub/sub, upgradable to WebSocket |
| Crypto | @noble/ed25519 | Ed25519 for DID and signing |
| DID | did:key (multicodec) | Self-describing, no infrastructure needed |
| Web Dashboard | Vanilla HTML + htmx or Preact | Minimal dependencies |
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
| Local dashboard | Federated web application |
| — | ActivityPub bridge (Bridgy Fed) |
| — | Matrix encrypted rooms (Layer 3.5) |
| — | Compute cooperatives (Layer -1) |
