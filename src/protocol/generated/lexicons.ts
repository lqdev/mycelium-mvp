/**
 * GENERATED CODE - DO NOT MODIFY
 */
import {
  type LexiconDoc,
  Lexicons,
  ValidationError,
  type ValidationResult,
} from '@atproto/lexicon'
import { type $Typed, is$typed, maybe$typed } from './util.js'

export const schemaDict = {
  MeLqdevMyceliumArtifactManifest: {
    lexicon: 1,
    id: 'me.lqdev.mycelium.artifact.manifest',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: [
            'artifactId',
            'cid',
            'mediaType',
            'size',
            'producerDid',
            'createdAt',
          ],
          properties: {
            artifactId: {
              type: 'string',
              maxLength: 512,
            },
            cid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#cid',
            },
            mediaType: {
              type: 'string',
              maxLength: 256,
            },
            size: {
              type: 'integer',
              minimum: 0,
              maximum: 9007199254740991,
            },
            producerDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            sourceUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  MeLqdevMyceliumAuthorityDelegation: {
    lexicon: 1,
    id: 'me.lqdev.mycelium.authority.delegation',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: [
            'delegatorDid',
            'delegateDid',
            'scopes',
            'createdAt',
            'expiresAt',
          ],
          properties: {
            delegatorDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            delegateDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            taskUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            scopes: {
              type: 'array',
              items: {
                type: 'string',
                maxLength: 256,
              },
              maxLength: 32,
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
            expiresAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  MeLqdevMyceliumAuthorityRevocation: {
    lexicon: 1,
    id: 'me.lqdev.mycelium.authority.revocation',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: ['delegationUri', 'revokerDid', 'reason', 'createdAt'],
          properties: {
            delegationUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            revokerDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            reason: {
              type: 'string',
              maxLength: 10000,
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  MeLqdevMyceliumCommon: {
    lexicon: 1,
    id: 'me.lqdev.mycelium.common',
    defs: {
      did: {
        type: 'string',
        maxLength: 512,
      },
      atUri: {
        type: 'string',
        maxLength: 2048,
      },
      cid: {
        type: 'string',
        maxLength: 256,
      },
      resourceRef: {
        type: 'object',
        required: ['uri'],
        properties: {
          uri: {
            type: 'string',
            maxLength: 2048,
          },
          cid: {
            type: 'string',
            maxLength: 256,
          },
        },
      },
      governance: {
        type: 'object',
        required: ['mode'],
        properties: {
          mode: {
            type: 'string',
            knownValues: [
              'requester-selected',
              'delegated-coordinator',
              'committee',
              'deterministic-bounty',
              'self-service',
            ],
          },
          coordinatorDid: {
            type: 'ref',
            ref: 'lex:me.lqdev.mycelium.common#did',
          },
          delegationUri: {
            type: 'ref',
            ref: 'lex:me.lqdev.mycelium.common#atUri',
          },
        },
      },
      rankedClaim: {
        type: 'object',
        required: ['claimUri', 'workerDid', 'score', 'reasons'],
        properties: {
          claimUri: {
            type: 'ref',
            ref: 'lex:me.lqdev.mycelium.common#atUri',
          },
          workerDid: {
            type: 'ref',
            ref: 'lex:me.lqdev.mycelium.common#did',
          },
          score: {
            type: 'integer',
            minimum: -1000000,
            maximum: 1000000,
          },
          reasons: {
            type: 'array',
            items: {
              type: 'string',
              maxLength: 1024,
            },
            maxLength: 32,
          },
        },
      },
    },
  },
  MeLqdevMyceliumTaskAcceptance: {
    lexicon: 1,
    id: 'me.lqdev.mycelium.task.acceptance',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: [
            'taskUri',
            'completionUri',
            'requesterDid',
            'outcome',
            'createdAt',
          ],
          properties: {
            taskUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            completionUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            requesterDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            outcome: {
              type: 'string',
              knownValues: ['accepted', 'rejected', 'partial'],
            },
            notes: {
              type: 'string',
              maxLength: 10000,
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  MeLqdevMyceliumTaskAward: {
    lexicon: 1,
    id: 'me.lqdev.mycelium.task.award',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: [
            'taskUri',
            'claimUri',
            'workerDid',
            'requesterDid',
            'createdAt',
          ],
          properties: {
            taskUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            claimUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            workerDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            requesterDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            coordinatorDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            delegationUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
            expiresAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  MeLqdevMyceliumTaskCancellation: {
    lexicon: 1,
    id: 'me.lqdev.mycelium.task.cancellation',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: ['taskUri', 'requesterDid', 'reason', 'createdAt'],
          properties: {
            taskUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            requesterDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            reason: {
              type: 'string',
              maxLength: 10000,
            },
            supersedesUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  MeLqdevMyceliumTaskClaim: {
    lexicon: 1,
    id: 'me.lqdev.mycelium.task.claim',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: ['taskUri', 'workerDid', 'proposal', 'createdAt'],
          properties: {
            taskUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            workerDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            proposal: {
              type: 'string',
              maxLength: 10000,
            },
            estimatedDuration: {
              type: 'string',
              maxLength: 256,
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
            expiresAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  MeLqdevMyceliumTaskCompletion: {
    lexicon: 1,
    id: 'me.lqdev.mycelium.task.completion',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: [
            'taskUri',
            'claimUri',
            'workerDid',
            'summary',
            'artifactUris',
            'createdAt',
          ],
          properties: {
            taskUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            claimUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            workerDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            summary: {
              type: 'string',
              maxLength: 10000,
            },
            artifactUris: {
              type: 'array',
              items: {
                type: 'ref',
                ref: 'lex:me.lqdev.mycelium.common#atUri',
              },
              maxLength: 128,
            },
            metrics: {
              type: 'unknown',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  MeLqdevMyceliumTaskOffer: {
    lexicon: 1,
    id: 'me.lqdev.mycelium.task.offer',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: [
            'taskId',
            'title',
            'description',
            'requiredCapabilities',
            'contextRefs',
            'deliverables',
            'requesterDid',
            'governance',
            'createdAt',
          ],
          properties: {
            taskId: {
              type: 'string',
              maxLength: 256,
            },
            title: {
              type: 'string',
              maxLength: 512,
            },
            description: {
              type: 'string',
              maxLength: 10000,
            },
            requiredCapabilities: {
              type: 'array',
              items: {
                type: 'string',
                maxLength: 256,
              },
              maxLength: 64,
            },
            contextRefs: {
              type: 'array',
              items: {
                type: 'ref',
                ref: 'lex:me.lqdev.mycelium.common#resourceRef',
              },
              maxLength: 128,
            },
            deliverables: {
              type: 'array',
              items: {
                type: 'string',
                maxLength: 512,
              },
              maxLength: 64,
            },
            requesterDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            governance: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#governance',
            },
            expiresAt: {
              type: 'string',
              format: 'datetime',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  MeLqdevMyceliumTaskRecommendation: {
    lexicon: 1,
    id: 'me.lqdev.mycelium.task.recommendation',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: [
            'taskUri',
            'coordinatorDid',
            'policy',
            'rankedClaims',
            'createdAt',
          ],
          properties: {
            taskUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            coordinatorDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            policy: {
              type: 'string',
              maxLength: 256,
            },
            rankedClaims: {
              type: 'array',
              maxLength: 128,
              items: {
                type: 'ref',
                ref: 'lex:me.lqdev.mycelium.common#rankedClaim',
              },
            },
            selectedClaimUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  MeLqdevMyceliumTrustAttestation: {
    lexicon: 1,
    id: 'me.lqdev.mycelium.trust.attestation',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: [
            'subjectDid',
            'attestorDid',
            'evidenceUris',
            'dimensions',
            'summary',
            'createdAt',
          ],
          properties: {
            subjectDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            attestorDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            evidenceUris: {
              type: 'array',
              items: {
                type: 'ref',
                ref: 'lex:me.lqdev.mycelium.common#atUri',
              },
              maxLength: 128,
            },
            dimensions: {
              type: 'unknown',
            },
            summary: {
              type: 'string',
              maxLength: 10000,
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  MeLqdevMyceliumTrustRevocation: {
    lexicon: 1,
    id: 'me.lqdev.mycelium.trust.revocation',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: ['attestationUri', 'revokerDid', 'reason', 'createdAt'],
          properties: {
            attestationUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            revokerDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            reason: {
              type: 'string',
              maxLength: 10000,
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  MeLqdevMyceliumVerificationResult: {
    lexicon: 1,
    id: 'me.lqdev.mycelium.verification.result',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: [
            'taskUri',
            'completionUri',
            'verifierDid',
            'status',
            'summary',
            'evidenceRefs',
            'createdAt',
          ],
          properties: {
            taskUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            completionUri: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#atUri',
            },
            verifierDid: {
              type: 'ref',
              ref: 'lex:me.lqdev.mycelium.common#did',
            },
            status: {
              type: 'string',
              knownValues: ['passed', 'failed', 'inconclusive'],
            },
            summary: {
              type: 'string',
              maxLength: 10000,
            },
            evidenceRefs: {
              type: 'array',
              items: {
                type: 'ref',
                ref: 'lex:me.lqdev.mycelium.common#resourceRef',
              },
              maxLength: 128,
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
} as const satisfies Record<string, LexiconDoc>
export const schemas = Object.values(schemaDict) satisfies LexiconDoc[]
export const lexicons: Lexicons = new Lexicons(schemas)

export function validate<T extends { $type: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType: true,
): ValidationResult<T>
export function validate<T extends { $type?: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: false,
): ValidationResult<T>
export function validate(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: boolean,
): ValidationResult {
  return (requiredType ? is$typed : maybe$typed)(v, id, hash)
    ? lexicons.validate(`${id}#${hash}`, v)
    : {
        success: false,
        error: new ValidationError(
          `Must be an object with "${hash === 'main' ? id : `${id}#${hash}`}" $type property`,
        ),
      }
}

export const ids = {
  MeLqdevMyceliumArtifactManifest: 'me.lqdev.mycelium.artifact.manifest',
  MeLqdevMyceliumAuthorityDelegation: 'me.lqdev.mycelium.authority.delegation',
  MeLqdevMyceliumAuthorityRevocation: 'me.lqdev.mycelium.authority.revocation',
  MeLqdevMyceliumCommon: 'me.lqdev.mycelium.common',
  MeLqdevMyceliumTaskAcceptance: 'me.lqdev.mycelium.task.acceptance',
  MeLqdevMyceliumTaskAward: 'me.lqdev.mycelium.task.award',
  MeLqdevMyceliumTaskCancellation: 'me.lqdev.mycelium.task.cancellation',
  MeLqdevMyceliumTaskClaim: 'me.lqdev.mycelium.task.claim',
  MeLqdevMyceliumTaskCompletion: 'me.lqdev.mycelium.task.completion',
  MeLqdevMyceliumTaskOffer: 'me.lqdev.mycelium.task.offer',
  MeLqdevMyceliumTaskRecommendation: 'me.lqdev.mycelium.task.recommendation',
  MeLqdevMyceliumTrustAttestation: 'me.lqdev.mycelium.trust.attestation',
  MeLqdevMyceliumTrustRevocation: 'me.lqdev.mycelium.trust.revocation',
  MeLqdevMyceliumVerificationResult: 'me.lqdev.mycelium.verification.result',
} as const
