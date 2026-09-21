import { createHash } from 'node:crypto';
import { canonicalize } from '../identity/index.js';
import {
  COLLECTIONS,
  isMyceliumCollection,
  type MyceliumCollection,
  type TaskState,
} from './constants.js';
import { evaluateAwardAuthority } from './governance.js';
import { validateProtocolRecord } from './validation.js';
import type {
  ProtocolRecordEnvelope,
  TaskAcceptance,
  TaskAward,
  TaskCancellation,
  TaskClaim,
  TaskCompletion,
  TaskOffer,
  TaskProjection,
} from './types.js';

export interface ProtocolCommitEvent {
  seq: number;
  did: string;
  collection: string;
  rkey: string;
  operation: 'create' | 'update' | 'delete';
  record?: unknown;
  cid?: string;
  timestamp: string;
}

export interface QuarantinedEvent {
  event: ProtocolCommitEvent;
  reason: string;
}

export interface AppViewHealth {
  cursors: Readonly<Record<string, number>>;
  recordCount: number;
  quarantinedCount: number;
  projectionHash: string;
}

function uriFor(event: ProtocolCommitEvent): string {
  return `at://${event.did}/${event.collection}/${event.rkey}`;
}

function cidFor(record: unknown): string {
  return createHash('sha256').update(canonicalize(record)).digest('hex');
}

export class ProtocolAppView {
  private readonly records = new Map<string, ProtocolRecordEnvelope>();
  private readonly deleted = new Set<string>();
  private readonly processedEvents = new Set<string>();
  private readonly cursorsByDid = new Map<string, number>();
  private readonly quarantine: QuarantinedEvent[] = [];

  reset(): void {
    this.records.clear();
    this.deleted.clear();
    this.processedEvents.clear();
    this.cursorsByDid.clear();
    this.quarantine.length = 0;
  }

  ingestSnapshot(snapshot: ReadonlyArray<ProtocolRecordEnvelope>): void {
    const ordered = [...snapshot].sort((a, b) => a.uri.localeCompare(b.uri));
    for (const envelope of ordered) {
      try {
        const record = validateProtocolRecord(envelope.collection, envelope.record, envelope.did);
        this.records.set(envelope.uri, { ...envelope, record });
        this.deleted.delete(envelope.uri);
      } catch (error) {
        this.quarantine.push({
          event: {
            seq: 0,
            did: envelope.did,
            collection: envelope.collection,
            rkey: envelope.rkey,
            operation: 'create',
            record: envelope.record,
            cid: envelope.cid,
            timestamp: new Date().toISOString(),
          },
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  ingest(event: ProtocolCommitEvent): boolean {
    if (!isMyceliumCollection(event.collection)) return false;
    const eventId = `${event.did}:${event.seq}:${event.operation}:${event.collection}:${event.rkey}`;
    if (this.processedEvents.has(eventId)) return false;
    this.processedEvents.add(eventId);

    const previous = this.cursorsByDid.get(event.did) ?? 0;
    if (event.seq <= previous) return false;
    this.cursorsByDid.set(event.did, event.seq);

    const uri = uriFor(event);
    if (event.operation === 'delete') {
      this.records.delete(uri);
      this.deleted.add(uri);
      return true;
    }
    if (event.record === undefined) {
      this.quarantine.push({ event, reason: 'commit is missing its record payload' });
      return false;
    }

    try {
      const record = validateProtocolRecord(event.collection, event.record, event.did);
      this.records.set(uri, {
        uri,
        did: event.did,
        collection: event.collection,
        rkey: event.rkey,
        cid: event.cid ?? cidFor(record),
        record,
      });
      this.deleted.delete(uri);
      return true;
    } catch (error) {
      this.quarantine.push({
        event,
        reason: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  rebuild(
    snapshot: ReadonlyArray<ProtocolRecordEnvelope>,
    events: ReadonlyArray<ProtocolCommitEvent>,
  ): void {
    this.reset();
    this.ingestSnapshot(snapshot);
    const ordered = [...events].sort((a, b) =>
      a.did.localeCompare(b.did) || a.seq - b.seq || a.rkey.localeCompare(b.rkey));
    for (const event of ordered) this.ingest(event);
  }

  listRecords(): ProtocolRecordEnvelope[] {
    return [...this.records.values()].sort((a, b) => a.uri.localeCompare(b.uri));
  }

  listQuarantine(): QuarantinedEvent[] {
    return [...this.quarantine];
  }

  health(): AppViewHealth {
    const cursors = Object.fromEntries(
      [...this.cursorsByDid.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
    return {
      cursors,
      recordCount: this.records.size,
      quarantinedCount: this.quarantine.length,
      projectionHash: this.projectionHash(),
    };
  }

  projectionHash(): string {
    const rows = this.listRecords().map((record) => ({
      uri: record.uri,
      cid: record.cid,
      collection: record.collection,
      record: record.record,
    }));
    return createHash('sha256').update(canonicalize(rows)).digest('hex');
  }

  projectTasks(now = new Date()): TaskProjection[] {
    const offers = this.listByCollection<TaskOffer>(COLLECTIONS.taskOffer);
    const claims = this.listByCollection<TaskClaim>(COLLECTIONS.taskClaim);
    const awards = this.listByCollection<TaskAward>(COLLECTIONS.taskAward);
    const completions = this.listByCollection<TaskCompletion>(COLLECTIONS.taskCompletion);
    const acceptances = this.listByCollection<TaskAcceptance>(COLLECTIONS.taskAcceptance);
    const cancellations = this.listByCollection<TaskCancellation>(COLLECTIONS.taskCancellation);
    const allRecords = this.listRecords();

    return offers.map((offerEnvelope) => {
      const offer = offerEnvelope.record;
      const taskClaims = claims.filter((claim) => claim.record.taskUri === offerEnvelope.uri);
      const taskAwards = awards.filter((award) => award.record.taskUri === offerEnvelope.uri);
      const authorizedAwards = taskAwards.filter((award) => {
        const claim = taskClaims.find((candidate) => candidate.uri === award.record.claimUri);
        return claim !== undefined &&
          evaluateAwardAuthority(award, offerEnvelope, claim, allRecords, now).authorized;
      });
      const taskCompletions = completions.filter((completion) =>
        completion.record.taskUri === offerEnvelope.uri);
      const taskAcceptances = acceptances.filter((acceptance) =>
        acceptance.record.taskUri === offerEnvelope.uri);
      const taskCancellations = cancellations.filter((cancellation) =>
        cancellation.record.taskUri === offerEnvelope.uri);
      const conflicts = taskAwards
        .filter((award) => !authorizedAwards.some((authorized) => authorized.uri === award.uri))
        .map((award) => award.uri);

      let state: TaskState = 'open';
      if (taskCancellations.length > 0) state = 'cancelled';
      else if (taskAcceptances.some((acceptance) => acceptance.record.outcome === 'accepted')) state = 'accepted';
      else if (taskCompletions.length > 0) state = 'submitted';
      else if (authorizedAwards.length > 0) state = 'awarded';
      else if (taskClaims.length > 0) state = 'claimed';

      const explanation = [
        `Requester: ${offer.requesterDid}`,
        `Claims observed: ${taskClaims.length}`,
        `Authorized awards: ${authorizedAwards.length}`,
      ];
      if (conflicts.length > 0) explanation.push(`Unauthorized or conflicting awards: ${conflicts.length}`);
      if (taskCancellations.length > 0) explanation.push('A requester cancellation supersedes active work.');

      const projection: TaskProjection = {
        taskUri: offerEnvelope.uri,
        requesterDid: offer.requesterDid,
        state,
        claimUris: taskClaims.map((claim) => claim.uri),
        conflictUris: conflicts,
        explanation,
      };
      const awardUri = authorizedAwards[0]?.uri;
      const completionUri = taskCompletions[0]?.uri;
      const acceptanceUri = taskAcceptances[0]?.uri;
      if (awardUri) projection.awardUri = awardUri;
      if (completionUri) projection.completionUri = completionUri;
      if (acceptanceUri) projection.acceptanceUri = acceptanceUri;
      return projection;
    });
  }

  private listByCollection<T>(
    collection: MyceliumCollection,
  ): Array<ProtocolRecordEnvelope & { record: T }> {
    return this.listRecords().filter((record) => record.collection === collection) as Array<
      ProtocolRecordEnvelope & { record: T }
    >;
  }
}
