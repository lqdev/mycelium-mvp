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
   - `tsx` — Fast TypeScript execution
   - `vitest` — Testing
3. Configure `tsconfig.json` with strict mode
4. Set up project structure:

```
mycelium-mvp/
├── src/
│   ├── identity/
│   ├── repository/
│   ├── schemas/
│   ├── firehose/
│   ├── orchestrator/
│   ├── reputation/
│   ├── agents/
│   └── demo/
├── data/                    # SQLite databases (gitignored)
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
- Define Zod schemas for all 7 record types (see [SCHEMAS.md](./SCHEMAS.md))
- Create a schema registry: `collection NSID → Zod schema`
- Integrate validation into repository `putRecord()` — reject invalid records
- Create helper functions for constructing each record type

**Record Types:**
1. `network.mycelium.agent.profile`
2. `network.mycelium.agent.capability`
3. `network.mycelium.agent.state`
4. `network.mycelium.task.posting`
5. `network.mycelium.task.claim`
6. `network.mycelium.task.completion`
7. `network.mycelium.reputation.stamp`

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

- Collect all `reputation.stamp` records where `subjectDid` matches
- Compute weighted averages across dimensions
- Calculate trust level based on thresholds
- Track per-domain breakdown (frontend vs. backend reputation)
- Detect trends (improving/stable/declining)

### 5c. Integration with Wanted Board

- Orchestrator queries agent reputation before assigning tasks
- Higher-reputation agents preferred for complex/high-priority tasks
- New agents limited to low-complexity tasks

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

**Implementation:**
- Simple HTTP server (built-in Node.js or `fastify`)
- Static HTML + minimal JS (htmx or vanilla)
- Four panels:
  1. **Agent Registry** — Cards for each agent with DID, capabilities, status
  2. **Wanted Board** — Task cards with real-time status updates
  3. **Firehose Stream** — Live event log with filters
  4. **Reputation Board** — Agent "character sheets" with radar charts

**Run command:** `npm run dashboard`

### 7c. Portability Demonstration

At the end of the demo:
1. Export an agent's full repository
2. Create a "new orchestrator" context
3. Import the agent into the new context
4. Show the agent's reputation and history are intact
5. Agent can claim tasks in the new context using existing reputation

**Deliverable:** Complete, runnable E2E demonstration with visual output.

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
