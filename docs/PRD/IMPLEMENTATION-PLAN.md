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

**Node.js:** Requires **Node.js 20 LTS** or higher. (`node --version` should show `v20.x.x` or later.)

**Tasks:**
1. Initialize Node.js project with TypeScript
2. Install core dependencies (pinned versions):
   ```
   better-sqlite3@^9.4.3   — SQLite for agent repositories
   @noble/ed25519@^2.0.0   — Ed25519 crypto for DID and signing
   @noble/hashes@^1.3.3    — SHA-256 for commit hashing
   bs58@^6.0.0             — Base58-btc encoding for DID generation
   zod@^3.23.8             — Schema validation
   chalk@^5.3.0            — Colored CLI output
   cli-table3@^0.6.5       — Formatted CLI tables
   fastify@^4.26.2         — Lightweight HTTP server for dashboard
   tsx@^4.7.1              — Fast TypeScript execution (development)
   vitest@^1.3.1           — Testing
   @types/better-sqlite3@^7.6.8  — TypeScript types for SQLite
   ```
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

**npm scripts (in `package.json`):**
```json
{
  "scripts": {
    "build": "tsx --no-warnings src/demo/run.ts --dry-run",
    "test": "vitest run",
    "test:watch": "vitest",
    "demo": "tsx --no-warnings src/demo/run.ts",
    "dashboard": "tsx --no-warnings src/demo/dashboard/server.ts"
  }
}
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
1. Canonical serialization: `canonicalize(record)` — recursively sorts all object keys at every nesting depth (see `canonicalize()` in [ARCHITECTURE.md](./ARCHITECTURE.md))
2. Convert to bytes: `new TextEncoder().encode(canonicalJson)`
3. Sign: `ed25519.sign(bytes, privateKey)` — 64-byte Ed25519 signature
4. Encode: `Buffer.from(signature).toString('base64url')` — URL-safe base64, no padding (Node.js built-in, no package needed)

**Verification Algorithm:**
1. Extract public key from DID: decode base58-btc (strip 'z' prefix), strip 2-byte multicodec prefix → 32-byte public key
2. Reconstruct canonical bytes (same as signing step 1-2)
3. Decode signature from base64url
4. Verify: `ed25519.verify(signature, bytes, publicKey)` → boolean

**Intelligence Provider & Model Identities:**
The same `generateIdentity()` function is used to create DIDs for intelligence providers and models. At bootstrap, create:
- 2 provider identities (GitHub Models for cloud, Local Ollama for local)
- 6 model identities (cloud: "Claude Sonnet 4", "Claude Haiku 4", "GPT-4", "Phi-4"; local: "Llama 3 70B", "CodeLlama")
Each provider gets its own repository for storing `intelligence.provider` and `intelligence.model` records.

### 1b. Repository Module

**File:** `src/repository/index.ts`

**Implementation:**
```typescript
// Core operations (see ARCHITECTURE.md §2 for AgentRepository and RecordResult types):
// - createRepository(identity: AgentIdentity, firehose?: Firehose) → AgentRepository
// - putRecord(repo, collection, rkey, content) → RecordResult       // upsert: creates OR updates
// - getRecord(repo, collection, rkey) → Record | null
// - listRecords(repo, collection) → Record[]
// - deleteRecord(repo, collection, rkey) → void
// - exportRepository(repo) → RepositoryExport  (for portability)
// - importRepository(exportData, identity, firehose?) → AgentRepository
// - getCommitLog(repo) → Commit[]
```

**Integration notes:**
- `createRepository()` takes the `AgentIdentity` so the repo can sign records internally. Optionally takes a `Firehose` to auto-emit events on write.
- `putRecord()` is an upsert: checks if `(collection, rkey)` exists → emits `"create"` or `"update"` commit accordingly. Signs the content automatically using `repo.identity`.
- Auto-creates `./data/` directory on first call if it doesn't exist.

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
// - createStamp(attestorRepo, subjectDid, taskUri, completionUri, taskDomain,
//               dimensions, intelligenceDid, reworkPenalty?) → ReputationStamp
//   (See full signature in §5c below)
// - getStampsForAgent(firehose, subjectDid) → ReputationStamp[]
//   Scans firehose.log for events where collection="network.mycelium.reputation.stamp"
//   and record.subjectDid matches. Returns the record content from each matching event.
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
  reputationScore = rep.totalTasks > 0 ? rep.overallScore : 50

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

**Assessment Score Mapping:**

The `assessment` string on `ReputationStamp` is derived from `overallScore`:

| `overallScore` Range | `assessment` Value |
|---------------------|--------------------|
| 90–100 | `"exceptional"` |
| 80–89 | `"strong"` |
| 65–79 | `"satisfactory"` |
| 50–64 | `"needs_improvement"` |
| 0–49 | `"unsatisfactory"` |

Implement as: `const assessments = [[90,"exceptional"],[80,"strong"],[65,"satisfactory"],[50,"needs_improvement"],[0,"unsatisfactory"]]; return assessments.find(([min]) => score >= min)[1];`

**Trend for agents with fewer than 2 stamps:** If an agent has 0 or 1 stamps, `recentTrend` is always `"stable"` (no data to compute a trend).

**Rework/Rejection Flow (step-by-step):**

When the Mayor rejects a `task.completion`:

```
1. Mayor sets task.posting.status = "open" (from "completed")
   → Firehose event: operation "update", collection "task.posting"

2. The original assignee's claim and assignment are preserved.
   No new claim is needed — the same agent is expected to rework.

3. The agent engine, on receiving the "open" status update event, checks:
   - Was I the previous assignee for this task? (match by taskUri)
   - If yes → self-transition to in_progress, begin rework

4. Agent creates a NEW task.completion record (new rkey) referencing
   the same taskUri. This is the "rework" submission.

5. Mayor reviews the rework submission (same flow as original review).

6. If accepted → reputation.stamp is issued.
   The stamp's overallScore is penalized: -10 points for requiring rework.
   (e.g., forge's profile cards score 82 → penalized to 72)
```

**Multiple claims and state machine interaction:** Multiple agents can submit `task.claim` records for the same task. The status transition `open → claimed` happens on the first claim received. Subsequent claims are accepted as records but do **not** trigger a state change. The orchestrator collects all claims, then assigns the best candidate. Claims exist independently of the task status — they're records in the claimer's repo, not state machine events.

**`agent.state` lifecycle management:**
- Created: Each agent writes an `agent.state` record (rkey: `"self"`) during bootstrap, with `status: "idle"`, `activeTasks: []`, `queuedTasks: []`, `completedToday: 0`.
- Updated by the **agent engine** (not the Mayor):
  - On assignment received → add task URI to `activeTasks[]`, set `status: "working"` if not already
  - On completion submitted → remove task URI from `activeTasks[]`, increment `completedToday`, set `status: "idle"` if no active tasks remain
- `completedToday` is never reset during the demo (single-run session).

**`createStamp` full parameter mapping:**
```typescript
function createStamp(
  attestorRepo: AgentRepository,       // Mayor's repo (stamps live in attestor's repo)
  subjectDid: string,                  // DID of the agent being rated
  taskUri: string,                     // AT URI of the task.posting
  completionUri: string,               // AT URI of the task.completion
  taskDomain: string,                  // Domain from the task's requiredCapabilities[0].domain
  dimensions: ReputationDimensions,    // The quality scores
  intelligenceDid: string,             // From task.completion.intelligenceUsed.modelDid
  reworkPenalty?: number,              // Points to subtract from overallScore (default: 0)
): ReputationStamp
```

The `overallScore`, `assessment`, and `comment` are computed inside `createStamp`:
- `overallScore = weightedSum(dimensions) - (reworkPenalty ?? 0)`
- `assessment = scoreToAssessment(overallScore)` (see table above)
- `comment = generateAssessmentComment(dimensions, assessment)` — template string from highest/lowest dimension

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

| Agent | Code Quality | Reliability | Communication | Creativity | Efficiency | Speed Mult. | Accept Rate | Fail Rate | maxConcurrentTasks |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| atlas | 92 ±5 | 90 ±4 | 88 ±6 | 87 ±5 | 86 ±4 | 1.0× | 95% | 3% | 2 |
| beacon | 85 ±4 | 88 ±3 | 82 ±5 | 78 ±6 | 92 ±3 | 0.8× | 90% | 5% | 2 |
| cipher | 90 ±3 | 93 ±2 | 80 ±5 | 75 ±7 | 83 ±4 | 1.2× | 85% | 2% | 1 |
| delta | 84 ±4 | 95 ±2 | 85 ±4 | 72 ±5 | 90 ±3 | 0.9× | 95% | 3% | 2 |
| echo | 88 ±3 | 92 ±3 | 90 ±4 | 80 ±5 | 85 ±4 | 1.0× | 90% | 4% | 2 |
| forge | 72 ±8 | 68 ±10 | 74 ±7 | 70 ±8 | 65 ±9 | 1.3× | 98% | 8% | 3 |
| mayor | — | — | — | — | — | — | — | — | — |

**Column definitions:**
- **Quality dimensions (±variance):** Center score with random uniform variance. E.g., atlas code quality = random(87, 97).
- **Speed Mult.:** Multiplier on base execution time. Base times: low=2s, medium=5s, high=10s. Atlas at 1.0× does a medium task in 5s; beacon at 0.8× does it in 4s.
- **Accept Rate:** Probability the agent claims a matching task (even if qualified). Models agent "busyness" or selectivity.
- **Fail Rate:** Probability the initial submission is rejected by the orchestrator, triggering a rework cycle.
- **maxConcurrentTasks:** Value written to `agent.profile.maxConcurrentTasks`. Advisory only — see [Bootstrap Sequence](#bootstrap-sequence). Mayor row has no behavioral params (it's an orchestrator, not a worker).

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
- Delay determined by `BASE_EXECUTION_TIME_MS[complexity] × speedMultiplier × jitter` (see [Constants](#constants))
  - After applying all multipliers: low ≈ 1.6–2.4s, medium ≈ 4–6s, high ≈ 8–12s
- Generate mock artifacts (file names, hashes, line counts)
- Quality scores slightly randomized around agent tendencies
- Occasional failures (5% chance) to test rejection flow

### 6c. Orchestrator ("Mayor")

**File:** `src/orchestrator/mayor.ts`

**Construction:**
```typescript
interface Mayor {
  identity: AgentIdentity;
  repo: AgentRepository;
  firehose: Firehose;
  template: DecompositionTemplate;
  agentRegistry: Map<string, AgentRegistryEntry>;  // DID → cached agent data
  postedTasks: Map<string, { status: string; uri: string }>;  // template task ID → status+URI
}

interface AgentRegistryEntry {
  did: string;
  handle: string;
  capabilities: AgentCapability[];
  activeTasks: string[];    // AT URIs of tasks currently assigned to this agent
  reputation: AggregatedReputation | null;
}

// - createMayor(identity, repo, firehose, template) → Mayor
// - mayor.subscribeToFirehose() — registers handlers for agent.profile,
//     agent.capability, task.claim, task.completion events
// - mayor.startProject(description) — posts initial tasks
```

**In-memory agent registry:** Mayor builds its agent registry by observing firehose events during bootstrap:
1. On `agent.profile` event → add entry to `agentRegistry` (DID, handle, caps=[], activeTasks=[])
2. On `agent.capability` event → append to matching entry's `capabilities[]`
3. On `task.claim` event → look up claimer in registry, evaluate, rank, assign
4. On `task.completion` event → look up completer, review, issue stamp
5. On assignment → add task URI to agent's `activeTasks[]`
6. On acceptance → remove task URI from agent's `activeTasks[]`

This means Mayor's firehose subscription must be active **before** agent bootstrap writes profile records (see [Bootstrap Sequence](#bootstrap-sequence)).

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

**Concrete `requiredCapabilities` for Each Task:**

| Task ID | Title | `requiredCapabilities[].domain` | `requiredCapabilities[].tags` | `minProficiency` |
|---------|-------|-------------------------------|-------------------------------|-------------------|
| task-001 | Design component library | `frontend` | `["react", "typescript", "components"]` | `advanced` |
| task-002 | Build REST API for agent data | `backend` | `["api-design", "node-js"]` | `intermediate` |
| task-003 | Implement authentication | `security` | `["authentication", "backend"]` | `advanced` |
| task-004 | Set up CI/CD pipeline | `devops` | `["ci-cd", "docker"]` | `intermediate` |
| task-005 | Create agent profile cards | `frontend` | `["react", "frontend"]` | `beginner` |
| task-006 | Build firehose event stream UI | `frontend` | `["react", "websocket", "typescript"]` | `advanced` |
| task-007 | Write integration tests | `testing` | `["integration-testing", "e2e-testing"]` | `intermediate` |
| task-008 | Deploy to staging | `devops` | `["deployment", "devops"]` | `beginner` |

**Mock claim/completion data strategy:** Claims and completions are **generated, not hardcoded**. The agent engine generates them from templates:
- **Claim proposal:** `{ approach: "${agent.handle} will use ${tools}", estimatedDuration: "${computed from SIMULATED_DURATION_MINUTES}", confidenceLevel: "high"|"medium" }`. The `approach` string is assembled from the agent's `tools[]` in their capability record. `confidenceLevel` is `"high"` if the agent has `expert` proficiency, `"medium"` otherwise.
- **Completion artifacts:** Generated from task title: e.g., task "Design component library" → `["Button.tsx", "Card.tsx", "Input.tsx", "theme.ts", "index.ts"]`. Use a hardcoded map of `taskId → artifactList` in `src/agents/roster.ts`:

```typescript
const TASK_ARTIFACTS: Record<string, string[]> = {
  "task-001": ["Button.tsx", "Card.tsx", "Input.tsx", "Modal.tsx", "theme.ts", "index.ts"],
  "task-002": ["routes.ts", "handlers.ts", "middleware.ts", "openapi.yaml"],
  "task-003": ["auth.ts", "jwt.ts", "middleware.ts", "auth.test.ts"],
  "task-004": ["Dockerfile", "docker-compose.yml", ".github/workflows/ci.yml"],
  "task-005": ["AgentCard.tsx", "AgentCard.test.tsx", "AgentCard.stories.tsx"],
  "task-006": ["FirehoseStream.tsx", "useFirehose.ts", "EventCard.tsx", "VirtualList.tsx"],
  "task-007": ["api.test.ts", "auth.test.ts", "lifecycle.test.ts", "reputation.test.ts"],
  "task-008": ["deploy.sh", "staging.env", "healthcheck.ts"],
};
```

- **Completion metrics** (lines, test count, coverage%) are computed from artifact count: `lines = artifacts.length * random(40, 120)`, `testCount = random(8, 25)`, `coveragePercent = random(82, 96)`.

**Mayor posts tasks respecting dependencies:** Only post a task when all its dependencies have status `accepted` or `closed`. Initially posts task-001, task-002, and task-004 (no deps). As tasks complete, posts newly unblocked tasks.

**Dependency-gated posting logic:**
```typescript
// Mayor monitors firehose for task status changes (accepted/closed)
// On each status event:
function checkAndPostUnblockedTasks(template, postedTasks, firehose):
  for each task in template.tasks:
    if task.id in postedTasks: continue      // Already posted
    allDepsResolved = task.dependsOn.every(depId =>
      postedTasks[depId]?.status in ["accepted", "closed"]
    )
    if allDepsResolved:
      postTask(mayorRepo, task)              // Post to Wanted Board
      postedTasks[task.id] = { status: "open", uri: result.uri }
```

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

**SSE event format:**
```
event: firehose
data: {"seq":1,"type":"commit","operation":"create","did":"did:key:z6Mk...","collection":"network.mycelium.agent.profile","rkey":"self","record":{...},"timestamp":"2026-03-11T00:00:01Z"}

```
Each SSE message uses `event: firehose` (matching `CONSTANTS.DASHBOARD_SSE_EVENT_NAME`) and `data:` contains the `FirehoseEvent` JSON-serialized on a single line. Messages are separated by a blank line per the SSE spec.

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
| 5 | Create agent profile cards | frontend, react | low | forge |
| 6 | Build firehose event stream UI | frontend, websocket | high | atlas |
| 7 | Write integration tests | testing, e2e | medium | echo |
| 8 | Deploy to staging | devops, deployment | low | delta |

### Timing Simulation

**The simulated time model:** Real execution delays are short (seconds), but `task.completion.executionTime` records realistic human-scale durations (minutes). These are **two different things**:

| Concept | Where | Value | Purpose |
|---------|-------|-------|---------|
| Real delay | `setTimeout` in `agents/engine.ts` | 1.6s – 14s | Paces the demo so events are visible |
| Simulated duration | `task.completion.executionTime` field | `"PT30M"` – `"PT2H"` | Narrative realism; what a real team would take |

**Real delay formula** (from [Constants](#constants)):
```typescript
const delay = BASE_EXECUTION_TIME_MS[task.complexity] * agent.speedMultiplier * (0.8 + Math.random() * 0.4);
// low: ~1.6s – 2.4s, medium: ~4s – 6s, high: ~8s – 12s
```

**Simulated duration formula** (for `executionTime` field):
```typescript
const simulatedMinutes = SIMULATED_DURATION_MINUTES[task.complexity] * agent.speedMultiplier;
const executionTime = `PT${Math.round(simulatedMinutes)}M`;  // ISO 8601 duration
// low: ~24–45min, medium: ~48–80min, high: ~80–125min
```

**Pre-defined `executionTime` values for the 8 demo tasks:**

| Task | Complexity | Assigned To | executionTime |
|------|-----------|-------------|---------------|
| Design component library | medium | atlas | `"PT52M"` |
| Build REST API | medium | beacon | `"PT40M"` |
| Implement authentication | high | cipher | `"PT96M"` |
| Set up CI/CD pipeline | medium | delta | `"PT45M"` |
| Create agent profile cards | low | forge | `"PT39M"` |
| Build firehose event stream UI | high | atlas | `"PT100M"` |
| Write integration tests | medium | echo | `"PT50M"` |
| Deploy to staging | low | delta | `"PT18M"` |

The demo runs in **60–90 seconds total** (real time). The `executionTime` values are stored in records to show what a realistic project would look like.

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

## Bootstrap Sequence

This is the **exact initialization order** that `demo/run.ts` (and `demo/dashboard/server.ts`) must follow. Order matters — Firehose must exist before any subscriptions, and subscriptions must exist before records are written (so no events are missed).

```
Step 1: Create Firehose
  firehose = createFirehose()
  // Must be first — all subsequent writes emit events.

Step 2: Generate Mayor identity + repository
  mayorIdentity = generateIdentity("mayor.mycelium.local", "Mayor (Orchestrator)")
  mayorRepo = createRepository(mayorIdentity, firehose)

Step 3: Create Mayor and register firehose subscription
  mayor = createMayor(mayorIdentity, mayorRepo, firehose, DASHBOARD_TEMPLATE)
  // Mayor.subscribeToFirehose() is called inside createMayor()
  // Must happen BEFORE any records are written.
  // If Mayor subscribes after agents are bootstrapped,
  // it misses the agent.profile events and can't build its registry.

Step 4: Register dashboard subscription (dashboard mode only)
  if (mode === 'dashboard') {
    dashboardServer.subscribeToFirehose(firehose)
  }

Step 5: Bootstrap intelligence providers + models
  result = bootstrapIntelligence(firehose)
  // Generates 2 provider identities + repos (passing firehose to createRepository)
  // Writes intelligence.provider records → 2 Firehose events
  // Generates 6 model identities
  // Writes intelligence.model records into provider repos → 6 Firehose events
  // Updates provider records with modelsOffered[] DIDs → 2 more Firehose events

Step 6: Generate agent identities (6 workers)
  agents = AGENT_ROSTER.map(def => generateIdentity(def.handle, def.displayName))

Step 7: Create agent repositories
  agentRepos = agents.map(a => createRepository(a, firehose))

Step 8: Write agent.profile records (each in own repo)
  // → 7 Firehose events (6 workers + Mayor)

Step 9: Write agent.capability records (each in own repo)
  // → 18 Firehose events (3 per agent × 6 agents)

Step 10: Bootstrap complete
  // Total Firehose events: ~35
  // Mayor is now subscribed and has seen all agent profiles
  // System is ready to accept a project spec
```

**`maxConcurrentTasks` enforcement:** The `maxConcurrentTasks` field in `agent.profile` is **advisory only** in the MVP. The orchestrator reads it during assignment scoring but does not hard-block assignments if exceeded. Full enforcement is a future-phase feature.

---

## Constants

All magic numbers used throughout the MVP. Define these in `src/constants.ts` and import from there — do not hardcode values in individual modules.

```typescript
// src/constants.ts

export const CONSTANTS = {

  // ─── Execution Timing ─────────────────────────────────────────────────
  // Real delays (milliseconds) used in setTimeout during agent execution
  BASE_EXECUTION_TIME_MS: {
    low: 2000,      // 2 seconds
    medium: 5000,   // 5 seconds
    high: 10000,    // 10 seconds
  },
  // Jitter multiplier range: actual delay = base × speedMult × random(0.8, 1.2)
  EXECUTION_JITTER_MIN: 0.8,
  EXECUTION_JITTER_MAX: 1.2,

  // Simulated duration (minutes) stored in task.completion.executionTime
  SIMULATED_DURATION_MINUTES: {
    low: 30,        // ~24-45min after speedMult
    medium: 60,     // ~48-80min after speedMult
    high: 100,      // ~80-125min after speedMult
  },

  // ─── Reputation Weights ───────────────────────────────────────────────
  // Overall score = weighted sum of dimension scores
  REPUTATION_DIMENSION_WEIGHTS: {
    codeQuality:    0.30,
    reliability:    0.25,
    efficiency:     0.20,
    communication:  0.15,
    creativity:     0.10,
  },

  // Recency weighting for aggregation
  REPUTATION_RECENCY_RECENT:  1.0,   // Last 5 stamps
  REPUTATION_RECENCY_MID:     0.8,   // Stamps 6–15
  REPUTATION_RECENCY_OLD:     0.5,   // Stamps 16+

  // Domain relevance weighting
  REPUTATION_DOMAIN_MATCH:    1.0,   // Stamp domain matches query domain
  REPUTATION_DOMAIN_OTHER:    0.7,   // Stamp domain does not match

  // ─── Trust Level Thresholds ───────────────────────────────────────────
  TRUST_LEVELS: {
    newcomer:    { minTasks: 0,  minAvgScore: 0  },
    established: { minTasks: 3,  minAvgScore: 60 },
    trusted:     { minTasks: 10, minAvgScore: 75 },
    expert:      { minTasks: 25, minAvgScore: 85 },
  },

  // ─── Trend Detection ──────────────────────────────────────────────────
  TREND_WINDOW_SIZE: 5,       // Evaluate last N stamps for trend
  TREND_DELTA_THRESHOLD: 5,   // Score change ≥5 = improving/declining; <5 = stable

  // ─── Ranking / Assignment ─────────────────────────────────────────────
  RANK_WEIGHT_CAPABILITY:    0.40,
  RANK_WEIGHT_REPUTATION:    0.35,
  RANK_LOAD_PENALTY:        15,    // Points deducted per active task
  RANK_CONFIDENCE_BONUS: {
    low:    0,
    medium: 5,
    high:   10,
  },
  RANK_NEWCOMER_REPUTATION:  50,   // Neutral score for agents with no reputation yet
  RANK_HIGH_COMPLEXITY_MIN_TRUST: "established" as const,  // Newcomers can't take high tasks

  // ─── Capability Matching ──────────────────────────────────────────────
  // Tags are kebab-case, lowercase, exact string match. See INTELLIGENCE.md for full vocabulary.
  CAPABILITY_TAG_MATCH: "exact",   // No fuzzy matching in MVP

  // ─── Firehose ─────────────────────────────────────────────────────────
  FIREHOSE_SEQ_START: 1,   // seq counter starts at 1 (not 0)

  // ─── Dashboard ──────────────────────────────────────────────────────
  DASHBOARD_PORT: 3000,
  DASHBOARD_SSE_EVENT_NAME: "firehose",  // SSE event type: `event: firehose\ndata: {...}\n\n`

} as const;
```

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
