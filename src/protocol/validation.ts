import { z } from 'zod';
import { ProtocolValidationError } from '../errors.js';
import { COLLECTIONS, isMyceliumCollection } from './constants.js';
import type {
  ProtocolRecord,
  AuthorityDelegation,
  AuthorityRevocation,
  TaskAcceptance,
  TaskAward,
  TaskCancellation,
  TaskClaim,
  TaskCompletion,
  TaskOffer,
  TaskRecommendation,
  TrustAttestation,
  TrustRevocation,
  VerificationResult,
  ArtifactManifest,
} from './types.js';

const did = z.string().regex(/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/);
const atUri = z.string().regex(/^at:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+$/);
const timestamp = z.string().datetime({ offset: true });
const cid = z.string().min(1);
const reference = z.object({ uri: atUri, cid: cid.optional() });

const taskOfferSchema = z.object({
  $type: z.literal(COLLECTIONS.taskOffer),
  taskId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  requiredCapabilities: z.array(z.string().min(1)),
  contextRefs: z.array(reference),
  deliverables: z.array(z.string().min(1)),
  requesterDid: did,
  governance: z.object({
    mode: z.enum([
      'requester-selected',
      'delegated-coordinator',
      'committee',
      'deterministic-bounty',
      'self-service',
    ]),
    coordinatorDid: did.optional(),
    delegationUri: atUri.optional(),
  }),
  expiresAt: timestamp.optional(),
  createdAt: timestamp,
});

const taskClaimSchema = z.object({
  $type: z.literal(COLLECTIONS.taskClaim),
  taskUri: atUri,
  workerDid: did,
  proposal: z.string().min(1),
  estimatedDuration: z.string().min(1).optional(),
  createdAt: timestamp,
  expiresAt: timestamp.optional(),
});

const taskRecommendationSchema = z.object({
  $type: z.literal(COLLECTIONS.taskRecommendation),
  taskUri: atUri,
  coordinatorDid: did,
  policy: z.string().min(1),
  rankedClaims: z.array(z.object({
    claimUri: atUri,
    workerDid: did,
    score: z.number().finite(),
    reasons: z.array(z.string().min(1)),
  })),
  selectedClaimUri: atUri.optional(),
  createdAt: timestamp,
});

const taskAwardSchema = z.object({
  $type: z.literal(COLLECTIONS.taskAward),
  taskUri: atUri,
  claimUri: atUri,
  workerDid: did,
  requesterDid: did,
  coordinatorDid: did.optional(),
  delegationUri: atUri.optional(),
  createdAt: timestamp,
  expiresAt: timestamp.optional(),
});

const taskCompletionSchema = z.object({
  $type: z.literal(COLLECTIONS.taskCompletion),
  taskUri: atUri,
  claimUri: atUri,
  workerDid: did,
  summary: z.string().min(1),
  artifactUris: z.array(atUri),
  metrics: z.record(z.union([z.number().finite(), z.string().min(1)])).optional(),
  createdAt: timestamp,
});

const taskAcceptanceSchema = z.object({
  $type: z.literal(COLLECTIONS.taskAcceptance),
  taskUri: atUri,
  completionUri: atUri,
  requesterDid: did,
  outcome: z.enum(['accepted', 'rejected', 'partial']),
  notes: z.string().min(1).optional(),
  createdAt: timestamp,
});

const taskCancellationSchema = z.object({
  $type: z.literal(COLLECTIONS.taskCancellation),
  taskUri: atUri,
  requesterDid: did,
  reason: z.string().min(1),
  supersedesUri: atUri.optional(),
  createdAt: timestamp,
});

const authorityDelegationSchema = z.object({
  $type: z.literal(COLLECTIONS.authorityDelegation),
  delegatorDid: did,
  delegateDid: did,
  taskUri: atUri.optional(),
  scopes: z.array(z.string().min(1)).min(1),
  createdAt: timestamp,
  expiresAt: timestamp,
});

const authorityRevocationSchema = z.object({
  $type: z.literal(COLLECTIONS.authorityRevocation),
  delegationUri: atUri,
  revokerDid: did,
  reason: z.string().min(1),
  createdAt: timestamp,
});

const verificationResultSchema = z.object({
  $type: z.literal(COLLECTIONS.verificationResult),
  taskUri: atUri,
  completionUri: atUri,
  verifierDid: did,
  status: z.enum(['passed', 'failed', 'inconclusive']),
  summary: z.string().min(1),
  evidenceRefs: z.array(reference),
  createdAt: timestamp,
});

const trustAttestationSchema = z.object({
  $type: z.literal(COLLECTIONS.trustAttestation),
  subjectDid: did,
  attestorDid: did,
  evidenceUris: z.array(atUri),
  dimensions: z.record(z.number().min(0).max(10).finite()),
  summary: z.string().min(1),
  createdAt: timestamp,
});

const trustRevocationSchema = z.object({
  $type: z.literal(COLLECTIONS.trustRevocation),
  attestationUri: atUri,
  revokerDid: did,
  reason: z.string().min(1),
  createdAt: timestamp,
});

const artifactManifestSchema = z.object({
  $type: z.literal(COLLECTIONS.artifactManifest),
  artifactId: z.string().min(1),
  cid,
  mediaType: z.string().min(1),
  size: z.number().int().min(0),
  producerDid: did,
  sourceUri: atUri.optional(),
  createdAt: timestamp,
});

export const protocolSchemas = {
  [COLLECTIONS.taskOffer]: taskOfferSchema,
  [COLLECTIONS.taskClaim]: taskClaimSchema,
  [COLLECTIONS.taskRecommendation]: taskRecommendationSchema,
  [COLLECTIONS.taskAward]: taskAwardSchema,
  [COLLECTIONS.taskCompletion]: taskCompletionSchema,
  [COLLECTIONS.taskAcceptance]: taskAcceptanceSchema,
  [COLLECTIONS.taskCancellation]: taskCancellationSchema,
  [COLLECTIONS.authorityDelegation]: authorityDelegationSchema,
  [COLLECTIONS.authorityRevocation]: authorityRevocationSchema,
  [COLLECTIONS.verificationResult]: verificationResultSchema,
  [COLLECTIONS.trustAttestation]: trustAttestationSchema,
  [COLLECTIONS.trustRevocation]: trustRevocationSchema,
  [COLLECTIONS.artifactManifest]: artifactManifestSchema,
} as const;

export type ProtocolSchema = (typeof protocolSchemas)[keyof typeof protocolSchemas];

function assertAuthor(
  collection: string,
  repoDid: string,
  record: ProtocolRecord,
): void {
  const authorField = (() => {
    switch (collection) {
      case COLLECTIONS.taskOffer: return (record as TaskOffer).requesterDid;
      case COLLECTIONS.taskClaim: return (record as TaskClaim).workerDid;
      case COLLECTIONS.taskRecommendation: return (record as TaskRecommendation).coordinatorDid;
      case COLLECTIONS.taskCompletion: return (record as TaskCompletion).workerDid;
      case COLLECTIONS.taskAcceptance: return (record as TaskAcceptance).requesterDid;
      case COLLECTIONS.taskCancellation: return (record as TaskCancellation).requesterDid;
      case COLLECTIONS.authorityDelegation: return (record as AuthorityDelegation).delegatorDid;
      case COLLECTIONS.authorityRevocation: return (record as AuthorityRevocation).revokerDid;
      case COLLECTIONS.verificationResult: return (record as VerificationResult).verifierDid;
      case COLLECTIONS.trustAttestation: return (record as TrustAttestation).attestorDid;
      case COLLECTIONS.trustRevocation: return (record as TrustRevocation).revokerDid;
      case COLLECTIONS.artifactManifest: return (record as ArtifactManifest).producerDid;
      case COLLECTIONS.taskAward: {
        const award = record as TaskAward;
        return award.coordinatorDid ?? award.requesterDid;
      }
      default: return undefined;
    }
  })();

  if (authorField !== repoDid) {
    throw new ProtocolValidationError(collection, {
      reason: 'author-subject-mismatch',
      expectedAuthor: repoDid,
      declaredAuthor: authorField,
    });
  }
}

export function validateProtocolRecord(
  collection: string,
  content: unknown,
  repoDid?: string,
): ProtocolRecord {
  if (!isMyceliumCollection(collection)) {
    throw new ProtocolValidationError(collection, { reason: 'unknown-collection' });
  }

  const schema = protocolSchemas[collection];
  const parsed = schema.safeParse(content);
  if (!parsed.success) {
    throw new ProtocolValidationError(collection, parsed.error.flatten());
  }

  const record = parsed.data as ProtocolRecord;
  if (repoDid) assertAuthor(collection, repoDid, record);
  return record;
}

export function isProtocolRecord(collection: string, content: unknown): content is ProtocolRecord {
  try {
    validateProtocolRecord(collection, content);
    return true;
  } catch {
    return false;
  }
}
