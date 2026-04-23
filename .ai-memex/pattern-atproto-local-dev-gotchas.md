---
title: "Pattern: AT Protocol Local Development Gotchas"
description: "Critical non-obvious failures when running a local AT Protocol PDS stack: TLD restrictions, HTTPS bypass, DID architecture split, session flow order, and Docker platform pitfalls."
entry_type: pattern
published_date: "2026-04-23 15:19 -05:00"
last_updated_date: "2026-04-23 15:19 -05:00"
tags: "typescript, docker, api, architecture, patterns"
related_skill: ""
source_project: "mycelium-mvp"
---

## Discovery

While building Phase 12 of Mycelium MVP — integrating a local AT Protocol PDS for agent identity
registration and record mirroring — we hit six distinct non-obvious failures. Each one produced a
cryptic error (or silent failure) with no clear pointer in the AT Proto docs. They're all fixable
with one-liner changes once you know the root cause.

---

## Root Cause

### 1. `.localhost` TLD is blocked by `@atproto/syntax`

`@atproto/syntax` has a hard-coded `DISALLOWED_TLDS` array:

```typescript
// node_modules/@atproto/syntax/src/handle.ts
const DISALLOWED_TLDS = [
  '.local', '.arpa', '.invalid', '.localhost',
  '.internal', '.example', '.alt', '.onion',
];
```

Handle validation runs inside `createAccount`. If the handle ends with `.localhost`,
`createAccount` returns `InvalidHandle` (400). In a create-first session flow this error is often
swallowed, leaving you with no session and no explanation.

### 2. PDS 0.4.x+ requires HTTPS — crashes on startup without `PDS_DEV_MODE`

The PDS OAuth subsystem validates that the resource URL uses HTTPS. Without dev mode the PDS exits
immediately with:

```
Error: Resource URL must use the https scheme
    at Object.createRouter (…/pds/src/auth-routes.ts:29)
```

### 3. DuckDB x64 binary segfaults on Apple Silicon via Docker QEMU

`platform: linux/amd64` in docker-compose forces QEMU emulation on Apple Silicon. DuckDB ships
native `linux-aarch64` binaries. The x64 binary crashes under QEMU with `SIGSEGV` (exit code 139).

### 4. `did:key` embeds the public key; `did:plc` doesn't — they can't be swapped

`verifySignature()` calls `extractPublicKey(did)`, which parses a multicodec-encoded Ed25519 public
key directly out of the DID string (the base58btc multibase suffix). `did:plc` strings contain no
key material. Naively replacing `did:key` with `did:plc` everywhere silently breaks all signature
verification.

### 5. Create-first session flow silently masks `InvalidHandle`

A "create account on startup, login on restart" flow hides `InvalidHandle` errors: if account
creation fails (e.g., bad TLD), the agent has no session. On restart the code tries to create
again, gets `AccountAlreadyExists` — which then hides the real problem entirely. Login-first makes
the actual error surface.

### 6. Deterministic DIDs cause duplicate primary key violations on restart

When agents reload a persisted `did:key` from the database, their in-memory commit sequence resets
to `seq=0`. The next run writes `(repo_did, 0)`, `(repo_did, 1)`, … — colliding with the previous
run's rows. `INSERT INTO commits` throws a unique constraint violation.

---

## Solution

### TLD: use `.test` (explicitly allowed per AT Proto spec for local/dev)

```typescript
// ❌ atlas.localhost — blocked by DISALLOWED_TLDS
// ✅ atlas.test      — allowed per AT Proto spec for development
const pdsHandle = `${shortName}.test`;
```

### PDS dev mode: single env var disables HTTPS requirement

```yaml
# docker-compose.yml
environment:
  - PDS_DEV_MODE=true
```

### Docker: remove platform pin — let the image build native

```yaml
# ❌ forces QEMU on Apple Silicon → DuckDB segfault
# platform: linux/amd64

# ✅ no pin — Docker resolves native arch automatically
services:
  mycelium:
    build: .
```

### DID architecture: keep `did:key` for signing; add `plcDid` for routing

```typescript
interface AgentIdentity {
  did: string;        // did:key:z6Mk… — signing identity; never replace this
  plcDid?: string;    // did:plc:abc… — PDS-assigned; used for XRPC repo + Jetstream
  handle: string;
  // …
}
```

Store both in DuckDB; the bridge and Jetstream consumer use `plcDid`; everything
involving `signContent()` / `verifySignature()` uses `did`.

### Session flow: login-first, create-account as fallback

```typescript
async function ensureSession(handle: string): Promise<PdsSession | null> {
  // Try login first — succeeds on restart (account already exists)
  try {
    const data = await xrpcPostJson('/xrpc/com.atproto.server.createSession', {
      identifier: toPdsHandle(handle),
      password: derivePassword(handle),
    });
    return buildSession(handle, data);
  } catch {
    // 401 → account doesn't exist yet; create it
    try {
      const data = await xrpcPostJson('/xrpc/com.atproto.server.createAccount', {
        handle: toPdsHandle(handle),
        password: derivePassword(handle),
        email: `${handle}@mycelium.local`,
      });
      return buildSession(handle, data);
    } catch (err) {
      console.error(`[pds-bridge] Cannot create/restore session for ${handle}:`, err);
      return null;
    }
  }
}
```

### Commits table: upsert instead of insert

```sql
-- ❌ Crashes on restart when (repo_did, seq) already exists
INSERT INTO commits (repo_did, seq, …) VALUES (…);

-- ✅ Silently replaces stale row from previous run
INSERT OR REPLACE INTO commits (repo_did, seq, …) VALUES (…);
```

---

## Bonus: Jetstream federation loop prevention

When subscribing to a Jetstream relay that forwards your own PDS events, every local write creates
a loop: write → PDS emits → Jetstream delivers → re-publish to local firehose → write again.

Fix: collect all local agent `plcDid` values at startup and skip them in the message handler.

```typescript
ws.addEventListener('message', (evt) => {
  const data = JSON.parse(evt.data);
  if (data.kind !== 'commit') return;
  if (!data.commit.collection.startsWith('network.mycelium.')) return;
  if (localPlcDids.has(data.did)) return; // ← loop prevention
  publish(firehose, buildFirehoseEvent(data));
});
```

---

## Prevention

- **Always verify handle TLD** against `DISALLOWED_TLDS` in `@atproto/syntax` before shipping a
  default hostname. `.test` is the documented safe choice for local dev.
- **Set `PDS_DEV_MODE=true` first** when standing up any local PDS — it's a no-op in production
  and prevents the HTTPS crash before you write a single line of integration code.
- **Never pin `platform: linux/amd64`** in docker-compose for services with native multi-arch
  binaries (DuckDB, Rust-based tools). Let Docker resolve the platform automatically.
- **Add `plcDid` as a separate field** — don't replace the signing DID. Design the schema with
  both fields from the start, even if `plcDid` starts as `undefined`.
- **Design commits tables for upserts** whenever agents have stable DIDs that survive restarts. An
  in-memory seq counter always resets; the DB doesn't.
- **Use login-first session flow** for any PDS client that may reconnect. Create-first swallows
  validation errors that surface only on the _first_ call.
