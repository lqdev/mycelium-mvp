import type { ProtocolAppView, ProtocolCommitEvent } from './appview.js';
import type { DuckDBConnection } from '../storage/duckdb.js';
import { execute, queryAll } from '../storage/duckdb.js';
import type {
  AuthoritativeRecoveryProvider,
  AuthoritativeRecoverySnapshot,
  AuthoritativeStreamBoundary,
  ProtocolRepoSnapshot,
} from '../atproto/repo-snapshot.js';
import type { ProtocolRecordEnvelope } from './types.js';

export interface CursorStore {
  load(): Promise<number | Readonly<Record<string, number>> | undefined>;
  save(streamSeq: number): Promise<void>;
}

export interface IngestionDiagnostic {
  kind: 'frame' | 'gap' | 'recovery';
  frameType?: string | undefined;
  streamSeq?: number | undefined;
  message: string;
}

export interface PdsEventSource {
  snapshot(): Promise<ProtocolRepoSnapshot | ReadonlyArray<ProtocolRecordEnvelope>>;
  subscribe(
    streamSeq: number | undefined,
    onEvent: (event: ProtocolCommitEvent) => void | Promise<void>,
    onDiagnostic?: (diagnostic: IngestionDiagnostic) => void,
  ): Promise<() => Promise<void>>;
  authoritativeRecovery?: AuthoritativeRecoveryProvider | undefined;
}

export interface IngestionStatus {
  phase: 'stopped' | 'snapshot' | 'replaying' | 'live';
  bufferedEvents: number;
  streamSeq?: number | undefined;
  recoveryRequired: boolean;
  diagnostics: ReadonlyArray<IngestionDiagnostic>;
  lastError?: string | undefined;
}

export class ProtocolIngestor {
  private statusValue: IngestionStatus = {
    phase: 'stopped',
    bufferedEvents: 0,
    recoveryRequired: false,
    diagnostics: [],
  };
  private readonly bufferedEvents: ProtocolCommitEvent[] = [];
  private readonly diagnosticsValue: IngestionDiagnostic[] = [];
  private unsubscribe: (() => Promise<void>) | undefined;
  private acceptingLiveEvents = false;
  private handoffInProgress = false;
  private liveEventChain: Promise<void> = Promise.resolve();
  private streamSeq: number | undefined;
  private connectionError: Error | undefined;
  private snapshotBoundary: number | undefined;

  constructor(
    private readonly source: PdsEventSource,
    private readonly appView: ProtocolAppView,
    private readonly cursors: CursorStore,
  ) {}

  status(): IngestionStatus {
    return { ...this.statusValue };
  }

  async start(): Promise<void> {
    if (this.statusValue.phase !== 'stopped') return;
    this.statusValue = {
      phase: 'snapshot',
      bufferedEvents: 0,
      recoveryRequired: false,
      diagnostics: this.diagnosticsValue,
    };
    this.connectionError = undefined;
    try {
      this.streamSeq = normaliseCursor(await this.cursors.load());
      this.unsubscribe = await this.source.subscribe(
        this.streamSeq,
        (event) => {
        if (this.statusValue.phase === 'stopped') return;
        const eventSeq = event.streamSeq ?? event.seq;
        if (event.tooBig) {
          this.bufferedEvents.push(event);
          this.recordDiagnostic({
            kind: 'recovery',
            streamSeq: eventSeq,
            message: 'subscribeRepos reported tooBig; snapshot recovery required',
          });
          this.statusValue = {
            ...this.statusValue,
            bufferedEvents: this.bufferedEvents.length,
            recoveryRequired: true,
          };
          if (this.acceptingLiveEvents && !this.handoffInProgress) {
            this.enqueueRecovery('live tooBig or rebase event');
            return this.liveEventChain;
          }
          return;
        }
        if (eventSeq !== undefined && this.streamSeq !== undefined &&
          eventSeq > this.streamSeq + 1) {
          this.bufferedEvents.push(event);
          this.recordDiagnostic({
            kind: 'gap',
            streamSeq: eventSeq,
            message: `firehose gap detected: expected ${this.streamSeq + 1}, received ${eventSeq}`,
          });
          this.statusValue = {
            ...this.statusValue,
            bufferedEvents: this.bufferedEvents.length,
            recoveryRequired: true,
          };
          if (this.acceptingLiveEvents && !this.handoffInProgress) {
            this.enqueueRecovery('live firehose gap');
            return this.liveEventChain;
          }
          return;
        }
        if (!this.acceptingLiveEvents || this.handoffInProgress) {
          this.bufferedEvents.push(event);
          this.statusValue = {
            ...this.statusValue,
            bufferedEvents: this.bufferedEvents.length,
          };
          return;
        }
        this.liveEventChain = this.liveEventChain
          .then(async () => {
            await this.ingestLiveEvent(event);
            if (this.statusValue.recoveryRequired) await this.recover('live gap or tooBig event');
          })
          .catch((error: unknown) => {
            return this.handleLiveChainError(error);
          });
        return this.liveEventChain;
        },
        (diagnostic) => {
          this.recordDiagnostic(diagnostic);
          if (diagnostic.frameType === '#connection') {
            this.connectionError = new Error(diagnostic.message);
            this.acceptingLiveEvents = false;
            this.handoffInProgress = false;
            this.statusValue = {
              ...this.statusValue,
              phase: 'stopped',
              lastError: diagnostic.message,
            };
          }
        },
      );
      if (this.connectionError) throw this.connectionError;
      await this.applySnapshot(await this.source.snapshot());
      if (this.connectionError) throw this.connectionError;
      this.statusValue = {
        ...this.statusValue,
        phase: 'replaying',
        bufferedEvents: this.bufferedEvents.length,
      };
      this.handoffInProgress = true;
      while (this.bufferedEvents.length > 0 && !this.statusValue.recoveryRequired) {
        await this.replayBuffered();
      }
      if (this.statusValue.recoveryRequired) {
        await this.recover('buffered gap or tooBig event');
      }
      if (this.connectionError) throw this.connectionError;
      this.acceptingLiveEvents = true;
      this.handoffInProgress = false;
      this.statusValue = {
        ...this.statusValue,
        phase: 'live',
        bufferedEvents: 0,
        ...(this.streamSeq === undefined ? {} : { streamSeq: this.streamSeq }),
        recoveryRequired: false,
      };
    } catch (error) {
      this.acceptingLiveEvents = false;
      this.handoffInProgress = false;
      this.statusValue = {
        ...this.statusValue,
        phase: 'stopped',
        bufferedEvents: this.bufferedEvents.length,
        ...(this.streamSeq === undefined ? {} : { streamSeq: this.streamSeq }),
        lastError: error instanceof Error ? error.message : String(error),
      };
      if (this.unsubscribe) await this.unsubscribe();
      this.unsubscribe = undefined;
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.acceptingLiveEvents = false;
    this.handoffInProgress = false;
    if (this.unsubscribe) await this.unsubscribe();
    await this.liveEventChain;
    this.unsubscribe = undefined;
    this.statusValue = {
      ...this.statusValue,
      phase: 'stopped',
      bufferedEvents: this.bufferedEvents.length,
      ...(this.streamSeq === undefined ? {} : { streamSeq: this.streamSeq }),
    };
  }

  private async applySnapshot(
    snapshot: ProtocolRepoSnapshot | ReadonlyArray<ProtocolRecordEnvelope>,
    boundary?: AuthoritativeStreamBoundary,
  ): Promise<void> {
    if (isRecordArray(snapshot)) {
      if (boundary !== undefined) {
        throw new Error('authoritative recovery boundary must accompany a repository snapshot');
      }
      this.appView.reset();
      this.snapshotBoundary = undefined;
      this.appView.ingestSnapshot(snapshot);
      return;
    }
    if (!isProtocolRepoSnapshot(snapshot)) {
      throw new Error('repository snapshot is malformed');
    }
    this.appView.reset();
    this.snapshotBoundary = boundary?.streamSeq;
    this.appView.ingestSnapshot(snapshot.records, {
      did: snapshot.did,
      repoRev: snapshot.repoRev,
      ...(boundary === undefined ? {} : { streamSeq: boundary.streamSeq }),
    });
    if (boundary !== undefined) {
      this.streamSeq = boundary.streamSeq;
      await this.cursors.save(boundary.streamSeq);
    }
  }

  private async replayBuffered(): Promise<void> {
    const events = this.bufferedEvents.splice(0).map((event, index) => ({ event, index }));
    events.sort((a, b) =>
      (a.event.streamSeq ?? a.event.seq ?? 0) - (b.event.streamSeq ?? b.event.seq ?? 0) ||
      a.index - b.index);
    for (const [eventIndex, { event }] of events.entries()) {
      const eventSeq = event.streamSeq ?? event.seq;
      const boundary = this.snapshotBoundary;
      if (event.tooBig && eventSeq !== undefined && boundary !== undefined && eventSeq <= boundary) {
        continue;
      }
      if (eventSeq !== undefined && boundary !== undefined && eventSeq < boundary) {
        continue;
      }
      if (eventSeq !== undefined && boundary === undefined &&
        this.streamSeq !== undefined && eventSeq < this.streamSeq) {
        continue;
      }
      if (eventSeq !== undefined && this.streamSeq !== undefined &&
        eventSeq > this.streamSeq + 1) {
        this.bufferedEvents.unshift(
          ...events.slice(eventIndex).map(({ event: pending }) => pending),
        );
        this.statusValue = {
          ...this.statusValue,
          bufferedEvents: this.bufferedEvents.length,
          recoveryRequired: true,
        };
        return;
      }
      if (event.tooBig) {
        this.statusValue = { ...this.statusValue, recoveryRequired: true };
        continue;
      }
      await this.ingestLiveEvent(event);
    }
  }

  private async ingestLiveEvent(event: ProtocolCommitEvent): Promise<void> {
    const eventSeq = event.streamSeq ?? event.seq;
    if (eventSeq !== undefined && this.streamSeq !== undefined && eventSeq < this.streamSeq) {
      return;
    }
    const applied = this.appView.ingest(event);
    if (applied && eventSeq !== undefined &&
      (this.streamSeq === undefined || eventSeq > this.streamSeq)) {
      this.streamSeq = eventSeq;
      await this.cursors.save(eventSeq);
    }
    this.statusValue = {
      ...this.statusValue,
      ...(this.streamSeq === undefined ? {} : { streamSeq: this.streamSeq }),
    };
  }

  private async recover(reason: string): Promise<void> {
    this.handoffInProgress = true;
    this.statusValue = {
      ...this.statusValue,
      phase: 'snapshot',
      recoveryRequired: true,
    };
    const provider = this.source.authoritativeRecovery;
    if (provider === undefined) {
      const error = new Error(
        'snapshot recovery requires an authoritative recovery provider; getRepo has no authoritative streamSeq boundary',
      );
      this.recordDiagnostic({ kind: 'recovery', message: error.message });
      throw error;
    }
    let lastBoundary: number | undefined;
    while (true) {
      const recovery = await provider.recover(reason);
      const validated = await this.requireAuthoritativeRecoverySnapshot(recovery, provider);
      if (lastBoundary !== undefined && validated.boundary.streamSeq === lastBoundary) {
        const error = new Error(
          `authoritative recovery boundary did not advance beyond ${lastBoundary}`,
        );
        this.recordDiagnostic({ kind: 'recovery', streamSeq: lastBoundary, message: error.message });
        throw error;
      }
      lastBoundary = validated.boundary.streamSeq;
      await this.applySnapshot(validated.snapshot, validated.boundary);
      this.statusValue = {
        ...this.statusValue,
        recoveryRequired: false,
      };
      await this.replayBuffered();
      if (!this.statusValue.recoveryRequired && this.bufferedEvents.length === 0) break;
      if (!this.statusValue.recoveryRequired) continue;
      reason = `${reason}; another gap or tooBig event`;
    }
    this.statusValue = {
      ...this.statusValue,
      phase: this.acceptingLiveEvents ? 'live' : 'replaying',
      bufferedEvents: this.bufferedEvents.length,
      ...(this.streamSeq === undefined ? {} : { streamSeq: this.streamSeq }),
      recoveryRequired: false,
    };
    if (this.acceptingLiveEvents) this.handoffInProgress = false;
  }

  private enqueueRecovery(reason: string): void {
    this.liveEventChain = this.liveEventChain
      .then(() => this.recover(reason))
      .catch((error: unknown) => {
        return this.handleLiveChainError(error);
      });
  }

  private async handleLiveChainError(error: unknown): Promise<void> {
    this.acceptingLiveEvents = false;
    this.handoffInProgress = false;
    this.statusValue = {
      ...this.statusValue,
      phase: 'stopped',
      lastError: error instanceof Error ? error.message : String(error),
    };
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    if (unsubscribe === undefined) return;
    try {
      await unsubscribe();
    } catch (cleanupError) {
      this.recordDiagnostic({
        kind: 'recovery',
        message: `subscription cleanup failed: ${
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        }`,
      });
    }
  }

  private recordDiagnostic(diagnostic: IngestionDiagnostic): void {
    this.diagnosticsValue.push(diagnostic);
    this.statusValue = {
      ...this.statusValue,
      diagnostics: this.diagnosticsValue,
    };
  }

  private async requireAuthoritativeRecoverySnapshot(
    recovery: unknown,
    provider: AuthoritativeRecoveryProvider,
  ): Promise<AuthoritativeRecoverySnapshot> {
    if (!isAuthoritativeRecoverySnapshot(recovery)) {
      const message = 'snapshot recovery requires a snapshot plus an authoritative streamSeq boundary';
      this.recordDiagnostic({ kind: 'recovery', message });
      throw new Error(message);
    }
    const { snapshot, boundary } = recovery;
    if (!isProtocolRepoSnapshot(snapshot) ||
      !Number.isSafeInteger(boundary.streamSeq) ||
      boundary.streamSeq < 0 ||
      boundary.repoDid !== snapshot.did ||
      boundary.repoRev !== snapshot.repoRev ||
      boundary.proof.trim().length === 0) {
      const message = 'snapshot recovery boundary is malformed or does not match repoRev';
      this.recordDiagnostic({ kind: 'recovery', message });
      throw new Error(message);
    }
    if (this.streamSeq !== undefined && boundary.streamSeq < this.streamSeq) {
      const message = `snapshot streamSeq ${boundary.streamSeq} is behind current streamSeq ${this.streamSeq}`;
      this.recordDiagnostic({ kind: 'recovery', streamSeq: boundary.streamSeq, message });
      throw new Error(message);
    }
    if ((await provider.verifyBoundary(recovery)) !== true) {
      const message = 'snapshot recovery boundary failed provider verification';
      this.recordDiagnostic({ kind: 'recovery', streamSeq: boundary.streamSeq, message });
      throw new Error(message);
    }
    return recovery;
  }
}

export class MemoryCursorStore implements CursorStore {
  private value: number | undefined;

  async load(): Promise<number | undefined> {
    return this.value;
  }

  async save(streamSeq: number): Promise<void> {
    const next = validCursor(streamSeq);
    if (this.value === undefined || next > this.value) this.value = next;
  }
}

export class DuckDbCursorStore implements CursorStore {
  constructor(private readonly conn: DuckDBConnection) {}

  async load(): Promise<number | undefined> {
    const rows = await queryAll<{ stream_seq: number }>(
      this.conn,
      "SELECT stream_seq FROM protocol_stream_cursors WHERE name = 'subscribeRepos'",
    );
    return rows.length > 0 ? Number(rows[0]!.stream_seq) : undefined;
  }

  async save(streamSeq: number): Promise<void> {
    const next = validCursor(streamSeq);
    await execute(
      this.conn,
      `INSERT INTO protocol_stream_cursors (name, stream_seq)
       VALUES ('subscribeRepos', $1)
       ON CONFLICT (name) DO UPDATE SET
         stream_seq = GREATEST(protocol_stream_cursors.stream_seq, EXCLUDED.stream_seq)`,
      [next],
    );
  }
}

function normaliseCursor(
  cursor: number | Readonly<Record<string, number>> | undefined,
): number | undefined {
  if (typeof cursor === 'number') return validCursor(cursor);
  if (cursor === undefined) return undefined;
  const values = Object.values(cursor);
  if (values.length === 0) return undefined;
  return Math.max(...values.map((value) => validCursor(value)));
}

function isRecordArray(
  value: unknown,
): value is ReadonlyArray<ProtocolRecordEnvelope> {
  return Array.isArray(value) && value.every(isRecordEnvelope);
}

function isProtocolRepoSnapshot(
  value: unknown,
): value is ProtocolRepoSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return !('streamSeq' in candidate) &&
    typeof candidate.did === 'string' && candidate.did.length > 0 &&
    typeof candidate.repoRev === 'string' && candidate.repoRev.length > 0 &&
    typeof candidate.rootCid === 'string' && candidate.rootCid.length > 0 &&
    Array.isArray(candidate.records) && candidate.records.every(isRecordEnvelope) &&
    Array.isArray(candidate.quarantined) && candidate.quarantined.every(isQuarantineEntry);
}

function isRecordEnvelope(value: unknown): value is ProtocolRecordEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.uri !== 'string' || candidate.uri.length === 0 ||
    typeof candidate.did !== 'string' || candidate.did.length === 0 ||
    typeof candidate.collection !== 'string' || candidate.collection.length === 0 ||
    typeof candidate.rkey !== 'string' || candidate.rkey.length === 0 ||
    typeof candidate.cid !== 'string' || candidate.cid.length === 0 ||
    typeof candidate.record !== 'object' || candidate.record === null ||
    Array.isArray(candidate.record)) {
    return false;
  }
  return candidate.uri === `at://${candidate.did}/${candidate.collection}/${candidate.rkey}`;
}

function isQuarantineEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.collection === 'string' && candidate.collection.length > 0 &&
    typeof candidate.rkey === 'string' && candidate.rkey.length > 0 &&
    typeof candidate.cid === 'string' && candidate.cid.length > 0 &&
    typeof candidate.reason === 'string' && candidate.reason.length > 0;
}

function isAuthoritativeRecoverySnapshot(
  value: unknown,
): value is AuthoritativeRecoverySnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!('snapshot' in candidate) || !('boundary' in candidate)) return false;
  const boundary = candidate.boundary;
  if (typeof boundary !== 'object' || boundary === null || Array.isArray(boundary)) {
    return false;
  }
  const candidateBoundary = boundary as Record<string, unknown>;
  return typeof candidateBoundary.streamSeq === 'number' &&
    typeof candidateBoundary.repoDid === 'string' &&
    typeof candidateBoundary.repoRev === 'string' &&
    typeof candidateBoundary.proof === 'string';
}

function validCursor(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('cursor must be a non-negative safe integer');
  }
  return value;
}
