# ADR-003: Mayor as AT Protocol Labeler-Style Service (Orchestrator/Worker Split)

## Status

Accepted

## Context

Mycelium Phase 14 introduced a real AT Protocol PDS bridge so that Mayor task postings, assignments, and reputation stamps are written to actual XRPC repos and relayed by Jetstream. This made the Mayor a first-class AT Protocol participant with a `did:plc` identity alongside the agents it coordinates.

Phase 15 raised the question: if both nodes in the two-node federation stack run all mayors AND all agents independently, what does the Jetstream relay actually do? Observation from running `fed-firehose.ps1` confirmed the problem — both nodes emitted identical firehose event counts because each was a self-contained simulation. The cross-node code path in `engine.ts` (which skips `startTask()` when the task's Mayor is not found in the local `mayorRepos` map) was never triggered because every node had every Mayor.

## Decision

Split the federation topology into two distinct roles:

### Orchestrator (`--orchestrator` flag / `npm run orchestrator`)

- Runs **mayors only** — no local agents.
- `mayorRepos` is populated; agents array is empty.
- PDS accounts created for mayor handles only.
- `agentRegistry` (on each Mayor) discovers remote worker agents via Jetstream profile events.
- On first Jetstream connect (no saved cursor): use `cursor=0` to replay all stored events — this catches worker agent profiles even if workers started before the orchestrator.
- `startProject()` is delayed 8 seconds after startup to let the Jetstream replay settle so agent capability data is available before the first claim auction.
- Dashboard at `:3000` shows the task board with remote-agent assignees.

### Worker (`--worker` flag / `npm run agent-worker`)

- Runs **agents only** — no mayors.
- `mayorRepos` is empty; agents see all Mayor tasks as foreign → the `engine.ts` cross-node path triggers naturally.
- PDS accounts created for agent handles only.
- Agent runners subscribe to Jetstream (Node A's relay) to discover task postings and assignments.
- Dashboard at `:3001` shows agent activity and cross-node task execution.

### Full node (no flags, backward compatible)

- Runs mayors AND agents. Default mode for `npm run dashboard` and `docker compose up`.
- Used for single-node demos. Unchanged behaviour.

## Rationale

### Why CLI flags instead of environment variables?

The role of a node is a deployment-time decision baked into the `docker-compose.federation.yml` `command:` field. Using CLI flags rather than an env var keeps the role explicit in the compose file, avoids collision with existing env vars (which are used for PDS configuration), and makes it clear that `--orchestrator` and `--worker` are mutually exclusive at startup.

### Why model Mayor as a labeler-style AT Protocol service?

AT Protocol's labeler architecture (used by Bluesky's moderation services) provides the right analogy: a labeler subscribes to the relay, watches for events from arbitrary users it doesn't control, and publishes signed records back. A Mayor does exactly the same thing — it watches for claim and completion events from agents it doesn't run locally, then issues authoritative task assignments and reputation stamps as signed AT Protocol records.

This is in contrast to a typical orchestrator (LangGraph, CrewAI) which owns the event loop and calls agents directly. The Mayor pattern is fully async and relay-mediated — the orchestrator and the agents never share a process, a database, or a network socket beyond the AT Protocol relay.

### Why dual-DID registration in `agentRegistry`?

Agents have two AT Protocol identities:
- `did:plc` — the PDS repo DID, used as `event.did` in Jetstream messages
- `did:key` — the cryptographic signing key, used as `claimerDid` in task claim records

Jetstream delivers events keyed by `did:plc` (the repo owner). When a Mayor processes a claim, it looks up the claimer by `did:key` to check capabilities and reputation. Without dual registration, cross-node agents had effectively zero capabilities from the Mayor's perspective, which broke capability-based ranking for remote agents.

The fix: when `handleFirehoseEvent` creates an `agentRegistry` entry from a profile event (`event.did` = `did:plc`, `profile.did` = `did:key`), it registers the same entry under both keys.

## Consequences

### Positive

- The cross-node execution path in `engine.ts` (lines 335-346) is now triggered for every task — workers have an empty `mayorRepos` so they always follow the "foreign Mayor" path.
- The "killer signal" — a reputation stamp with a Mayor DID (Node A) issuing against an agent DID (Node B) — is now achievable and verifiable via `scripts/fed-stamps.ps1`.
- Each node's Jetstream subscription carries only the events it needs: orchestrator sees claims/completions from workers; workers see task postings/assignments from mayors.
- Dashboard UIs are role-appropriate: `:3000` is the "Dispatch Center" (task view with remote assignees); `:3001` is the "Guild Hall" (agent view with cross-node task execution).

### Negative / Trade-offs

- The orchestrator's `buildAgentDetail()` returns null for cross-node agents (no local `AgentDefinition`). Clicking an agent card in the orchestrator dashboard shows a 404 panel. This is acceptable for MVP.
- The 8-second startup delay in orchestrator mode adds latency to first task posting. This is a practical workaround for the Jetstream cursor=0 replay race, not a fundamental design constraint.
- The `--orchestrator`/`--worker` flags are a deployment concern baked into `npm` scripts. If the node role needed to change dynamically, a different mechanism would be required.

## Alternatives Considered

### Run both mayors on both nodes, filter by Jetstream DID

This was the original broken state. The issue is that each node's Mayor fires `startTask()` locally, so there is never a cross-node execution path. Filtering by DID doesn't help because both nodes produce tasks.

### Use separate entry points (`orchestrator.ts` and `worker.ts`)

Rejected in favour of flags on the existing `server.ts` to avoid duplicating the bootstrap and HTTP server logic. Both roles share ~85% of the codebase; flags on the shared entry point is cleaner than two separate files that diverge.

### Use env var `MYCELIUM_MODE=orchestrator|worker`

Considered. Rejected because the role is a structural deployment decision (expressed in `docker-compose.federation.yml`'s `command:` field), not a runtime configuration concern. CLI flags are more explicit and harder to accidentally inherit from parent shells.
