# Mycelium MVP — Implementation Plan

> Phased build plan with mock data strategy. Each phase produces a working increment.

---

## Phase Overview

```
Phase 0: Project Bootstrap              ░░░░░░░░░░
Phase 1: Identity & Storage             ████░░░░░░
Phase 2: Schemas & Records              ████████░░
Phase 3: Firehose & Discovery           ██████████
Phase 4: Task Lifecycle (Wanted Board)   ██████████████
Phase 5: Reputation System              ██████████████████
Phase 6: Orchestrator & Agents          ██████████████████████
Phase 7: E2E Demo & Dashboard           ██████████████████████████
```

---

## Phase 0: Project Bootstrap

**Goal:** Set up the TypeScript project with tooling.

**Tasks:**
1. Initialize Node.js project with TypeScript
2. Install core dependencies:
   - `better-sqlite3` — SQLite for agent repositories
   - `@noble/ed25519` — Ed25519 crypto for DID and signing
   - `zod` — Schema validation
   - `chalk` — Colored CLI output
   - `cli-table3` — Formatted CLI tables
   - `fastify` — Lightweight HTTP server for dashboard
   - `tsx` — Fast TypeScript execution
   - `vitest` — Testing
3. Configure `tsconfig.json` with strict mode
4. Set up project structure:

```
mycelium-mvp/
├── src/
│   ├── identity/
│   │   ├── index.ts                # generateIdentity, signRecord, verifySignature, didToKeyFragment
│   │   └── identity.test.ts
│   ├── repository/
│   │   ├── index.ts                # createRepository, putRecord, getRecord, listRecords, etc.
│   │   └── repository.test.ts
│   ├── schemas/
│   │   ├── index.ts                # Schema registry, validation, helper functions
│   │   ├── types.ts                # All TypeScript interfaces (shared across modules)
│   │   └── schemas.test.ts
│   ├── intelligence/
│   │   ├── index.ts                # createProvider, createModel, listModels, resolveModelDid
│   │   └── intelligence.test.ts
│   ├── firehose/
│   │   ├── index.ts                # createFirehose, subscribe, unsubscribe, getEventLog
│   │   └── firehose.test.ts
│   ├── orchestrator/
│   │   ├── wanted-board.ts         # postTask, claimTask, assignTask, completeTask, reviewCompletion
│   │   ├── mayor.ts                # Mayor orchestrator: decompose, monitor, assign, review
│   │   ├── state-machine.ts        # Task state transitions and validation
│   │   └── orchestrator.test.ts
│   ├── reputation/
│   │   ├── index.ts                # createStamp, aggregateReputation, getTrustLevel
│   │   ├── formulas.ts             # Weighted averages, trend detection, trust thresholds
│   │   └── reputation.test.ts
│   ├── agents/
│   │   ├── roster.ts               # 6 agent definitions with capabilities and behavioral params
│   │   ├── engine.ts               # Agent decision loop: evaluate, claim, execute, complete
│   │   └── agents.test.ts
│   └── demo/
│       ├── run.ts                  # CLI demo runner (npm run demo)
│       ├── dashboard/
│       │   ├── server.ts           # HTTP server (Fastify)
│       │   ├── public/
│       │   │   ├── index.html      # Dashboard SPA
│       │   │   ├── style.css       # Dashboard styles
│       │   │   └── app.js          # Dashboard logic (vanilla JS + SSE)
│       │   └── api.ts              # REST API endpoints for dashboard
│       └── demo.test.ts
├── data/                           # SQLite databases (gitignored)
├── docs/
│   └── PRD/
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

**Deliverable:** `npm run build` succeeds, `npm test` runs (empty).

---

## Phase 1: Identity & Storage

**Goal:** Agents can be created with unique DIDs and have their own data stores.

### 1a. Identity Module

**File:** `src/identity/index.ts`

**Implementation:**
```typescript
// Core operations:
// - generateIdentity(handle, displayName) → AgentIdentity
// - signRecord(identity, record) → SignedRecord
// - verifySignature(did, record, sig) → boolean
// - didToKeyFragment(did) → string (for filenames)
```

**Key decisions:**
- Use `did:key` method with Ed25519 (multicodec prefix `0xed`)
- DID format: `did:key:z6Mk...` (base58-btc encoded)
- Private keys stored in-memory only (not persisted in MVP)

**DID Generation Algorithm (step-by-step):**
1. `privateKey = ed25519.utils.randomPrivateKey()` — 32 random bytes
2. `publicKey = ed25519.getPublicKey(privateKey)` — 32-byte Ed25519 public key
3. `multicodecBytes = new Uint8Array([0xed, 0x01, ...publicKey])` — 34 bytes (multicodec prefix for Ed25519-pub)
4. `encoded = 'z' + base58btc.encode(multicodecBytes)` — multibase base58-btc with 'z' prefix
5. `did = 'did:key:' + encoded` — final DID string: `"did:key:z6Mk..."`
6. `didToKeyFragment(did) = did.split(':')[2]` — returns `"z6Mk..."` for filenames and short display

**Signing Algorithm:**
1. Canonical serialization: `JSON.stringify(record, Object.keys(record).sort())` — keys sorted alphabetically at all nesting levels
2. Convert to bytes: `new TextEncoder().encode(canonicalJson)`
3. Sign: `ed25519.sign(bytes, privateKey)` — 64-byte Ed25519 signature
4. Encode: `base64url(signature)` — URL-safe base64, no padding (RFC 4648 §5)

**Verification Algorithm:**
1. Extract public key from DID: decode base58-btc (strip 'z' prefix), strip 2-byte multicodec prefix → 32-byte public key
2. Reconstruct canonical bytes (same as signing step 1-2)
3. Decode signature from base64url
4. Verify: `ed25519.verify(signature, bytes, publicKey)` → boolean

**Intelligence Provider & Model Identities:**
The same `generateIdentity()` function is used to create DIDs for intelligence providers and models. At bootstrap, create:
- 2-3 provider identities (e.g., "Anthropic", "OpenAI", "Local Ollama")
- 3-4 model identities (e.g., "Claude Sonnet 4", "GPT-4", "Llama 3")
Each provider gets its own repository for storing `intelligence.provider` and `intelligence.model` records.

### 1b. Repository Module

**File:** `src/repository/index.ts`

**Implementation:**
```typescript
// Core operations:
// - createRepository(did) → AgentRepository
// - putRecord(repo, collection, rkey, content) → RecordResult
// - getRecord(repo, collection, rkey) → Record | null
// - listRecords(repo, collection) → Record[]
// - deleteRecord(repo, collection, rkey) → void
// - exportRepository(repo) → RepositoryExport  (for portability)
// - importRepository(export) → AgentRepository
// - getCommitLog(repo) → Commit[]
```

**Storage:** One SQLite file per agent in `./data/{did-fragment}.db`

**Commit Hash Chain Algorithm:**
- `contentHash = SHA-256(canonicalJson(content))` — same canonical serialization as signing
- `repoRootHash = SHA-256(previousCommit.repoRootHash + ":" + contentHash)` — chained hash
- First commit: `repoRootHash = contentHash` (no previous commit)
- On update: new commit with new contentHash, chained from previous repoRootHash
- On delete: commit records deletion, content_hash is SHA-256 of empty string, chain continues

**Export Format:**
```json
{
  "did": "did:key:z6Mk...",
  "exportedAt": "ISO-8601",
  "records": [{ "uri": "at://...", "collection": "...", "rkey": "...", "content": {}, "sig": "..." }],
  "commits": [{ "seq": 1, "operation": "create", "record_uri": "...", "content_hash": "...", "repo_root_hash": "..." }],
  "finalRootHash": "sha256-..."
}
```

**Import Verification:**
1. Replay all commits in seq order
2. For each: verify `content_hash` matches SHA-256 of corresponding record content
3. For each: verify `repo_root_hash` = SHA-256(prev.repo_root_hash + ":" + content_hash)
4. Verify all record signatures using the DID's public key
5. If any check fails → reject import, report which commit/record failed

**Tests:**
- Create agent, verify DID format
- Store and retrieve records
- Verify signatures on stored records
- Export and import repository (portability)
- Commit log records all operations

**Deliverable:** Can create agents with unique identities and store/retrieve signed records.

---

## Phase 2: Schemas & Validation

**Goal:** All record types are formally defined and validated.

**File:** `src/schemas/index.ts`

**Implementation:**
- Define Zod schemas for all 9 record types (see [SCHEMAS.md](./SCHEMAS.md))
- Create a schema registry: `collection NSID → Zod schema`
- Integrate validation into repository `putRecord()` — reject invalid records
- Create helper functions for constructing each record type

**Record Types:**
1. `network.mycelium.agent.profile`
2. `network.mycelium.agent.capability`
3. `network.mycelium.agent.state`
4. `network.mycelium.intelligence.provider`
5. `network.mycelium.intelligence.model`
6. `network.mycelium.task.posting`
7. `network.mycelium.task.claim`
8. `network.mycelium.task.completion`
9. `network.mycelium.reputation.stamp`

**Tests:**
- Valid records pass validation
- Invalid records (missing fields, wrong types) are rejected
- Schema registry resolves NSIDs correctly
- Helper functions produce valid records

**Deliverable:** All record types are defined, validated, and can be stored in repositories.

---

## Phase 3: Firehose & Discovery

**Goal:** Record changes are broadcast and subscribable.

**File:** `src/firehose/index.ts`

**Implementation:**
```typescript
// Core operations:
// - createFirehose() → Firehose
// - subscribe(firehose, filter?, handler) → Subscription
// - unsubscribe(firehose, subscriptionId) → void
// - getEventLog(firehose) → FirehoseEvent[]  (for dashboard replay)
```

**Integration:** Modify `AgentRepository.putRecord()` to emit events to the firehose after successful write.

**Filter support:**
- By collection NSID (e.g., only `task.posting` events)
- By DID (e.g., only events from a specific agent)
- Combined filters

**Tests:**
- Storing a record triggers a firehose event
- Filtered subscriptions only receive matching events
- Event log preserves ordering
- Multiple subscribers receive the same event

**Deliverable:** Changes to any agent repository are discoverable via firehose subscription.

---

## Phase 4: Wanted Board / Task Lifecycle

**Goal:** Full task lifecycle — post → discover → claim → assign → complete → review.

**File:** `src/orchestrator/wanted-board.ts`

**Implementation:**
```typescript
// Core operations:
// - postTask(orchestratorRepo, taskSpec) → TaskPosting
// - claimTask(agentRepo, taskUri, proposal) → TaskClaim
// - assignTask(orchestratorRepo, taskUri, claimerDid) → void
// - completeTask(agentRepo, claimUri, results) → TaskCompletion
// - reviewCompletion(orchestratorRepo, completionUri, accepted) → void
```

**State Machine Implementation:**
- Task status transitions validated (can't claim a closed task, etc.)
- Status changes update the `task.posting` record via the repository
- Each transition emits a firehose event

**State Transition Table:**

| Current State | Valid Transitions | Trigger |
|--------------|-------------------|---------|
| `open` | `claimed` | First task.claim received |
| `claimed` | `assigned`, `open` | Orchestrator assigns or all claims withdrawn |
| `assigned` | `in_progress` | Agent begins execution |
| `in_progress` | `completed` | Agent creates task.completion |
| `completed` | `accepted`, `open` | Orchestrator reviews (accept or reject→reopen) |
| `accepted` | `closed` | Reputation stamp issued, lifecycle ends |

Invalid transitions throw `InvalidStateTransitionError(currentState, attemptedState, taskUri)`.

**Implementation pattern:**
```typescript
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ['claimed'],
  claimed: ['assigned', 'open'],
  assigned: ['in_progress'],
  in_progress: ['completed'],
  completed: ['accepted', 'open'],
  accepted: ['closed'],
  closed: [],
};

function validateTransition(current: TaskStatus, next: TaskStatus, taskUri: string): void {
  if (!VALID_TRANSITIONS[current].includes(next)) {
    throw new InvalidStateTransitionError(current, next, taskUri);
  }
}
```

**Tests:**
- Full lifecycle test: post → claim → assign → complete → review
- Multiple agents can claim the same task
- Invalid transitions are rejected
- State machine enforces ordering

**Deliverable:** Complete task lifecycle with state machine validation.

---

## Phase 5: Reputation System

**Goal:** Reputation stamps are created, signed, stored, and aggregatable.

### 5a. Stamp Creation

**File:** `src/reputation/index.ts`

```typescript
// Core operations:
// - createStamp(attestorRepo, subjectDid, taskUri, dimensions) → ReputationStamp
// - getStampsForAgent(firehose, subjectDid) → ReputationStamp[]
// - aggregateReputation(stamps) → AggregatedReputation
// - getTrustLevel(aggregated) → TrustLevel
```

### 5b. Aggregation Logic

**Aggregation Formulas:**

1. **Weighted average per dimension:**
   ```
   avgScore[dim] = Σ(stamp[dim] × weight) / Σ(weight)
   where weight = recencyWeight × domainRelevanceWeight
   recencyWeight = 1.0 for last 5 stamps, 0.8 for stamps 6-15, 0.5 for stamps 16+
   domainRelevanceWeight = 1.0 if stamp.taskDomain matches query domain, 0.7 otherwise
   ```

2. **Overall score:**
   ```
   overallScore = (codeQuality × 0.30) + (reliability × 0.25) + (efficiency × 0.20) + (communication × 0.15) + (creativity × 0.10)
   ```

3. **Trust level thresholds (cumulative):**
   | Level | Min Tasks | Min Avg Overall Score |
   |-------|-----------|----------------------|
   | `newcomer` | 0 | — |
   | `established` | 3 | 60 |
   | `trusted` | 10 | 75 |
   | `expert` | 25 | 85 |

4. **Trend detection (sliding window):**
   ```
   window = last 5 stamps (or all if fewer than 5)
   recentAvg = average overallScore of last ⌈N/2⌉ stamps in window
   olderAvg = average overallScore of first ⌊N/2⌋ stamps in window
   delta = recentAvg - olderAvg
   trend = delta > 5 ? "improving" : delta < -5 ? "declining" : "stable"
   ```

5. **Per-domain breakdown:**
   ```
   For each unique taskDomain across all stamps:
     domainCount[domain] = count of stamps with that domain
     domainAvg[domain] = simple average of overallScore for that domain
   Return as Record<string, { count: number, avgScore: number }>
   ```

### 5c. Integration with Wanted Board

**Reputation-Informed Assignment Algorithm:**

When multiple agents claim the same task, the orchestrator ranks them:

```
For each claim on a task:
  agent = resolve(claim.claimerDid)
  rep = aggregateReputation(agent)

  // Capability fit score (0-100)
  capabilityScore = 0
  for each requiredCap in task.requiredCapabilities:
    matchingCap = agent.capabilities.find(c => c.domain === requiredCap.domain)
    if matchingCap:
      proficiencyScore = { beginner: 25, intermediate: 50, advanced: 75, expert: 100 }[matchingCap.proficiencyLevel]
      tagOverlap = intersect(matchingCap.tags, requiredCap.tags).length / requiredCap.tags.length
      capabilityScore += proficiencyScore * tagOverlap
  capabilityScore /= task.requiredCapabilities.length

  // Reputation score (0-100, or 50 for newcomers)
  reputationScore = rep.totalTasks > 0 ? rep.averageScores.overall : 50

  // Load penalty (prefer less busy agents)
  loadPenalty = agent.activeTasks.length * 15   // -15 per active task

  // Confidence bonus
  confidenceBonus = { low: 0, medium: 5, high: 10 }[claim.proposal.confidenceLevel]

  // Final ranking score
  rankScore = (capabilityScore * 0.40) + (reputationScore * 0.35) - loadPenalty + confidenceBonus

  // Complexity gate: newcomers can't take high-complexity tasks
  if task.complexity === "high" && rep.trustLevel === "newcomer":
    rankScore = -1   // Disqualified

Sort claims by rankScore descending. Assign to highest.
```

**Capability Matching (for agent self-evaluation — "should I claim this?"):**

```
function shouldClaim(agent, task):
  for each requiredCap in task.requiredCapabilities:
    hasMatchingDomain = agent.capabilities.some(c => c.domain === requiredCap.domain)
    if not hasMatchingDomain: return false
    
    matchingCap = agent.capabilities.find(c => c.domain === requiredCap.domain)
    profLevels = ["beginner", "intermediate", "advanced", "expert"]
    meetsMinProficiency = profLevels.indexOf(matchingCap.proficiencyLevel) >= profLevels.indexOf(requiredCap.minProficiency)
    if not meetsMinProficiency: return false
    
    tagOverlap = intersect(matchingCap.tags, requiredCap.tags).length
    if tagOverlap === 0: return false   // No relevant tags at all

  return true
```

**Tests:**
- Stamps are signed by attestor's key
- Aggregation correctly computes averages
- Trust levels follow threshold rules
- Task matching respects reputation

**Deliverable:** Working reputation system with aggregation and trust levels.

---

## Phase 6: Orchestrator & Mock Agents

**Goal:** A "Mayor" orchestrator and simulated worker agents run autonomously.

### 6a. Mock Agent Definitions

**File:** `src/agents/roster.ts`

Define 6 agents with distinct capabilities (see [ARCHITECTURE.md](./ARCHITECTURE.md) agent roster).

Each agent has:
- Predefined identity (handle, display name)
- Capability declarations (domains, tools, proficiency)
- Behavioral parameters (speed, quality tendency, task acceptance rate)

**Complete Agent Parameters:**

| Agent | Code Quality | Reliability | Communication | Creativity | Efficiency | Speed Mult. | Accept Rate | Fail Rate |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| atlas | 92 ±5 | 90 ±4 | 88 ±6 | 87 ±5 | 86 ±4 | 1.0× | 95% | 3% |
| beacon | 85 ±4 | 88 ±3 | 82 ±5 | 78 ±6 | 92 ±3 | 0.8× | 90% | 5% |
| cipher | 90 ±3 | 93 ±2 | 80 ±5 | 75 ±7 | 83 ±4 | 1.2× | 85% | 2% |
| delta | 84 ±4 | 95 ±2 | 85 ±4 | 72 ±5 | 90 ±3 | 0.9× | 95% | 3% |
| echo | 88 ±3 | 92 ±3 | 90 ±4 | 80 ±5 | 85 ±4 | 1.0× | 90% | 4% |
| forge | 72 ±8 | 68 ±10 | 74 ±7 | 70 ±8 | 65 ±9 | 1.3× | 98% | 8% |

**Column definitions:**
- **Quality dimensions (±variance):** Center score with random uniform variance. E.g., atlas code quality = random(87, 97).
- **Speed Mult.:** Multiplier on base execution time. Base times: low=2s, medium=5s, high=10s. Atlas at 1.0× does a medium task in 5s; beacon at 0.8× does it in 4s.
- **Accept Rate:** Probability the agent claims a matching task (even if qualified). Models agent "busyness" or selectivity.
- **Fail Rate:** Probability the initial submission is rejected by the orchestrator, triggering a rework cycle.

**Mock execution formula:**
```
executionTime = baseTime[task.complexity] × agent.speedMultiplier × (0.8 + Math.random() * 0.4)
qualityScore[dim] = clamp(agent.center[dim] + uniformRandom(-variance, +variance), 0, 100)
shouldFail = Math.random() < agent.failRate
```

### 6b. Agent Decision Engine

**File:** `src/agents/engine.ts`

```typescript
// Agent behavior loop:
// 1. Subscribe to firehose for task.posting events
// 2. On new task: evaluate capabilities against requirements
// 3. If match: create task.claim with approach proposal
// 4. On assignment: simulate execution (random delay)
// 5. On completion: create task.completion with mock artifacts
```

**Simulated execution:**
- Delay proportional to task complexity (low: 1-3s, medium: 3-8s, high: 8-15s)
- Generate mock artifacts (file names, hashes, line counts)
- Quality scores slightly randomized around agent tendencies
- Occasional failures (5% chance) to test rejection flow

### 6c. Orchestrator ("Mayor")

**File:** `src/orchestrator/mayor.ts`

```typescript
// Mayor behavior:
// 1. Receive a project spec (high-level description)
// 2. Decompose into 5-8 atomic tasks
// 3. Post each task to the Wanted Board
// 4. Monitor for claims, evaluate against reputation
// 5. Assign best candidate
// 6. Monitor for completions, review quality
// 7. Issue reputation stamps
// 8. Track overall project progress
```

**Task Decomposition (Mock):**
- Predefined decomposition templates for demo scenarios
- Each subtask has tagged capabilities and complexity

**Decomposition Template Data Structure:**

```typescript
interface DecompositionTemplate {
  projectPattern: string;                // Regex or keyword match against project description
  tasks: Array<{
    id: string;                          // Unique within template, e.g., "task-001"
    title: string;
    description: string;
    requiredCapabilities: Array<{
      domain: string;
      tags: string[];
      minProficiency: ProficiencyLevel;
    }>;
    complexity: "low" | "medium" | "high";
    priority: "low" | "normal" | "high" | "critical";
    dependsOn: string[];                 // IDs of tasks that must complete first
  }>;
}
```

**Demo Scenario Template — "Build the Mycelium Dashboard":**

```
Dependency DAG:

  task-001 (component library)  ──────────────────────────┐
  task-002 (REST API)  ──────────┐                        │
  task-003 (authentication) ←────┘ (depends on API)       │
  task-004 (CI/CD pipeline)  ─────────────────────────────┤
  task-005 (profile cards) ←──────────────────────────────┘ (depends on components)
  task-006 (firehose UI) ←── task-001 (depends on components)
  task-007 (integration tests) ←── task-002, task-003, task-005, task-006
  task-008 (deploy to staging) ←── task-004, task-007
```

**Concrete dependency array per task:**
- task-001: `[]` (no dependencies)
- task-002: `[]` (no dependencies)
- task-003: `["task-002"]` (needs API first)
- task-004: `[]` (no dependencies)
- task-005: `["task-001"]` (needs component library)
- task-006: `["task-001"]` (needs component library)
- task-007: `["task-002", "task-003", "task-005", "task-006"]` (needs all app code)
- task-008: `["task-004", "task-007"]` (needs CI/CD and tests)

**Mayor posts tasks respecting dependencies:** Only post a task when all its dependencies have status `accepted` or `closed`. Initially posts task-001, task-002, and task-004 (no deps). As tasks complete, posts newly unblocked tasks.

**Tests:**
- Agents discover and claim tasks they're qualified for
- Agents ignore tasks they can't do
- Orchestrator assigns highest-reputation candidate
- Full lifecycle runs without intervention

**Deliverable:** Autonomous orchestration demo with mock agents.

---

## Phase 7: E2E Demo & Dashboard

**Goal:** A polished demonstration showing the full system working together.

### 7a. CLI Demo Runner

**File:** `src/demo/run.ts`

**Implementation:**
- Scripted scenario (see [E2E-SCENARIO.md](./E2E-SCENARIO.md))
- Formatted console output with colors, tables, and progress indicators
- Step-by-step narration explaining what's happening at each phase
- Summary statistics at the end

**Run command:** `npm run demo`

### 7b. Web Dashboard

**File:** `src/demo/dashboard/`

**Technology decision:** Vanilla HTML + CSS + JavaScript with Server-Sent Events (SSE). No framework. Rationale: Zero build step, instant reload, minimal complexity for a demo dashboard.

**Server:** Fastify (lightweight, TypeScript-native HTTP server)

**Data flow:**
1. Dashboard server starts, connects to the same Firehose instance as the demo
2. REST API serves current state (agents, tasks, reputation)
3. SSE endpoint (`/api/events`) streams firehose events to the browser in real-time
4. Browser updates panels on each SSE event (no polling)

**API Endpoints:**

| Method | Path | Response | Description |
|--------|------|----------|-------------|
| GET | `/` | HTML | Dashboard SPA |
| GET | `/api/agents` | `AgentProfile[]` | All agent profiles with capabilities |
| GET | `/api/agents/:did` | `AgentProfile` | Single agent profile |
| GET | `/api/agents/:did/reputation` | `AggregatedReputation` | Agent's character sheet |
| GET | `/api/tasks` | `TaskPosting[]` | All tasks with current status |
| GET | `/api/tasks/:rkey` | `TaskPosting` | Single task with claims |
| GET | `/api/firehose` | `FirehoseEvent[]` | Full event log |
| GET | `/api/events` | SSE stream | Real-time firehose events |
| GET | `/api/reputation` | `AggregatedReputation[]` | All agents' reputation |

**Dashboard layout (2×2 grid):**
```
┌──────────────────────┬──────────────────────┐
│   AGENT REGISTRY     │    WANTED BOARD       │
│   Cards per agent    │    Task cards with     │
│   DID, caps, status  │    status badges       │
├──────────────────────┼──────────────────────┤
│   FIREHOSE STREAM    │   REPUTATION BOARD    │
│   Scrolling event    │    Bar charts per      │
│   log with filters   │    agent dimension     │
└──────────────────────┴──────────────────────┘
```

**Styling:** CSS Grid layout, CSS custom properties for theming. Color palette:
- Open tasks: blue, Assigned: yellow, Completed: green, Rejected: red
- Trust levels: newcomer=gray, established=blue, trusted=green, expert=gold

**Run command:** `npm run dashboard` starts on `http://localhost:3000`

### 7c. Portability Demonstration

At the end of the demo:
1. Export an agent's full repository
2. Create a "new orchestrator" context
3. Import the agent into the new context
4. Show the agent's reputation and history are intact
5. Agent can claim tasks in the new context using existing reputation

**Deliverable:** Complete, runnable E2E demonstration with visual output.

---

## Error Handling Conventions

All modules use custom error classes extending a base `MyceliumError`. Errors are thrown (not returned as Result types) — the MVP favors simplicity.

**Error Class Hierarchy:**
```typescript
class MyceliumError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'MyceliumError';
  }
}

// Identity errors
class InvalidDIDError extends MyceliumError { /* code: "INVALID_DID" */ }
class SignatureVerificationError extends MyceliumError { /* code: "SIG_VERIFY_FAILED" */ }

// Repository errors
class RecordNotFoundError extends MyceliumError { /* code: "RECORD_NOT_FOUND" */ }
class SchemaValidationError extends MyceliumError { /* code: "SCHEMA_VALIDATION" — includes Zod error details */ }
class ImportVerificationError extends MyceliumError { /* code: "IMPORT_VERIFY_FAILED" — includes which commit/record failed */ }

// Task lifecycle errors
class InvalidStateTransitionError extends MyceliumError { /* code: "INVALID_TRANSITION" — includes from/to/taskUri */ }
class TaskNotFoundError extends MyceliumError { /* code: "TASK_NOT_FOUND" */ }
class UnauthorizedError extends MyceliumError { /* code: "UNAUTHORIZED" — agent doesn't own this record */ }

// Firehose errors
class SubscriptionNotFoundError extends MyceliumError { /* code: "SUB_NOT_FOUND" */ }
```

**Conventions:**
- All public functions document which errors they can throw (JSDoc `@throws`)
- Schema validation errors include the full Zod error with path information
- Repository operations wrap SQLite errors in `MyceliumError` subclasses
- The demo runner catches all errors and formats them with `chalk.red()` for display
- Tests verify both happy paths AND error cases

---

## Conventions & Standards

**Identifiers:**
- **rkey generation:** `crypto.randomUUID()` (v4 UUID) for all generated record keys
- **Timestamps:** `new Date().toISOString()` — always UTC, always ISO 8601 with milliseconds
- **AT URIs:** `at://${did}/${collection}/${rkey}` — constructed by template literal

**SQLite:**
- One connection per repository, opened on `createRepository()`, closed on process exit
- WAL mode enabled: `PRAGMA journal_mode=WAL;` for concurrent reads
- Foreign keys enabled: `PRAGMA foreign_keys=ON;`

**Testing:**
- Test files co-located with source: `src/identity/identity.test.ts`
- Use `vitest` with `describe`/`it`/`expect` pattern
- Each phase's tests must pass before starting the next phase
- Use `beforeEach` to create fresh temp directories for SQLite databases in tests

**Code style:**
- No classes — use factory functions and plain objects (functional style)
- Export named functions, not default exports
- Use `type` imports for type-only imports: `import type { AgentIdentity } from '../schemas/types'`

---

## Mock Data Strategy

### Philosophy
Mock data should tell a **compelling story**, not be random noise. The demo narrates a realistic project from inception to completion.

### Project Scenario
**"Build the Mycelium Dashboard"** — A meta-project where agents build the very dashboard that displays them.

### Task Decomposition (Pre-defined)

| # | Task Title | Capability Required | Complexity | Assigned To |
|---|-----------|---------------------|-----------|-------------|
| 1 | Design component library | frontend, design | medium | atlas |
| 2 | Build REST API for agent data | backend, api | medium | beacon |
| 3 | Implement authentication | backend, security | high | cipher |
| 4 | Set up CI/CD pipeline | devops, ci-cd | medium | delta |
| 5 | Create agent profile cards | frontend, react | low | atlas |
| 6 | Build firehose event stream UI | frontend, websocket | high | forge |
| 7 | Write integration tests | testing, e2e | medium | echo |
| 8 | Deploy to staging | devops, deployment | low | delta |

### Timing Simulation
- Tasks execute with simulated delays (1-15 seconds)
- Some tasks depend on others (API before auth, components before tests)
- The demo runs in ~60-90 seconds total

### Quality Variation
- Each agent has a quality "center" with ±10% random variation
- Atlas: ~90 code quality, ~85 creativity
- Beacon: ~85 code quality, ~92 efficiency
- Echo: ~95 reliability, ~80 creativity
- This produces realistic reputation differentiation

### Edge Cases Demonstrated
1. **Capability mismatch**: Echo (QA) sees a frontend task but doesn't claim it
2. **Competition**: Multiple agents claim the same task; orchestrator picks the best
3. **Rejection**: One completion fails review; agent reworks it
4. **Trust bootstrapping**: Forge (generalist) starts with less reputation; limited to simpler tasks
5. **Migration**: Atlas migrates to a new orchestrator with reputation intact

---

## Dependency Graph

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──┐
                                                │
                                   Phase 4 ◄────┘
                                      │
                                   Phase 5
                                      │
                                   Phase 6
                                      │
                                   Phase 7
```

Phases 1-3 are foundational and sequential. Phases 4-5 build on the foundation. Phase 6 integrates everything. Phase 7 is the polish layer.

---

## Definition of Done

The MVP is complete when:

- [ ] `npm run demo` executes the full E2E scenario from bootstrap to portability
- [ ] `npm run dashboard` launches a web UI showing all system components
- [ ] All 6 agents are created with unique DIDs and signed capability records
- [ ] 8 tasks are posted, discovered, claimed, executed, and completed
- [ ] Reputation stamps are issued and aggregated into character sheets
- [ ] At least one agent successfully migrates with reputation intact
- [ ] At least one task experiences claim competition (multiple bidders)
- [ ] At least one task experiences rejection and rework
- [ ] `npm test` passes with all core modules covered
- [ ] Console output clearly narrates each step of the lifecycle
- [ ] Intelligence providers and models have DIDs and are stored as first-class records
- [ ] Agent profiles reference intelligence by DID (not hard-coded strings)
- [ ] Task completions include intelligence attribution
