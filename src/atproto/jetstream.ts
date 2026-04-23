// AT Protocol Jetstream Federation Consumer — env-gated.
//
// When JETSTREAM_ENDPOINT is set (e.g. "ws://localhost:6008/subscribe"),
// this module subscribes to a Jetstream relay and bridges any incoming
// network.mycelium.* events to the local in-process firehose.
//
// Design goals:
// - Loop prevention: skip events whose DID matches a local agent plcDid
// - Auto-reconnect with exponential backoff (1s → 30s)
// - Fire-and-forget; never blocks the simulation
// - Uses Node 22 native WebSocket (globalThis.WebSocket — no extra dep)

import type { Firehose, FirehoseEvent } from '../schemas/types.js';
import { publish } from '../firehose/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Subset of the Jetstream commit event we care about. */
interface JetstreamEvent {
  kind: string;
  did: string;
  time_us: number;
  commit?: {
    operation: 'create' | 'update' | 'delete';
    collection: string;
    rkey: string;
    record?: unknown;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MYCELIUM_PREFIX = 'network.mycelium.';
const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

// ─── Module state ─────────────────────────────────────────────────────────────

let _endpoint: string | null = null;
let _firehose: Firehose | null = null;
let _localPlcDids: Set<string> = new Set();
let _reconnectMs = MIN_RECONNECT_MS;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _shuttingDown = false;
let _ws: WebSocket | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns true when Jetstream is configured and active. */
export function isJetstreamEnabled(): boolean {
  return _endpoint !== null;
}

/**
 * Subscribe to a Jetstream relay and forward network.mycelium.* events to
 * the local firehose. Call once at startup when JETSTREAM_ENDPOINT is set.
 *
 * @param endpoint   - WebSocket URL (e.g. "ws://localhost:6008/subscribe")
 * @param firehose   - the local in-process firehose to publish into
 * @param localPlcDids - set of did:plc values for local agents (loop prevention)
 */
export function initJetstream(
  endpoint: string,
  firehose: Firehose,
  localPlcDids: Set<string>,
): void {
  _endpoint = endpoint;
  _firehose = firehose;
  _localPlcDids = localPlcDids;
  _shuttingDown = false;
  _reconnectMs = MIN_RECONNECT_MS;
  console.log(`[jetstream] Connecting to ${endpoint}`);
  connect();
}

/** Disconnect and reset all state (for tests or clean shutdown). */
export function shutdownJetstream(): void {
  _shuttingDown = true;
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  _ws?.close();
  _ws = null;
  _endpoint = null;
  _firehose = null;
  _localPlcDids = new Set();
  _reconnectMs = MIN_RECONNECT_MS;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function connect(): void {
  if (!_endpoint || _shuttingDown) return;

  const ws = new WebSocket(_endpoint);
  _ws = ws;

  ws.addEventListener('open', () => {
    _reconnectMs = MIN_RECONNECT_MS;
    console.log('[jetstream] Connected');
  });

  ws.addEventListener('message', (evt) => {
    if (!_firehose || _shuttingDown) return;
    try {
      handleMessage(evt.data as string, _firehose);
    } catch {
      // Silently discard malformed messages
    }
  });

  // 'close' fires after both clean close and error — single reconnect path
  ws.addEventListener('close', () => {
    if (_shuttingDown) return;
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    // 'close' always fires next; reconnect is handled there
  });
}

function handleMessage(raw: string, firehose: Firehose): void {
  const data = JSON.parse(raw) as JetstreamEvent;
  if (data.kind !== 'commit') return;
  if (!data.commit) return;

  const { collection, rkey, operation, record } = data.commit;
  if (!collection.startsWith(MYCELIUM_PREFIX)) return;

  // Loop prevention: skip events we ourselves emitted
  if (_localPlcDids.has(data.did)) return;

  const event: FirehoseEvent = {
    seq: firehose.seq++,
    type: 'commit',
    operation,
    did: data.did,
    collection,
    rkey,
    record: record ?? null,
    timestamp: new Date(data.time_us / 1000).toISOString(),
  };

  publish(firehose, event);
}

function scheduleReconnect(): void {
  if (_shuttingDown || !_endpoint) return;
  console.log(`[jetstream] Disconnected — reconnecting in ${_reconnectMs}ms`);
  _reconnectTimer = setTimeout(() => {
    _reconnectMs = Math.min(_reconnectMs * 2, MAX_RECONNECT_MS);
    connect();
  }, _reconnectMs);
}
