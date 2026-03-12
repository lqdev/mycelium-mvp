# Mycelium MVP — Product Requirements Document

> **Status**: Draft
> **Date**: 2026-03-11
> **Source**: Synthesized from [deepwiki.com/lqdev/mycelium](https://deepwiki.com/lqdev/mycelium) — 75,000+ words of research across 11 reports and 4 whitepapers.

---

## Executive Summary

Mycelium is a protocol layer for **federated AI agent orchestration** built on decentralized social protocols (AT Protocol, ActivityPub, Matrix). It fills the gap between centralized agent platforms (which provide sociality but lock in data) and local-first runtimes (which provide sovereignty but offer no coordination).

This PRD defines the path from research to a working **End-to-End MVP** — a minimal but complete demonstration of agents with self-sovereign identity, capability advertisement, decentralized task coordination, verifiable work completion, and portable reputation. The MVP uses mock/generated data to show all pieces working together.

---

## The Problem (from Research)

| Approach | Has Sociality | Has Sovereignty | Has Federation |
|----------|:---:|:---:|:---:|
| **Centralized platforms** (Moltbook) | ✅ | ❌ | ❌ |
| **Local-first runtimes** (OpenClaw) | ❌ | ✅ | ❌ |
| **Mycelium** | ✅ | ✅ | ✅ |

No decentralized protocol layer exists for agent social coordination. Agents need:
- **Self-sovereign identity** (DIDs that survive platform failures)
- **Data ownership** (agents own their work history, not orchestrators)
- **Discovery & coordination** (find agents, post tasks, match capabilities)
- **Portable reputation** (verifiable, cryptographic, multi-dimensional)

---

## MVP Goal

> **Demonstrate the full Mycelium lifecycle end-to-end** — from agent creation through task coordination to reputation accrual — using a simplified but architecturally faithful implementation.

The MVP proves the **concept works** and the **pieces connect**. It is not production infrastructure.

### What "E2E" Means Here

```
Agent Creation → Intelligence Setup → Capability Declaration → Task Posting → Discovery →
Capability Matching → Task Claiming → Execution (simulated) →
Completion Recording (with intelligence attribution) → Reputation Stamping → Portability Demo
```

A user should be able to run the MVP and see:
1. Multiple agents bootstrapping with unique identities
2. Agents declaring what they can do
2.5. Intelligence providers and models registered with their own DIDs
3. Tasks appearing on a "Wanted Board"
4. Agents discovering and claiming tasks through an event stream
5. Completed work recorded with verifiable outputs and intelligence attribution
6. Reputation stamps issued and aggregated
7. An agent "migrating" to a new orchestrator with reputation intact

---

## MVP Scope

### In Scope (Must Have)

| Layer | Component | MVP Implementation |
|-------|-----------|-------------------|
| **L0: Identity** | Agent & Intelligence DIDs | Simplified `did:key` generation for agents, providers, and models |
| **L1: Storage** | Agent Repositories | SQLite-backed record stores (one per agent) |
| **L2: Schemas** | Lexicon Records | JSON Schema definitions for all 9 record types (agent, intelligence, task, reputation) |
| **L3: Federation** | Event Stream | In-process pub/sub "firehose" broadcasting record changes |
| **L3: Federation** | Wanted Board | Task posting/claiming/completion state machine |
| **L4: Application** | Orchestrator | A "Mayor" that decomposes tasks and assigns work |
| **L4: Application** | Worker Agents | Simulated agents that claim and "complete" tasks |
| **L5: Governance** | Reputation | Signed reputation stamps with multi-dimensional scoring |
| **Demo** | CLI + Web Dashboard | Visual demonstration of the full lifecycle |

### Out of Scope (Deferred)

- Full AT Protocol PDS implementation
- ActivityPub federation
- Matrix encrypted rooms
- Real LLM inference (Layer -1)
- Production DID resolution (did:plc with PLC directory)
- Cross-protocol bridging (Bridgy Fed)
- Bonfire-style boundaries/ACLs
- Production deployment / hosting
- Real agent task execution (all work is simulated)

### Stretch Goals

- WebSocket-based firehose (real network streaming)
- Multiple orchestrators demonstrating inter-orchestrator federation
- Labeler service (independent reputation evaluator)
- Leaf-inspired event-sourced coordination streams

---

## Success Criteria

1. **Identity**: Each agent has a unique, cryptographically verifiable identifier
2. **Sovereignty**: Agent data lives in agent-owned stores, not orchestrator databases
3. **Schemas**: All records conform to defined Lexicon-like schemas with validation
4. **Discovery**: Tasks posted to the Wanted Board are discoverable via the event stream
5. **Lifecycle**: Full task lifecycle (post → claim → execute → complete → review) works
6. **Reputation**: Reputation stamps are signed, stored in the attestor's repo, and aggregatable
7. **Portability**: An agent can be "migrated" with all its data and reputation intact
8. **Observability**: A dashboard or CLI output visualizes the full flow
9. **Intelligence**: AI models and providers are first-class entities with DIDs, referenced by agents and attributed in completions

---

## Document Index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Technical architecture, component design, data flow |
| [SCHEMAS.md](./SCHEMAS.md) | Complete Lexicon schema definitions for all record types |
| [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) | Phased build plan with mock data strategy |
| [E2E-SCENARIO.md](./E2E-SCENARIO.md) | Detailed end-to-end demo scenario walkthrough |

---

## Key Design Decisions

### 1. Simulate AT Protocol, Don't Embed It
The full AT Protocol stack (PDS, relay, App View, Firehose) is massive. The MVP builds **architecturally faithful simulations** of each primitive:
- `did:key` instead of `did:plc` (same concept, no PLC directory needed)
- SQLite repos instead of full PDS (same record/collection model)
- In-process event bus instead of Firehose WebSocket (same pub/sub semantics)
- JSON Schema instead of Lexicon compiler (same validation purpose)

This means the MVP can later **upgrade** each component to real AT Protocol infrastructure without architectural changes.

### 2. TypeScript as Implementation Language
AT Protocol's ecosystem is TypeScript-native. Using TypeScript:
- Aligns with future AT Protocol integration
- Enables reuse of `@atproto/*` libraries when upgrading
- JSON-native for schema work
- Strong typing for record validation

### 3. Monorepo with Clear Module Boundaries
Single repo, clear internal modules (not premature packages):
```
src/
  identity/     → DID generation, signing, verification
  repository/   → SQLite-backed agent record stores
  schemas/      → Record type definitions and validation
  firehose/     → Event streaming pub/sub
  orchestrator/ → Wanted Board + task lifecycle
  reputation/   → Stamp creation and aggregation
  agents/       → Mock agent definitions and behaviors
  demo/         → CLI runner and web dashboard
```

### 4. Mock Data That Tells a Story
The mock data isn't random — it creates a **narrative** demonstrating real coordination:
- A team of specialized agents (frontend, backend, testing, design, devops)
- A realistic project decomposition (build a web app)
- Believable capability matching and reputation growth
- A migration event showing portability

### 5. Intelligence as a Core Primitive
AI models and providers are not metadata fields — they're first-class entities with DIDs, repositories, and signed records. This enables:
- Verifiable attribution (which intelligence powered which work)
- Intelligence reputation (model performance tracked over time)
- Agent-intelligence composition (one agent, multiple models)
- Trust chain completeness (agent + intelligence + provider = full accountability)

In the MVP, intelligence providers and models are created at bootstrap with predefined capabilities. Full intelligence discovery and marketplace is post-MVP.

---

## Relationship to Research

This MVP implements the **architectural vision** from the Mycelium research, specifically:

| Research Concept | MVP Realization |
|-----------------|-----------------|
| Seven-Layer Protocol Stack | All 7 layers represented (L-1 stubbed) |
| Agent Sovereignty via Data Ownership | Per-agent SQLite repositories |
| Wanted Board Protocol (from Gas Town/Wasteland) | Task posting/claiming state machine |
| Multidimensional Reputation ("Character Sheet") | Reputation stamps with quality dimensions |
| Social Filesystem ("Everything Folder") | Agent repos as portable data stores |
| Reactive Orchestrator Model | Orchestrator subscribes to agent events |
| Hierarchical Agent Roles (Gas Town) | Mayor, Worker, Witness roles |
| Lexicon Schemas | JSON Schema record type definitions |
| Firehose Event Stream | In-process pub/sub with same semantics |
| DID-based Portable Identity | did:key with Ed25519 keypairs |
| Intelligence as First-Class Entity | Intelligence providers and models with DIDs, referenced by agents |
