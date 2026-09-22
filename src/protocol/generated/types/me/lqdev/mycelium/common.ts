/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { type ValidationResult, BlobRef } from '@atproto/lexicon'
import { CID } from 'multiformats/cid'
import { validate as _validate } from '../../../../lexicons.js'
import {
  type $Typed,
  is$typed as _is$typed,
  type OmitKey,
} from '../../../../util.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'me.lqdev.mycelium.common'

export type Did = string
export type AtUri = string
export type Cid = string

export interface ResourceRef {
  $type?: 'me.lqdev.mycelium.common#resourceRef'
  uri: string
  cid?: string
}

const hashResourceRef = 'resourceRef'

export function isResourceRef<V>(v: V) {
  return is$typed(v, id, hashResourceRef)
}

export function validateResourceRef<V>(v: V) {
  return validate<ResourceRef & V>(v, id, hashResourceRef)
}

export interface Governance {
  $type?: 'me.lqdev.mycelium.common#governance'
  mode:
    | 'requester-selected'
    | 'delegated-coordinator'
    | 'committee'
    | 'deterministic-bounty'
    | 'self-service'
    | (string & {})
  coordinatorDid?: Did
  delegationUri?: AtUri
}

const hashGovernance = 'governance'

export function isGovernance<V>(v: V) {
  return is$typed(v, id, hashGovernance)
}

export function validateGovernance<V>(v: V) {
  return validate<Governance & V>(v, id, hashGovernance)
}

export interface RankedClaim {
  $type?: 'me.lqdev.mycelium.common#rankedClaim'
  claimUri: AtUri
  workerDid: Did
  score: number
  reasons: string[]
}

const hashRankedClaim = 'rankedClaim'

export function isRankedClaim<V>(v: V) {
  return is$typed(v, id, hashRankedClaim)
}

export function validateRankedClaim<V>(v: V) {
  return validate<RankedClaim & V>(v, id, hashRankedClaim)
}
