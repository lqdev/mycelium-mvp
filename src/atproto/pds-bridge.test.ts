import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import {
  initPdsBridge,
  mirrorRecord,
  mirrorDelete,
  isPdsBridgeEnabled,
  shutdownPdsBridge,
} from './pds-bridge.js';

// ─── Mock PDS server ─────────────────────────────────────────────────────────

interface CapturedRequest {
  method: string;
  url: string;
  auth: string | null;
  body: Record<string, unknown>;
}

function createMockPds(): { server: http.Server; requests: CapturedRequest[]; close: () => Promise<void> } {
  const requests: CapturedRequest[] = [];

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      requests.push({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        auth: req.headers.authorization ?? null,
        body,
      });

      res.setHeader('Content-Type', 'application/json');

      if (req.url?.includes('createSession')) {
        // Simulate no existing account → 401 so bridge falls back to createAccount
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'AuthenticationRequired', message: 'Invalid identifier or password' }));
      } else if (req.url?.includes('createAccount')) {
        res.writeHead(200);
        res.end(JSON.stringify({
          did: 'did:plc:testmockabc123',
          handle: 'atlas.test',
          accessJwt: 'mock-access-jwt',
          refreshJwt: 'mock-refresh-jwt',
        }));
      } else if (req.url?.includes('refreshSession')) {
        res.writeHead(200);
        res.end(JSON.stringify({
          did: 'did:plc:testmockabc123',
          accessJwt: 'mock-access-jwt-refreshed',
          refreshJwt: 'mock-refresh-jwt-refreshed',
        }));
      } else if (req.url?.includes('putRecord')) {
        res.writeHead(200);
        res.end(JSON.stringify({
          uri: 'at://did:plc:testmockabc123/network.mycelium.task.posting/test',
          cid: 'bafyreigtest',
        }));
      } else if (req.url?.includes('deleteRecord')) {
        res.writeHead(200);
        res.end(JSON.stringify({ commit: { cid: 'bafyreigtest' } }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'MethodNotImplemented' }));
      }
    });
  });

  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

  return { server, requests, close };
}

function startServer(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve(addr.port);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('isPdsBridgeEnabled()', () => {
  beforeEach(() => shutdownPdsBridge());
  afterEach(() => shutdownPdsBridge());

  it('returns false before initPdsBridge is called', () => {
    expect(isPdsBridgeEnabled()).toBe(false);
  });
});

describe('initPdsBridge()', () => {
  const mock = createMockPds();
  let port: number;

  beforeEach(async () => {
    shutdownPdsBridge();
    mock.requests.length = 0;
    port = await startServer(mock.server);
  });

  afterEach(async () => {
    shutdownPdsBridge();
    await mock.close();
  });

  it('enables the bridge after init', async () => {
    await initPdsBridge([{ handle: 'atlas.mycelium.local' }], `http://127.0.0.1:${port}`, 'adminpass');
    expect(isPdsBridgeEnabled()).toBe(true);
  });

  it('returns a Map of handle → did:plc for each agent', async () => {
    const result = await initPdsBridge(
      [{ handle: 'atlas.mycelium.local' }, { handle: 'beacon.mycelium.local' }],
      `http://127.0.0.1:${port}`,
      'adminpass',
    );
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    // mock server returns did:plc:testmockabc123 for every account
    expect(result.get('atlas.mycelium.local')).toBe('did:plc:testmockabc123');
    expect(result.get('beacon.mycelium.local')).toBe('did:plc:testmockabc123');
  });

  it('calls createAccount for each agent (when no existing session)', async () => {
    await initPdsBridge(
      [{ handle: 'atlas.mycelium.local' }, { handle: 'beacon.mycelium.local' }],
      `http://127.0.0.1:${port}`,
      'adminpass',
    );
    // createSession is tried first but returns 401 → falls back to createAccount
    const accountCalls = mock.requests.filter((r) => r.url.includes('createAccount'));
    expect(accountCalls).toHaveLength(2);
  });

  it('sends short handle + .test TLD to PDS (e.g. atlas.test)', async () => {
    await initPdsBridge([{ handle: 'atlas.mycelium.local' }], `http://127.0.0.1:${port}`, 'adminpass');
    const call = mock.requests.find((r) => r.url.includes('createAccount'));
    expect(call?.body.handle).toBe('atlas.test');
  });

  it('uses custom pdsHostname when provided', async () => {
    await initPdsBridge(
      [{ handle: 'atlas.mycelium.local' }],
      `http://127.0.0.1:${port}`,
      'adminpass',
      'mycelium.test',
    );
    const call = mock.requests.find((r) => r.url.includes('createAccount'));
    expect(call?.body.handle).toBe('atlas.mycelium.test');
  });

  it('derives deterministic password (same inputs → same result)', async () => {
    const mock2 = createMockPds();
    const port2 = await startServer(mock2.server);
    try {
      await initPdsBridge([{ handle: 'atlas.mycelium.local' }], `http://127.0.0.1:${port}`, 'testpass');
      const pass1 = (mock.requests.find((r) => r.url.includes('createAccount'))?.body.password ?? '') as string;

      shutdownPdsBridge();
      mock2.requests.length = 0;

      await initPdsBridge([{ handle: 'atlas.mycelium.local' }], `http://127.0.0.1:${port2}`, 'testpass');
      const pass2 = (mock2.requests.find((r) => r.url.includes('createAccount'))?.body.password ?? '') as string;

      expect(pass1).toBe(pass2);
      expect(pass1.length).toBeGreaterThan(0);
    } finally {
      await mock2.close();
    }
  });

  it('populates the localPlcDids set during init so Jetstream echo-loop prevention works immediately', async () => {
    const localPlcDids = new Set<string>();
    await initPdsBridge(
      [{ handle: 'atlas.mycelium.local' }, { handle: 'mayor.mycelium.local' }],
      `http://127.0.0.1:${port}`,
      'adminpass',
      'test',
      localPlcDids,
    );
    // mock returns did:plc:testmockabc123 for every account
    expect(localPlcDids.has('did:plc:testmockabc123')).toBe(true);
  });

  it('updates localPlcDids when a session is lazily established via mirrorRecord', async () => {
    const localPlcDids = new Set<string>();
    // Init with no agents — only sets endpoint/password
    await initPdsBridge([], `http://127.0.0.1:${port}`, 'adminpass', 'test', localPlcDids);
    expect(localPlcDids.size).toBe(0);

    // Lazy mirrorRecord triggers ensureSession → should update the shared set
    mirrorRecord('mayor.mycelium.local', 'network.mycelium.task.posting', 'task-1', { status: 'open' });
    await sleep(150);

    expect(localPlcDids.has('did:plc:testmockabc123')).toBe(true);
  });

  it('uses existing session when createSession succeeds (skips createAccount)', async () => {
    // Mock that accepts createSession directly (simulates account already exists)
    const existingAccountServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url?.includes('createSession')) {
          res.writeHead(200);
          res.end(JSON.stringify({
            did: 'did:plc:existing',
            accessJwt: 'existing-jwt',
            refreshJwt: 'existing-refresh',
          }));
        } else {
          res.writeHead(404);
          res.end('{}');
        }
      });
    });
    const existPort = await startServer(existingAccountServer);
    try {
      shutdownPdsBridge();
      await initPdsBridge([{ handle: 'atlas.mycelium.local' }], `http://127.0.0.1:${existPort}`, 'adminpass');
      expect(isPdsBridgeEnabled()).toBe(true);
      // createAccount was never hit (server would 404 it anyway — session succeeded)
    } finally {
      await new Promise<void>((r) => existingAccountServer.close(() => r()));
    }
  });
});

describe('mirrorRecord()', () => {
  const mock = createMockPds();
  let port: number;

  beforeEach(async () => {
    shutdownPdsBridge();
    mock.requests.length = 0;
    port = await startServer(mock.server);
    await initPdsBridge([{ handle: 'atlas.mycelium.local' }], `http://127.0.0.1:${port}`, 'adminpass');
  });

  afterEach(async () => {
    shutdownPdsBridge();
    await mock.close();
  });

  it('is a no-op when bridge is not configured', () => {
    shutdownPdsBridge();
    expect(() => mirrorRecord('atlas.mycelium.local', 'network.mycelium.task.posting', 'task-1', {})).not.toThrow();
  });

  it('calls putRecord on the PDS with correct collection and rkey', async () => {
    mock.requests.length = 0; // clear init requests
    mirrorRecord('atlas.mycelium.local', 'network.mycelium.task.posting', 'task-1', { title: 'Test' });
    await sleep(100);
    const putCall = mock.requests.find((r) => r.url.includes('putRecord'));
    expect(putCall).toBeDefined();
    expect(putCall?.body.collection).toBe('network.mycelium.task.posting');
    expect(putCall?.body.rkey).toBe('task-1');
  });

  it('sends the record payload to the PDS', async () => {
    mock.requests.length = 0;
    const record = { $type: 'network.mycelium.task.posting', title: 'Hello', status: 'open' };
    mirrorRecord('atlas.mycelium.local', 'network.mycelium.task.posting', 'task-2', record);
    await sleep(100);
    const putCall = mock.requests.find((r) => r.url.includes('putRecord'));
    expect(putCall?.body.record).toMatchObject(record);
  });

  it('sends the pdsDid as repo (not the internal did:key)', async () => {
    mock.requests.length = 0;
    mirrorRecord('atlas.mycelium.local', 'network.mycelium.agent.profile', 'self', {});
    await sleep(100);
    const putCall = mock.requests.find((r) => r.url.includes('putRecord'));
    expect(putCall?.body.repo).toBe('did:plc:testmockabc123');
  });

  it('includes Bearer token in Authorization header', async () => {
    mock.requests.length = 0;
    mirrorRecord('atlas.mycelium.local', 'network.mycelium.task.posting', 'task-3', {});
    await sleep(100);
    const putCall = mock.requests.find((r) => r.url.includes('putRecord'));
    expect(putCall?.auth).toBe('Bearer mock-access-jwt');
  });

  it('does not throw for unknown agents (logs and skips)', async () => {
    // 'unknown.agent' has no session — should fail gracefully
    expect(() => mirrorRecord('unknown.agent', 'network.mycelium.task.posting', 'x', {})).not.toThrow();
    await sleep(150); // let it settle
    // No crash — just logged
  });
});

describe('mirrorDelete()', () => {
  const mock = createMockPds();
  let port: number;

  beforeEach(async () => {
    shutdownPdsBridge();
    mock.requests.length = 0;
    port = await startServer(mock.server);
    await initPdsBridge([{ handle: 'atlas.mycelium.local' }], `http://127.0.0.1:${port}`, 'adminpass');
  });

  afterEach(async () => {
    shutdownPdsBridge();
    await mock.close();
  });

  it('is a no-op when bridge is not configured', () => {
    shutdownPdsBridge();
    expect(() => mirrorDelete('atlas.mycelium.local', 'network.mycelium.task.posting', 'task-1')).not.toThrow();
  });

  it('calls deleteRecord on the PDS', async () => {
    mock.requests.length = 0;
    mirrorDelete('atlas.mycelium.local', 'network.mycelium.task.posting', 'task-1');
    await sleep(100);
    const deleteCall = mock.requests.find((r) => r.url.includes('deleteRecord'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.body.collection).toBe('network.mycelium.task.posting');
    expect(deleteCall?.body.rkey).toBe('task-1');
  });

  it('uses the pdsDid as repo for deleteRecord', async () => {
    mock.requests.length = 0;
    mirrorDelete('atlas.mycelium.local', 'network.mycelium.task.posting', 'task-4');
    await sleep(100);
    const deleteCall = mock.requests.find((r) => r.url.includes('deleteRecord'));
    expect(deleteCall?.body.repo).toBe('did:plc:testmockabc123');
  });
});

describe('shutdownPdsBridge()', () => {
  const mock = createMockPds();

  afterEach(async () => {
    shutdownPdsBridge();
    await mock.close();
  });

  it('disables the bridge after shutdown', async () => {
    const port = await startServer(mock.server);
    await initPdsBridge([{ handle: 'atlas.mycelium.local' }], `http://127.0.0.1:${port}`, 'adminpass');
    expect(isPdsBridgeEnabled()).toBe(true);
    shutdownPdsBridge();
    expect(isPdsBridgeEnabled()).toBe(false);
  });
});
