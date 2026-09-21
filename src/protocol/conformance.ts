import type { AgentIdentity, RecordResult, StoredRecord } from '../schemas/types.js';
import { createMemoryRepository, getRecord, putRecord } from '../repository/index.js';
import { createDemoPrincipals } from './fixtures.js';
import {
  assertPermissionAllowed,
  createRolePermissionSetResolver,
  PermissionSetCache,
  resolvePermissionScopes,
  type RepoAction,
  type RepoPermission,
} from './permissions.js';
import { COLLECTIONS } from './constants.js';

export interface ConformanceSession {
  did: string;
  identity: AgentIdentity;
  permissions: ReadonlyArray<RepoPermission>;
}

export interface PdsConformanceAdapter {
  session(role: 'requester' | 'workerA' | 'workerB' | 'verifier' | 'coordinator'): Promise<ConformanceSession>;
  put(
    session: ConformanceSession,
    collection: string,
    rkey: string,
    record: unknown,
  ): Promise<RecordResult>;
  get(uri: string): Promise<StoredRecord>;
}

export interface ConformanceCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ConformanceReport {
  passed: boolean;
  checks: ConformanceCheck[];
}

export class MemoryPdsConformanceAdapter implements PdsConformanceAdapter {
  private readonly principals = createDemoPrincipals();
  private readonly repositories = new Map<string, ReturnType<typeof createMemoryRepository>>();
  private readonly sessions = new Map<ConformanceSession['did'], ConformanceSession>();
  private readonly permissionCache = new PermissionSetCache(createRolePermissionSetResolver());

  async session(
    role: 'requester' | 'workerA' | 'workerB' | 'verifier' | 'coordinator',
  ): Promise<ConformanceSession> {
    const principal = role === 'workerA'
      ? this.principals.find((item) => item.role === 'worker' && item.handle?.startsWith('worker-a'))
      : role === 'workerB'
        ? this.principals.find((item) => item.role === 'worker' && item.handle?.startsWith('worker-b'))
        : this.principals.find((item) => item.role === role);
    if (!principal) throw new Error(`Missing conformance principal "${role}"`);

    const existing = this.sessions.get(principal.did);
    if (existing) return existing;
    const permissionRole = role === 'workerA' || role === 'workerB' ? 'worker' : role;
    const resolved = await resolvePermissionScopes(
      [`include:me.lqdev.mycelium.auth.${permissionRole}`],
      this.permissionCache,
    );
    const session: ConformanceSession = {
      did: principal.did,
      identity: principal.identity,
      permissions: resolved.permissions,
    };
    this.sessions.set(session.did, session);
    this.repositories.set(session.did, createMemoryRepository(principal.identity));
    return session;
  }

  async put(
    session: ConformanceSession,
    collection: string,
    rkey: string,
    record: unknown,
  ): Promise<RecordResult> {
    assertPermissionAllowed(session.permissions, collection, 'create');
    const repo = this.repositories.get(session.did);
    if (!repo) throw new Error(`Unknown conformance session "${session.did}"`);
    return putRecord(repo, collection, rkey, record);
  }

  async get(uri: string): Promise<StoredRecord> {
    const [, , did, collection, rkey] = uri.split('/');
    if (!did || !collection || !rkey) throw new Error(`Invalid AT URI "${uri}"`);
    const repo = this.repositories.get(did);
    if (!repo) throw new Error(`Unknown repository "${did}"`);
    return getRecord(repo, collection, rkey);
  }
}

export async function runProtocolConformance(
  adapter: PdsConformanceAdapter,
): Promise<ConformanceReport> {
  const checks: ConformanceCheck[] = [];
  const pass = (name: string, detail: string) => checks.push({ name, passed: true, detail });
  const fail = (name: string, error: unknown) => checks.push({
    name,
    passed: false,
    detail: error instanceof Error ? error.message : String(error),
  });

  try {
    const requester = await adapter.session('requester');
    const workerA = await adapter.session('workerA');
    const workerB = await adapter.session('workerB');
    const verifier = await adapter.session('verifier');
    const coordinator = await adapter.session('coordinator');
    pass('five-principal-sessions', 'requester, two workers, verifier, and coordinator obtained scoped sessions');

    const offer = {
      $type: COLLECTIONS.taskOffer,
      taskId: 'conformance-task',
      title: 'Conformance task',
      description: 'A task used by the black-box Protocol 0.1 suite.',
      requiredCapabilities: ['typescript'],
      contextRefs: [],
      deliverables: ['report'],
      requesterDid: requester.did,
      governance: { mode: 'requester-selected' as const },
      createdAt: new Date().toISOString(),
    };
    const offerResult = await adapter.put(requester, COLLECTIONS.taskOffer, 'task-1', offer);
    pass('requester-authored-offer', offerResult.uri);

    const claims = await Promise.all([workerA, workerB].map((worker, index) =>
      adapter.put(worker, COLLECTIONS.taskClaim, `claim-${index + 1}`, {
        $type: COLLECTIONS.taskClaim,
        taskUri: offerResult.uri,
        workerDid: worker.did,
        proposal: `Worker ${index + 1} proposal`,
        createdAt: new Date().toISOString(),
      })));
    pass('competing-worker-claims', claims.map((claim) => claim.uri).join(', '));

    const recommendation = await adapter.put(
      coordinator,
      COLLECTIONS.taskRecommendation,
      'recommendation-1',
      {
        $type: COLLECTIONS.taskRecommendation,
        taskUri: offerResult.uri,
        coordinatorDid: coordinator.did,
        policy: 'first-valid-claim',
        rankedClaims: claims.map((claim, index) => ({
          claimUri: claim.uri,
          workerDid: index === 0 ? workerA.did : workerB.did,
          score: 100 - index,
          reasons: ['valid conformance claim'],
        })),
        selectedClaimUri: claims[0]?.uri,
        createdAt: new Date().toISOString(),
      },
    );
    pass('coordinator-recommendation', recommendation.uri);

    let unauthorizedRejected = false;
    try {
      await adapter.put(workerA, COLLECTIONS.taskOffer, 'forged-offer', offer);
    } catch {
      unauthorizedRejected = true;
    }
    if (!unauthorizedRejected) throw new Error('worker was allowed to create a requester offer');
    pass('scope-denial', 'worker offer write rejected before PDS mutation');

    const completion = await adapter.put(workerA, COLLECTIONS.taskCompletion, 'completion-1', {
      $type: COLLECTIONS.taskCompletion,
      taskUri: offerResult.uri,
      claimUri: claims[0]?.uri,
      workerDid: workerA.did,
      summary: 'Completed the conformance task.',
      artifactUris: [],
      createdAt: new Date().toISOString(),
    });
    const verification = await adapter.put(verifier, COLLECTIONS.verificationResult, 'verification-1', {
      $type: COLLECTIONS.verificationResult,
      taskUri: offerResult.uri,
      completionUri: completion.uri,
      verifierDid: verifier.did,
      status: 'passed',
      summary: 'Evidence is present.',
      evidenceRefs: [],
      createdAt: new Date().toISOString(),
    });
    const acceptance = await adapter.put(requester, COLLECTIONS.taskAcceptance, 'acceptance-1', {
      $type: COLLECTIONS.taskAcceptance,
      taskUri: offerResult.uri,
      completionUri: completion.uri,
      requesterDid: requester.did,
      outcome: 'accepted',
      createdAt: new Date().toISOString(),
    });
    const stored = await adapter.get(acceptance.uri);
    if (stored.uri !== acceptance.uri || verification.cid.length === 0) {
      throw new Error('URI/CID read-back failed');
    }
    pass('completion-verification-acceptance', `${verification.uri} -> ${acceptance.uri}`);
    pass('uri-cid-readback', stored.uri);
  } catch (error) {
    fail('protocol-conformance', error);
  }

  return {
    passed: checks.every((check) => check.passed),
    checks,
  };
}
