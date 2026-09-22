import { encode, cidForLex } from '@atproto/lex-cbor';
import { BlockMap, blocksToCarFile } from '@atproto/repo';
import type { LexValue } from '@atproto/lex-cbor';
import { describe, expect, it } from 'vitest';
import { ProtocolAppView, type ProtocolCommitEvent } from '../protocol/appview.js';
import { COLLECTIONS } from '../protocol/constants.js';
import { MemoryCursorStore, ProtocolIngestor } from '../protocol/ingestion.js';
import type { ProtocolRepoSnapshot } from './repo-snapshot.js';
import {
  AtprotoSubscribeReposSource,
  decodeSubscribeReposFrame,
  type SubscribeReposSocket,
} from './subscribe-repos.js';

const did = 'did:plc:subscribe-repos-fixture';

class FixtureSocket implements SubscribeReposSocket {
  readonly readyState = 0;
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  close(): void {}

  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

async function makeRecordBlock(record: Record<string, unknown>): Promise<{
  cid: Awaited<ReturnType<typeof cidForLex>>;
  car: Uint8Array;
}> {
  const bytes = encode(record as LexValue);
  const cid = await cidForLex(record as LexValue);
  return { cid, car: await blocksToCarFile(cid, new BlockMap([[cid, bytes]])) };
}

async function makeCommitFrame(input: {
  seq: number;
  record?: Record<string, unknown>;
  action: 'create' | 'update' | 'delete';
  path: string;
  tooBig?: boolean;
}): Promise<Uint8Array> {
  const block = input.record === undefined
    ? { cid: undefined, car: await blocksToCarFile(null, new BlockMap()) }
    : await makeRecordBlock(input.record);
  const commitCid = block.cid ?? await cidForLex({
    $type: 'com.atproto.sync.commit',
    seq: input.seq,
  } as LexValue);
  const body = {
    seq: input.seq,
    rebase: false,
    tooBig: input.tooBig ?? false,
    repo: did,
    commit: commitCid,
    rev: `repo-rev-${input.seq}`,
    since: null,
    blocks: block.car,
    ops: [{
      action: input.action,
      path: input.path,
      cid: input.action === 'delete' ? null : block.cid,
    }],
  };
  const header = encode({ op: 1, t: '#commit' } as LexValue);
  const payload = encode(body as unknown as LexValue);
  return new Uint8Array([...header, ...payload]);
}

function snapshot(records: ProtocolRepoSnapshot['records'], streamSeq?: number): ProtocolRepoSnapshot {
  return {
    did,
    repoRev: 'snapshot-rev',
    ...(streamSeq === undefined ? {} : { streamSeq }),
    rootCid: 'bafyreibqlm3quhnjyhqlsjj24uauvaoonmyi3jfkzqr44mzecn2yq2xpmu',
    records,
    quarantined: [],
  };
}

function eventFromCommit(
  seq: number,
  action: 'create' | 'update' | 'delete',
  rkey: string,
  record?: unknown,
  cid?: string,
): ProtocolCommitEvent {
  return {
    streamSeq: seq,
    did,
    collection: COLLECTIONS.taskOffer,
    rkey,
    operation: action,
    ...(record === undefined ? {} : { record }),
    ...(cid === undefined ? {} : { cid }),
    repoRev: `repo-rev-${seq}`,
    since: null,
    timestamp: `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
  };
}

describe('official com.atproto.sync.subscribeRepos ingestion', () => {
  it('decodes concatenated official CBOR header and payload objects with CAR records', async () => {
    const record = {
      $type: COLLECTIONS.taskOffer,
      taskId: 'task-1',
      title: 'Live task',
    };
    const frame = await makeCommitFrame({
      seq: 42,
      action: 'create',
      path: `${COLLECTIONS.taskOffer}/task-1`,
      record,
    });

    const decoded = await decodeSubscribeReposFrame(frame);

    expect(decoded).toMatchObject({
      kind: 'commit',
      commit: {
        streamSeq: 42,
        repo: did,
        repoRev: 'repo-rev-42',
        since: null,
        tooBig: false,
        operations: [{
          action: 'create',
          collection: COLLECTIONS.taskOffer,
          rkey: 'task-1',
          record,
        }],
      },
    });
    if (decoded.kind === 'commit') {
      expect(decoded.commit.operations[0]!.cid).toBeDefined();
      expect(decoded.commit.commitCid).toBeDefined();
    }
  });

  it('classifies identity, account, handle, info, and unknown frames as diagnostics', async () => {
    for (const type of ['#identity', '#account', '#handle', '#info', '#future']) {
      const raw = new Uint8Array([
        ...encode({ op: 1, t: type } as LexValue),
        ...encode({ seq: 7 } as LexValue),
      ]);
      await expect(decodeSubscribeReposFrame(raw)).resolves.toEqual({
        kind: 'diagnostic',
        diagnostic: {
          kind: 'frame',
          frameType: type,
          message: `ignored subscribeRepos frame ${type}`,
        },
      });
    }
  });

  it('processes WebSocket frames FIFO even when an event callback is asynchronous', async () => {
    const firstFrame = await makeCommitFrame({
      seq: 1,
      action: 'delete',
      path: `${COLLECTIONS.taskOffer}/task-1`,
    });
    const secondFrame = await makeCommitFrame({
      seq: 2,
      action: 'delete',
      path: `${COLLECTIONS.taskOffer}/task-2`,
    });
    let socket!: FixtureSocket;
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    let secondFinished!: () => void;
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstStartedPromise = new Promise<void>((resolve) => { firstStarted = resolve; });
    const secondFinishedPromise = new Promise<void>((resolve) => { secondFinished = resolve; });
    const seen: number[] = [];
    const source = new AtprotoSubscribeReposSource({
      endpoint: 'https://pds.example',
      snapshot: { async snapshotWithMetadata() { return snapshot([]); } },
      websocketFactory: () => {
        socket = new FixtureSocket();
        queueMicrotask(() => socket.emit('open'));
        return socket;
      },
    });
    const unsubscribe = await source.subscribe(undefined, async (event) => {
      seen.push(event.streamSeq!);
      if (event.streamSeq === 1) {
        firstStarted();
        await firstRelease;
      } else if (event.streamSeq === 2) {
        secondFinished();
      }
    });

    socket.emit('message', firstFrame);
    socket.emit('message', secondFrame);
    await firstStartedPromise;
    expect(seen).toEqual([1]);
    releaseFirst();
    await secondFinishedPromise;
    expect(seen).toEqual([1, 2]);
    await unsubscribe();
  });

  it('replays snapshot plus update/delete live events to the ordered rebuild hash', async () => {
    const initial = {
      $type: COLLECTIONS.taskOffer,
      taskId: 'task-1',
      title: 'Before live',
      description: 'A task',
      requiredCapabilities: ['typescript'],
      contextRefs: [],
      deliverables: ['patch'],
      requesterDid: did,
      governance: { mode: 'requester-selected' as const },
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const updated = { ...initial, title: 'After live' };
    const initialBlock = await makeRecordBlock(initial);
    const initialEnvelope = {
      uri: `at://${did}/${COLLECTIONS.taskOffer}/task-1`,
      did,
      collection: COLLECTIONS.taskOffer,
      rkey: 'task-1',
      cid: initialBlock.cid.toString(),
      record: initial,
    };
    const initialSnapshot = snapshot([initialEnvelope]);
    const updateFrame = await makeCommitFrame({
      seq: 101,
      action: 'update',
      path: `${COLLECTIONS.taskOffer}/task-1`,
      record: updated,
    });
    const deleteFrame = await makeCommitFrame({
      seq: 102,
      action: 'delete',
      path: `${COLLECTIONS.taskOffer}/task-1`,
    });

    let releaseSnapshot!: () => void;
    let snapshotStarted!: () => void;
    const snapshotReady = new Promise<void>((resolve) => { snapshotStarted = resolve; });
    const snapshotRelease = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
    let socket!: FixtureSocket;
    const source = new AtprotoSubscribeReposSource({
      endpoint: 'https://pds.example',
      snapshot: {
        async snapshotWithMetadata() {
          snapshotStarted();
          await snapshotRelease;
          return initialSnapshot;
        },
      },
      websocketFactory: () => {
        socket = new FixtureSocket();
        queueMicrotask(() => socket.emit('open'));
        return socket;
      },
    });
    const appView = new ProtocolAppView();
    const ingestor = new ProtocolIngestor(source, appView, new MemoryCursorStore());
    const start = ingestor.start();
    await snapshotStarted;
    socket.emit('message', updateFrame);
    socket.emit('message', deleteFrame);
    await new Promise((resolve) => setTimeout(resolve, 5));
    releaseSnapshot();
    await start;

    const expected = new ProtocolAppView();
    expected.rebuild(initialSnapshot.records, [
      eventFromCommit(101, 'update', 'task-1', updated, undefined),
      eventFromCommit(102, 'delete', 'task-1'),
    ]);
    expect(appView.projectionHash()).toBe(expected.projectionHash());
    expect(appView.listRecords()).toHaveLength(0);
    expect(ingestor.status().streamSeq).toBe(102);
  });

  it('recovers from a tooBig commit using a fresh snapshot boundary', async () => {
    const oldRecord = {
      $type: COLLECTIONS.taskOffer,
      taskId: 'task-1',
      title: 'Old',
      description: 'A task',
      requiredCapabilities: ['typescript'],
      contextRefs: [],
      deliverables: ['patch'],
      requesterDid: did,
      governance: { mode: 'requester-selected' as const },
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const newRecord = { ...oldRecord, title: 'Recovered' };
    const oldBlock = await makeRecordBlock(oldRecord);
    const newBlock = await makeRecordBlock(newRecord);
    const first = snapshot([{
      uri: `at://${did}/${COLLECTIONS.taskOffer}/task-1`,
      did,
      collection: COLLECTIONS.taskOffer,
      rkey: 'task-1',
      cid: oldBlock.cid.toString(),
      record: oldRecord,
    }]);
    const recovered = snapshot([{
      ...first.records[0]!,
      cid: newBlock.cid.toString(),
      record: newRecord,
    }], 200);
    const tooBigFrame = await makeCommitFrame({
      seq: 200,
      action: 'update',
      path: `${COLLECTIONS.taskOffer}/task-1`,
      tooBig: true,
    });
    let calls = 0;
    let releaseSnapshot!: () => void;
    let snapshotStarted!: () => void;
    const snapshotReady = new Promise<void>((resolve) => { snapshotStarted = resolve; });
    const snapshotRelease = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
    let socket!: FixtureSocket;
    const source = new AtprotoSubscribeReposSource({
      endpoint: 'https://pds.example',
      snapshot: {
        async snapshotWithMetadata() {
          calls++;
          if (calls === 1) {
            snapshotStarted();
            await snapshotRelease;
            return first;
          }
          return recovered;
        },
      },
      websocketFactory: () => {
        socket = new FixtureSocket();
        queueMicrotask(() => socket.emit('open'));
        return socket;
      },
    });
    const appView = new ProtocolAppView();
    const ingestor = new ProtocolIngestor(source, appView, new MemoryCursorStore());
    const start = ingestor.start();
    await snapshotReady;
    socket.emit('message', tooBigFrame);
    await new Promise((resolve) => setTimeout(resolve, 5));
    releaseSnapshot();
    await start;

    expect(appView.listRecords()[0]?.record).toEqual(newRecord);
    expect(ingestor.status()).toMatchObject({
      phase: 'live',
      streamSeq: 200,
      recoveryRequired: false,
    });
    expect(ingestor.status().diagnostics.some(({ kind }) => kind === 'recovery')).toBe(true);
  });
});
