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
const id = 'me.lqdev.mycelium.trust.attestation'

export interface Main {
  $type: 'me.lqdev.mycelium.trust.attestation'
  subjectDid: MeLqdevMyceliumCommon.Did
  attestorDid: MeLqdevMyceliumCommon.Did
  evidenceUris: MeLqdevMyceliumCommon.AtUri[]
  dimensions: { [_ in string]: unknown }
  summary: string
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
