import type { ProtocolAppView, ProtocolCommitEvent } from './appview.js';
import type { DuckDBConnection } from '../storage/duckdb.js';
import { execute, queryAll } from '../storage/duckdb.js';
import type { ProtocolRepoSnapshot } from '../atproto/repo-snapshot.js';

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
  snapshot(): Promise<ProtocolRepoSnapshot | ReadonlyArray<import('./types.js').ProtocolRecordEnvelope>>;
  subscribe(
    streamSeq: number | undefined,
    onEvent: (event: ProtocolCommitEvent) => void | Promise<void>,
    onDiagnostic?: (diagnostic: IngestionDiagnostic) => void,
  ): Promise<() => Promise<void>>;
  recover?(reason: string): Promise<ProtocolRepoSnapshot>;
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
    this.streamSeq = normaliseCursor(await this.cursors.load());

    this.unsubscribe = await this.source.subscribe(
      this.streamSeq,
      (event) => {
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
            this.liveEventChain = this.liveEventChain.then(() =>
              this.recover('live tooBig or rebase event'));
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
            this.liveEventChain = this.liveEventChain.then(() =>
              this.recover('live firehose gap'));
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
            this.acceptingLiveEvents = false;
            this.statusValue = {
              ...this.statusValue,
              phase: 'stopped',
              lastError: error instanceof Error ? error.message : String(error),
            };
          });
        return this.liveEventChain;
      },
      (diagnostic) => this.recordDiagnostic(diagnostic),
    );

    try {
      await this.applySnapshot(await this.source.snapshot());
      this.statusValue = {
        ...this.statusValue,
        phase: 'replaying',
        bufferedEvents: this.bufferedEvents.length,
      };
      this.handoffInProgress = true;
      while (this.bufferedEvents.length > 0) await this.replayBuffered();
      if (this.statusValue.recoveryRequired) {
        await this.recover('buffered gap or tooBig event');
      }
      this.acceptingLiveEvents = true;
      this.handoffInProgress = false;
      this.statusValue = {
        ...this.statusValue,
        phase: 'live',
        bufferedEvents: 0,
        streamSeq: this.streamSeq,
        recoveryRequired: false,
      };
    } catch (error) {
      this.acceptingLiveEvents = false;
      this.handoffInProgress = false;
      this.statusValue = {
        ...this.statusValue,
        phase: 'stopped',
        bufferedEvents: this.bufferedEvents.length,
        streamSeq: this.streamSeq,
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
      streamSeq: this.streamSeq,
    };
  }

  private async applySnapshot(
    snapshot: ProtocolRepoSnapshot | ReadonlyArray<import('./types.js').ProtocolRecordEnvelope>,
  ): Promise<void> {
    this.appView.reset();
    if (isRecordArray(snapshot)) {
      this.appView.ingestSnapshot(snapshot);
      return;
    }
    this.appView.ingestSnapshot(snapshot.records, snapshot.streamSeq);
    if (snapshot.streamSeq !== undefined) {
      this.streamSeq = snapshot.streamSeq;
      await this.cursors.save(snapshot.streamSeq);
    }
  }

  private async replayBuffered(): Promise<void> {
    const events = this.bufferedEvents.splice(0).map((event, index) => ({ event, index }));
    events.sort((a, b) =>
      (a.event.streamSeq ?? a.event.seq ?? 0) - (b.event.streamSeq ?? b.event.seq ?? 0) ||
      a.index - b.index);
    for (const { event } of events) {
      const eventSeq = event.streamSeq ?? event.seq;
      if (event.tooBig) {
        this.statusValue = { ...this.statusValue, recoveryRequired: true };
        continue;
      }
      if (eventSeq !== undefined && this.streamSeq !== undefined && eventSeq < this.streamSeq) {
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
    this.appView.ingest(event);
    if (eventSeq !== undefined && (this.streamSeq === undefined || eventSeq > this.streamSeq)) {
      this.streamSeq = eventSeq;
      await this.cursors.save(eventSeq);
    }
    this.statusValue = { ...this.statusValue, streamSeq: this.streamSeq };
  }

  private async recover(reason: string): Promise<void> {
    this.handoffInProgress = true;
    this.statusValue = {
      ...this.statusValue,
      phase: 'snapshot',
      recoveryRequired: true,
    };
    const snapshot = this.source.recover
      ? await this.source.recover(reason)
      : await this.source.snapshot();
    if (!isProtocolRepoSnapshot(snapshot) || snapshot.streamSeq === undefined) {
      throw new Error('snapshot recovery requires an authoritative streamSeq boundary');
    }
    await this.applySnapshot(snapshot);
    await this.replayBuffered();
    this.statusValue = {
      ...this.statusValue,
      phase: 'replaying',
      bufferedEvents: this.bufferedEvents.length,
      recoveryRequired: false,
    };
    if (this.acceptingLiveEvents) this.handoffInProgress = false;
  }

  private recordDiagnostic(diagnostic: IngestionDiagnostic): void {
    this.diagnosticsValue.push(diagnostic);
    this.statusValue = {
      ...this.statusValue,
      diagnostics: this.diagnosticsValue,
    };
  }
}

export class MemoryCursorStore implements CursorStore {
  private value: number | undefined;

  async load(): Promise<number | undefined> {
    return this.value;
  }

  async save(streamSeq: number): Promise<void> {
    this.value = streamSeq;
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
    await execute(
      this.conn,
      `INSERT OR REPLACE INTO protocol_stream_cursors (name, stream_seq) VALUES ('subscribeRepos', $1)`,
      [streamSeq],
    );
  }
}

function normaliseCursor(
  cursor: number | Readonly<Record<string, number>> | undefined,
): number | undefined {
  if (typeof cursor === 'number') return cursor;
  if (cursor === undefined) return undefined;
  const values = Object.values(cursor);
  return values.length > 0 ? Math.max(...values) : undefined;
}

function isRecordArray(
  value: ProtocolRepoSnapshot | ReadonlyArray<import('./types.js').ProtocolRecordEnvelope>,
): value is ReadonlyArray<import('./types.js').ProtocolRecordEnvelope> {
  return Array.isArray(value);
}

function isProtocolRepoSnapshot(
  value: ProtocolRepoSnapshot | ReadonlyArray<import('./types.js').ProtocolRecordEnvelope>,
): value is ProtocolRepoSnapshot {
  return !Array.isArray(value);
}
