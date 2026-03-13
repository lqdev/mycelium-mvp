# 🍄 Mycelium MVP

A **federated AI agent orchestration system** built on AT Protocol primitives — agents with self-sovereign identity, capability discovery, decentralised task coordination, and portable reputation.

> **Status:** Prototype / MVP — all mechanics working, LLM inference is simulated.

---

## What It Does

Mycelium is a protocol layer that fills the gap between centralised agent platforms (which lock in your data) and local-first runtimes (which offer no coordination). Agents own their identity and work history; orchestrators coordinate without controlling.

The MVP demonstrates the full lifecycle:

```
Bootstrap agents → Declare capabilities → Post tasks to Wanted Board →
Agents discover & claim tasks via Firehose → Execute (simulated) →
Completion recorded with intelligence attribution → Reputation stamps issued
```

---

## Quick Start

**Requirements:** Node.js ≥ 20

```bash
npm install

# Run the full E2E CLI demo (~50 seconds)
npm run demo

# Run the web dashboard (http://localhost:3000)
npm run dashboard

# Run tests
npm test
```

---

## Demo Output

`npm run demo` bootstraps a 6-agent team and runs an 8-task project end-to-end:

```
🍄  MYCELIUM MVP — Federated Agent Orchestration Demo
══════════════════════════════════════════════════════════════

🤖 atlas    ← Frontend specialist (claude-sonnet-4 via GitHub Models)
🤖 beacon   ← Backend architect   (claude-sonnet-4 via GitHub Models)
🤖 cipher   ← Security analyst    (gpt-4 via GitHub Models)
🤖 delta    ← DevOps engineer     (claude-haiku-4 via GitHub Models)
🤖 echo     ← QA specialist       (claude-sonnet-4 via GitHub Models)
🤖 forge    ← Generalist          (llama-3-70b via Ollama)

📋 PROJECT: Build the Mycelium Dashboard
   8 tasks · dependency-gated posting · competing claims · reputation stamps

[████████] 8/8 accepted ✅

Agent  Tasks  Score  Trust        Model
atlas    3      85   🔵 established  claude-sonnet-4
beacon   1      86   ⬜ newcomer     claude-sonnet-4
cipher   1      83   ⬜ newcomer     gpt-4
...
```

---

## Architecture

### The Seven Layers (all present in MVP)

| Layer | Component | MVP Implementation |
|-------|-----------|-------------------|
| L0 | Agent Identity | `did:key` (Ed25519) — unique, cryptographically verifiable |
| L1 | Data Ownership | Per-agent SQLite repos — agents own their records, not orchestrators |
| L2 | Schemas | Zod-validated Lexicon-like records (9 types) |
| L3 | Federation | In-memory Firehose pub/sub — same semantics as AT Protocol relay |
| L3 | Coordination | Wanted Board — task state machine (open→claimed→assigned→in_progress→completed→accepted) |
| L4 | Orchestration | Mayor — decomposes projects, ranks claims, issues reputation stamps |
| L5 | Governance | Reputation — signed stamps, multi-dimensional scores, trust levels |

### Intelligence Providers

Models are first-class entities with DIDs, enabling verifiable attribution:

```
GitHub Models (cloud)        Ollama (local)
├── claude-sonnet-4          ├── llama-3-70b
├── claude-haiku-4           └── codellama
├── gpt-4
└── phi-4
```

### Source Layout

```
src/
  identity/       Ed25519 key generation, DID:key, signing/verification
  repository/     SQLite-backed record store (one DB per agent)
  firehose/       In-memory pub/sub event bus
  schemas/        Zod schemas for all 9 record types
  intelligence/   Provider/model bootstrap (GitHub Models + Ollama)
  agents/         Engine (bootstrap + createAgentRunner) + 6-agent roster
  orchestrator/   Mayor + Wanted Board (claim ranking, task lifecycle)
  reputation/     Stamp creation, aggregation, trust levels, rankClaims
  constants.ts    All magic numbers centralised
  demo/
    run.ts        Full E2E CLI demo
    dashboard/    Fastify SSE/REST server + HTML/CSS/JS dashboard
```

---

## Key Concepts

**Agent Sovereignty** — Each agent has its own SQLite repo. The Mayor coordinates but never owns agent data. An agent can take its repo (identity + capability records + work history + reputation stamps) to any compatible orchestrator.

**Wanted Board** — Tasks posted as `task.posting` records in the Mayor's repo. Agents subscribe to the Firehose, evaluate tasks via `shouldClaim()` (domain + proficiency + tag matching), file `task.claim` records in their own repos. The Mayor ranks competing claims by capability fit, reputation, and load, then assigns the best candidate.

**Reputation** — After task acceptance, the Mayor issues a `reputation.stamp` (multi-dimensional: code quality, reliability, communication, creativity, efficiency). Stamps live in the Mayor's repo, signed and attributable. Any observer can aggregate them into a trust level (`newcomer → established → trusted → expert`).

**Intelligence Attribution** — Every task completion records `intelligenceUsed: { modelDid, providerDid }`. Reputation stamps carry `intelligenceDid`. The full provenance chain (agent + model + provider) is verifiable.

---

## Testing

```bash
npm test          # run all 179 tests once
npm run test:watch  # watch mode
```

Test coverage: schemas, identity, firehose, repository, wanted-board, orchestrator, reputation, agents, intelligence.

---

## Documentation

Full design rationale, schemas, and implementation notes in [`docs/PRD/`](./docs/PRD/):

- [`README.md`](./docs/PRD/README.md) — Executive summary and MVP scope
- [`ARCHITECTURE.md`](./docs/PRD/ARCHITECTURE.md) — Component design and data flow
- [`SCHEMAS.md`](./docs/PRD/SCHEMAS.md) — All 9 Lexicon record type definitions
- [`INTELLIGENCE.md`](./docs/PRD/INTELLIGENCE.md) — Intelligence provider strategy
- [`E2E-SCENARIO.md`](./docs/PRD/E2E-SCENARIO.md) — Detailed demo walkthrough
- [`IMPLEMENTATION-PLAN.md`](./docs/PRD/IMPLEMENTATION-PLAN.md) — Phased build plan

---

## What's Next

- Connect to real GitHub Models API (swap mock stubs for HTTP client)
- Add Ollama HTTP client for local inference
- Persist Firehose events to SQLite for cross-session replay
- Agent-to-agent delegation (sub-task spawning)
- Rework/rejection flow (Mayor rejects poor-quality completions)
- WebSocket-based Firehose (real network streaming)
- Multiple orchestrators demonstrating inter-orchestrator federation
