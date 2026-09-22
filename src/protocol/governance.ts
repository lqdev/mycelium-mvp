import { COLLECTIONS } from './constants.js';
import type {
  AuthorityDelegation,
  AuthorityRevocation,
  ProtocolRecordEnvelope,
  TaskAward,
  TaskClaim,
  TaskOffer,
} from './types.js';

export interface AwardAuthorityResult {
  authorized: boolean;
  reason: string;
  delegationUri?: string;
}

function asRecord<T>(envelope: ProtocolRecordEnvelope | undefined, collection: string): T | undefined {
  return envelope?.collection === collection ? envelope.record as T : undefined;
}

export function isDelegationActive(
  delegationEnvelope: ProtocolRecordEnvelope,
  allRecords: ReadonlyArray<ProtocolRecordEnvelope>,
  now = new Date(),
): boolean {
  const delegation = asRecord<AuthorityDelegation>(
    delegationEnvelope,
    COLLECTIONS.authorityDelegation,
  );
  if (
    !delegation ||
    new Date(delegation.createdAt) > now ||
    new Date(delegation.expiresAt) <= now
  ) return false;

  return !allRecords.some((envelope) => {
    const revocation = asRecord<AuthorityRevocation>(
      envelope,
      COLLECTIONS.authorityRevocation,
    );
    return revocation?.delegationUri === delegationEnvelope.uri &&
      revocation.revokerDid === delegation.delegatorDid &&
      new Date(revocation.createdAt) <= now;
  });
}

function hasAwardScope(delegation: AuthorityDelegation): boolean {
  return delegation.scopes.some((scope) =>
    scope === COLLECTIONS.taskAward || scope === 'task.award' || scope === 'create',
  );
}

export function evaluateAwardAuthority(
  awardEnvelope: ProtocolRecordEnvelope,
  offerEnvelope: ProtocolRecordEnvelope,
  claimEnvelope: ProtocolRecordEnvelope,
  records: ReadonlyArray<ProtocolRecordEnvelope>,
  now = new Date(),
): AwardAuthorityResult {
  const award = asRecord<TaskAward>(awardEnvelope, COLLECTIONS.taskAward);
  const offer = asRecord<TaskOffer>(offerEnvelope, COLLECTIONS.taskOffer);
  const claim = asRecord<TaskClaim>(claimEnvelope, COLLECTIONS.taskClaim);
  if (!award || !offer || !claim) {
    return { authorized: false, reason: 'missing-offer-claim-or-award' };
  }
  if (award.requesterDid !== offer.requesterDid) {
    return { authorized: false, reason: 'award-requester-does-not-match-offer' };
  }
  if (award.workerDid !== claim.workerDid || award.claimUri !== claimEnvelope.uri) {
    return { authorized: false, reason: 'award-does-not-match-claim' };
  }

  if (!award.coordinatorDid) {
    if (awardEnvelope.did !== offer.requesterDid) {
      return { authorized: false, reason: 'direct-award-not-authored-by-requester' };
    }
    return { authorized: true, reason: 'requester-authored-direct-award' };
  }

  if (awardEnvelope.did !== award.coordinatorDid) {
    return { authorized: false, reason: 'delegated-award-not-authored-by-coordinator' };
  }
  const delegation = records.find((envelope) =>
    envelope.uri === award.delegationUri &&
    envelope.collection === COLLECTIONS.authorityDelegation,
  );
  const delegationRecord = delegation
    ? asRecord<AuthorityDelegation>(delegation, COLLECTIONS.authorityDelegation)
    : undefined;
  if (!delegation || !delegationRecord) {
    return {
      authorized: false,
      reason: 'delegation-not-found',
      ...(award.delegationUri ? { delegationUri: award.delegationUri } : {}),
    };
  }
  if (
    delegationRecord.delegatorDid !== offer.requesterDid ||
    delegationRecord.delegateDid !== award.coordinatorDid ||
    (delegationRecord.taskUri && delegationRecord.taskUri !== offerEnvelope.uri) ||
    !hasAwardScope(delegationRecord)
  ) {
    return {
      authorized: false,
      reason: 'delegation-scope-or-subject-mismatch',
      delegationUri: delegation.uri,
    };
  }
  if (!isDelegationActive(delegation, records, now)) {
    return {
      authorized: false,
      reason: 'delegation-expired-or-revoked',
      delegationUri: delegation.uri,
    };
  }
  return { authorized: true, reason: 'active-requester-delegation', delegationUri: delegation.uri };
}

export function createRequesterAward(
  taskUri: string,
  claimUri: string,
  requesterDid: string,
  workerDid: string,
  createdAt = new Date().toISOString(),
): TaskAward {
  return {
    $type: COLLECTIONS.taskAward,
    taskUri,
    claimUri,
    workerDid,
    requesterDid,
    createdAt,
  };
}

export function createDelegatedAward(
  taskUri: string,
  claimUri: string,
  requesterDid: string,
  workerDid: string,
  coordinatorDid: string,
  delegationUri: string,
  createdAt = new Date().toISOString(),
): TaskAward {
  return {
    $type: COLLECTIONS.taskAward,
    taskUri,
    claimUri,
    workerDid,
    requesterDid,
    coordinatorDid,
    delegationUri,
    createdAt,
  };
}
