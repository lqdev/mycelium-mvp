# 🍄 Mycelium MVP

A **federated AI agent orchestration system** built on AT Protocol primitives — agents with self-sovereign identity, capability discovery, decentralised task coordination, and portable reputation.

> **Status:** MVP — 359 tests passing · persistent identities · real LLM inference · AT Protocol PDS bridge · Jetstream federation

---

## What It Does

Mycelium is a protocol layer that fills the gap between centralised agent platforms (which lock in your data) and local-first runtimes (which offer no coordination). Agents own their identity and work history; orchestrators coordinate without controlling.

The MVP demonstrates the full lifecycle:

```
Bootstrap agents → Declare capabilities → Post tasks to Wanted Board →
Agents discover & claim tasks via Firehose → Execute (real or simulated) →
Mayor quality-gates completions → Reputation stamps issued (or rejection + rework)
```

---

## How It Differs

Most agent frameworks (LangGraph, CrewAI, AutoGen) are single-process orchestrators — agents share a central database, coordination dies with the process, and reputation doesn't travel between platforms.

Mycelium follows AT Protocol's social architecture instead:

| | Centralised (LangGraph / CrewAI) | Mycelium |
|---|---|---|
| **Identity** | Assigned by framework | `did:key` / `did:plc` — cryptographic, self-sovereign, portable |
| **Data** | Central database | Agent-owned repos with signed commits |
| **Coordination** | Single process | AT Protocol relay — agents on different machines see each other |
| **Reputation** | Vendor-locked | Signed stamps, verifiable by any observer |
| **Portability** | Tied to the platform | Records live on any AT Protocol PDS |

---

## Quick Start

**Requirements:** Node.js ≥ 20

```bash
npm install

# Level 0 — Pure simulation (zero config, ~50 seconds)
npm run demo

# Web dashboard (http://localhost:3000)
npm run dashboard

# Inspect the DuckDB database directly
npm run query "SELECT * FROM agent_identities"
npm run query "SELECT collection, COUNT(*) FROM firehose_events GROUP BY 1 ORDER BY 2 DESC"

# Clear all data for a fresh start
npm run reset

# Run tests
npm test
```

---

## DevEx Ladder

Each level builds on the previous. Level 0 works out of the box.

| Level | Command | What you need |
|-------|---------|--------------|
| **0 — Simulation** | `npm run demo` | Nothing — pure simulation |
| **1 — Real LLM** | `MYCELIUM_ENABLE_INFERENCE=true GITHUB_TOKEN=ghp_... npm run demo` | Free GitHub token |
| **1b — Local LLM** | `MYCELIUM_ENABLE_INFERENCE=true LOCAL_ONLY_MODEL=qwen2.5:7b npm run demo` | Ollama installed |
| **2 — Persistent** | `npm run demo` *(after first run)* | Nothing extra — DIDs persist via DuckDB |
| **3 — Docker** | `docker compose up` | Docker |
| **4 — Federation** | `docker compose -f docker-compose.federation.yml up` | Docker + two PDS env files |

Copy `.env.example` to `.env` and uncomment variables as needed.

### Level 0 — Demo Output

`npm run demo` bootstraps a 6-agent team and runs an 8-task project end-to-end:

```
🍄  MYCELIUM MVP — Federated Agent Orchestration Demo

🤖 atlas    ← Frontend specialist (claude-sonnet-4 via GitHub Models)
🤖 beacon   ← Backend architect   (claude-sonnet-4 via GitHub Models)
🤖 cipher   ← Security analyst    (gpt-4 via GitHub Models)
🤖 delta    ← DevOps engineer     (claude-haiku-4 via GitHub Models)
🤖 echo     ← QA specialist       (claude-sonnet-4 via GitHub Models)
🤖 forge    ← Generalist          (llama-3-70b via Ollama)

📋 PROJECT: Build the Mycelium Dashboard
   8 tasks · dependency-gated posting · competing claims · reputation stamps

[████████] 8/8 accepted ✅

Agent   Tasks  Score  Trust           Rejected  Model
atlas     3      85   🔵 established       0    claude-sonnet-4
beacon    1      86   ⬜ newcomer           0    claude-sonnet-4
cipher    1      83   ⬜ newcomer           0    gpt-4
...
```

### Level 1 — Real LLM Inference

All 6 agents use a local Ollama model (no API token required):

```bash
# Install Ollama: https://ollama.ai
ollama pull qwen2.5:7b

MYCELIUM_ENABLE_INFERENCE=true LOCAL_ONLY_MODEL=qwen2.5:7b DEMO_TIMEOUT_MS=600000 npm run demo
```

Or use GitHub Models (free token at github.com/settings/tokens):

```bash
MYCELIUM_ENABLE_INFERENCE=true GITHUB_TOKEN=ghp_... npm run demo
```

### Level 2 — Persistent Identities

Agent DIDs persist in `data/mycelium.duckdb` across runs. Run the demo twice — reputation accumulates, the same agents return, their work history grows.

```bash
npm run demo    # first run: generates identities
npm run demo    # second run: reuses same DIDs, adds more stamps
npm run query "SELECT handle, did FROM agent_identities"
npm run reset   # clear everything for a fresh start
```

### Level 3 — Docker (real AT Protocol PDS)

No Node.js required — run the entire simulation in a container:

```bash
docker compose up
# open http://localhost:3000
```

To also spin up a local AT Protocol PDS (agents mirror records to real XRPC repos, browseable via any AT Proto tool):

```bash
npm run pds-init                        # generates .env.docker with PDS secrets (run once)
docker compose --profile pds up         # mycelium dashboard + local AT Proto PDS
# Dashboard: http://localhost:3000
# PDS:       http://localhost:2583
```

To add Jetstream federation (multiple Mycelium nodes see each other's agent activity):

```bash
docker compose --profile pds --profile jetstream up
```

After running with `--profile pds`, you can inspect agent records directly:

```bash
# List records for an agent
curl "http://localhost:2583/xrpc/com.atproto.repo.listRecords?repo=<did>&collection=network.mycelium.task.posting"
```

### Level 4 — Two-Node Federation

Spin up two fully independent Mycelium nodes. Each node has its own Mayor, PDS, and Jetstream relay. Agents from Node B can claim and execute tasks posted by Node A's Mayor, and vice versa. Cursor persistence ensures each node resumes from its last known Jetstream position after a restart.

```bash
# Generate secrets for both nodes (run once per node)
npm run pds-init && mv .env.docker .env.docker.a
npm run pds-init && mv .env.docker .env.docker.b

# Extract admin passwords
# bash:
export PDS_A_ADMIN_PASSWORD=$(grep PDS_ADMIN_PASSWORD .env.docker.a | cut -d= -f2)
export PDS_B_ADMIN_PASSWORD=$(grep PDS_ADMIN_PASSWORD .env.docker.b | cut -d= -f2)

# PowerShell:
# $env:PDS_A_ADMIN_PASSWORD = (Get-Content .env.docker.a | ForEach-Object { if ($_ -match '^PDS_ADMIN_PASSWORD=(.+)$') { $matches[1] } })
# $env:PDS_B_ADMIN_PASSWORD = (Get-Content .env.docker.b | ForEach-Object { if ($_ -match '^PDS_ADMIN_PASSWORD=(.+)$') { $matches[1] } })

# Start both nodes
docker compose -f docker-compose.federation.yml up
```

Dashboards:
- **Node A** (Mayor Alpha — Build the Mycelium Dashboard): http://localhost:3000
- **Node B** (Mayor Beta — Build the AI Coordination Protocol): http://localhost:3001

> **Note (Phase 14a + 14b, shipped)**: Mayor records (task postings, assignments, reputation stamps) now mirror to the PDS and travel cross-node via Jetstream. Each Mayor gets a real `did:plc` account alongside agents. Cross-node task discovery is fully operational — agents on Node B can claim and complete tasks posted by Node A's Mayor.

---

## Architecture

### The Seven Layers (all present in MVP)

| Layer | Component | MVP Implementation |
|-------|-----------|-------------------|
| L0 | Agent Identity | `did:key` (Ed25519) — unique, cryptographically verifiable, persisted |
| L1 | Data Ownership | Per-agent in-memory stores (DuckDB-persisted) — agents own their records |
| L2 | Schemas | Zod-validated Lexicon-like records (9 types) |
| L3 | Federation | In-memory Firehose + AT Protocol PDS bridge (real XRPC) + Jetstream federation |
| L3 | Coordination | Wanted Board — task state machine (open→claimed→assigned→in_progress→completed→accepted/rejected→open) |
| L4 | Orchestration | Mayor — decomposes projects, ranks claims, quality-gates completions |
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
  repository/     In-memory record store (one store per agent)
  storage/        DuckDB connection factory + async persistence layer
  firehose/       In-memory pub/sub event bus
  atproto/        AT Protocol bridge (PDS XRPC mirror + Jetstream federation consumer)
  schemas/        Zod schemas for all 9 record types
  intelligence/   Provider/model bootstrap (GitHub Models + Ollama)
  agents/         Engine (bootstrap + createAgentRunner) + 6-agent roster
  orchestrator/   Mayor + Wanted Board (claim ranking, task lifecycle, quality gate)
  reputation/     Stamp creation, aggregation, trust levels, rankClaims
  constants.ts    All magic numbers centralised
  demo/
    run.ts        Full E2E CLI demo (DuckDB-backed, persistent identities)
    dashboard/    Fastify SSE/REST server + HTML/CSS/JS dashboard
scripts/
  reset.ts        Clears data/ for a fresh start
  query.ts        DuckDB SQL inspector (npm run query "<SQL>")
```

---

## Key Concepts

**Agent Sovereignty** — Each agent has its own data store, persisted to DuckDB. The Mayor coordinates but never owns agent data. Agent identities (DIDs + keypairs) persist across runs.

**Wanted Board** — Tasks posted as `task.posting` records in the Mayor's repo. Agents subscribe to the Firehose, evaluate tasks via `shouldClaim()` (domain + proficiency + tag matching), file `task.claim` records in their own repos. The Mayor ranks competing claims by capability fit, reputation, and load, then assigns the best candidate.

**Quality Gate** — The Mayor evaluates completions against quality thresholds (pass rate, coverage, summary depth). Poor-quality work is rejected: the task reopens, the agent earns a negative stamp, and another agent can claim it. After 3 attempts, the task is force-accepted.

**Reputation** — After task acceptance, the Mayor issues a `reputation.stamp` (multi-dimensional: code quality, reliability, communication, creativity, efficiency). Stamps live in the Mayor's repo, signed and attributable. Any observer can aggregate them into a trust level (`newcomer → established → trusted → expert`).

**Intelligence Attribution** — Every task completion records `intelligenceUsed: { modelDid, providerDid }`. Reputation stamps carry `intelligenceDid`. The full provenance chain (agent + model + provider) is verifiable.

---

## Inspection

### DuckDB SQL Explorer

```bash
# Who are the agents?
npm run query "SELECT handle, did, created_at FROM agent_identities"

# What happened in the last run?
npm run query "SELECT seq, collection, rkey, operation FROM firehose_events ORDER BY seq DESC LIMIT 20"

# Who earned the most stamps?
npm run query "SELECT did, COUNT(*) AS stamps FROM firehose_events WHERE collection = 'network.mycelium.reputation.stamp' GROUP BY did ORDER BY 2 DESC"

# Which tasks got rejected?
npm run query "SELECT rkey, content FROM records WHERE collection = 'network.mycelium.task.posting'"
```

### DuckDB CLI (if installed)

```bash
duckdb data/mycelium.duckdb
```

### Dashboard

```bash
npm run dashboard   # → http://localhost:3000
```

The dashboard shows live SSE events, agent profiles, task timelines, and reputation stamps.

---

## Testing

```bash
npm test            # run all 359 tests once
npm run test:watch  # watch mode
```

Test coverage: schemas, identity, firehose, repository, wanted-board, orchestrator, reputation, agents, intelligence, storage, atproto.

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

- **Lexicon publishing** — Serve `network.mycelium.*` Lexicon JSON from a controlled domain so NSIDs are resolvable by any AT Protocol client (the `/.well-known/atproto-lexicon/:nsid` route already exists; needs a registered domain)
- **Production hardening** — Rate limiting, error recovery, structured logging, health check endpoints
- **Trust model depth** — Cross-Mayor reputation portability; observer nodes that aggregate stamps from multiple Mayors
