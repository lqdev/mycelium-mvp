# ADR-006: Protocol 0.1 principals and authorship

**Status:** Accepted  
**Date:** 2026-09-21

## Context

The MVP treated every agent, model, tool, and resource as an agent-like identity.
That makes it unclear who can authorize an action and who merely describes an
addressable object. It also allowed a coordinator to publish a reputation record
that looked as if it had been authored by the requester.

## Decision

Protocol 0.1 distinguishes four things:

| Thing | Protocol representation | Authority |
|---|---|---|
| Human, organization, or long-lived agent service | DID-backed principal | May authorize actions by publishing records |
| Model, tool, prompt, policy, document, or artifact | AT URI and optional CID | Addressable resource; not an authorizing principal |
| Ephemeral software process | OAuth/DPoP-bound session and run ID | Acts for its principal for a bounded scope |
| Repository record | AT URI, CID, and repository DID | The repository DID is the cryptographic author |

Protocol records must not duplicate an `authorDid` field as an authority signal.
Where a domain subject is required, such as `requesterDid` or `workerDid`, the
AppView checks that field against the repository DID that authored the record.

Protocol 0.1 uses `me.lqdev.mycelium.*` Lexicons and keeps the existing
`network.mycelium.*`, `did:key`, Mayor, and custom repository behavior behind the
legacy MVP boundary.

## Consequences

- Requester acceptance and trust attestations are authored by the requester or
  attestor, not by a coordinator impersonating either party.
- A model can be referenced in completion evidence without receiving a permanent
  DID.
- OAuth permissions constrain a session, while signed protocol facts express
  task-specific authority.
- PDS migration preserves authorship because records remain in the principal's
  repository.
