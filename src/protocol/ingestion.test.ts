import { describe, expect, it } from 'vitest';
import { ProtocolAppView } from './appview.js';
import {
  MemoryCursorStore,
  ProtocolIngestor,
  type CursorStore,
  type PdsEventSource,
} from './ingestion.js';
import { COLLECTIONS } from './constants.js';
import { generateIdentity } from '../identity/index.js';
import type { ProtocolCommitEvent } from './appview.js';
import type { ProtocolRecordEnvelope } from './types.js';
import { createDuckDB } from '../storage/duckdb.js';
import { DuckDbCursorStore } from './ingestion.js';
import type {
  AuthoritativeRecoverySnapshot,
  ProtocolRepoSnapshot,
} from '../atproto/repo-snapshot.js';

function metadataSnapshot(
  did: string,
  records: ReadonlyArray<ProtocolRecordEnvelope>,
): ProtocolRepoSnapshot {
  return {
    did,
    repoRev: 'repo-rev-snapshot',
    rootCid: 'bafyreibqlm3quhnjyhqlsjj24uauvaoonmyi3jfkzqr44mzecn2yq2xpmu',
    records,
    quarantined: [],
  };
}

function authoritativeSnapshot(
  snapshot: ProtocolRepoSnapshot,
  streamSeq: number,
): AuthoritativeRecoverySnapshot {
  return {
    snapshot,
    boundary: {
      streamSeq,
      repoDid: snapshot.did,
      repoRev: snapshot.repoRev,
      proof: `fixture:${snapshot.did}:${snapshot.repoRev}:${streamSeq}`,
    },
  };
}

function fixtureRecoveryProvider(
  recovery: AuthoritativeRecoverySnapshot |
    (() => AuthoritativeRecoverySnapshot | Promise<AuthoritativeRecoverySnapshot>),
) {
  return {
    async recover() {
      return typeof recovery === 'function' ? recovery() : recovery;
    },
    async verifyBoundary(candidate: AuthoritativeRecoverySnapshot) {
      return candidate.boundary.proof ===
        `fixture:${candidate.snapshot.did}:${candidate.snapshot.repoRev}:${candidate.boundary.streamSeq}`;
    },
  };
}

function taskOffer(did: string, taskId: string): Record<string, unknown> {
  return {
    $type: COLLECTIONS.taskOffer,
    taskId,
    title: 'Recovery test task',
    description: 'A task used to verify replay completeness',
    requiredCapabilities: ['typescript'],
    contextRefs: [],
    deliverables: ['patch'],
    requesterDid: did,
    governance: { mode: 'requester-selected' },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('Protocol 0.1 snapshot/live ingestion', () => {
  it('buffers events during snapshot, replays them, and persists one global stream cursor', async () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    const offer = {
      $type: COLLECTIONS.taskOffer,
      taskId: 'task-1',
      title: 'Snapshot task',
      description: 'Task loaded from a PDS snapshot',
      requiredCapabilities: ['typescript'],
      contextRefs: [],
      deliverables: ['patch'],
      requesterDid: requester.did,
      governance: { mode: 'requester-selected' as const },
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const envelope: ProtocolRecordEnvelope = {
      uri: `at://${requester.did}/${COLLECTIONS.taskOffer}/task-1`,
      did: requester.did,
      collection: COLLECTIONS.taskOffer,
      rkey: 'task-1',
      cid: 'cid-task-1',
      record: offer,
    };
    let emit: ((event: ProtocolCommitEvent) => void | Promise<void>) | undefined;
    const source: PdsEventSource = {
      async snapshot() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [envelope];
      },
      async subscribe(_cursors, onEvent) {
        emit = onEvent;
        onEvent({
          seq: 2,
          did: requester.did,
          collection: COLLECTIONS.taskOffer,
          rkey: 'task-2',
          operation: 'create',
          record: { ...offer, taskId: 'task-2' },
          timestamp: '2026-01-01T00:00:01.000Z',
        });
        return async () => {};
      },
    };
    const appView = new ProtocolAppView();
    const ingestor = new ProtocolIngestor(source, appView, new MemoryCursorStore());

    await ingestor.start();
    expect(ingestor.status().phase).toBe('live');
    expect(appView.listRecords()).toHaveLength(2);
    expect(appView.health().cursors[requester.did]).toBe(2);
    expect(emit).toBeDefined();
  });

  it('persists cursors in DuckDB for restart recovery', async () => {
    const { instance, conn } = await createDuckDB();
    try {
      const store = new DuckDbCursorStore(conn);
      await store.save(42);
      await expect(store.load()).resolves.toBe(42);
    } finally {
      instance.closeSync();
    }
  });

  it('persists the maximum cursor under concurrent out-of-order saves', async () => {
    const { instance, conn } = await createDuckDB();
    try {
      const store = new DuckDbCursorStore(conn);
      await Promise.all([store.save(17), store.save(91), store.save(42), store.save(63)]);
      await expect(store.load()).resolves.toBe(91);
    } finally {
      instance.closeSync();
    }
  });

  it('does not lose events that arrive while the handoff cursor save is pending', async () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    const offer = {
      $type: COLLECTIONS.taskOffer,
      taskId: 'task-1',
      title: 'Snapshot task',
      description: 'Task loaded from a PDS snapshot',
      requiredCapabilities: ['typescript'],
      contextRefs: [],
      deliverables: ['patch'],
      requesterDid: requester.did,
      governance: { mode: 'requester-selected' as const },
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const envelope: ProtocolRecordEnvelope = {
      uri: `at://${requester.did}/${COLLECTIONS.taskOffer}/task-1`,
      did: requester.did,
      collection: COLLECTIONS.taskOffer,
      rkey: 'task-1',
      cid: 'cid-task-1',
      record: offer,
    };
    let emit: ((event: ProtocolCommitEvent) => void | Promise<void>) | undefined;
    let releaseFirstSave!: () => void;
    let firstSaveStarted!: () => void;
    const firstSave = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
    const saveStarted = new Promise<void>((resolve) => { firstSaveStarted = resolve; });
    let saveCount = 0;
    const cursors: CursorStore = {
      async load() {
        return {};
      },
      async save() {
        saveCount++;
        if (saveCount === 1) {
          firstSaveStarted();
          await firstSave;
        }
      },
    };
    const source: PdsEventSource = {
      async snapshot() {
        return [envelope];
      },
      async subscribe(_cursors, onEvent) {
        emit = onEvent;
        onEvent({
          seq: 2,
          did: requester.did,
          collection: COLLECTIONS.taskOffer,
          rkey: 'task-2',
          operation: 'create',
          record: { ...offer, taskId: 'task-2' },
          timestamp: '2026-01-01T00:00:01.000Z',
        });
        return async () => {};
      },
    };
    const appView = new ProtocolAppView();
    const ingestor = new ProtocolIngestor(source, appView, cursors);
    const start = ingestor.start();
    await saveStarted;
    expect(emit).toBeDefined();
    emit?.({
      seq: 3,
      did: requester.did,
      collection: COLLECTIONS.taskOffer,
      rkey: 'task-3',
      operation: 'create',
      record: { ...offer, taskId: 'task-3' },
      timestamp: '2026-01-01T00:00:02.000Z',
    });
    releaseFirstSave();
    await start;

    expect(appView.listRecords()).toHaveLength(3);
    expect(appView.health().cursors[requester.did]).toBe(3);
  });

  it('restores stopped state when subscription reports a post-open connection failure during startup', async () => {
    const source: PdsEventSource = {
      async snapshot() {
        throw new Error('snapshot must not run after connection failure');
      },
      async subscribe(_cursor, _onEvent, onDiagnostic) {
        onDiagnostic?.({
          kind: 'recovery',
          frameType: '#connection',
          message: 'subscribeRepos WebSocket closed (1006)',
        });
        return async () => {};
      },
    };
    const appView = new ProtocolAppView();
    const ingestor = new ProtocolIngestor(source, appView, new MemoryCursorStore());

    await expect(ingestor.start()).rejects.toThrow('WebSocket closed (1006)');
    expect(ingestor.status()).toMatchObject({
      phase: 'stopped',
      lastError: 'subscribeRepos WebSocket closed (1006)',
    });
  });

  it('drains events appended while an authoritative recovery snapshot saves its boundary', async () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    const offer = {
      $type: COLLECTIONS.taskOffer,
      taskId: 'task-recovered',
      title: 'Recovered task',
      description: 'Task loaded after recovery',
      requiredCapabilities: ['typescript'],
      contextRefs: [],
      deliverables: ['patch'],
      requesterDid: requester.did,
      governance: { mode: 'requester-selected' as const },
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    let emit: ((event: ProtocolCommitEvent) => void | Promise<void>) | undefined;
    let recoveryStarted!: () => void;
    let releaseRecovery!: () => void;
    const recoveryStartedPromise = new Promise<void>((resolve) => { recoveryStarted = resolve; });
    const recoveryRelease = new Promise<void>((resolve) => { releaseRecovery = resolve; });
    const source: PdsEventSource = {
      async snapshot() {
        return metadataSnapshot(requester.did, []);
      },
      async subscribe(_cursor, onEvent) {
        emit = onEvent;
        return async () => {};
      },
      authoritativeRecovery: fixtureRecoveryProvider(async () => {
        recoveryStarted();
        await recoveryRelease;
        return authoritativeSnapshot(metadataSnapshot(requester.did, []), 10);
      }),
    };
    const appView = new ProtocolAppView();
    const ingestor = new ProtocolIngestor(source, appView, new MemoryCursorStore());
    await ingestor.start();

    const recoveryDone = emit?.({
      streamSeq: 10,
      did: requester.did,
      collection: '',
      rkey: '',
      operation: 'create',
      tooBig: true,
      timestamp: '2026-01-01T00:00:10.000Z',
    });
    await recoveryStartedPromise;
    emit?.({
      streamSeq: 11,
      did: requester.did,
      collection: COLLECTIONS.taskOffer,
      rkey: 'task-recovered',
      operation: 'create',
      record: offer,
      timestamp: '2026-01-01T00:00:11.000Z',
    });
    releaseRecovery();
    if (recoveryDone !== undefined) await recoveryDone;

    expect(ingestor.status()).toMatchObject({
      phase: 'live',
      streamSeq: 11,
      bufferedEvents: 0,
      recoveryRequired: false,
    });
    expect(appView.listRecords()).toHaveLength(1);
  });

  it('skips an equal-boundary tooBig marker without retrying recovery', async () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    let emit: ((event: ProtocolCommitEvent) => void | Promise<void>) | undefined;
    let recoveryCalls = 0;
    const source: PdsEventSource = {
      async snapshot() {
        return metadataSnapshot(requester.did, []);
      },
      async subscribe(_cursor, onEvent) {
        emit = onEvent;
        return async () => {};
      },
      authoritativeRecovery: fixtureRecoveryProvider(() => {
        recoveryCalls++;
        return authoritativeSnapshot(metadataSnapshot(requester.did, []), 10);
      }),
    };
    const ingestor = new ProtocolIngestor(source, new ProtocolAppView(), new MemoryCursorStore());
    await ingestor.start();

    const recovery = emit?.({
      streamSeq: 10,
      did: requester.did,
      collection: '',
      rkey: '',
      operation: 'create',
      tooBig: true,
      timestamp: '2026-01-01T00:00:10.000Z',
    });
    if (recovery !== undefined) await recovery;

    expect(recoveryCalls).toBe(1);
    expect(ingestor.status()).toMatchObject({
      phase: 'live',
      streamSeq: 10,
      bufferedEvents: 0,
      recoveryRequired: false,
    });
  });

  it('replays an ordinary event at the authoritative boundary', async () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    const record = taskOffer(requester.did, 'replayed-at-boundary');
    let emit: ((event: ProtocolCommitEvent) => void | Promise<void>) | undefined;
    let recoveryStarted!: () => void;
    let releaseRecovery!: () => void;
    const recoveryStartedPromise = new Promise<void>((resolve) => { recoveryStarted = resolve; });
    const recoveryRelease = new Promise<void>((resolve) => { releaseRecovery = resolve; });
    const source: PdsEventSource = {
      async snapshot() {
        return metadataSnapshot(requester.did, []);
      },
      async subscribe(_cursor, onEvent) {
        emit = onEvent;
        return async () => {};
      },
      authoritativeRecovery: fixtureRecoveryProvider(async () => {
        recoveryStarted();
        await recoveryRelease;
        return authoritativeSnapshot(metadataSnapshot(requester.did, []), 20);
      }),
    };
    const appView = new ProtocolAppView();
    const ingestor = new ProtocolIngestor(source, appView, new MemoryCursorStore());
    await ingestor.start();

    const recovery = emit?.({
      streamSeq: 20,
      did: requester.did,
      collection: '',
      rkey: '',
      operation: 'create',
      tooBig: true,
      timestamp: '2026-01-01T00:00:20.000Z',
    });
    await recoveryStartedPromise;
    emit?.({
      streamSeq: 20,
      did: requester.did,
      collection: COLLECTIONS.taskOffer,
      rkey: 'replayed-at-boundary',
      operation: 'create',
      record,
      timestamp: '2026-01-01T00:00:20.000Z',
    });
    releaseRecovery();
    if (recovery !== undefined) await recovery;

    expect(appView.listRecords()).toHaveLength(1);
    expect(appView.listRecords()[0]?.record).toEqual(record);
    expect(ingestor.status()).toMatchObject({
      phase: 'live',
      streamSeq: 20,
      recoveryRequired: false,
    });
  });

  it('fails closed when recovery is requested without an authoritative provider', async () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    let emit: ((event: ProtocolCommitEvent) => void | Promise<void>) | undefined;
    const source: PdsEventSource = {
      async snapshot() {
        return metadataSnapshot(requester.did, []);
      },
      async subscribe(_cursor, onEvent) {
        emit = onEvent;
        return async () => {};
      },
    };
    const ingestor = new ProtocolIngestor(source, new ProtocolAppView(), new MemoryCursorStore());
    await ingestor.start();

    const recovery = emit?.({
      streamSeq: 10,
      did: requester.did,
      collection: '',
      rkey: '',
      operation: 'create',
      tooBig: true,
      timestamp: '2026-01-01T00:00:10.000Z',
    });
    if (recovery !== undefined) await recovery;

    expect(ingestor.status()).toMatchObject({
      phase: 'stopped',
      lastError: 'snapshot recovery requires an authoritative recovery provider; getRepo has no authoritative streamSeq boundary',
    });
  });

  it('closes the subscription and ignores events after live recovery failure', async () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    let emit: ((event: ProtocolCommitEvent) => void | Promise<void>) | undefined;
    let unsubscribeCalls = 0;
    const source: PdsEventSource = {
      async snapshot() {
        return metadataSnapshot(requester.did, []);
      },
      async subscribe(_cursor, onEvent) {
        emit = onEvent;
        return async () => {
          unsubscribeCalls++;
        };
      },
      authoritativeRecovery: {
        async recover() {
          throw new Error('authoritative recovery unavailable');
        },
        async verifyBoundary() {
          return true;
        },
      },
    };
    const ingestor = new ProtocolIngestor(source, new ProtocolAppView(), new MemoryCursorStore());
    await ingestor.start();

    const failure = emit?.({
      streamSeq: 10,
      did: requester.did,
      collection: '',
      rkey: '',
      operation: 'create',
      tooBig: true,
      timestamp: '2026-01-01T00:00:10.000Z',
    });
    if (failure !== undefined) await failure;

    expect(unsubscribeCalls).toBe(1);
    expect(ingestor.status()).toMatchObject({
      phase: 'stopped',
      bufferedEvents: 1,
      lastError: 'authoritative recovery unavailable',
    });
    const bufferedAfterFailure = ingestor.status().bufferedEvents;
    await emit?.({
      streamSeq: 11,
      did: requester.did,
      collection: COLLECTIONS.taskOffer,
      rkey: 'ignored-after-failure',
      operation: 'delete',
      timestamp: '2026-01-01T00:00:11.000Z',
    });
    expect(ingestor.status().bufferedEvents).toBe(bufferedAfterFailure);
    expect(unsubscribeCalls).toBe(1);
  });

  it('rejects an unverified boundary before replacing state or advancing the cursor', async () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    const existingRecord = taskOffer(requester.did, 'existing-before-recovery');
    const existingEnvelope: ProtocolRecordEnvelope = {
      uri: `at://${requester.did}/${COLLECTIONS.taskOffer}/existing-before-recovery`,
      did: requester.did,
      collection: COLLECTIONS.taskOffer,
      rkey: 'existing-before-recovery',
      cid: 'cid-existing-before-recovery',
      record: existingRecord,
    };
    let emit: ((event: ProtocolCommitEvent) => void | Promise<void>) | undefined;
    const source: PdsEventSource = {
      async snapshot() {
        return metadataSnapshot(requester.did, [existingEnvelope]);
      },
      async subscribe(_cursor, onEvent) {
        emit = onEvent;
        return async () => {};
      },
      authoritativeRecovery: {
        async recover() {
          return authoritativeSnapshot(metadataSnapshot(requester.did, []), 10);
        },
        async verifyBoundary() {
          return false;
        },
      },
    };
    const appView = new ProtocolAppView();
    const cursors = new MemoryCursorStore();
    const ingestor = new ProtocolIngestor(source, appView, cursors);
    await ingestor.start();

    const recovery = emit?.({
      streamSeq: 10,
      did: requester.did,
      collection: '',
      rkey: '',
      operation: 'create',
      tooBig: true,
      timestamp: '2026-01-01T00:00:10.000Z',
    });
    if (recovery !== undefined) await recovery;

    expect(appView.listRecords()).toHaveLength(1);
    await expect(cursors.load()).resolves.toBeUndefined();
    expect(ingestor.status()).toMatchObject({
      phase: 'stopped',
      lastError: 'snapshot recovery boundary failed provider verification',
    });
  });

  it('rejects malformed recovery envelopes before replacing state or advancing the cursor', async () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    const existingRecord = taskOffer(requester.did, 'existing-before-malformed-recovery');
    const existingEnvelope: ProtocolRecordEnvelope = {
      uri: `at://${requester.did}/${COLLECTIONS.taskOffer}/existing-before-malformed-recovery`,
      did: requester.did,
      collection: COLLECTIONS.taskOffer,
      rkey: 'existing-before-malformed-recovery',
      cid: 'cid-existing-before-malformed-recovery',
      record: existingRecord,
    };
    const malformedSnapshot = {
      ...metadataSnapshot(requester.did, []),
      records: [null],
    };
    const malformedRecovery = {
      snapshot: malformedSnapshot,
      boundary: {
        streamSeq: 10,
        repoDid: requester.did,
        repoRev: malformedSnapshot.repoRev,
        proof: 'fixture:malformed',
      },
    } as unknown as AuthoritativeRecoverySnapshot;
    let emit: ((event: ProtocolCommitEvent) => void | Promise<void>) | undefined;
    const cursors = new MemoryCursorStore();
    await cursors.save(7);
    const source: PdsEventSource = {
      async snapshot() {
        return metadataSnapshot(requester.did, [existingEnvelope]);
      },
      async subscribe(_cursor, onEvent) {
        emit = onEvent;
        return async () => {};
      },
      authoritativeRecovery: {
        async recover() {
          return malformedRecovery;
        },
        async verifyBoundary() {
          return true;
        },
      },
    };
    const appView = new ProtocolAppView();
    const ingestor = new ProtocolIngestor(source, appView, cursors);
    await ingestor.start();
    const projectionBeforeRecovery = appView.projectionHash();

    const recovery = emit?.({
      streamSeq: 8,
      did: requester.did,
      collection: '',
      rkey: '',
      operation: 'create',
      tooBig: true,
      timestamp: '2026-01-01T00:00:08.000Z',
    });
    if (recovery !== undefined) await recovery;

    expect(appView.projectionHash()).toBe(projectionBeforeRecovery);
    expect(appView.listRecords()).toHaveLength(1);
    await expect(cursors.load()).resolves.toBe(7);
    expect(ingestor.status()).toMatchObject({
      phase: 'stopped',
      lastError: 'snapshot recovery boundary is malformed or does not match repoRev',
    });
  });

  it('rejects malformed array snapshots before resetting the AppView', async () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    const existingRecord = taskOffer(requester.did, 'existing-before-array-snapshot');
    const existingEnvelope: ProtocolRecordEnvelope = {
      uri: `at://${requester.did}/${COLLECTIONS.taskOffer}/existing-before-array-snapshot`,
      did: requester.did,
      collection: COLLECTIONS.taskOffer,
      rkey: 'existing-before-array-snapshot',
      cid: 'cid-existing-before-array-snapshot',
      record: existingRecord,
    };
    const cursors = new MemoryCursorStore();
    await cursors.save(7);
    const source: PdsEventSource = {
      async snapshot() {
        return [null] as unknown as ReadonlyArray<ProtocolRecordEnvelope>;
      },
      async subscribe() {
        return async () => {};
      },
    };
    const appView = new ProtocolAppView();
    appView.ingestSnapshot([existingEnvelope]);
    const projectionBeforeSnapshot = appView.projectionHash();
    const ingestor = new ProtocolIngestor(source, appView, cursors);

    await expect(ingestor.start()).rejects.toThrow('repository snapshot is malformed');
    expect(appView.projectionHash()).toBe(projectionBeforeSnapshot);
    expect(appView.listRecords()).toHaveLength(1);
    await expect(cursors.load()).resolves.toBe(7);
  });

  it('rejects a recovery boundary behind the durable cursor without regressing it', async () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    let emit: ((event: ProtocolCommitEvent) => void | Promise<void>) | undefined;
    const source: PdsEventSource = {
      async snapshot() {
        return metadataSnapshot(requester.did, []);
      },
      async subscribe(_cursor, onEvent) {
        emit = onEvent;
        return async () => {};
      },
      authoritativeRecovery: fixtureRecoveryProvider(
        authoritativeSnapshot(metadataSnapshot(requester.did, []), 49),
      ),
    };
    const cursors = new MemoryCursorStore();
    await cursors.save(50);
    const ingestor = new ProtocolIngestor(source, new ProtocolAppView(), cursors);
    await ingestor.start();

    const recoveryResult = emit?.({
      streamSeq: 51,
      did: requester.did,
      collection: '',
      rkey: '',
      operation: 'create',
      tooBig: true,
      timestamp: '2026-01-01T00:00:51.000Z',
    });
    if (recoveryResult !== undefined) await recoveryResult;

    expect(ingestor.status()).toMatchObject({
      phase: 'stopped',
      streamSeq: 50,
      lastError: 'snapshot streamSeq 49 is behind current streamSeq 50',
    });
    await expect(cursors.load()).resolves.toBe(50);
  });
});
