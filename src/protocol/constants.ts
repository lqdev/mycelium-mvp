export const PROTOCOL_VERSION = '0.1.0';
export const MYCELIUM_NAMESPACE = 'me.lqdev.mycelium';

export const COLLECTIONS = {
  taskOffer: `${MYCELIUM_NAMESPACE}.task.offer`,
  taskClaim: `${MYCELIUM_NAMESPACE}.task.claim`,
  taskRecommendation: `${MYCELIUM_NAMESPACE}.task.recommendation`,
  taskAward: `${MYCELIUM_NAMESPACE}.task.award`,
  taskCompletion: `${MYCELIUM_NAMESPACE}.task.completion`,
  taskAcceptance: `${MYCELIUM_NAMESPACE}.task.acceptance`,
  taskCancellation: `${MYCELIUM_NAMESPACE}.task.cancellation`,
  authorityDelegation: `${MYCELIUM_NAMESPACE}.authority.delegation`,
  authorityRevocation: `${MYCELIUM_NAMESPACE}.authority.revocation`,
  verificationResult: `${MYCELIUM_NAMESPACE}.verification.result`,
  trustAttestation: `${MYCELIUM_NAMESPACE}.trust.attestation`,
  trustRevocation: `${MYCELIUM_NAMESPACE}.trust.revocation`,
  artifactManifest: `${MYCELIUM_NAMESPACE}.artifact.manifest`,
} as const;

export type MyceliumCollection = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export const ROLE_PERMISSION_SETS = {
  requester: `${MYCELIUM_NAMESPACE}.auth.requester`,
  worker: `${MYCELIUM_NAMESPACE}.auth.worker`,
  verifier: `${MYCELIUM_NAMESPACE}.auth.verifier`,
  coordinator: `${MYCELIUM_NAMESPACE}.auth.coordinator`,
} as const;

export type ProtocolRole = keyof typeof ROLE_PERMISSION_SETS;

export const GOVERNANCE_MODES = [
  'requester-selected',
  'delegated-coordinator',
  'committee',
  'deterministic-bounty',
  'self-service',
] as const;

export type GovernanceMode = (typeof GOVERNANCE_MODES)[number];

export const TASK_STATES = [
  'open',
  'claimed',
  'awarded',
  'in-progress',
  'submitted',
  'verified',
  'accepted',
  'cancelled',
  'disputed',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export function isMyceliumCollection(value: string): value is MyceliumCollection {
  return (Object.values(COLLECTIONS) as string[]).includes(value);
}
