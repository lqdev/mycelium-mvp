---
title: "Mayor as First-Class AT Proto Participant"
description: "Orchestrators must be registered with the PDS bridge and included in the local DID filter set — omitting them silently excludes their records from Jetstream federation"
entry_type: pattern
published_date: "2025-07-24 00:00 UTC"
last_updated_date: "2025-07-24 00:00 UTC"
tags: "atproto, jetstream, federation, orchestrator, pds, typescript"
source_project: "mycelium-mvp"
---

## Discovery

Phase 14a debugging revealed that Mayor records (task postings, assignments, reputation stamps) never appeared in the PDS or on Jetstream — even though agents' records flowed correctly. Cross-node task discovery was therefore impossible: peer nodes subscribed to Jetstream saw agent activity but zero orchestrator decisions.

## Root Cause

Two omissions in the PDS bridge wiring:

1. **Mayor DID not registered in `_handleByDid`**: The bridge's `mirrorRecord()` routes writes via a `Map<string, string>` keyed by agent DID. Only registered DIDs trigger PDS mirroring. Because `registerAgentMapping(mayor.did, mayor.handle)` was never called, every Mayor write silently dropped.

2. **Mayor not included in `initPdsBridge()` call**: The bridge creates PDS accounts for each handle passed at init time. Without the Mayor's handle, no PDS account was ever created for the orchestrator.

3. **Echo loop risk from missing `localPlcDids` entry**: When Jetstream relays events back to the originating node, `handleFirehoseEvent` needs to filter out locally-originated records to avoid re-processing them as new tasks. The `localPlcDids` Set prevents this — but only if it includes *all* local writers, including the Mayor.

## Solution

**Register Mayor like any agent before `initPdsBridge()`:**
```typescript
registerAgentMapping(mayor.identity.did, mayor.identity.handle);
```

**Include Mayor handles in the `initPdsBridge()` call:**
```typescript
const localPlcDids = new Set<string>();
await initPdsBridge(
  [...agentHandles, mayor.identity.handle, mayorBeta.identity.handle],
  localPlcDids,  // mutable set — bridge adds plcDids as sessions are established
);
```

**Apply plcDids back to Mayor identities after init:**
```typescript
for (const [handle, plcDid] of plcDidMap) {
  if (handle === mayor.identity.handle) mayor.identity.plcDid = plcDid;
}
```

**Pass `localPlcDids` as a mutable Set (not a snapshot)**: The bridge establishes PDS sessions lazily on first write. If you snapshot the Set at init time, sessions established after `initPdsBridge()` returns (e.g., on the Mayor's first `putRecord`) are missing from the filter — causing Jetstream to echo Mayor records back as phantom tasks.

## Prevention

Any entity that writes AT Proto records must be registered with the PDS bridge:
- Call `registerAgentMapping(did, handle)` for every record-writing DID
- Include every writer's handle in the `initPdsBridge()` handles array
- `localPlcDids` must be the same mutable `Set<string>` reference passed into `initPdsBridge()` — never a copy

A missing registration produces no error: records appear to write successfully (in-memory and DuckDB both work), but PDS mirroring silently no-ops for that DID. The symptom appears only when querying the PDS or inspecting Jetstream output.

## Test Pattern

Test the `localPlcDids` Set both at init time and lazily:

```typescript
it('localPlcDids is populated for each handle at init', async () => {
  const plcDids = new Set<string>();
  await initPdsBridge(['alice.test'], plcDids);
  expect(plcDids.size).toBe(1);
});

it('localPlcDids is updated when session is lazily established via mirrorRecord', async () => {
  const plcDids = new Set<string>();
  await initPdsBridge(['bob.test'], plcDids);
  plcDids.clear();  // simulate missing init-time population
  await mirrorRecord('bob.test', 'collection', 'rkey', {});
  expect(plcDids.size).toBe(1);  // lazy session added it back
});
```
