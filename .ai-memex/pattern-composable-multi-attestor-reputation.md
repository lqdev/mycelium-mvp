# Pattern: Composable Multi-Attestor Reputation

**Type:** pattern  
**Project:** mycelium-mvp  
**Phase:** 17 (Composable Trust & Open Task Authorship)  
**Date:** 2026-04-25

---

## Problem

A single-authority reputation system (Mayor stamps only) concentrates trust. One entity decides who's good. This is centralised, gameable, and misses first-party signal from the people who actually commissioned the work.

---

## Solution

Stamp records carry an optional `attestorType` field. Different attestor roles carry different weights during aggregation:

```
mayor     → 40%  (objective quality gate, always present)
requester → 35%  (first-party satisfaction, high signal)
peer      → 20%  (expert review, opt-in)
verifier  → 5%   (credential verification, rare)
```

**Key invariants:**
- `attestorType` is optional — absent stamps are treated as `'mayor'` for backward compatibility
- `totalTasks` counts unique `taskUri`s, not stamp count, to prevent score inflation when one task gets multiple stamps
- `breakdownByAttestor` is returned alongside the weighted `overallScore` so consumers can see source of trust

---

## Implementation (Mycelium)

```typescript
// constants.ts
export const REPUTATION_ATTESTOR_WEIGHTS = {
  mayor:     0.40,
  requester: 0.35,
  peer:      0.20,
  verifier:  0.05,
} as const;

// reputation/index.ts — weighted aggregation
function aggregateReputation(stamps: ReputationStamp[]): AggregatedReputation {
  const byAttestor = groupBy(stamps, (s) => s.attestorType ?? 'mayor');
  
  // Unique taskUris for totalTasks (not stamp count)
  const uniqueTasks = new Set(stamps.map((s) => s.taskUri));
  
  // Weight each attestor group's average score
  let weightedScore = 0;
  let totalWeight = 0;
  for (const [type, group] of Object.entries(byAttestor)) {
    const w = WEIGHTS[type] ?? 0.05;
    const avg = mean(group.map((s) => s.overallScore));
    weightedScore += avg * w;
    totalWeight += w;
  }
  
  return {
    overallScore: weightedScore / totalWeight,
    totalTasks: uniqueTasks.size,
    breakdownByAttestor: ...,
  };
}
```

**Requester flow (task.review → requester stamp):**
1. Customer posts `task.review` to their OWN AT Protocol repo
2. Mayor detects via firehose subscription
3. Mayor verifies reviewer DID matches the original `requesterDid` from the `task.posting`
4. Mayor issues `reputation.stamp` with `attestorType: 'requester'` for the completing agent

---

## Why This Works

- **Open participation** — Any DID can post a `task.posting`. The requester identity is self-sovereign.
- **No record type proliferation** — One `reputation.stamp` type covers all attestors. The `attestorType` field routes weights.
- **Backward compatible** — Existing stamps with no `attestorType` don't break; they aggregate as `mayor`-weight. Score is algebraically identical to old system when only mayor stamps exist.
- **Verifiable** — Any observer can re-run `aggregateReputation()` on the public stamp records and independently verify the score.

---

## Tradeoffs

- Requester weight (35%) is high for unverified sentiment — a malicious requester could tank a good agent. Mitigation: the Mayor verifies the reviewer DID before issuing the stamp.
- Peer and verifier roles exist in the schema but have no automated issuance path yet (manual/future).
- Weights are hardcoded constants. A future upgrade could make them configurable per network/mayor.

---

## References

- `src/constants.ts` — `REPUTATION_ATTESTOR_WEIGHTS`
- `src/reputation/index.ts` — `aggregateReputation()`, `createStamp()`
- `src/orchestrator/mayor.ts` — firehose handler for `task.review`
- `src/orchestrator/wanted-board.ts` — `writeReview()`
- `src/schemas/types.ts` — `TaskReview`, `ReputationStamp.attestorType`
- `docs/ADR/ADR-005-composable-trust.md` — architectural rationale
