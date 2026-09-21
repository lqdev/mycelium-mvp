# ADR-007: Immutable facts and competing governance

**Status:** Accepted  
**Date:** 2026-09-21

## Context

The Mayor/worker hierarchy was an implementation convenience, not a protocol
requirement. A fixed coordinator signing another participant's reputation or
award creates a single point of authority and makes independent coordination
hard to verify.

## Decision

Protocol 0.1 is a create-only fact graph. Roles publish separate records:

- requesters publish offers, direct awards, acceptances, cancellations, and
  delegations;
- workers publish competing claims, completions, and artifact manifests;
- coordinators publish recommendations and delegated awards;
- verifiers publish independent verification results;
- attestors publish their own trust attestations and revocations.

Corrections and revocations are new records with strong references. An
AppView derives task state and reputation explanations from those facts; a
numeric reputation score is never protocol truth.

The protocol supports several governance modes:

1. `requester-selected`: the requester chooses a claim and authors the award.
2. `delegated-coordinator`: the requester publishes an unexpired delegation;
   the coordinator authors the award and references that delegation.
3. `committee`: a future quorum reducer can require multiple independent
   recommendations or approvals.
4. `deterministic-bounty`: a published policy can select a winner from claims.
5. `self-service`: completion and verification can stand without an award.

Recommendations are advisory. An award is authoritative only when authored by
the requester or by a coordinator covered by an active requester delegation.

## Consequences

- Competing claims are first-class and do not mutate a shared task row.
- A coordinator can be replaced without rewriting requester or worker history.
- Revocation is observable and rebuildable.
- Governance policies can evolve in AppViews without changing the authored facts.
- The old Mayor remains useful as an optional adapter, but it cannot define
  Protocol 0.1 provenance.
