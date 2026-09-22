import type { ProtocolAppView, ProtocolCommitEvent } from './appview.js';
import type { ProtocolRecordEnvelope } from './types.js';
import type { DuckDBConnection } from '../storage/duckdb.js';
import { execute, queryAll } from '../storage/duckdb.js';

export interface CursorStore {
  load(): Promise<Readonly<Record<string, number>>>;
  save(cursors: Readonly<Record<string, number>>): Promise<void>;
}

export interface PdsEventSource {
  snapshot(): Promise<ReadonlyArray<ProtocolRecordEnvelope>>;
  subscribe(
    cursors: Readonly<Record<string, number>>,
    onEvent: (event: ProtocolCommitEvent) => void | Promise<void>,
  ): Promise<() => Promise<void>>;
}

export interface IngestionStatus {
  phase: 'stopped' | 'snapshot' | 'replaying' | 'live';
  bufferedEvents: number;
  lastError?: string;
}

export class ProtocolIngestor {
  private statusValue: IngestionStatus = {
    phase: 'stopped',
    bufferedEvents: 0,
  };
  private readonly bufferedEvents: ProtocolCommitEvent[] = [];
  private unsubscribe: (() => Promise<void>) | undefined;
  private acceptingLiveEvents = false;
  private handoffInProgress = false;
  private liveEventChain: Promise<void> = Promise.resolve();

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
    this.statusValue = { phase: 'snapshot', bufferedEvents: 0 };
    const savedCursors = await this.cursors.load();

    this.unsubscribe = await this.source.subscribe(savedCursors, (event) => {
      if (!this.acceptingLiveEvents || this.handoffInProgress) {
        this.bufferedEvents.push(event);
        this.statusValue = {
          ...this.statusValue,
          bufferedEvents: this.bufferedEvents.length,
        };
        return;
      }
      this.liveEventChain = this.liveEventChain.then(async () => {
        this.appView.ingest(event);
        await this.cursors.save(this.appView.health().cursors);
      });
      return this.liveEventChain;
    });

    try {
      const snapshot = await this.source.snapshot();
      this.appView.reset();
      this.appView.ingestSnapshot(snapshot);
      this.statusValue = { phase: 'replaying', bufferedEvents: this.bufferedEvents.length };
      this.handoffInProgress = true;
      while (this.bufferedEvents.length > 0) {
        const events = this.bufferedEvents.splice(0).sort((a, b) =>
          a.did.localeCompare(b.did) || a.seq - b.seq);
        for (const event of events) {
          this.appView.ingest(event);
        }
        await this.cursors.save(this.appView.health().cursors);
      }
      this.acceptingLiveEvents = true;
      this.handoffInProgress = false;
      this.statusValue = { phase: 'live', bufferedEvents: 0 };
    } catch (error) {
      this.acceptingLiveEvents = false;
      this.handoffInProgress = false;
      this.statusValue = {
        phase: 'stopped',
        bufferedEvents: this.bufferedEvents.length,
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
    this.statusValue = { phase: 'stopped', bufferedEvents: this.bufferedEvents.length };
  }
}

export class MemoryCursorStore implements CursorStore {
  private value: Readonly<Record<string, number>> = {};

  async load(): Promise<Readonly<Record<string, number>>> {
    return { ...this.value };
  }

  async save(cursors: Readonly<Record<string, number>>): Promise<void> {
    this.value = { ...cursors };
  }
}

export class DuckDbCursorStore implements CursorStore {
  constructor(private readonly conn: DuckDBConnection) {}

  async load(): Promise<Readonly<Record<string, number>>> {
    const rows = await queryAll<{ did: string; seq: number }>(
      this.conn,
      'SELECT did, seq FROM protocol_cursors',
    );
    return Object.fromEntries(rows.map((row) => [row.did, Number(row.seq)]));
  }

  async save(cursors: Readonly<Record<string, number>>): Promise<void> {
    for (const [did, seq] of Object.entries(cursors)) {
      await execute(
        this.conn,
        `INSERT OR REPLACE INTO protocol_cursors (did, seq) VALUES ($1, $2)`,
        [did, seq],
      );
    }
  }
}
