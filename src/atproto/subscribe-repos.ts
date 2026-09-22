import { decode as decodeCbor, decodeAll } from '@atproto/lex-cbor';
import { readCar } from '@atproto/repo';
import type { ProtocolCommitEvent } from '../protocol/appview.js';
import type {
  IngestionDiagnostic,
  PdsEventSource,
} from '../protocol/ingestion.js';
import type { ProtocolRepoSnapshot, AtprotoRepoSnapshotAdapter } from './repo-snapshot.js';

export interface SubscribeReposSocket {
  readonly readyState?: number;
  addEventListener(type: string, listener: (event: SubscribeReposSocketEvent) => void): void;
  close(): void;
}

export interface SubscribeReposSocketEvent {
  data?: unknown;
  code?: number;
  reason?: string;
}

export interface SubscribeReposSourceOptions {
  endpoint: string;
  snapshot: Pick<AtprotoRepoSnapshotAdapter, 'snapshotWithMetadata'>;
  websocketFactory?: (url: string) => SubscribeReposSocket;
}

export interface SubscribeReposOperation {
  action: 'create' | 'update' | 'delete';
  collection: string;
  rkey: string;
  cid?: string;
  record?: unknown;
}

export interface SubscribeReposCommit {
  streamSeq: number;
  repo: string;
  commitCid: string;
  repoRev: string;
  since: string | null;
  tooBig: boolean;
  rebase: boolean;
  operations: ReadonlyArray<SubscribeReposOperation>;
}

export type SubscribeReposFrame =
  | { kind: 'commit'; commit: SubscribeReposCommit }
  | { kind: 'diagnostic'; diagnostic: IngestionDiagnostic };

interface SubscribeReposHeader {
  op: number;
  t: string;
}

/**
 * Decode the official subscribeRepos frame: concatenated header and body CBOR
 * objects, not a JSON or array envelope.
 * Commit blocks are an official CAR byte string, not JSON record payloads.
 */
export async function decodeSubscribeReposFrame(raw: Uint8Array): Promise<SubscribeReposFrame> {
  const values = [...decodeAll(raw)] as unknown[];
  if (values.length !== 2) {
    return diagnostic('unknown', 'subscribeRepos frame must contain concatenated header and body CBOR objects');
  }

  const header = values[0];
  if (!isHeader(header)) {
    return diagnostic('unknown', 'subscribeRepos frame header is invalid');
  }
  const body = values[1];
  if (header.op !== 1 || header.t !== '#commit') {
    return diagnostic(header.t, `ignored subscribeRepos frame ${header.t}`);
  }

  return { kind: 'commit', commit: await decodeCommit(body) };
}

export class AtprotoSubscribeReposSource implements PdsEventSource {
  private readonly endpoint: string;
  private readonly snapshotAdapter: Pick<AtprotoRepoSnapshotAdapter, 'snapshotWithMetadata'>;
  private readonly websocketFactory: (url: string) => SubscribeReposSocket;
  private lastObservedStreamSeq: number | undefined;

  constructor(options: SubscribeReposSourceOptions) {
    this.endpoint = toSubscribeReposEndpoint(options.endpoint);
    this.snapshotAdapter = options.snapshot;
    this.websocketFactory = options.websocketFactory ?? ((url) => new WebSocket(url));
  }

  async snapshot(): Promise<ProtocolRepoSnapshot> {
    const boundary = this.lastObservedStreamSeq;
    const snapshot = await this.snapshotAdapter.snapshotWithMetadata();
    return boundary === undefined
      ? snapshot
      : { ...snapshot, streamSeq: boundary };
  }

  async recover(): Promise<ProtocolRepoSnapshot> {
    return this.snapshot();
  }

  async subscribe(
    streamSeq: number | undefined,
    onEvent: (event: ProtocolCommitEvent) => void | Promise<void>,
    onDiagnostic?: (diagnostic: IngestionDiagnostic) => void,
  ): Promise<() => Promise<void>> {
    const url = new URL(this.endpoint);
    if (streamSeq !== undefined) url.searchParams.set('cursor', String(streamSeq));
    const socket = this.websocketFactory(url.toString());
    let settled = false;
    let resolveOpen!: () => void;
    let rejectOpen!: (error: Error) => void;
    const opened = new Promise<void>((resolve, reject) => {
      resolveOpen = resolve;
      rejectOpen = reject;
    });

    socket.addEventListener('open', () => {
      if (!settled) {
        settled = true;
        resolveOpen();
      }
    });
    socket.addEventListener('error', (event) => {
      if (!settled) {
        settled = true;
        rejectOpen(new Error(`subscribeRepos WebSocket error: ${event.reason ?? 'unknown error'}`));
      }
    });
    socket.addEventListener('close', (event) => {
      if (!settled) {
        settled = true;
        rejectOpen(new Error(`subscribeRepos WebSocket closed (${event.code ?? 1000})`));
      }
    });
    socket.addEventListener('message', (event) => {
      void this.handleMessage(event.data, onEvent, onDiagnostic);
    });

    if (socket.readyState === 1) resolveOpen();
    await opened;
    return async () => socket.close();
  }

  private async handleMessage(
    raw: unknown,
    onEvent: (event: ProtocolCommitEvent) => void | Promise<void>,
    onDiagnostic?: (diagnostic: IngestionDiagnostic) => void,
  ): Promise<void> {
    try {
      const frame = await decodeSubscribeReposFrame(await asBytes(raw));
      if (frame.kind === 'diagnostic') {
        onDiagnostic?.(frame.diagnostic);
        return;
      }
      const commit = frame.commit;
      this.lastObservedStreamSeq = Math.max(this.lastObservedStreamSeq ?? 0, commit.streamSeq);
      if (commit.tooBig || commit.rebase) {
        onDiagnostic?.({
          kind: 'recovery',
          frameType: '#commit',
          streamSeq: commit.streamSeq,
          message: commit.tooBig
            ? 'subscribeRepos commit tooBig=true'
            : 'subscribeRepos commit rebase=true',
        });
        await onEvent({
          streamSeq: commit.streamSeq,
          did: commit.repo,
          collection: '',
          rkey: '',
          operation: 'create',
          commitCid: commit.commitCid,
          repoRev: commit.repoRev,
          since: commit.since,
          tooBig: true,
          rebase: commit.rebase,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (commit.operations.length === 0) {
        await onEvent({
          streamSeq: commit.streamSeq,
          did: commit.repo,
          collection: '',
          rkey: '',
          operation: 'create',
          commitCid: commit.commitCid,
          repoRev: commit.repoRev,
          since: commit.since,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      for (const operation of commit.operations) {
        const event: ProtocolCommitEvent = {
          streamSeq: commit.streamSeq,
          did: commit.repo,
          collection: operation.collection,
          rkey: operation.rkey,
          operation: operation.action,
          commitCid: commit.commitCid,
          repoRev: commit.repoRev,
          since: commit.since,
          timestamp: new Date().toISOString(),
        };
        if (operation.cid !== undefined) event.cid = operation.cid;
        if (operation.record !== undefined) event.record = operation.record;
        await onEvent(event);
      }
    } catch (error) {
      onDiagnostic?.({
        kind: 'frame',
        frameType: 'unknown',
        message: `subscribeRepos frame decode failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}

async function decodeCommit(value: unknown): Promise<SubscribeReposCommit> {
  if (!isObject(value)) throw new Error('subscribeRepos #commit body is not an object');
  const streamSeq = safeInteger(value.seq, 'seq');
  const repo = requiredString(value.repo, 'repo');
  const commitCid = cidString(value.commit, 'commit');
  const repoRev = requiredString(value.rev, 'rev');
  const since = value.since === null ? null : requiredString(value.since, 'since');
  const tooBig = requiredBoolean(value.tooBig, 'tooBig');
  const rebase = requiredBoolean(value.rebase, 'rebase');
  const blocks = value.blocks;
  const rawOps = value.ops;
  if (!(blocks instanceof Uint8Array)) throw new Error('subscribeRepos #commit blocks is not bytes');
  if (!Array.isArray(rawOps)) throw new Error('subscribeRepos #commit ops is not an array');

  if (tooBig || rebase) {
    return { streamSeq, repo, commitCid, repoRev, since, tooBig, rebase, operations: [] };
  }

  const car = await readCar(blocks);
  const operations: SubscribeReposOperation[] = [];
  for (const rawOp of rawOps) {
    if (!isObject(rawOp)) throw new Error('subscribeRepos repo operation is not an object');
    const action = rawOp.action;
    if (action !== 'create' && action !== 'update' && action !== 'delete') {
      throw new Error(`unsupported subscribeRepos operation "${String(action)}"`);
    }
    const [collection, rkey] = parsePath(requiredString(rawOp.path, 'path'));
    const rawCid = rawOp.cid;
    if (action === 'delete') {
      if (rawCid !== null && rawCid !== undefined) {
        throw new Error('delete operation must have a null cid');
      }
      operations.push({ action, collection, rkey });
      continue;
    }
    const cid = cidString(rawCid, 'cid');
    const block = car.blocks.entries().find((entry) => entry.cid.toString() === cid);
    if (block === undefined) throw new Error(`missing CAR block for ${cid}`);
    operations.push({ action, collection, rkey, cid, record: decodeCbor(block.bytes) });
  }

  return { streamSeq, repo, commitCid, repoRev, since, tooBig, rebase, operations };
}

function parsePath(path: string): [string, string] {
  const separator = path.indexOf('/');
  if (separator <= 0 || separator === path.length - 1 || path.indexOf('/', separator + 1) >= 0) {
    throw new Error(`invalid subscribeRepos record path "${path}"`);
  }
  return [path.slice(0, separator), path.slice(separator + 1)];
}

function toSubscribeReposEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`unsupported subscribeRepos endpoint protocol "${url.protocol}"`);
  }
  if (!url.pathname.endsWith('/xrpc/com.atproto.sync.subscribeRepos')) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/xrpc/com.atproto.sync.subscribeRepos`;
  }
  return url.toString();
}

async function asBytes(raw: unknown): Promise<Uint8Array> {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (typeof Blob !== 'undefined' && raw instanceof Blob) return new Uint8Array(await raw.arrayBuffer());
  throw new Error('subscribeRepos WebSocket message is not binary CBOR');
}

function diagnostic(frameType: string, message: string): SubscribeReposFrame {
  return { kind: 'diagnostic', diagnostic: { kind: 'frame', frameType, message } };
}

function isHeader(value: unknown): value is SubscribeReposHeader {
  return isObject(value) && typeof value.op === 'number' && typeof value.t === 'string';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid ${field}`);
  return value;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`invalid ${field}`);
  return value;
}

function safeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid ${field}`);
  }
  return value;
}

function cidString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (isObject(value) && typeof value.toString === 'function') {
    const result = value.toString();
    if (result && result !== '[object Object]') return result;
  }
  throw new Error(`invalid ${field} CID`);
}
