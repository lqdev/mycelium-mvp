---
title: "Research: Multi-Attestor Trust Topologies for Multi-Agent Systems"
description: "Deep investigation into who should validate completed work in distributed agent systems — Mayor, customer, peer, or automated verifier — and how AT Protocol's DID-first design enables composable trust."
entry_type: research
published_date: "2026-04-24 11:30 CDT"
last_updated_date: "2026-04-24 11:30 CDT"
tags: "architecture, patterns, ai-collaboration, typescript, atproto"
related_skill: ""
source_project: "mycelium-mvp"
---

## The Question

In a distributed multi-agent system where an orchestrator (Mayor) assigns tasks to agents and
evaluates completed work, who should be the verifier? Options considered:

1. **The Mayor** (current Mycelium MVP approach) — the orchestrator that defined the task
2. **A trust agency** — an independent third party with domain expertise
3. **The customer** — the human or AI that originally requested the work
4. **Peer agents** — other agents in the network reviewing each other's work
5. **Automated verifiers** — CI/CD bots, test runners, formal checkers

The deeper question: is the system flexible enough to support multiple topologies without
re-architecting?

## Options Considered

### Option A: Mayor-only attestation (current MVP)

The orchestrator that defined the task requirements evaluates all completed work and issues
reputation stamps.

**Pros:**
- Mayor has full task context — defined the requirements and acceptance criteria
- Single attestor keeps the trust model simple and debuggable
- The `attestorDid` field in stamps already supports this composably
- No additional infrastructure needed

**Cons:**
- Conflict of interest: Mayor assigned the work AND evaluates the work
- Mayor may lack domain expertise (a frontend Mayor evaluating security work)
- No customer voice — there is literally no customer in the current model
- The Mayor IS the customer (it hardcodes project templates)

**Verdict: Correct for MVP. Incomplete for production.**

### Option B: Critic + Judge separation

Two distinct roles: a Critic that iterates improvement suggestions, and a Judge that makes
the binary accept/reject decision.

**Pros:** Prevents critic-judge deadlock (critic can't block forever)
**Cons:** Requires two protocol participants per completion; adds latency

**Verdict: Valuable pattern for adversarial or high-stakes evaluations; overkill for MVP.**

### Option C: Credentialed peer review

Agents with demonstrated expertise in a domain (proven by high reputation stamps in that
domain) are granted credentials and assigned to review other agents' work.

**The degrees/certifications analogy:**
- University degree = `credential.grant` from a trusted institution (DID)  
- Professional certification = time-limited credential with renewal
- CPA signs financials, bar-licensed lawyer reviews contracts, certified engineer reviews code
- The weight of a review stamp depends on the reviewer's credential chain depth

**Self-reinforcing trust graph:**
1. Agent does good work → earns reputation stamps from Mayor
2. High reputation in domain X → Mayor issues `credential.grant` for X
3. Credentialed agent reviews other agents' work → issues `task.review` stamps
4. Review stamps carry weight proportional to credential depth
5. Credentialed agents can eventually credential others (with depth limit for dilution)

**Key property: No external "trust agency" required.** Trust propagates from within the
agent network itself, bootstrapped from the Mayor's initial stamps.

**Verdict: The target production model. Recommended for Phase 17.**

### Option D: Customer feedback stamps

The entity that originally requested the work (the submitter's DID) rates whether the
completed work actually solved their problem.

**Why this matters:** Every other evaluation approach answers "was the spec met?" but only
the customer knows "does this actually help me?" These are fundamentally different questions
that require different answerers.

**Example:** A tax attorney asks an agent network to prepare an estate plan. The Mayor can
verify the plan follows the correct template. But only the attorney knows if it correctly
reflects the client's actual situation.

**Verdict: Essential for production. Cannot be replaced by any automated check.**

### Option E: Automated verifier services

Machines that objectively check specific properties: test runners, linters, type checkers,
formal verifiers, performance benchmarks.

**Pros:** Objective, reproducible, fast, no human judgment required
**Cons:** Can't evaluate subjective quality, user experience, or business fit

**Verdict: Valuable as a first-pass filter; not sufficient as the sole attestor.**

## Evaluation Criteria

| Criterion | Mayor | Credentialed Peer | Customer | Automated |
|-----------|-------|------------------|----------|-----------|
| Has spec context | ✅ (defined it) | Partial | ✅ (submitted it) | ❌ |
| Domain expertise | Varies | ✅ (by domain) | Varies | Domain-specific |
| Conflict of interest | ⚠️ Yes | Low | None | None |
| Scalability | ✅ | Depends | ❌ (human bottleneck) | ✅ |
| Detects real value | ❌ | Partial | ✅ | ❌ |

## The Three Verification Dimensions

Every completed task has three distinct questions requiring different answerers:

| Dimension | Question | Best Answered By |
|-----------|----------|-----------------|
| Completion | Was the work done? | Mechanically verifiable |
| Spec compliance | Does it match what was asked? | Mayor (defined the spec) |
| Value delivery | Does this solve my actual problem? | Customer (the requester) |

**The current MVP only covers completion + spec compliance. Value delivery has no answerer.**

## AT Protocol's Enabling Architecture

The critical insight: **because every participant has a DID and can write signed records to
the relay, any verification topology is achievable without changing the core protocol** —
only new schema types and new participants are needed.

AT Protocol's labeler model (for content evaluation) maps directly:
- **Users** (PDSes) produce content → **Agents** produce completed work
- **Labelers** subscribe to firehose, issue signed labels → **Verifiers** subscribe to
  completions, issue signed stamps
- **Users configure trusted labelers** → **Reputation aggregator configures trusted attestors**

Any DID can be a verifier. Trust is configured, not assumed.

### Viable topologies (all achievable with DID-first design)

```
Topology A (current MVP):
  Mayor orchestrates + Mayor stamps

Topology B (Phase 17 — customer voice):
  Customer → Mayor decomposes → Agents complete
  Mayor stamps spec compliance
  Customer stamps satisfaction

Topology C (Phase 17 — credentialed peer):
  Mayor orchestrates → Agents complete
  Mayor stamps + Credentialed peer reviews
  (peer's stamp weighted by credential depth)

Topology D (production — full multi-attestor):
  Customer → Mayor decomposes → Agents complete
  + Intelligence/Knowledge/Tool providers participate
  Mayor stamps (40%) + Customer stamps (30%)
  + Credentialed peer stamps (20%) + Automated verifier stamps (10%)

Topology E (automated CI/CD):
  Mayor orchestrates → Agents submit code
  CI/CD bot stamps "tests pass/fail" → Mayor accepts/rejects
```

Each topology is just a set of DIDs subscribing to different events and issuing different
records. No central authority required.

## Recommendation

### For MVP (current state): Mayor-only ✅

The Mayor stamping is correct. It has the most context, keeps the model simple, and
`attestorDid` is already in the schema for future composability. Don't add complexity here.

### For Phase 17: Multi-attestor with credentialed peers

**New lexicon types needed:**

```typescript
// network.mycelium.task.submission — customer posts project
{ submitterDid, title, description, domains, priority }
// Mayor subscribes, LLM-decomposes into tasks, records submitterDid

// network.mycelium.credential.grant — the "degree" primitive  
{ granteeDid, domain, credentialType, scope, expiresAt?, credentialRef? }
// credentialRef traces the chain back to root of trust

// network.mycelium.task.review — credentialed peer's verdict
{ reviewerDid, completionUri, verdict, credentialRef, qualityDimensions }
// verdict: 'approve' | 'reject' | 'revise' — same state machine as Mayor rejection

// network.mycelium.verifier.service — automated verifier registration
{ verifierDid, evaluationMethod, domains, endpoint? }
// Like app.bsky.labeler.service — any DID can register as discoverable verifier
```

**Reputation composition (Phase 17 target):**
```typescript
reputationScore = (
  mayorStamps.avg                               × 0.40 +  // spec compliance
  customerStamps.avg                            × 0.30 +  // value delivery (ground truth)
  credentialedPeerStamps.avg × credentialDepth  × 0.20 +  // expert peer review
  verifierStamps.avg                            × 0.10    // automated checks
);
// credentialDepth = 1.0 at root, 0.5 for one hop, 0.25 for two hops (trust dilution)
```

## Trade-offs

**Mayor-only (current):**
- ✅ Simple, debuggable, no additional infrastructure  
- ❌ Conflict of interest, no customer voice, single point of attestation

**Multi-attestor (Phase 17):**
- ✅ Balanced evaluation, ground truth from customer, domain expertise from credentialed peers
- ❌ More complex aggregation, credential bootstrapping needed, more participants to coordinate

**Key insight:** The schema is already designed for composability via `attestorDid`. Moving
from single to multi-attestor is additive — no breaking changes to existing stamp records.

## Connection to Platform-Level Research

The credential model (agents as certified reviewers) mirrors:
- **AT Protocol labelers**: any DID can label, users configure trust in specific labelers
- **Professional licensing**: practitioners earn credentials, credential depth implies expertise
- **Peer review journals**: credentialed reviewers evaluate submissions, reputation emerges from repeated review

The self-reinforcing trust graph means no external authority is needed at steady state.
The Mayor bootstraps the system with initial credential grants; after that, trust propagates
within the agent network.

## Related Entries

- `pattern-at-proto-labeler-as-orchestration-service.md` — the Mayor-as-labeler pattern
  that this research extends to verification
- `pattern-did-uri-normalization-atproto-federation.md` — the DID identity layer that makes
  multi-attestor trust possible across node boundaries
