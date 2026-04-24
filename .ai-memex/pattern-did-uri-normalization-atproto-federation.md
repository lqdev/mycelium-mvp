---
title: "DID URI Normalization in AT Proto Cross-Node Federation"
description: "Cross-node AT Protocol events carry did:plc URIs while in-memory repos use did:key URIs — normalizing with ownership validation is required for correct federated orchestration"
entry_type: pattern
published_date: "2025-07-24 00:00 UTC"
last_updated_date: "2025-07-24 00:00 UTC"
tags: "atproto, jetstream, federation, did, typescript, orchestration"
source_project: "mycelium-mvp"
---

## Discovery

Phase 14b revealed that cross-node task claims and completions were silently ignored by the Mayor orchestrator. An agent on Node B would claim a task, Node A's Mayor would receive the Jetstream-bridged claim event — and nothing would happen. The task would stay `open` forever.

The root cause: a DID URI identity mismatch. Node A's Mayor stored task URIs as `at://did:key:mayorA/...` (from the in-memory repo), but Node B agents saw the task via Jetstream as `at://did:plc:mayorA/...` (from the PDS). Their claim records naturally referenced the Jetstream-visible URI — which the Mayor didn't recognise.

## Root Cause

AT Protocol gives every participant two identities:
- `did:key` — the cryptographic self-sovereign identity, used for in-memory repos and local firehose events
- `did:plc` — the PDS-assigned identity, used for all XRPC writes and Jetstream events

When the Mayor calls `postTask()`, the result URI is `at://did:key:mayor/...`. When Jetstream relays that record cross-node, the event DID is `did:plc:mayor`. Node B agents write claims with `taskUri: "at://did:plc:mayor/..."`. Mayor A receives the claim, looks for `did:plc:mayor` in its `pendingClaims` map — finds nothing under `did:key:mayor` — and drops it.

**Compound problem:** Even if local agents (using `did:key`) and remote agents (using `did:plc`) claim the same task, they'd be stored under two separate keys in `pendingClaims`. Two independent ranking rounds fire — the first may assign a weaker local candidate before the expert remote claim is processed.

**Dangerous edge case:** Both Mayors use the same deterministic rkey format (`task-001`, `task-002`, etc.). Without ownership validation, Mayor A would process a claim for `at://did:plc:mayorB/.../task-001` as if it were a claim for its *own* `task-001`. `getTask(mayor.repo, uri)` is DID-agnostic (uses only collection + rkey), so the collision is silent.

## Solution

Add a `canonicalOwnTaskUri(mayor, uri): string | null` helper — normalize AND validate ownership in a single step:

```typescript
function canonicalOwnTaskUri(mayor: Mayor, uri: string): string | null {
  // Already local did:key form
  if (uri.startsWith(`at://${mayor.identity.did}/`)) return uri;

  // PDS/Jetstream form of our own task
  const plcDid = mayor.identity.plcDid;
  if (plcDid && uri.startsWith(`at://${plcDid}/`)) {
    return `at://${mayor.identity.did}/${uri.slice(`at://${plcDid}/`.length)}`;
  }

  // Foreign orchestrator's task — must ignore
  return null;
}
```

Apply at every entry point that receives external task URIs:

```typescript
// In handleFirehoseEvent — claim handler
const taskUri = canonicalOwnTaskUri(mayor, claim.taskUri);
if (!taskUri) return;  // foreign Mayor's claim — ignore
pendingClaims.set(taskUri, [...existing, claimWithUri]);
setTimeout(() => processClaimsForTask(mayor, pendingClaims, taskUri), 0);

// In handleCompletion — at the very top
const taskUri = canonicalOwnTaskUri(mayor, completion.taskUri);
if (!taskUri) return;  // foreign Mayor's completion — ignore
// all subsequent logic uses the canonical did:key URI
```

## Why `string | null` Not `string`

A pure normalizer (`normalizeTaskUri(uri): string`) would only translate `did:plc` → `did:key`. It would still pass through foreign URIs unchanged. Because `getTask`/`transitionTask` in `wanted-board.ts` use only `rkey` for lookups, a foreign claim for `at://did:plc:otherMayor/.../task-001` would corrupt this Mayor's `task-001` if rkeys collide (which they do — both Mayors use `task-001`, `task-002`, etc. from the same template).

Returning `null` for foreign URIs forces callers to explicitly discard the event, making the isolation invariant visible in the code.

## Key Insight: `wanted-board.ts` Is DID-Agnostic

```typescript
function parseAtUri(uri: string): { collection: string; rkey: string } {
  const parts = uri.split('/');
  return { collection: parts[3]!, rkey: parts[4]! };
  // parts[2] (the DID) is intentionally ignored
}
```

All wanted-board operations (`getTask`, `assignTask`, `transitionTask`, `completeTask`) use only `collection + rkey` as lookup keys. This means: once normalized to the canonical `did:key` form, all wanted-board calls work correctly without any further changes. The fix is entirely in the Mayor's event handler layer.

## Mixed Claim Pool Consolidation

Because both local (`did:key`) and remote (`did:plc`) claims are now keyed identically after normalization, all claims for the same task land in the same `pendingClaims` slot. When `setTimeout(() => processClaimsForTask(...), 0)` fires, it sees the full combined pool — local and remote candidates ranked together. The expert wins regardless of which node they're on.

## Prevention

In any AT Protocol system where you maintain a local Map keyed by AT URIs:
- Never assume the incoming URI form matches your local store's form
- Normalize on ingestion (not on lookup) so the map always contains one canonical key
- Always validate ownership before normalizing — otherwise DID-agnostic record stores silently corrupt on rkey collision
- Test with both URI forms: write a test where `did:plc` claim arrives for a task stored under `did:key`, and a separate test where a same-rkey URI from a *different* DID is rejected
