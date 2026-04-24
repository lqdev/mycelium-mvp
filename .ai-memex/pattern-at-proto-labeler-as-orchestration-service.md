---
title: "AT Protocol Labeler as an Orchestration Service Pattern"
description: "How to model a task orchestrator as a relay-native AT Protocol labeler: self-sovereign DID, subscribes to Jetstream, issues signed records — no shared database or network socket with the agents it coordinates."
entry_type: pattern
published_date: "2026-04-23 23:00 CDT"
last_updated_date: "2026-04-23 23:00 CDT"
tags: "typescript, atproto, distributed-systems, architecture, patterns, ai-agents, federation"
source_project: "mycelium-mvp"
---

## Discovery

The Mycelium MVP Phase 15 diagnosis: two Docker nodes running a "federation" stack both had _identical_ firehose event counts. Despite Jetstream cross-subscriptions, both nodes were self-contained simulations. The cross-node code path was dead code because both nodes bootstrapped every Mayor and every agent. There was no actual federation — just two parallel copies of the same demo.

The fix required splitting orchestration (Mayor) from execution (agents) into separate deployment roles. Once separated, the cross-node path that was already implemented in `engine.ts` started firing for every single task.

## Root Cause

Orchestrators and workers must be **structurally separated** for relay-mediated coordination to produce observable cross-node work. If every node runs everything, the relay carries nothing meaningful — all coordination is local.

Secondary bug: AT Protocol agents have two DIDs:
- `did:plc` — the PDS repo DID, delivered as `event.did` by Jetstream
- `did:key` — the cryptographic signing key, used in signed records as `claimerDid`

The `agentRegistry` was keyed by `did:plc` but claim lookups used `did:key`. Cross-node agents had invisible capabilities because their registry lookup always missed. Fix: register under both keys when handling profile events.

## The Pattern: Mayor-as-Labeler

AT Protocol has a labeler architecture for moderation services: a labeler subscribes to the relay, watches for events from arbitrary users it doesn't control, and publishes signed `#label` records back into its own AT Protocol repo. Any PDS or relay can then distribute those labels to whoever subscribes.

A **task orchestrator** fits this pattern exactly:

```
Labeler / Mayor:
  1. Has its own did:plc identity (PDS account)
  2. Subscribes to the relay (Jetstream)
  3. Watches for events from agents it doesn't run locally
     (profile announcements, task claims, completions)
  4. Issues signed records back into its own AT Protocol repo
     (task postings, assignments, reputation stamps)
  5. Those records travel via Jetstream to all subscribers
```

The agents never call the Mayor. The Mayor never calls the agents. They communicate only through signed AT Protocol records relayed by Jetstream. This is the key difference from LangGraph/CrewAI-style orchestrators which own the event loop.

## The 911 Dispatch Analogy

Think of Mayors as **911 dispatch centers** and agents as **field units**:
- Dispatch doesn't run in the same building as the field units
- Dispatch posts work orders to a shared radio channel (Jetstream)
- Field units scan the channel, pick up work orders matching their capabilities
- Field units report completion back on the same channel
- Dispatch issues the official "case closed" stamp (reputation record)

No direct connection between dispatch and field. The relay is the only shared infrastructure.

## Solution

### Deployment Topology (orchestrator/worker split)

```
Node A — Orchestrator (mayors only):
  - Mayor Alpha + Mayor Beta (did:plc accounts on PDS A)
  - No local agents
  - Subscribes to Jetstream B (sees worker agent events)
  - Posts task postings, assignments, stamps to PDS A
  - cursor=0 on first connect → replays stored events to discover pre-existing agents

Node B — Workers (agents only):
  - 8 agents (did:plc + did:key identities on PDS B)
  - No mayors
  - Subscribes to Jetstream A (sees Mayor task events)
  - mayorRepos is empty → engine.ts cross-node path triggers for every task
  - Claims and completions written to PDS B
```

### CLI Flag Design

```typescript
// server.ts — module scope, read once at startup
const isOrchestrator = process.argv.includes('--orchestrator');
const isWorker = process.argv.includes('--worker');

// Fail fast — roles are mutually exclusive
if (isOrchestrator && isWorker) {
  console.error('--orchestrator and --worker are mutually exclusive');
  process.exit(1);
}
```

```json
// package.json
{
  "scripts": {
    "dashboard": "tsx src/demo/dashboard/server.ts",
    "orchestrator": "tsx src/demo/dashboard/server.ts --orchestrator",
    "agent-worker": "tsx src/demo/dashboard/server.ts --worker"
  }
}
```

```yaml
# docker-compose.federation.yml
services:
  mycelium-a:
    command: ["npm", "run", "orchestrator"]
  mycelium-b:
    command: ["npm", "run", "agent-worker"]
```

### Startup Race Fix (cursor=0 replay)

Workers may start before the orchestrator. Without replay, the orchestrator subscribes live-tail and misses agent profile events already delivered. Fix: use `cursor=0` on first Jetstream connect in orchestrator mode — this replays all stored events from Jetstream's persistent storage.

```typescript
const savedCursor = await loadJetstreamCursor(jetstreamEndpoint);
initJetstream(
  jetstreamEndpoint,
  firehose,
  localPlcDids,
  savedCursor ?? (isOrchestrator ? 0 : undefined), // replay on first orchestrator connect
  (timeUs) => saveJetstreamCursor(jetstreamEndpoint, timeUs),
);
```

Also delay `startProject()` by 8 seconds in orchestrator mode to let the replay settle before the first claim auction.

### Dual-DID Registration

```typescript
// mayor.ts — handleFirehoseEvent
const entry = {
  did: event.did,          // did:plc (Jetstream wire DID)
  handle: profile.handle,
  capabilities: [],
  activeTasks: [],
  reputation: null,
};
mayor.agentRegistry.set(event.did, entry);

// Also index under the signing did:key so claim lookups resolve correctly
// profile.did comes from the record body (the agent's signing key)
if (profile.did && profile.did !== event.did) {
  mayor.agentRegistry.set(profile.did, entry);
}
```

## The Killer Signal

The proof that cross-node federation is working:

```
A reputation stamp where:
  issuerDid = did:plc:... (Mayor on Node A)
  subjectDid = did:key:... (Agent on Node B)
```

This means: Node B agent wrote a completion record → Jetstream B relayed it → Node A Mayor received it → Mayor issued a stamp → Stamp written to PDS A → Jetstream A relayed it → observable on Node B.

The full relay round-trip in one verifiable record.

```powershell
# Validate via script
scripts\fed-stamps.ps1
# Look for: ✅ N cross-node stamps — full federation loop proven
```

## Prevention

**When building relay-mediated distributed systems:**

1. **Separate orchestrators from workers at deployment time** — never co-locate them in a demo that claims to be federated.
2. **Dual-register participants by all their identities** — if a participant has both a wire DID and a signing DID, index under both from the start.
3. **Use cursor replay on first connect** for consumers that need to discover pre-existing participants — live-tail only works if you started first.
4. **Add startup delays** before making decisions that depend on discovered participants — give replay time to settle.
5. **Design a "killer signal"** before building — one verifiable observable (a record, a log line) that can only exist if the full cross-node loop closed. Test for it explicitly.
6. **Don't confuse cross-subscription with cross-node work** — two nodes cross-subscribing to each other's Jetstream streams does not prove coordination unless one of them actually reacts to the other's records.
