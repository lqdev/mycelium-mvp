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
});
