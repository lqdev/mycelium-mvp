---
title: "Pattern: AT Protocol AppView as Decentralized Task Marketplace (Wanted Board)"
description: "Task authors publish task.posting to their own PDS. The Wanted Board acts as an AT Protocol AppView-style indexer — subscribing to Jetstream globally, indexing tasks from any DID's repo."
entry_type: pattern
published_date: "2026-04-24 20:38 CDT"
last_updated_date: "2026-04-24 20:38 CDT"
tags: "atproto, architecture, patterns"
source_project: "mycelium-mvp"
---

# Pattern: AT Protocol AppView as Decentralized Task Marketplace (Wanted Board)

## The Architectural Insight

In Mycelium Phases 1–16, the Mayor (orchestrator) is BOTH the task requester AND the task coordinator. The Mayor posts `task.posting` records to its OWN repo and then orchestrates agents to fulfill them. This is fine for a demo — but it obscures a more powerful architectural truth.

**In a fully decentralized AT Protocol world:**

```
Any entity (person, business, AI system) with a DID
  → publishes task.posting to THEIR OWN PDS repo
  → record enters the Jetstream firehose globally

The Wanted Board (an AT Protocol AppView)
  → subscribes to Jetstream
  → indexes task.posting records from ANY DID's repo
  → serves them to agents for discovery and claiming

The Mayor/Orchestrator
  → discovers tasks via Wanted Board
  → coordinates execution
  → does NOT "own" the task — the requester does

The Requester
  → first-class network participant
  → can review completion and stamp acceptance
  → decoupled from orchestration
```

This is the same model as:
- **Bluesky posts** — any user posts to their own PDS; `app.bsky.feed.post` records are indexed by AppViews to serve feeds
- **AT Protocol Labels** — any labeler subscribes to the relay and publishes `app.bsky.label.defs` records to their own repo; Bluesky Social (an AppView) aggregates them
- **Bluesky Feed Generators** — discover posts from any user's repo via Jetstream, index them, serve curated feeds

**The Wanted Board IS a Mycelium AppView.**

## Pattern Description

### Problem

Task coordination systems couple "who wants work done" with "who routes work." This creates:
- Centralization (only one entity can post tasks — the Mayor)
- Conflict of interest (Mayor assigns AND evaluates)
- Closed market (external requesters can't participate)

### Solution

Separate task authorship from task orchestration using AT Protocol's native architecture:

1. **Any DID can be a task requester.** They POST `network.mycelium.task.posting` to their own PDS repo. This record enters the global firehose.

2. **The Wanted Board is an indexer, not a store.** It subscribes to Jetstream, discovers `task.posting` records from any DID's repo, and maintains a queryable index of open tasks. It doesn't CREATE tasks — it DISCOVERS them.

3. **The Mayor is a coordinator, not a requester.** It queries the Wanted Board index, finds tasks it can orchestrate, and coordinates agent execution. It may also post tasks itself (self-requester) — but this is just ONE type of task origin.

4. **The requester retains ownership.** The `task.posting` record lives in the requester's repo with their signature. Completion acceptance is also written by the requester (via `task.review`). Their relationship to the task is verifiable forever.

### Implementation

```typescript
// Any entity with an identity can post a task:
const customerIdentity = await generateIdentity();
const customerRepo = await createRepository(customerIdentity);

putRecord(customerRepo, 'network.mycelium.task.posting', 'task-001', {
  $type: 'network.mycelium.task.posting',
  title: 'Build me an estate plan',
  requiredCapabilities: ['legal-analysis', 'financial-planning'],
  // ...
});
// → Record lands in Jetstream → Wanted Board indexes it → Mayor discovers it

// Mayor coordinates without owning the task:
const tasks = await wantedBoard.discoverTasks({ 
  status: 'open',
  requiredCapabilities: availableCapabilities 
});
// Tasks came from any DID's repo — Mayor doesn't filter by "did I post this?"
```

### The "Estate Plan" Scenario

```
Customer (any DID)   → posts "Build me an estate plan" to their PDS
                            ↓ Jetstream firehose
Wanted Board (AppView) → indexes the task.posting from customer's repo
                            ↓ Mayor queries Wanted Board
Mayor               → discovers task, decomposes into subtasks
                       (accountants, lawyers, analysts)
                            ↓ Agents across all PDSs claim subtasks
Agents              → execute, post completions to their own repos
                            ↓ Mayor coordinates
Mayor               → stamps quality gate (protocol completed)
Customer            → reviews completions, stamps acceptance (was my need met?)
Peer agents         → optional: domain expert review stamps
```

## AT Protocol AppView Architecture (Reference)

AT Protocol distinguishes three server roles:

| Role | Mycelium Equivalent | Responsibility |
|------|--------------------|-|
| **PDS** (Personal Data Server) | Each agent's/requester's node | Stores the user's records, signs them, makes them available via XRPC |
| **Relay** (Firehose) | Jetstream | Aggregates events from all PDSes, provides a subscribable stream |
| **AppView** | Wanted Board | Subscribes to Relay, indexes records by topic/type, serves read queries |

The key property of an AppView: **it doesn't own data, it indexes data from repos**. The source of truth is always the repo; the AppView is a queryable view.

## Why This Matters

1. **Open market**: Any entity can post tasks. Startups, individuals, other AI systems. The protocol handles it.

2. **Verifiable ownership**: A task's requester is identified by DID, not by "who used the Mayor's API." The `task.posting` is signed by the requester's key in their own repo.

3. **Composable trust**: Since the requester has a DID, they can stamp acceptance (`task.review`). This closes the loop — "did the work meet my need?" is answered by the person who needed it, not the system that coordinated it.

4. **Natural federation**: Multiple Mayors (orchestrators) can discover and compete to coordinate the same task. The requester gets the best coordinator via market dynamics.

5. **Portability**: A requester can move to a different PDS without losing their task history. Their task.posting records move with them (AT Protocol data portability).

## Relationship to AT Protocol Labelers

The closest AT Protocol analogy is labelers + AppViews:

```
Labeler posts label records → to their own PDS repo → via relay → indexed by AppView
Requester posts task records → to their own PDS repo → via relay → indexed by Wanted Board
```

The Mayor that receives tasks is structurally identical to a Bluesky AppView that aggregates labels. Neither "owns" the original records.

## Phase 17 Implementation Note

Phase 17 introduces a "customer" DID in the Mycelium demo that posts the project task to its own repo (separate from the Mayor's repo). The Wanted Board's task discovery loop is updated to index tasks from ANY repo (not just `mayorRepos.keys()`). The Mayor detects that it didn't post this task and acts as pure coordinator. After completion, the customer uses `task.review` to stamp acceptance.

This validates the AppView pattern concretely in the demo.
