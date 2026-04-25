# ADR-005: Composable Trust — Multi-Attestor Reputation & Open Task Authorship

**Status:** Draft (Phase 17 design intent — awaiting implementation)
**Date:** 2026-04-24
**Authors:** Mycelium MVP team
**Supersedes:** N/A
**Related:** ADR-003 (Intelligence Attribution), ADR-004 (Knowledge & Tool Providers)

---

## Context

As of Phase 16, reputation stamps in Mycelium have a single attestor: the Mayor (orchestrator). The Mayor evaluates each task completion and writes a `reputation.stamp` to its own PDS repo. This creates two problems:

### Problem 1: Conflict of Interest

The Mayor assigns tasks AND evaluates them. It has full context on the process (did the agent meet the protocol requirements?) but limited context on the outcome (did the deliverable actually meet the customer's need?). These are different questions requiring different witnesses.

### Problem 2: Closed Task Authorship

The Mayor currently posts `task.posting` records to its OWN repo. This means the Mayor is both requester and orchestrator — which is fine for a demo, but wrong for a protocol. In AT Protocol's model, any entity with a DID can publish records to their own PDS. The Wanted Board should be an AppView-style indexer that discovers tasks from ANY DID's repo, not just the Mayor's.

This couples "who wants work done" with "who coordinates work" — a separation of concerns violation that limits Mycelium's extensibility.

### Why Now

Phase 17 is the natural time to address these because:
1. The full provenance chain (agent + model + knowledge + tools) is established (Phase 16)
2. The federation architecture is proven (Phase 15)
3. The next logical question is: who vouches for the final result?

---

## Decision

### Decision 1: Open Task Authorship (Wanted Board as AppView)

**Any DID can publish `task.posting` to their own PDS.** The Wanted Board acts as an AT Protocol AppView-style indexer — subscribing to Jetstream globally and indexing `task.posting` records from any DID's repo.

The Mayor's role is **coordination only**: it discovers tasks from the Wanted Board index, finds the best agents, and manages the task lifecycle. The Mayor does not need to be the task requester.

**Implementation:**
- Demo introduces a "customer" DID with its own repo that posts the project task
- Wanted Board's `discoverTasks()` searches all repos visible via firehose, not just `mayorRepos`
- No new record type required — `task.posting` already has `requesterDid` field distinct from where the record is stored

**What this unlocks:**
- External requesters can participate in the network
- Multiple orchestrators can compete to fulfill the same task
- Requester identity is verifiable (signed record in their own repo)

### Decision 2: task.review Record

A new record type `network.mycelium.task.review` allows the task requester to formally signal acceptance or rejection after seeing the completion.

```
task.posting (requester's repo)
  → task.completion (agent's repo)  
  → task.review (requester's repo)   ← NEW
  → reputation.stamp[mayor] (mayor's repo)
  → reputation.stamp[requester] (mayor's repo, encoding review outcome)
```

The `task.review` record lives in the **requester's repo** (they own it, they sign it). The reputation system translates the review into a `reputation.stamp` with `attestorType: 'requester'`.

### Decision 3: attestorType on reputation.stamp

Add `attestorType: "mayor" | "requester" | "peer" | "verifier"` to `reputation.stamp`.

**Why not separate schema per attestor type?**
- All stamps answer the same structural question: "how did agent X perform on task Y?"
- The difference is WHO is answering and from WHAT perspective
- `attestorType` as a field preserves backward compatibility (existing stamps default to `'mayor'`)
- Aggregation is simpler with a single stamp type

### Decision 4: Weighted Multi-Attestor Aggregation

```typescript
REPUTATION_ATTESTOR_WEIGHTS = {
  mayor:     0.40,   // Protocol gate — did it complete per spec? (authoritative on process)
  requester: 0.35,   // Satisfaction signal — did it meet my actual need? (most valuable economically)
  peer:      0.20,   // Domain review — is the work technically sound? (expert signal)
  verifier:  0.05,   // Automated baseline — did it pass the checks? (table stakes)
}
```

**Weight rationale:**
- **Mayor (0.40)**: The orchestrator has full context on the protocol execution. It's the authoritative signal for "did the process complete correctly?" Higher than peer because Mayor sees every task; peer reviews are selective.
- **Requester (0.35)**: The satisfaction signal is economically the most important — if customers keep rejecting an agent's work, that agent has a real problem. Slightly lower than Mayor because requesters may have incomplete technical context.
- **Peer (0.20)**: Domain expert review is high-signal when present but sparse. An agent that consistently gets strong peer reviews is genuinely expert. Lower weight because peer reviews are optional and coverage is uneven.
- **Verifier (0.05)**: Automated checks catch baseline failures but don't measure quality. High coverage, low signal-to-noise.

**Backward compatibility:** Existing stamps without `attestorType` default to `'mayor'` during aggregation. Aggregation with only Mayor stamps produces identical results to pre-Phase-17 behavior (mayor weight normalized to 1.0 when only mayor stamps exist).

---

## Consequences

### Positive

1. **Separation of concerns**: Task authorship, orchestration, execution, and attestation are now distinct roles.

2. **Richer reputation signals**: Agents that consistently get both Mayor approval AND requester satisfaction build stronger reputations. Agents that game Mayor metrics but fail requesters are exposed.

3. **Open participation**: Any entity can post tasks. The protocol handles discovery. This enables the "estate plan" scenario — a customer posts a complex task, specialists from across the network fulfill it.

4. **Aligned incentives**: Agents are incentivized to actually satisfy requesters, not just meet the Mayor's checklist. The requester weight (0.35) is large enough that ignoring it has real reputation consequences.

5. **Graceful evolution**: Adding `attestorType` to stamps doesn't break existing aggregation. Phase 18 can add peer review coordination without schema changes.

### Negative / Trade-offs

1. **Requester review latency**: The task lifecycle now has an additional step (awaiting `task.review`). The system needs a timeout/expiry mechanism for reviews that never arrive. *Mitigation: default behavior if no review within N minutes is to proceed with Mayor-only stamp.*

2. **Review quality variance**: Requester satisfaction scores may be inconsistent or biased. A difficult customer might score everything 40/100. *Mitigation: requester reputation will eventually be trackable — requesters who consistently score unreasonably may be discounted.*

3. **Weight calibration risk**: The 0.40/0.35/0.20/0.05 weights are informed guesses. Production data may reveal these need adjustment. *Mitigation: weights are in `src/constants.ts` — easy to tune. ADR update when we have evidence.*

4. **Demo complexity**: Introducing a customer DID adds a third persona to the demo (Mayor, Customer, Agents). Narration must explain this clearly. *Mitigation: the AppView pattern is a story worth telling — "look, a customer just posted a task and Mayors competed to fulfill it."*

---

## Alternatives Considered

### Alt A: Add requesterDid stamp without schema change
Keep a single stamp type but add `requesterScore` as an optional field on the existing stamp. Mayor writes one stamp encoding both its own opinion and the requester's.

*Rejected*: Conflates two different signals into one record. Makes it impossible for the requester to write their own attestation. Requester perspective gets diluted by Mayor processing.

### Alt B: Requester writes stamp directly (no Mayor involvement)
Requester writes `reputation.stamp` directly with their own DID as attestor. No translation step.

*Rejected*: The stamp's authority comes from the signing key. If the requester is unknown/unvetted, their direct stamp carries little weight. The Mayor as "stamp issuer of record" provides a consistent trust root. Also: requester signing infrastructure (PDS, keys) may not exist for all requesters.

### Alt C: Separate schema for each attestor type
`reputation.mayor-stamp`, `reputation.requester-stamp`, `reputation.peer-stamp`, etc.

*Rejected*: Schema explosion without benefit. The aggregation logic needs to union these anyway. A single stamp type with `attestorType` achieves the same goal with less schema surface area.

---

## Phase 18 Backlog (Out of Scope for Phase 17)

- **Peer review coordination**: How does the Mayor select peer reviewers? Random sampling from agents with matching capabilities? Opt-in review pools? This needs its own ADR.
- **Verifier service registry**: `network.mycelium.verifier.service` record — a discoverable service that can automatically evaluate completions (code analysis, security scan, format validation).
- **Requester reputation**: Track requester behavior over time. Requesters who score unreasonably low consistently, or who never post reviews, get a "requester reliability" score that discounts their stamps.
- **`credential.grant`**: Verified expertise credentials issued by attestors to agents ("this agent is certified by X for legal analysis"). Referenced in `agentProfile.intelligenceRefs` or new `credentialRefs` field.
- **Multi-Mayor coordination**: Two orchestrators fulfilling complementary subtasks of the same customer request. `task.posting` decomposition across Mayor domains.
