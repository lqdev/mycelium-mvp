// AT Protocol PDS Bridge — env-gated, fire-and-forget write-through.
//
// When PDS_ENDPOINT is set (e.g. "http://localhost:2583"), every record write
// in the simulation is mirrored to a real AT Protocol PDS via XRPC.
//
// Design:
//  - Uses native fetch (no @atproto/api dependency)
//  - Never blocks the simulation — all HTTP calls are async and failures are logged
//  - Creates a PDS account per agent on first run; re-authenticates on restart
//  - Agent passwords are derived deterministically from the admin password + handle

import { createHash } from 'node:crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PdsSession {
  handle: string;       // internal handle (e.g. "atlas.mycelium.local")
  pdsHandle: string;    // PDS-registered handle (e.g. "atlas.localhost")
  pdsDid: string;       // did:plc assigned by the PDS
  accessJwt: string;
  refreshJwt: string;
}

// ─── Module state ─────────────────────────────────────────────────────────────

let _endpoint: string | null = null;
let _adminPassword: string | null = null;
// .localhost is blocked by @atproto/syntax handle validation — use .test instead
let _pdsHostname: string = 'test';

const _sessions = new Map<string, PdsSession>(); // internal handle → session

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns true when the bridge is configured and ready. */
export function isPdsBridgeEnabled(): boolean {
  return _endpoint !== null;
}

/**
 * Initialise the bridge and create/restore PDS accounts for all agents.
 * Call once at server startup if PDS_ENDPOINT is set.
 * Safe to call multiple times (idempotent).
 * Returns a map of internal handle → did:plc for the caller to persist.
 */
export async function initPdsBridge(
  agents: Array<{ handle: string }>,
  endpoint: string,
  adminPassword: string,
  pdsHostname = 'test',
): Promise<Map<string, string>> {
  _endpoint = endpoint.replace(/\/$/, '');
  _adminPassword = adminPassword;
  _pdsHostname = pdsHostname;

  const plcDids = new Map<string, string>();
  let successCount = 0;
  for (const agent of agents) {
    const session = await ensureSession(agent.handle);
    if (session) {
      plcDids.set(agent.handle, session.pdsDid);
      successCount++;
    }
  }
  console.log(`[pds-bridge] Connected to ${_endpoint} — ${successCount}/${agents.length} agent sessions ready`);
  return plcDids;
}

/** Reset bridge state (for tests or clean shutdown). */
export function shutdownPdsBridge(): void {
  _endpoint = null;
  _adminPassword = null;
  _sessions.clear();
}

/**
 * Mirror a record write to the PDS (fire-and-forget).
 * No-op if the bridge is not configured.
 */
export function mirrorRecord(
  internalHandle: string,
  collection: string,
  rkey: string,
  record: unknown,
): void {
  if (!_endpoint) return;
  void (async () => {
    try {
      const session = await ensureSession(internalHandle);
      if (!session) return;

      const res = await xrpcPost(
        '/xrpc/com.atproto.repo.putRecord',
        {
          repo: session.pdsDid,
          collection,
          rkey,
          record,
        },
        session.accessJwt,
      );

      if (res.status === 401) {
        // Access token expired — refresh and retry once
        const refreshed = await tryRefresh(session);
        if (!refreshed) return;
        await xrpcPost(
          '/xrpc/com.atproto.repo.putRecord',
          { repo: refreshed.pdsDid, collection, rkey, record },
          refreshed.accessJwt,
        );
      } else if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[pds-bridge] putRecord ${collection}/${rkey} failed (${res.status}): ${body}`);
      }
    } catch (err) {
      console.error('[pds-bridge] mirrorRecord error:', err);
    }
  })();
}

/**
 * Mirror a record deletion to the PDS (fire-and-forget).
 * No-op if the bridge is not configured.
 */
export function mirrorDelete(
  internalHandle: string,
  collection: string,
  rkey: string,
): void {
  if (!_endpoint) return;
  void (async () => {
    try {
      const session = await ensureSession(internalHandle);
      if (!session) return;

      const res = await xrpcPost(
        '/xrpc/com.atproto.repo.deleteRecord',
        { repo: session.pdsDid, collection, rkey },
        session.accessJwt,
      );

      if (res.status === 401) {
        const refreshed = await tryRefresh(session);
        if (!refreshed) return;
        await xrpcPost(
          '/xrpc/com.atproto.repo.deleteRecord',
          { repo: refreshed.pdsDid, collection, rkey },
          refreshed.accessJwt,
        );
      } else if (!res.ok && res.status !== 404) {
        const body = await res.text().catch(() => '');
        console.error(`[pds-bridge] deleteRecord ${collection}/${rkey} failed (${res.status}): ${body}`);
      }
    } catch (err) {
      console.error('[pds-bridge] mirrorDelete error:', err);
    }
  })();
}

// ─── Session management ───────────────────────────────────────────────────────

/** Ensure a valid session exists for the given internal handle. */
async function ensureSession(handle: string): Promise<PdsSession | null> {
  const existing = _sessions.get(handle);
  if (existing) return existing;

  const pdsHandle = toPdsHandle(handle);
  const password = derivePassword(handle);

  // Try login first (handles restarts where account already exists)
  try {
    const data = await xrpcPostJson('/xrpc/com.atproto.server.createSession', {
      identifier: pdsHandle,
      password,
    });
    const session: PdsSession = {
      handle,
      pdsHandle,
      pdsDid: data.did as string,
      accessJwt: data.accessJwt as string,
      refreshJwt: data.refreshJwt as string,
    };
    _sessions.set(handle, session);
    return session;
  } catch {
    // Account doesn't exist yet — create it
    try {
      const data = await xrpcPostJson('/xrpc/com.atproto.server.createAccount', {
        handle: pdsHandle,
        password,
        email: `${pdsHandle}@mycelium.local`,
      });
      const session: PdsSession = {
        handle,
        pdsHandle,
        pdsDid: data.did as string,
        accessJwt: data.accessJwt as string,
        refreshJwt: data.refreshJwt as string,
      };
      _sessions.set(handle, session);
      return session;
    } catch (err) {
      console.error(`[pds-bridge] Cannot create/restore session for ${handle} (pds handle: ${pdsHandle}):`, err);
      return null;
    }
  }
}

/** Try to refresh an expired access token. Updates the session map on success. */
async function tryRefresh(session: PdsSession): Promise<PdsSession | null> {
  try {
    const data = await fetch(`${_endpoint}/xrpc/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.refreshJwt}`,
        'Content-Type': 'application/json',
      },
    });
    if (!data.ok) throw new Error(`refresh failed: ${data.status}`);
    const json = await data.json() as Record<string, unknown>;
    const updated: PdsSession = {
      ...session,
      accessJwt: json.accessJwt as string,
      refreshJwt: json.refreshJwt as string,
    };
    _sessions.set(session.handle, updated);
    return updated;
  } catch {
    // Refresh failed — re-authenticate from scratch
    _sessions.delete(session.handle);
    return ensureSession(session.handle);
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Convert internal handle (atlas.mycelium.local) to PDS handle (atlas.test).
 * NOTE: .localhost is blocked by @atproto/syntax — use .test (allowed per spec). */
function toPdsHandle(handle: string): string {
  const shortName = handle.split('.')[0];
  return `${shortName}.${_pdsHostname}`;
}

/** Derive a stable per-agent password from the admin password + handle. */
function derivePassword(handle: string): string {
  return createHash('sha256')
    .update(`${_adminPassword}:${handle}`)
    .digest('hex')
    .slice(0, 32);
}

/** POST an XRPC method with a JSON body and optional Bearer token. Returns the raw Response. */
async function xrpcPost(
  path: string,
  body: unknown,
  accessJwt?: string,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessJwt) headers.Authorization = `Bearer ${accessJwt}`;
  return fetch(`${_endpoint}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** POST an XRPC method and return the parsed JSON, throwing on non-2xx. */
async function xrpcPostJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await xrpcPost(path, body);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`XRPC ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}
