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
revision as `repoRev`. That revision is not a global stream cursor, and a
normal snapshot has no `streamSeq` field.

`AtprotoSubscribeReposSource` implements the official
`com.atproto.sync.subscribeRepos` WebSocket protocol. Frames use concatenated
CBOR header/payload objects; commit blocks are CAR bytes and operations carry
record CIDs and paths. `ProtocolIngestor` persists the numeric global `seq`,
buffers frames while getRepo loads, replays in stream order, and reports
identity/account/handle/info/unknown frames as diagnostics. A sequence gap or
`tooBig` commit triggers snapshot recovery and is not considered recovered
unless an injected `AuthoritativeRecoveryProvider` returns a snapshot plus a
verifiable boundary. The boundary carries the snapshot DID, its `repoRev`, the
global `streamSeq`, and a provider proof; the provider verifier must establish
that the proof covers the exact snapshot and stream position. Malformed,
unverified, or regressing boundaries are rejected before AppView replacement
or durable cursor advancement. Replay skips only equal-or-older `tooBig`
markers already covered by the boundary, preserves ordinary events at or after
the boundary, and fails closed when repeated recovery does not advance it.
The normal getRepo snapshot path never fabricates a global boundary, and
`lastObservedStreamSeq` is never used as one. Without the provider, recovery
fails explicitly. Jetstream remains an optional legacy/federation adapter.

There is no upstream AT Protocol endpoint assumed here that atomically pairs
`getRepo` with a global `subscribeRepos` sequence. Production deployment
therefore requires an external relay/PDS companion or equivalent checkpoint
service with an auditable consistency proof, wired through
`AuthoritativeRecoveryProvider`. Until that prerequisite exists, this MVP
supports initial getRepo loading and live subscription only; it must stop
instead of attempting unsafe gap recovery.

Repository commit authenticity is a mandatory boundary before either snapshot
or live data can reach the AppView. `AtprotoRepositoryCommitVerifier` uses the
official `@atproto/repo` and `@atproto/crypto` primitives rather than
reimplementing DAG-CBOR signing:

- snapshot CARs use `verifyRepo` with the expected repository DID and an
  authorized signing key, validating the signed root and complete MST;
- subscribeRepos CAR slices verify the CAR root/commit CID, repository DID,
  commit revision, signature, and each operation's post-commit MST path/CID
  claim. They do not claim full diff/ancestry verification because a live CAR
  may be only a proof slice and this AppView does not yet retain a prior
  `ReadableRepo` for every stream.

The verifier receives a typed, injected `DidDocumentResolver` and
`RepositoryVerificationKeyResolver`. The default key resolver accepts only an
explicitly authorized `#atproto` `Multikey` whose document id and controller
match a `did:plc` or `did:web` repository DID. It converts the Multikey through
the installed AT Protocol crypto package; it never derives or trusts a
`did:key` fallback for a PLC/web repository. Deployments must provide the DID
resolution service, cache/freshness policy, and any key-rotation overlap policy.
Tests must inject deterministic resolvers/verifiers; network resolution is not
part of the ingestion code.

Both ingestion adapters require a commit verifier. Authentication failure,
malformed CAR/commit, and unsupported key material are fail-closed before the
AppView callback, preserving projection state and the durable cursor. Record
lexicon validation remains a separate concern and is not treated as commit
authenticity.

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
