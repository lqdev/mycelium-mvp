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
import type { ProtocolRepoSnapshot } from '../atproto/repo-snapshot.js';

function metadataSnapshot(
  did: string,
  records: ReadonlyArray<ProtocolRecordEnvelope>,
  streamSeq?: number,
): ProtocolRepoSnapshot {
  return {
    did,
    repoRev: 'repo-rev-snapshot',
    ...(streamSeq === undefined ? {} : { streamSeq }),
    rootCid: 'bafyreibqlm3quhnjyhqlsjj24uauvaoonmyi3jfkzqr44mzecn2yq2xpmu',
    records,
    quarantined: [],
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
      async recover() {
        recoveryStarted();
        await recoveryRelease;
        return metadataSnapshot(requester.did, [], 10);
      },
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
      async recover() {
        return {
          ...metadataSnapshot(requester.did, [], 49),
          streamSeq: 49,
        };
      },
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
