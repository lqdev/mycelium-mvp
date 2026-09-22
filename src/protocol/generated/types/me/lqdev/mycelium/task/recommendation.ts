/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { type ValidationResult, BlobRef } from '@atproto/lexicon'
import { CID } from 'multiformats/cid'
import { validate as _validate } from '../../../../../lexicons.js'
import {
  type $Typed,
  is$typed as _is$typed,
  type OmitKey,
} from '../../../../../util.js'
import type * as MeLqdevMyceliumCommon from '../common.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'me.lqdev.mycelium.task.recommendation'

export interface Main {
  $type: 'me.lqdev.mycelium.task.recommendation'
  taskUri: MeLqdevMyceliumCommon.AtUri
  coordinatorDid: MeLqdevMyceliumCommon.Did
  policy: string
  rankedClaims: MeLqdevMyceliumCommon.RankedClaim[]
  selectedClaimUri?: MeLqdevMyceliumCommon.AtUri
  createdAt: string
  [k: string]: unknown
}

const hashMain = 'main'

export function isMain<V>(v: V) {
  return is$typed(v, id, hashMain)
}

export function validateMain<V>(v: V) {
  return validate<Main & V>(v, id, hashMain, true)
}

export {
  type Main as Record,
  isMain as isRecord,
  validateMain as validateRecord,
}
