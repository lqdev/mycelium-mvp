# Pattern: AppView-Style Participant Registry for AT Protocol Dashboards

**Type:** pattern  
**Project:** mycelium-mvp  
**Phase:** 18 (Network Participants & Dashboard Redesign)  
**Date:** 2026-04-25

---

## Problem

A dashboard that only shows one type of network participant (e.g., "AI agents") becomes incomplete as the network grows. When a human user posts a `task.posting` to their own AT Protocol repo, they appear in the firehose as an unresolvable DID — indistinguishable from an unknown entity.

More broadly: AT Protocol has no concept of "participant type". DIDs are DIDs. The question of *who* a DID is — agent, user, orchestrator, tool — is application-level knowledge that needs to be managed.

---

## Solution: Role-Assignment at Bootstrap, Not Record-Derived at Runtime

Inspired by AT Protocol's AppView architecture: the AppView indexes records and assigns semantic meaning. It knows that `did:foo` is "Alice" because it ingested her `app.bsky.actor.profile`.

For a local Mycelium network, we do the same — but simpler: **assign roles at bootstrap** when we know who everyone is, store them in a `participants[]` registry, and use that registry to resolve any DID at display time.

```typescript
interface NetworkParticipant {
  type: 'user' | 'agent' | 'mayor' | 'tool' | 'knowledge';
  did: string;
  handle: string;
  displayName: string;
  // type-specific live data fields added at query time
}
```

**Two helper functions replace scattered `shortDid()` calls:**

```javascript
// Resolve DID → handle for display
function resolveHandle(did) {
  const p = state.participants.find((x) => x.did === did);
  return p ? p.handle : shortDid(did);  // fallback for unknown DIDs
}

// Classify DID → participant type for filtering
function classifyDid(did) {
  const p = state.participants.find((x) => x.did === did);
  return p ? p.type : 'other';
}
```

---

## Key Design Decisions

**Classify by role, not by records published** — An agent publishes `agent.profile`; a knowledge provider publishes `knowledge.provider`. You *could* derive type from record shape. But this is fragile: a DID with no records yet is unclassifiable, and the rules are brittle. Role assignment at registration time is simpler and more reliable.

**Single `/api/participants` endpoint, not per-type endpoints** — The dashboard fetches one list and renders grouped sections. This is easier to cache and less chatty than `/api/agents` + `/api/users` + `/api/mayor`.

**Live data enrichment at query time** — `buildParticipantList()` takes the static registry and enriches each entry with live data (agent reputation from firehose stamps, mayor task counts, user post counts). Static identity → live stats separation makes the pattern clean.

**Display order matters for UX** — Group order: user → mayor → agents → tools → knowledge. This puts humans first (narrative: humans commission work), then the orchestrator, then the workforce, then infrastructure.

---

## Firehose Filter for Human Events

The firehose filter needed a "Users" button, but events don't have a `participantType` field. We stamp each rendered row with a `data-participant-type` dataset attribute derived from `classifyDid(event.did)`:

```javascript
row.dataset.participantType = classifyDid(event.did);

// Filter logic:
if (state.filter === 'user') {
  if (participantType !== 'user') return;  // skip non-user events
}
```

This works because `participants[]` is loaded before the firehose SSE stream starts rendering — the registry is warm by the time events flow.

---

## Tradeoffs

- Registry is in-memory, not persisted. A server restart loses the mapping until `bootstrapDemo()` re-runs. Fine for a demo; production would persist to DuckDB.
- `resolveHandle()` is O(n) scan over participants. Fine for ≤50 participants; would need a Map for scale.
- Unknown DIDs (e.g., from Jetstream federation peers) fall back to `shortDid()`. This is correct — the local AppView doesn't know every DID on the internet.

---

## References

- `src/demo/dashboard/server.ts` — `NetworkParticipant`, `buildParticipantList()`, `/api/participants`, `/api/status`
- `src/demo/dashboard/public/app.js` — `resolveHandle()`, `classifyDid()`, `renderParticipants()`, filter logic
- `src/demo/dashboard/public/index.html` — panel rename, "Users" filter button
- `src/demo/dashboard/public/style.css` — `.participant-card`, `.type-badge`
