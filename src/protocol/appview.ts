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
  /** Global subscribeRepos firehose sequence. */
  streamSeq?: number | undefined;
  /** Legacy simulation alias for streamSeq; never a repository revision. */
  seq?: number;
  did: string;
  collection: string;
  rkey: string;
  operation: 'create' | 'update' | 'delete';
  record?: unknown;
  cid?: string;
  commitCid?: string;
  repoRev?: string;
  since?: string | null;
  tooBig?: boolean;
  rebase?: boolean;
  timestamp: string;
}

export interface QuarantinedEvent {
  event: ProtocolCommitEvent;
  reason: string;
}

export interface ProtocolSnapshotMetadata {
  did: string;
  repoRev: string;
  streamSeq?: number | undefined;
}

export interface AppViewHealth {
  cursors: Readonly<Record<string, number>>;
  streamSeq?: number | undefined;
  repoRevs: Readonly<Record<string, string>>;
  recordCount: number;
  quarantinedCount: number;
  projectionHash: string;
}

function canonicalUri(did: string, collection: string, rkey: string): string {
  return `at://${did}/${collection}/${rkey}`;
}

function uriFor(event: ProtocolCommitEvent): string {
  return canonicalUri(event.did, event.collection, event.rkey);
}

function cidFor(record: unknown): string {
  return createHash('sha256').update(canonicalize(record)).digest('hex');
}

export class ProtocolAppView {
  private readonly records = new Map<string, ProtocolRecordEnvelope>();
  private readonly deleted = new Set<string>();
  private readonly processedEvents = new Set<string>();
  private readonly cursorsByDid = new Map<string, number>();
  private readonly repoRevsByDid = new Map<string, string>();
  private lastStreamSeq: number | undefined;
  private readonly quarantine: QuarantinedEvent[] = [];

  reset(): void {
    this.records.clear();
    this.deleted.clear();
    this.processedEvents.clear();
    this.cursorsByDid.clear();
    this.repoRevsByDid.clear();
    this.lastStreamSeq = undefined;
    this.quarantine.length = 0;
  }

  ingestSnapshot(
    snapshot: ReadonlyArray<ProtocolRecordEnvelope>,
    metadata?: ProtocolSnapshotMetadata,
  ): void {
    if (metadata?.streamSeq !== undefined) this.lastStreamSeq = metadata.streamSeq;
    if (metadata !== undefined) this.repoRevsByDid.set(metadata.did, metadata.repoRev);
    const ordered = [...snapshot].sort((a, b) => a.uri.localeCompare(b.uri));
    for (const envelope of ordered) {
      const expectedUri = canonicalUri(envelope.did, envelope.collection, envelope.rkey);
      if (envelope.uri !== expectedUri) {
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
          reason: `snapshot URI does not match canonical URI "${expectedUri}"`,
        });
        continue;
      }
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
    const streamSeq = event.streamSeq ?? event.seq;
    if (event.tooBig) {
      this.quarantine.push({ event, reason: 'subscribeRepos commit set tooBig; snapshot recovery required' });
      if (streamSeq !== undefined) this.advanceCursor(event.did, streamSeq, event.repoRev);
      return false;
    }
    if (streamSeq === undefined || !Number.isSafeInteger(streamSeq) || streamSeq < 0) {
      this.quarantine.push({ event, reason: 'commit is missing a valid global stream sequence' });
      return false;
    }
    if (!isMyceliumCollection(event.collection)) return false;
    const eventId = `${event.did}:${streamSeq}:${event.operation}:${event.collection}:${event.rkey}`;
    if (this.processedEvents.has(eventId)) return false;
    this.processedEvents.add(eventId);

    const previous = this.cursorsByDid.get(event.did) ?? 0;
    if (streamSeq < previous) return false;
    this.advanceCursor(event.did, streamSeq, event.repoRev);

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
      (a.streamSeq ?? a.seq ?? 0) - (b.streamSeq ?? b.seq ?? 0) ||
      a.did.localeCompare(b.did) || a.rkey.localeCompare(b.rkey));
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
      ...(this.lastStreamSeq === undefined ? {} : { streamSeq: this.lastStreamSeq }),
      repoRevs: Object.fromEntries(
        [...this.repoRevsByDid.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
      recordCount: this.records.size,
      quarantinedCount: this.quarantine.length,
      projectionHash: this.projectionHash(),
    };
  }

  private advanceCursor(did: string, streamSeq: number, repoRev?: string): void {
    const previous = this.cursorsByDid.get(did) ?? 0;
    if (streamSeq > previous) this.cursorsByDid.set(did, streamSeq);
    if (repoRev !== undefined) this.repoRevsByDid.set(did, repoRev);
    if (this.lastStreamSeq === undefined || streamSeq > this.lastStreamSeq) {
      this.lastStreamSeq = streamSeq;
    }
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
      const validCompletions = taskCompletions.filter((completion) =>
        taskClaims.some((claim) =>
          claim.uri === completion.record.claimUri &&
          claim.record.taskUri === offerEnvelope.uri &&
          claim.record.workerDid === completion.record.workerDid));
      const invalidCompletionUris = taskCompletions
        .filter((completion) => !validCompletions.some((valid) => valid.uri === completion.uri))
        .map((completion) => completion.uri);
      const taskAcceptances = acceptances.filter((acceptance) =>
        acceptance.record.taskUri === offerEnvelope.uri &&
        acceptance.record.requesterDid === offer.requesterDid &&
        validCompletions.some((completion) => completion.uri === acceptance.record.completionUri));
      const invalidAcceptanceUris = acceptances
        .filter((acceptance) =>
          acceptance.record.taskUri === offerEnvelope.uri &&
          !taskAcceptances.some((valid) => valid.uri === acceptance.uri))
        .map((acceptance) => acceptance.uri);
      const taskCancellations = cancellations.filter((cancellation) =>
        cancellation.record.taskUri === offerEnvelope.uri &&
        cancellation.record.requesterDid === offer.requesterDid);
      const invalidCancellationUris = cancellations
        .filter((cancellation) =>
          cancellation.record.taskUri === offerEnvelope.uri &&
          !taskCancellations.some((valid) => valid.uri === cancellation.uri))
        .map((cancellation) => cancellation.uri);
      const conflicts = taskAwards
        .filter((award) => !authorizedAwards.some((authorized) => authorized.uri === award.uri))
        .map((award) => award.uri)
        .concat(invalidCompletionUris, invalidAcceptanceUris, invalidCancellationUris);

      let state: TaskState = 'open';
      if (taskCancellations.length > 0) state = 'cancelled';
      else if (taskAcceptances.some((acceptance) => acceptance.record.outcome === 'accepted')) state = 'accepted';
      else if (validCompletions.length > 0) state = 'submitted';
      else if (authorizedAwards.length > 0) state = 'awarded';
      else if (taskClaims.length > 0) state = 'claimed';

      const explanation = [
        `Requester: ${offer.requesterDid}`,
        `Claims observed: ${taskClaims.length}`,
        `Authorized awards: ${authorizedAwards.length}`,
      ];
      if (conflicts.length > 0) explanation.push(`Unauthorized or conflicting facts: ${conflicts.length}`);
      if (invalidCompletionUris.length > 0) {
        explanation.push(`Invalid completion references: ${invalidCompletionUris.length}`);
      }
      if (invalidAcceptanceUris.length > 0) {
        explanation.push(`Invalid acceptance references: ${invalidAcceptanceUris.length}`);
      }
      if (invalidCancellationUris.length > 0) {
        explanation.push(`Invalid cancellation references: ${invalidCancellationUris.length}`);
      }
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
      const completionUri = validCompletions[0]?.uri;
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
