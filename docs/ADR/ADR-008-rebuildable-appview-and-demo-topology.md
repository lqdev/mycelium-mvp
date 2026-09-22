# ADR-008: Rebuildable AppView and low-cost live topology

**Status:** Accepted

**Date:** 2026-09-21

## Context

The MVP's in-memory firehose and asynchronous PDS bridge are useful for local
simulation but cannot be the source of truth for a federated protocol. A hosted
demo must survive AppView loss and prove that projections can be reconstructed
from PDS data.

## Decision

PDS repositories are authoritative. The Protocol 0.1 AppView:

1. imports a repository snapshot/CAR;
2. applies historical commit events;
3. drains buffered live `com.atproto.sync.subscribeRepos` events;
4. persists one numeric global firehose cursor per subscription and deduplicates
   events;
5. quarantines invalid protocol records instead of projecting them;
6. computes a deterministic projection hash;
7. exposes derived task state, authority explanations, conflicts, and ingest health.

DuckDB is disposable projection state. Deleting it and replaying the same
snapshot/events must produce the same projection hash.

The snapshot boundary is explicit: `AtprotoRepoSnapshotAdapter` fetches the
official `com.atproto.sync.getRepo` CAR, traverses the repository MST with the
official AT Protocol repository package, and preserves the signed commit
revision as `repoRev`. That revision is not a global stream cursor.

`AtprotoSubscribeReposSource` implements the official
`com.atproto.sync.subscribeRepos` WebSocket protocol. Frames use concatenated
CBOR header/payload objects; commit blocks are CAR bytes and operations carry
record CIDs and paths. `ProtocolIngestor` persists the numeric global `seq`,
buffers frames while getRepo loads, replays in stream order, and reports
identity/account/handle/info/unknown frames as diagnostics. A sequence gap or
`tooBig` commit triggers snapshot recovery and is not considered recovered
unless the replacement snapshot supplies an authoritative `streamSeq`
boundary. The normal getRepo snapshot path never fabricates that boundary;
recovery therefore requires an explicit source provider that returns the
snapshot together with the authoritative global sequence. Jetstream remains an
optional legacy/federation adapter.

Commit signature verification against resolved DID keys is intentionally
deferred to a separate follow-up; this slice does not claim public federation
readiness.

The live demo uses one small Linux VM with Caddy/TLS, the official Bluesky PDS,
a private PLC directory backed by PostgreSQL, and the TypeScript AppView/API.
App and PDS use separate registrable domains. The official PDS and PLC volumes
are persistent; AppView state is rebuildable. Oracle Cloud Always Free is the
preferred host when capacity is available, with a single VPS fallback capped at
USD 10/month. No public relay, crawler, signup, or network-wide AppView is
required for Protocol 0.1.

## Consequences

- Direct PDS subscription is the canonical single-PDS demo path; Jetstream stays
  a legacy/federation adapter.
- Restore drills and projection rebuilds are release gates.
- A hosted AppView outage does not destroy authored task history.
- The demo is isolated from the public Bluesky network until federation hardening
  and moderation policy are separately accepted.
