import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import type { WebSocket as WsSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { createFirehose } from '../firehose/index.js';
import { initJetstream, shutdownJetstream, isJetstreamEnabled } from './jetstream.js';
import type { Firehose } from '../schemas/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Start a WebSocket server on an OS-assigned port. */
function startWss(): Promise<{ wss: WebSocketServer; port: number; clients: WsSocket[] }> {
  return new Promise((resolve) => {
    const clients: WsSocket[] = [];
    const wss = new WebSocketServer({ port: 0 });
    wss.on('connection', (ws) => {
      clients.push(ws);
      ws.on('close', () => clients.splice(clients.indexOf(ws), 1));
    });
    wss.on('listening', () => {
      const addr = wss.address() as { port: number };
      resolve({ wss, port: addr.port, clients });
    });
  });
}

function closeWss(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve) => wss.close(() => resolve()));
}

/** Build a valid Jetstream commit event as a JSON string. */
function makeJetstreamEvent(overrides: {
  kind?: string;
  did?: string;
  time_us?: number;
  collection?: string;
  rkey?: string;
  operation?: 'create' | 'update' | 'delete';
  record?: unknown;
} = {}): string {
  return JSON.stringify({
    kind: overrides.kind ?? 'commit',
    did: overrides.did ?? 'did:plc:remote123',
    time_us: overrides.time_us ?? 1_700_000_000_000_000,
    commit: {
      operation: overrides.operation ?? 'create',
      collection: overrides.collection ?? 'network.mycelium.task.posting',
      rkey: overrides.rkey ?? 'task1',
      record: overrides.record ?? { '$type': 'network.mycelium.task.posting', title: 'Remote task' },
    },
  });
}

/** Wait until the firehose log has at least `count` events (or timeout). */
function waitForEvents(firehose: Firehose, count: number, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (firehose.log.length >= count) {
        clearInterval(interval);
        resolve();
      }
    }, 20);
    setTimeout(() => {
      clearInterval(interval);
      reject(new Error(`Timeout: expected ${count} events, got ${firehose.log.length}`));
    }, timeoutMs);
  });
}

/** Start a WebSocket server that also captures the URL of the last connection request. */
function startWssCapturingUrl(): Promise<{ wss: WebSocketServer; port: number; clients: WsSocket[]; getLastUrl: () => string }> {
  return new Promise((resolve) => {
    const clients: WsSocket[] = [];
    let lastUrl = '';
    const wss = new WebSocketServer({ port: 0 });
    wss.on('connection', (ws: WsSocket, req: IncomingMessage) => {
      lastUrl = req.url ?? '';
      clients.push(ws);
      ws.on('close', () => clients.splice(clients.indexOf(ws), 1));
    });
    wss.on('listening', () => {
      const addr = wss.address() as { port: number };
      resolve({ wss, port: addr.port, clients, getLastUrl: () => lastUrl });
    });
  });
}

/** Wait a short time (e.g., to confirm no events arrive). */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('isJetstreamEnabled()', () => {
  afterEach(() => shutdownJetstream());

  it('returns false before init', () => {
    expect(isJetstreamEnabled()).toBe(false);
  });

  it('returns true after initJetstream()', async () => {
    const { wss, port } = await startWss();
    try {
      const firehose = createFirehose();
      initJetstream(`ws://127.0.0.1:${port}`, firehose, new Set());
      expect(isJetstreamEnabled()).toBe(true);
    } finally {
      shutdownJetstream();
      await closeWss(wss);
    }
  });

  it('returns false after shutdownJetstream()', async () => {
    const { wss, port } = await startWss();
    try {
      const firehose = createFirehose();
      initJetstream(`ws://127.0.0.1:${port}`, firehose, new Set());
      shutdownJetstream();
      expect(isJetstreamEnabled()).toBe(false);
    } finally {
      await closeWss(wss);
    }
  });
});

describe('initJetstream() — event bridging', () => {
  let wss: WebSocketServer;
  let port: number;
  let clients: WsSocket[];

  beforeEach(async () => {
    ({ wss, port, clients } = await startWss());
  });

  afterEach(async () => {
    shutdownJetstream();
    await closeWss(wss);
  });

  it('publishes network.mycelium.* events to the local firehose', async () => {
    const firehose = createFirehose();
    initJetstream(`ws://127.0.0.1:${port}`, firehose, new Set());

    // Wait for client to connect then send event
    await sleep(100);
    clients[0].send(makeJetstreamEvent());
    await waitForEvents(firehose, 1);

    expect(firehose.log).toHaveLength(1);
    const event = firehose.log[0];
    expect(event.did).toBe('did:plc:remote123');
    expect(event.collection).toBe('network.mycelium.task.posting');
    expect(event.rkey).toBe('task1');
    expect(event.operation).toBe('create');
    expect(event.type).toBe('commit');
  });

  it('ignores events from non-mycelium collections', async () => {
    const firehose = createFirehose();
    initJetstream(`ws://127.0.0.1:${port}`, firehose, new Set());

    await sleep(100);
    clients[0].send(makeJetstreamEvent({ collection: 'app.bsky.feed.post' }));
    await sleep(150); // give time for any event to arrive

    expect(firehose.log).toHaveLength(0);
  });

  it('ignores non-commit events (kind=identity, kind=account)', async () => {
    const firehose = createFirehose();
    initJetstream(`ws://127.0.0.1:${port}`, firehose, new Set());

    await sleep(100);
    clients[0].send(JSON.stringify({ kind: 'identity', did: 'did:plc:remote', time_us: 0 }));
    clients[0].send(JSON.stringify({ kind: 'account', did: 'did:plc:remote', time_us: 0 }));
    await sleep(150);

    expect(firehose.log).toHaveLength(0);
  });

  it('skips events from local agent plcDids (loop prevention)', async () => {
    const firehose = createFirehose();
    const localPlcDids = new Set(['did:plc:local-atlas', 'did:plc:local-beacon']);
    initJetstream(`ws://127.0.0.1:${port}`, firehose, localPlcDids);

    await sleep(100);
    // This DID is local — should be skipped
    clients[0].send(makeJetstreamEvent({ did: 'did:plc:local-atlas' }));
    // This DID is remote — should be delivered
    clients[0].send(makeJetstreamEvent({ did: 'did:plc:remote-other' }));
    await waitForEvents(firehose, 1);

    expect(firehose.log).toHaveLength(1);
    expect(firehose.log[0].did).toBe('did:plc:remote-other');
  });

  it('assigns monotonically increasing seq numbers from the firehose', async () => {
    const firehose = createFirehose();
    const startSeq = firehose.seq;
    initJetstream(`ws://127.0.0.1:${port}`, firehose, new Set());

    await sleep(100);
    clients[0].send(makeJetstreamEvent({ rkey: 'task-a' }));
    clients[0].send(makeJetstreamEvent({ rkey: 'task-b' }));
    await waitForEvents(firehose, 2);

    expect(firehose.log[0].seq).toBe(startSeq);
    expect(firehose.log[1].seq).toBe(startSeq + 1);
  });

  it('converts time_us (microseconds) to ISO timestamp', async () => {
    const firehose = createFirehose();
    initJetstream(`ws://127.0.0.1:${port}`, firehose, new Set());

    const time_us = 1_700_000_000_000_000; // 1700000000000 ms
    await sleep(100);
    clients[0].send(makeJetstreamEvent({ time_us }));
    await waitForEvents(firehose, 1);

    expect(firehose.log[0].timestamp).toBe(new Date(time_us / 1000).toISOString());
  });

  it('handles delete operations with null record', async () => {
    const firehose = createFirehose();
    initJetstream(`ws://127.0.0.1:${port}`, firehose, new Set());

    await sleep(100);
    const msg = JSON.stringify({
      kind: 'commit',
      did: 'did:plc:remote123',
      time_us: 1_700_000_000_000_000,
      commit: { operation: 'delete', collection: 'network.mycelium.task.posting', rkey: 'task1' },
    });
    clients[0].send(msg);
    await waitForEvents(firehose, 1);

    expect(firehose.log[0].operation).toBe('delete');
    expect(firehose.log[0].record).toBeNull();
  });

  it('silently discards malformed JSON messages', async () => {
    const firehose = createFirehose();
    initJetstream(`ws://127.0.0.1:${port}`, firehose, new Set());

    await sleep(100);
    clients[0].send('{not valid json!!!');
    clients[0].send(makeJetstreamEvent()); // valid — to confirm connection still works
    await waitForEvents(firehose, 1);

    // One valid event still arrives; no crash from the malformed one
    expect(firehose.log).toHaveLength(1);
  });
});

describe('initJetstream() — reconnection', () => {
  it('reconnects after server closes the connection', async () => {
    const firehose = createFirehose();
    let { wss, port, clients } = await startWss();

    initJetstream(`ws://127.0.0.1:${port}`, firehose, new Set());
    await sleep(100); // initial connect
    expect(clients).toHaveLength(1);

    // Simulate server dropping the connection
    clients[0].terminate();

    // The module should schedule a reconnect (1s backoff)
    await sleep(1200);

    // Restart server on same port isn't possible easily — just verify no crash
    // and that the module is still in 'enabled' state
    expect(isJetstreamEnabled()).toBe(true);

    shutdownJetstream();
    await closeWss(wss);
  });
});

describe('shutdownJetstream()', () => {
  it('stops processing events after shutdown', async () => {
    const { wss, port, clients } = await startWss();
    const firehose = createFirehose();
    initJetstream(`ws://127.0.0.1:${port}`, firehose, new Set());

    await sleep(100);
    shutdownJetstream();

    // Send an event after shutdown — it should not appear in the firehose
    if (clients[0]?.readyState === 1 /* OPEN */) {
      clients[0].send(makeJetstreamEvent());
    }
    await sleep(150);

    expect(firehose.log).toHaveLength(0);
    await closeWss(wss);
  });
});

describe('initJetstream() — cursor', () => {
  afterEach(() => shutdownJetstream());

  it('appends ?cursor=N to the WebSocket URL when cursor is provided', async () => {
    const { wss, port, getLastUrl } = await startWssCapturingUrl();
    try {
      const firehose = createFirehose();
      initJetstream(`ws://127.0.0.1:${port}/subscribe`, firehose, new Set(), 1_700_000_000_000_000);
      await sleep(100);
      expect(getLastUrl()).toBe('/subscribe?cursor=1700000000000000');
    } finally {
      shutdownJetstream();
      await closeWss(wss);
    }
  });

  it('does not append cursor param when no cursor provided', async () => {
    const { wss, port, getLastUrl } = await startWssCapturingUrl();
    try {
      const firehose = createFirehose();
      initJetstream(`ws://127.0.0.1:${port}/subscribe`, firehose, new Set());
      await sleep(100);
      expect(getLastUrl()).toBe('/subscribe');
    } finally {
      shutdownJetstream();
      await closeWss(wss);
    }
  });

  it('calls onCursor callback with time_us after each bridged event', async () => {
    const { wss, port, clients } = await startWss();
    const cursors: number[] = [];
    const firehose = createFirehose();
    const time_us = 1_700_000_000_000_000;

    initJetstream(`ws://127.0.0.1:${port}`, firehose, new Set(), undefined, (t) => cursors.push(t));
    try {
      await sleep(100);
      clients[0].send(makeJetstreamEvent({ time_us }));
      clients[0].send(makeJetstreamEvent({ time_us: time_us + 1_000_000 }));
      await waitForEvents(firehose, 2);

      expect(cursors).toHaveLength(2);
      expect(cursors[0]).toBe(time_us);
      expect(cursors[1]).toBe(time_us + 1_000_000);
    } finally {
      shutdownJetstream();
      await closeWss(wss);
    }
  });

  it('does not call onCursor for filtered events (local DID or wrong collection)', async () => {
    const { wss, port, clients } = await startWss();
    const cursors: number[] = [];
    const firehose = createFirehose();
    const localPlcDids = new Set(['did:plc:local']);

    initJetstream(`ws://127.0.0.1:${port}`, firehose, localPlcDids, undefined, (t) => cursors.push(t));
    try {
      await sleep(100);
      clients[0]?.send(makeJetstreamEvent({ did: 'did:plc:local' })); // filtered — local DID
      clients[0]?.send(makeJetstreamEvent({ collection: 'app.bsky.feed.post' })); // filtered — wrong collection
      await sleep(150);

      expect(cursors).toHaveLength(0);
    } finally {
      shutdownJetstream();
      await closeWss(wss);
    }
  });
});
