import type { GovernanceMode, MyceliumCollection, TaskState } from './constants.js';

export type PrincipalKind = 'human' | 'organization' | 'agent-service';

export interface Principal {
  did: string;
  kind: PrincipalKind;
  handle?: string;
  displayName?: string;
}

export interface ResourceReference {
  uri: string;
  cid?: string;
}

export interface TaskOffer {
  $type: 'me.lqdev.mycelium.task.offer';
  taskId: string;
  title: string;
  description: string;
  requiredCapabilities: string[];
  contextRefs: ResourceReference[];
  deliverables: string[];
  requesterDid: string;
  governance: {
    mode: GovernanceMode;
    coordinatorDid?: string;
    delegationUri?: string;
  };
  expiresAt?: string;
  createdAt: string;
}

export interface TaskClaim {
  $type: 'me.lqdev.mycelium.task.claim';
  taskUri: string;
  workerDid: string;
  proposal: string;
  estimatedDuration?: string;
  createdAt: string;
  expiresAt?: string;
}

export interface TaskRecommendation {
  $type: 'me.lqdev.mycelium.task.recommendation';
  taskUri: string;
  coordinatorDid: string;
  policy: string;
  rankedClaims: Array<{
    claimUri: string;
    workerDid: string;
    score: number;
    reasons: string[];
  }>;
  selectedClaimUri?: string;
  createdAt: string;
}

export interface TaskAward {
  $type: 'me.lqdev.mycelium.task.award';
  taskUri: string;
  claimUri: string;
  workerDid: string;
  requesterDid: string;
  coordinatorDid?: string;
  delegationUri?: string;
  createdAt: string;
  expiresAt?: string;
}

export interface TaskCompletion {
  $type: 'me.lqdev.mycelium.task.completion';
  taskUri: string;
  claimUri: string;
  workerDid: string;
  summary: string;
  artifactUris: string[];
  metrics?: Record<string, number | string>;
  createdAt: string;
}

export interface TaskAcceptance {
  $type: 'me.lqdev.mycelium.task.acceptance';
  taskUri: string;
  completionUri: string;
  requesterDid: string;
  outcome: 'accepted' | 'rejected' | 'partial';
  notes?: string;
  createdAt: string;
}

export interface TaskCancellation {
  $type: 'me.lqdev.mycelium.task.cancellation';
  taskUri: string;
  requesterDid: string;
  reason: string;
  supersedesUri?: string;
  createdAt: string;
}

export interface AuthorityDelegation {
  $type: 'me.lqdev.mycelium.authority.delegation';
  delegatorDid: string;
  delegateDid: string;
  taskUri?: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
}

export interface AuthorityRevocation {
  $type: 'me.lqdev.mycelium.authority.revocation';
  delegationUri: string;
  revokerDid: string;
  reason: string;
  createdAt: string;
}

export interface VerificationResult {
  $type: 'me.lqdev.mycelium.verification.result';
  taskUri: string;
  completionUri: string;
  verifierDid: string;
  status: 'passed' | 'failed' | 'inconclusive';
  summary: string;
  evidenceRefs: ResourceReference[];
  createdAt: string;
}

export interface TrustAttestation {
  $type: 'me.lqdev.mycelium.trust.attestation';
  subjectDid: string;
  attestorDid: string;
  evidenceUris: string[];
  dimensions: Record<string, number>;
  summary: string;
  createdAt: string;
}

export interface TrustRevocation {
  $type: 'me.lqdev.mycelium.trust.revocation';
  attestationUri: string;
  revokerDid: string;
  reason: string;
  createdAt: string;
}

export interface ArtifactManifest {
  $type: 'me.lqdev.mycelium.artifact.manifest';
  artifactId: string;
  cid: string;
  mediaType: string;
  size: number;
  producerDid: string;
  sourceUri?: string;
  createdAt: string;
}

export type ProtocolRecord =
  | TaskOffer
  | TaskClaim
  | TaskRecommendation
  | TaskAward
  | TaskCompletion
  | TaskAcceptance
  | TaskCancellation
  | AuthorityDelegation
  | AuthorityRevocation
  | VerificationResult
  | TrustAttestation
  | TrustRevocation
  | ArtifactManifest;

export interface ProtocolRecordEnvelope {
  uri: string;
  did: string;
  collection: MyceliumCollection;
  rkey: string;
  cid: string;
  record: ProtocolRecord;
}

export interface TaskProjection {
  taskUri: string;
  requesterDid: string;
  state: TaskState;
  claimUris: string[];
  awardUri?: string;
  completionUri?: string;
  acceptanceUri?: string;
  conflictUris: string[];
  explanation: string[];
}
