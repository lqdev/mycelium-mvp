---
title: "Trust Attestation Topologies in Decentralized AI Coordination"
description: "Who should stamp a completed task — Mayor only, or a composable multi-attestor model? Evaluation of trust topology options for Mycelium's reputation system."
entry_type: research
published_date: "2026-04-24 20:38 CDT"
last_updated_date: "2026-04-24 20:38 CDT"
tags: "architecture, patterns, atproto, ai-collaboration"
source_project: "mycelium-mvp"
---

# Trust Attestation Topologies in Decentralized AI Coordination

## The Question

After Phase 16 wired knowledge + tool attribution into reputation stamps, the next question surfaced: **who should stamp a completed task?** 

Mycelium's current model (Phases 1–16): the Mayor stamps every completion — it's the sole attestor. But is Mayor-only the right model? What alternatives exist, and what do they imply?

## Options Considered

### Option A: Mayor-Only (Current)
**Description:** The orchestrator (Mayor) evaluates completion quality and stamps. Single attestor, deterministic.

**Pros:**
- Simple — one signer, one trust path
- Mayor has full context (task spec, completion record, claimed vs. actual capabilities)
- Already implemented and working

**Cons:**
- Mayor is both task assigner AND quality judge — conflict of interest
- "Did the job meet the customer's need?" is not a question the Mayor can answer (Mayor doesn't know what the customer needed beyond the spec)
- Mayor's reputation is only as trustworthy as the Mayor's own reputation — circular
- Single point of failure for trust

**Score:** 3/5 — Works for MVP, insufficient for production trust

---

### Option B: Customer/Requester Stamp
**Description:** The entity that POSTED the task reviews the completion and stamps acceptance or rejection.

**Pros:**
- Closes the most important gap: "did the deliverable actually meet the need?"
- Separates orchestrator role (Mayor) from satisfaction validation (requester)
- Natural precedent: code review, pull request approval, invoice acceptance
- Works at protocol level — requester writes `task.review` to their own PDS, stamps to theirs

**Cons:**
- Requester might not be qualified to evaluate technical quality (e.g., a non-technical customer evaluating code)
- Requester may be biased (want to avoid paying, or vice versa)
- Requester may not respond (timeout scenario — who unblocks?)

**Score:** 4/5 — Essential for production; biases manageable through weighting

---

### Option C: Peer Agent Review
**Description:** Other agents in the network with overlapping capabilities review the work and co-sign.

**Pros:**
- Domain expertise — a peer code reviewer actually understands the code
- Naturally decentralized — any qualified agent can offer a review stamp
- Creates a secondary market for review work (reviewers earn reputation for good reviews)
- Strong precedent in open-source culture (PR reviews, RFC comments)

**Cons:**
- Who selects reviewers? Random selection could be gamed; Mayor selection re-introduces centralization
- Review coordination is complex — how many reviewers? What's the quorum?
- Reviewer reputation must be trusted too (circular problem, but manageable)
- Adds latency to the task lifecycle

**Score:** 4/5 — High value for quality-sensitive domains; adds complexity

---

### Option D: Dedicated Trust Agency / Verifier Service
**Description:** A third-party service (neither Mayor nor requester nor peer) that co-signs completions. Could be an automated system (code analysis, security scanner) or a human organization.

**Pros:**
- Neutral third party — no conflict of interest
- Automated verifiers (CI checks, security scanners) are consistent and fast
- Could be domain-specific (a "Certified Legal Work" verifier for legal AI agents)
- Mirrors real-world trust infrastructure (notaries, certification bodies, auditors)

**Cons:**
- Who certifies the certifier? Trust must stop somewhere
- Automated verifiers can only check what's checkable automatically (syntax, tests — not semantic quality)
- Human verifier organizations are expensive and slow
- Centralization risk — if THE verifier is compromised, all stamps they touched are suspect

**Score:** 3/5 — High value for specific domains; poor default

---

## Evaluation Criteria

| Criterion | Mayor-Only | Requester | Peer Review | Verifier Service |
|-----------|-----------|-----------|-------------|-----------------|
| Covers "did it meet the need?" | ❌ | ✅ | ⚠️ partial | ❌ |
| Covers "is the work quality high?" | ⚠️ | ❌ | ✅ | ⚠️ |
| Covers "did protocol complete?" | ✅ | ❌ | ❌ | ⚠️ |
| Implementation complexity | Low | Medium | High | High |
| Decentralization | Medium | High | High | Low |
| Latency | Low | Medium | High | Low–Medium |
| Conflict of interest risk | High | Medium | Low | Low |

## Recommendation: Composable Multi-Attestor Model

**No single attestor type is sufficient.** Trust is contextual — different questions need different witnesses:

| Question | Best Attestor |
|----------|--------------|
| Did the protocol complete? | Mayor |
| Did it meet the customer's need? | Requester |
| Is the work technically sound? | Peer |
| Does it pass automated checks? | Verifier Service |

**Implementation approach (Phase 17):**

1. Add `attestorType: 'mayor' | 'requester' | 'peer' | 'verifier'` to `reputation.stamp`
2. Weight aggregation by attestor type:
   - `mayor`: 0.40 — protocol gate, quality bar
   - `requester`: 0.35 — satisfaction signal (most important for economic incentives)
   - `peer`: 0.20 — domain expert validation
   - `verifier`: 0.05 — automated baseline checks
3. New record: `task.review` — requester's formal acceptance/rejection signal
4. Reputation aggregation shows breakdown by attestor type (richer character sheet)

**The "estate plan" scenario:**
> Customer posts "Build me an estate plan." Mayor orchestrates (accountants, lawyers, analysts).
> After delivery:
> - Mayor stamps: "agents performed per protocol, claimed capabilities matched deliverables"
> - Customer stamps: "this actually helped me plan my estate"  ← THE most valuable signal
> - Peer (another lawyer agent) stamps: "the legal advice is sound"
> - Verifier (automated): "all documents are valid format and complete"

## Key Insight: Trust is Contextual, Not Hierarchical

The temptation is to model trust as a hierarchy (Mayor > Requester > Peer). This is wrong. Trust signals answer different questions — they're orthogonal, not ordered. A requester stamp has more weight for "satisfaction" than a Mayor stamp, and a peer stamp has more weight for "technical quality" than a requester stamp.

The composable model lets reputation consumers (future agents deciding who to hire) weight these signals according to what they care about. A safety-critical task might weight verifier stamps highest. A creative task might weight requester and peer stamps highest.

## Related Work

- **W3C Verifiable Credentials** — multi-issuer credential chains; Mycelium's `reputation.stamp` is structurally similar to a VC
- **AT Protocol Labelers** — multiple labelers can label the same content; apps choose which to trust and how much — direct precedent for attestorType weighting
- **GitHub Code Review model** — required reviewers (Mayor equivalent) + optional peer reviews (peer attestor) + CI checks (verifier) — the composable model is already widely understood
- **StackOverflow** — accepted answer (requester stamp) ≠ highest upvoted answer (peer stamp) ≠ moderator-approved answer (verifier stamp)
