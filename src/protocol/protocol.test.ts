import { describe, expect, it } from 'vitest';
import { createMemoryRepository, getRecord, putRecord } from '../repository/index.js';
import { generateIdentity } from '../identity/index.js';
import {
  COLLECTIONS,
  createDelegatedAward,
  createRolePermissionSetResolver,
  PermissionSetCache,
  ProtocolAppView,
  resolvePermissionScopes,
  isDelegationActive,
  validateProtocolRecord,
} from './index.js';
import type {
  AuthorityDelegation,
  ProtocolRecordEnvelope,
  TaskClaim,
  TaskOffer,
} from './types.js';

const now = '2026-01-01T00:00:00.000Z';

function envelope<T>(
  did: string,
  collection: typeof COLLECTIONS[keyof typeof COLLECTIONS],
  rkey: string,
  record: T,
): ProtocolRecordEnvelope {
  return {
    uri: `at://${did}/${collection}/${rkey}`,
    did,
    collection,
    rkey,
    cid: `cid-${rkey}`,
    record: record as ProtocolRecordEnvelope['record'],
  };
}

describe('Protocol 0.1 validation and authorship', () => {
  it('accepts a requester-authored task offer and rejects forged authorship', () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    const offer: TaskOffer = {
      $type: COLLECTIONS.taskOffer,
      taskId: 'task-1',
      title: 'Implement a feature',
      description: 'A protocol test task',
      requiredCapabilities: ['typescript'],
      contextRefs: [],
      deliverables: ['patch'],
      requesterDid: requester.did,
      governance: { mode: 'requester-selected' },
      createdAt: now,
    };

    expect(validateProtocolRecord(COLLECTIONS.taskOffer, offer, requester.did)).toEqual(offer);
    expect(() => validateProtocolRecord(COLLECTIONS.taskOffer, offer, 'did:key:z6Mkwrong'))
      .toThrowError(/validation failed/);
  });

  it('writes Protocol 0.1 records through the repository without making the legacy schemas authoritative', () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    const repo = createMemoryRepository(requester);
    const result = putRecord(repo, COLLECTIONS.taskOffer, 'task-1', {
      $type: COLLECTIONS.taskOffer,
      taskId: 'task-1',
      title: 'Implement a feature',
      description: 'A protocol test task',
      requiredCapabilities: ['typescript'],
      contextRefs: [],
      deliverables: ['patch'],
      requesterDid: requester.did,
      governance: { mode: 'requester-selected' },
      createdAt: now,
    });

    expect(result.uri).toBe(`at://${requester.did}/${COLLECTIONS.taskOffer}/task-1`);
    expect(getRecord(repo, COLLECTIONS.taskOffer, 'task-1').content).toMatchObject({
      taskId: 'task-1',
    });
  });
});

describe('scoped permissions', () => {
  it('resolves role permission sets and denies unrelated writes', async () => {
    const cache = new PermissionSetCache(createRolePermissionSetResolver());
    const resolved = await resolvePermissionScopes(
      ['include:me.lqdev.mycelium.auth.worker'],
      cache,
      1000,
    );

    expect(resolved.includes).toEqual(['me.lqdev.mycelium.auth.worker']);
    expect(resolved.permissions.map((permission) => permission.collection)).toEqual([
      COLLECTIONS.artifactManifest,
      COLLECTIONS.taskClaim,
      COLLECTIONS.taskCompletion,
    ]);
    expect(() => {
      const permission = resolved.permissions.find((item) => item.collection === COLLECTIONS.taskClaim);
      if (!permission) throw new Error('worker permission missing');
      if (permission.collection !== COLLECTIONS.taskClaim || !permission.actions.has('create')) {
        throw new Error('worker permission mismatch');
      }
    }).not.toThrow();
    expect(resolved.permissions.some((permission) => permission.collection === COLLECTIONS.taskOffer))
      .toBe(false);
  });

  it('uses a stale cached set only within its explicit expiration window', async () => {
    let calls = 0;
    const cache = new PermissionSetCache({
      async resolve() {
        calls++;
        if (calls > 1) throw new Error('resolver unavailable');
        return {
          id: 'me.lqdev.mycelium.auth.worker',
          permissions: [{
            type: 'permission',
            resource: 'repo',
            collection: [COLLECTIONS.taskClaim],
            action: ['create'],
          }],
        };
      },
    }, 10, 20);

    await cache.get('me.lqdev.mycelium.auth.worker', 0);
    await expect(cache.get('me.lqdev.mycelium.auth.worker', 15)).resolves.toBeDefined();
    await expect(cache.get('me.lqdev.mycelium.auth.worker', 21)).rejects.toThrow(/resolver unavailable/);
  });
});

describe('rebuildable AppView and governance', () => {
  it('rebuilds the same deterministic projection and quarantines forged records', () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    const worker = generateIdentity('worker.demo.test', 'Worker');
    const offer: TaskOffer = {
      $type: COLLECTIONS.taskOffer,
      taskId: 'task-1',
      title: 'Implement a feature',
      description: 'A protocol test task',
      requiredCapabilities: ['typescript'],
      contextRefs: [],
      deliverables: ['patch'],
      requesterDid: requester.did,
      governance: { mode: 'requester-selected' },
      createdAt: now,
    };
    const claim: TaskClaim = {
      $type: COLLECTIONS.taskClaim,
      taskUri: `at://${requester.did}/${COLLECTIONS.taskOffer}/task-1`,
      workerDid: worker.did,
      proposal: 'I can implement it',
      createdAt: now,
    };
    const snapshot = [
      envelope(requester.did, COLLECTIONS.taskOffer, 'task-1', offer),
      envelope(worker.did, COLLECTIONS.taskClaim, 'claim-1', claim),
    ];
    const invalidEvent = {
      seq: 3,
      did: worker.did,
      collection: COLLECTIONS.taskOffer,
      rkey: 'forged',
      operation: 'create' as const,
      record: { ...offer, requesterDid: requester.did },
      timestamp: now,
    };

    const first = new ProtocolAppView();
    first.rebuild(snapshot, [invalidEvent]);
    const second = new ProtocolAppView();
    second.rebuild([...snapshot].reverse(), [invalidEvent]);

    expect(first.projectionHash()).toBe(second.projectionHash());
    expect(first.listQuarantine()).toHaveLength(1);
    expect(first.projectTasks()[0]).toMatchObject({
      taskUri: `at://${requester.did}/${COLLECTIONS.taskOffer}/task-1`,
      state: 'claimed',
    });
  });

  it('ignores stale events after a newer per-DID cursor', () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    const appView = new ProtocolAppView();
    const offer: TaskOffer = {
      $type: COLLECTIONS.taskOffer,
      taskId: 'task-1',
      title: 'Implement a feature',
      description: 'A protocol test task',
      requiredCapabilities: ['typescript'],
      contextRefs: [],
      deliverables: ['patch'],
      requesterDid: requester.did,
      governance: { mode: 'requester-selected' },
      createdAt: now,
    };

    expect(appView.ingest({
      seq: 2,
      did: requester.did,
      collection: COLLECTIONS.taskOffer,
      rkey: 'task-1',
      operation: 'create',
      record: offer,
      timestamp: now,
    })).toBe(true);
    expect(appView.ingest({
      seq: 1,
      did: requester.did,
      collection: COLLECTIONS.taskOffer,
      rkey: 'task-older',
      operation: 'create',
      record: { ...offer, taskId: 'older' },
      timestamp: now,
    })).toBe(false);
    expect(appView.listRecords()).toHaveLength(1);
    expect(appView.health().cursors[requester.did]).toBe(2);
  });

  it('accepts a delegated coordinator award only while the requester delegation is active', () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    const worker = generateIdentity('worker.demo.test', 'Worker');
    const coordinator = generateIdentity('coordinator.demo.test', 'Coordinator');
    const taskUri = `at://${requester.did}/${COLLECTIONS.taskOffer}/task-1`;
    const claimUri = `at://${worker.did}/${COLLECTIONS.taskClaim}/claim-1`;
    const delegation: AuthorityDelegation = {
      $type: COLLECTIONS.authorityDelegation,
      delegatorDid: requester.did,
      delegateDid: coordinator.did,
      taskUri,
      scopes: [COLLECTIONS.taskAward],
      createdAt: now,
      expiresAt: '2026-02-01T00:00:00.000Z',
    };
    const delegationEnvelope = envelope(
      requester.did,
      COLLECTIONS.authorityDelegation,
      'delegation-1',
      delegation,
    );
    const offerEnvelope = envelope(requester.did, COLLECTIONS.taskOffer, 'task-1', {
      $type: COLLECTIONS.taskOffer,
      taskId: 'task-1',
      title: 'Implement a feature',
      description: 'A protocol test task',
      requiredCapabilities: ['typescript'],
      contextRefs: [],
      deliverables: ['patch'],
      requesterDid: requester.did,
      governance: { mode: 'delegated-coordinator', coordinatorDid: coordinator.did, delegationUri: delegationEnvelope.uri },
      createdAt: now,
    });
    const claimEnvelope = envelope(worker.did, COLLECTIONS.taskClaim, 'claim-1', {
      $type: COLLECTIONS.taskClaim,
      taskUri,
      workerDid: worker.did,
      proposal: 'I can implement it',
      createdAt: now,
    });
    const award = createDelegatedAward(
      taskUri,
      claimUri,
      requester.did,
      worker.did,
      coordinator.did,
      delegationEnvelope.uri,
      now,
    );
    const awardEnvelope = envelope(coordinator.did, COLLECTIONS.taskAward, 'award-1', award);
    const appView = new ProtocolAppView();
    appView.ingestSnapshot([offerEnvelope, claimEnvelope, delegationEnvelope, awardEnvelope]);

    expect(appView.projectTasks(new Date('2026-01-15T00:00:00.000Z'))[0]?.state).toBe('awarded');
    expect(appView.projectTasks(new Date('2026-02-15T00:00:00.000Z'))[0]?.state).toBe('claimed');
  });

  it('projects only task-linked completions and requester-authorized decisions', () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    const otherRequester = generateIdentity('other-requester.demo.test', 'Other requester');
    const workerA = generateIdentity('worker-a.demo.test', 'Worker A');
    const workerB = generateIdentity('worker-b.demo.test', 'Worker B');
    const taskUri = `at://${requester.did}/${COLLECTIONS.taskOffer}/task-1`;
    const offer = {
      $type: COLLECTIONS.taskOffer,
      taskId: 'task-1',
      title: 'Implement a feature',
      description: 'A protocol test task',
      requiredCapabilities: ['typescript'],
      contextRefs: [],
      deliverables: ['patch'],
      requesterDid: requester.did,
      governance: { mode: 'requester-selected' as const },
      createdAt: now,
    };
    const claimA = {
      $type: COLLECTIONS.taskClaim,
      taskUri,
      workerDid: workerA.did,
      proposal: 'Worker A proposal',
      createdAt: now,
    };
    const claimB = {
      $type: COLLECTIONS.taskClaim,
      taskUri,
      workerDid: workerB.did,
      proposal: 'Worker B proposal',
      createdAt: now,
    };
    const invalidCompletion = {
      $type: COLLECTIONS.taskCompletion,
      taskUri,
      claimUri: `at://${workerB.did}/${COLLECTIONS.taskClaim}/claim-b`,
      workerDid: workerA.did,
      summary: 'Mismatched claim',
      artifactUris: [],
      createdAt: now,
    };
    const invalidAcceptance = {
      $type: COLLECTIONS.taskAcceptance,
      taskUri,
      completionUri: `at://${workerA.did}/${COLLECTIONS.taskCompletion}/completion-1`,
      requesterDid: otherRequester.did,
      outcome: 'accepted' as const,
      createdAt: now,
    };
    const invalidCancellation = {
      $type: COLLECTIONS.taskCancellation,
      taskUri,
      requesterDid: otherRequester.did,
      reason: 'Unauthorized cancellation',
      createdAt: now,
    };

    const invalidProjection = new ProtocolAppView();
    invalidProjection.ingestSnapshot([
      envelope(requester.did, COLLECTIONS.taskOffer, 'task-1', offer),
      envelope(workerA.did, COLLECTIONS.taskClaim, 'claim-a', claimA),
      envelope(workerB.did, COLLECTIONS.taskClaim, 'claim-b', claimB),
      envelope(workerA.did, COLLECTIONS.taskCompletion, 'completion-1', invalidCompletion),
      envelope(otherRequester.did, COLLECTIONS.taskAcceptance, 'acceptance-1', invalidAcceptance),
      envelope(otherRequester.did, COLLECTIONS.taskCancellation, 'cancellation-1', invalidCancellation),
    ]);

    const invalidTask = invalidProjection.projectTasks()[0];
    expect(invalidTask?.state).toBe('claimed');
    expect(invalidTask?.conflictUris).toHaveLength(3);
    expect(invalidTask?.completionUri).toBeUndefined();
    expect(invalidTask?.acceptanceUri).toBeUndefined();

    const validCompletion = {
      ...invalidCompletion,
      claimUri: `at://${workerA.did}/${COLLECTIONS.taskClaim}/claim-a`,
    };
    const validAcceptance = {
      ...invalidAcceptance,
      requesterDid: requester.did,
      completionUri: `at://${workerA.did}/${COLLECTIONS.taskCompletion}/completion-1`,
    };
    const validProjection = new ProtocolAppView();
    validProjection.ingestSnapshot([
      envelope(requester.did, COLLECTIONS.taskOffer, 'task-1', offer),
      envelope(workerA.did, COLLECTIONS.taskClaim, 'claim-a', claimA),
      envelope(workerA.did, COLLECTIONS.taskCompletion, 'completion-1', validCompletion),
      envelope(requester.did, COLLECTIONS.taskAcceptance, 'acceptance-1', validAcceptance),
    ]);
    expect(validProjection.projectTasks()[0]).toMatchObject({
      state: 'accepted',
      completionUri: `at://${workerA.did}/${COLLECTIONS.taskCompletion}/completion-1`,
      acceptanceUri: `at://${requester.did}/${COLLECTIONS.taskAcceptance}/acceptance-1`,
    });
  });

  it('quarantines snapshots whose envelope URI is not canonical', () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    const offer: TaskOffer = {
      $type: COLLECTIONS.taskOffer,
      taskId: 'task-1',
      title: 'Implement a feature',
      description: 'A protocol test task',
      requiredCapabilities: ['typescript'],
      contextRefs: [],
      deliverables: ['patch'],
      requesterDid: requester.did,
      governance: { mode: 'requester-selected' },
      createdAt: now,
    };
    const appView = new ProtocolAppView();
    appView.ingestSnapshot([{
      ...envelope(requester.did, COLLECTIONS.taskOffer, 'task-1', offer),
      uri: `at://did:key:z6MkOther/${COLLECTIONS.taskOffer}/task-1`,
    }]);

    expect(appView.listRecords()).toHaveLength(0);
    expect(appView.listQuarantine()[0]?.reason).toMatch(/canonical URI/);
  });

  it('keeps recommendation scores aligned with the Lexicon integer bounds', () => {
    const coordinator = generateIdentity('coordinator.demo.test', 'Coordinator');
    const base = {
      $type: COLLECTIONS.taskRecommendation,
      taskUri: 'at://did:key:z6MkRequester/me.lqdev.mycelium.task.offer/task-1',
      coordinatorDid: coordinator.did,
      policy: 'highest-score',
      rankedClaims: [{
        claimUri: 'at://did:key:z6MkWorker/me.lqdev.mycelium.task.claim/claim-1',
        workerDid: 'did:key:z6MkWorker',
        score: 1,
        reasons: ['valid'],
      }],
      createdAt: now,
    };

    expect(() => validateProtocolRecord(COLLECTIONS.taskRecommendation, {
      ...base,
      rankedClaims: [{ ...base.rankedClaims[0], score: 1.5 }],
    }, coordinator.did)).toThrow();
    expect(() => validateProtocolRecord(COLLECTIONS.taskRecommendation, {
      ...base,
      rankedClaims: [{ ...base.rankedClaims[0], score: 1_000_001 }],
    }, coordinator.did)).toThrow();
    expect(validateProtocolRecord(COLLECTIONS.taskRecommendation, {
      ...base,
      rankedClaims: [{ ...base.rankedClaims[0], score: 1_000_000 }],
    }, coordinator.did)).toBeDefined();
  });

  it('does not activate future delegations or honor unrelated revocations', () => {
    const requester = generateIdentity('requester.demo.test', 'Requester');
    const otherRequester = generateIdentity('other-requester.demo.test', 'Other requester');
    const coordinator = generateIdentity('coordinator.demo.test', 'Coordinator');
    const delegation = {
      $type: COLLECTIONS.authorityDelegation as const,
      delegatorDid: requester.did,
      delegateDid: coordinator.did,
      scopes: [COLLECTIONS.taskAward],
      createdAt: '2026-02-01T00:00:00.000Z',
      expiresAt: '2026-03-01T00:00:00.000Z',
    };
    const delegationEnvelope = envelope(
      requester.did,
      COLLECTIONS.authorityDelegation,
      'delegation-1',
      delegation,
    );
    expect(isDelegationActive(
      delegationEnvelope,
      [delegationEnvelope],
      new Date('2026-01-15T00:00:00.000Z'),
    )).toBe(false);

    const activeDelegation = {
      ...delegation,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const activeEnvelope = envelope(
      requester.did,
      COLLECTIONS.authorityDelegation,
      'delegation-2',
      activeDelegation,
    );
    const unrelatedRevocation = envelope(
      otherRequester.did,
      COLLECTIONS.authorityRevocation,
      'revocation-1',
      {
        $type: COLLECTIONS.authorityRevocation,
        delegationUri: activeEnvelope.uri,
        revokerDid: otherRequester.did,
        reason: 'Unrelated principal',
        createdAt: '2026-01-15T00:00:00.000Z',
      },
    );
    expect(isDelegationActive(
      activeEnvelope,
      [activeEnvelope, unrelatedRevocation],
      new Date('2026-01-20T00:00:00.000Z'),
    )).toBe(true);
  });
});
