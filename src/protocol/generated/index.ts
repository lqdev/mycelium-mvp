/**
 * GENERATED CODE - DO NOT MODIFY
 */
import {
  XrpcClient,
  type FetchHandler,
  type FetchHandlerOptions,
} from '@atproto/xrpc'
import { schemas } from './lexicons.js'
import { CID } from 'multiformats/cid'
import { type OmitKey, type Un$Typed } from './util.js'
import * as MeLqdevMyceliumArtifactManifest from './types/me/lqdev/mycelium/artifact/manifest.js'
import * as MeLqdevMyceliumAuthorityDelegation from './types/me/lqdev/mycelium/authority/delegation.js'
import * as MeLqdevMyceliumAuthorityRevocation from './types/me/lqdev/mycelium/authority/revocation.js'
import * as MeLqdevMyceliumCommon from './types/me/lqdev/mycelium/common.js'
import * as MeLqdevMyceliumTaskAcceptance from './types/me/lqdev/mycelium/task/acceptance.js'
import * as MeLqdevMyceliumTaskAward from './types/me/lqdev/mycelium/task/award.js'
import * as MeLqdevMyceliumTaskCancellation from './types/me/lqdev/mycelium/task/cancellation.js'
import * as MeLqdevMyceliumTaskClaim from './types/me/lqdev/mycelium/task/claim.js'
import * as MeLqdevMyceliumTaskCompletion from './types/me/lqdev/mycelium/task/completion.js'
import * as MeLqdevMyceliumTaskOffer from './types/me/lqdev/mycelium/task/offer.js'
import * as MeLqdevMyceliumTaskRecommendation from './types/me/lqdev/mycelium/task/recommendation.js'
import * as MeLqdevMyceliumTrustAttestation from './types/me/lqdev/mycelium/trust/attestation.js'
import * as MeLqdevMyceliumTrustRevocation from './types/me/lqdev/mycelium/trust/revocation.js'
import * as MeLqdevMyceliumVerificationResult from './types/me/lqdev/mycelium/verification/result.js'

export * as MeLqdevMyceliumArtifactManifest from './types/me/lqdev/mycelium/artifact/manifest.js'
export * as MeLqdevMyceliumAuthorityDelegation from './types/me/lqdev/mycelium/authority/delegation.js'
export * as MeLqdevMyceliumAuthorityRevocation from './types/me/lqdev/mycelium/authority/revocation.js'
export * as MeLqdevMyceliumCommon from './types/me/lqdev/mycelium/common.js'
export * as MeLqdevMyceliumTaskAcceptance from './types/me/lqdev/mycelium/task/acceptance.js'
export * as MeLqdevMyceliumTaskAward from './types/me/lqdev/mycelium/task/award.js'
export * as MeLqdevMyceliumTaskCancellation from './types/me/lqdev/mycelium/task/cancellation.js'
export * as MeLqdevMyceliumTaskClaim from './types/me/lqdev/mycelium/task/claim.js'
export * as MeLqdevMyceliumTaskCompletion from './types/me/lqdev/mycelium/task/completion.js'
export * as MeLqdevMyceliumTaskOffer from './types/me/lqdev/mycelium/task/offer.js'
export * as MeLqdevMyceliumTaskRecommendation from './types/me/lqdev/mycelium/task/recommendation.js'
export * as MeLqdevMyceliumTrustAttestation from './types/me/lqdev/mycelium/trust/attestation.js'
export * as MeLqdevMyceliumTrustRevocation from './types/me/lqdev/mycelium/trust/revocation.js'
export * as MeLqdevMyceliumVerificationResult from './types/me/lqdev/mycelium/verification/result.js'

export class AtpBaseClient extends XrpcClient {
  me: MeNS

  constructor(options: FetchHandler | FetchHandlerOptions) {
    super(options, schemas)
    this.me = new MeNS(this)
  }

  /** @deprecated use `this` instead */
  get xrpc(): XrpcClient {
    return this
  }
}

export class MeNS {
  _client: XrpcClient
  lqdev: MeLqdevNS

  constructor(client: XrpcClient) {
    this._client = client
    this.lqdev = new MeLqdevNS(client)
  }
}

export class MeLqdevNS {
  _client: XrpcClient
  mycelium: MeLqdevMyceliumNS

  constructor(client: XrpcClient) {
    this._client = client
    this.mycelium = new MeLqdevMyceliumNS(client)
  }
}

export class MeLqdevMyceliumNS {
  _client: XrpcClient
  artifact: MeLqdevMyceliumArtifactNS
  authority: MeLqdevMyceliumAuthorityNS
  task: MeLqdevMyceliumTaskNS
  trust: MeLqdevMyceliumTrustNS
  verification: MeLqdevMyceliumVerificationNS

  constructor(client: XrpcClient) {
    this._client = client
    this.artifact = new MeLqdevMyceliumArtifactNS(client)
    this.authority = new MeLqdevMyceliumAuthorityNS(client)
    this.task = new MeLqdevMyceliumTaskNS(client)
    this.trust = new MeLqdevMyceliumTrustNS(client)
    this.verification = new MeLqdevMyceliumVerificationNS(client)
  }
}

export class MeLqdevMyceliumArtifactNS {
  _client: XrpcClient
  manifest: MeLqdevMyceliumArtifactManifestRecord

  constructor(client: XrpcClient) {
    this._client = client
    this.manifest = new MeLqdevMyceliumArtifactManifestRecord(client)
  }
}

export class MeLqdevMyceliumArtifactManifestRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: MeLqdevMyceliumArtifactManifest.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'me.lqdev.mycelium.artifact.manifest',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: MeLqdevMyceliumArtifactManifest.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'me.lqdev.mycelium.artifact.manifest',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumArtifactManifest.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.artifact.manifest'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumArtifactManifest.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.artifact.manifest'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'me.lqdev.mycelium.artifact.manifest', ...params },
      { headers },
    )
  }
}

export class MeLqdevMyceliumAuthorityNS {
  _client: XrpcClient
  delegation: MeLqdevMyceliumAuthorityDelegationRecord
  revocation: MeLqdevMyceliumAuthorityRevocationRecord

  constructor(client: XrpcClient) {
    this._client = client
    this.delegation = new MeLqdevMyceliumAuthorityDelegationRecord(client)
    this.revocation = new MeLqdevMyceliumAuthorityRevocationRecord(client)
  }
}

export class MeLqdevMyceliumAuthorityDelegationRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: MeLqdevMyceliumAuthorityDelegation.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'me.lqdev.mycelium.authority.delegation',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: MeLqdevMyceliumAuthorityDelegation.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'me.lqdev.mycelium.authority.delegation',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumAuthorityDelegation.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.authority.delegation'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumAuthorityDelegation.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.authority.delegation'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'me.lqdev.mycelium.authority.delegation', ...params },
      { headers },
    )
  }
}

export class MeLqdevMyceliumAuthorityRevocationRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: MeLqdevMyceliumAuthorityRevocation.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'me.lqdev.mycelium.authority.revocation',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: MeLqdevMyceliumAuthorityRevocation.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'me.lqdev.mycelium.authority.revocation',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumAuthorityRevocation.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.authority.revocation'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumAuthorityRevocation.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.authority.revocation'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'me.lqdev.mycelium.authority.revocation', ...params },
      { headers },
    )
  }
}

export class MeLqdevMyceliumTaskNS {
  _client: XrpcClient
  acceptance: MeLqdevMyceliumTaskAcceptanceRecord
  award: MeLqdevMyceliumTaskAwardRecord
  cancellation: MeLqdevMyceliumTaskCancellationRecord
  claim: MeLqdevMyceliumTaskClaimRecord
  completion: MeLqdevMyceliumTaskCompletionRecord
  offer: MeLqdevMyceliumTaskOfferRecord
  recommendation: MeLqdevMyceliumTaskRecommendationRecord

  constructor(client: XrpcClient) {
    this._client = client
    this.acceptance = new MeLqdevMyceliumTaskAcceptanceRecord(client)
    this.award = new MeLqdevMyceliumTaskAwardRecord(client)
    this.cancellation = new MeLqdevMyceliumTaskCancellationRecord(client)
    this.claim = new MeLqdevMyceliumTaskClaimRecord(client)
    this.completion = new MeLqdevMyceliumTaskCompletionRecord(client)
    this.offer = new MeLqdevMyceliumTaskOfferRecord(client)
    this.recommendation = new MeLqdevMyceliumTaskRecommendationRecord(client)
  }
}

export class MeLqdevMyceliumTaskAcceptanceRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: MeLqdevMyceliumTaskAcceptance.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'me.lqdev.mycelium.task.acceptance',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: MeLqdevMyceliumTaskAcceptance.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'me.lqdev.mycelium.task.acceptance',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTaskAcceptance.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.task.acceptance'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTaskAcceptance.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.task.acceptance'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'me.lqdev.mycelium.task.acceptance', ...params },
      { headers },
    )
  }
}

export class MeLqdevMyceliumTaskAwardRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: MeLqdevMyceliumTaskAward.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'me.lqdev.mycelium.task.award',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: MeLqdevMyceliumTaskAward.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'me.lqdev.mycelium.task.award',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTaskAward.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.task.award'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTaskAward.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.task.award'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'me.lqdev.mycelium.task.award', ...params },
      { headers },
    )
  }
}

export class MeLqdevMyceliumTaskCancellationRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: MeLqdevMyceliumTaskCancellation.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'me.lqdev.mycelium.task.cancellation',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: MeLqdevMyceliumTaskCancellation.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'me.lqdev.mycelium.task.cancellation',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTaskCancellation.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.task.cancellation'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTaskCancellation.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.task.cancellation'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'me.lqdev.mycelium.task.cancellation', ...params },
      { headers },
    )
  }
}

export class MeLqdevMyceliumTaskClaimRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: MeLqdevMyceliumTaskClaim.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'me.lqdev.mycelium.task.claim',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: MeLqdevMyceliumTaskClaim.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'me.lqdev.mycelium.task.claim',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTaskClaim.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.task.claim'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTaskClaim.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.task.claim'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'me.lqdev.mycelium.task.claim', ...params },
      { headers },
    )
  }
}

export class MeLqdevMyceliumTaskCompletionRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: MeLqdevMyceliumTaskCompletion.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'me.lqdev.mycelium.task.completion',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: MeLqdevMyceliumTaskCompletion.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'me.lqdev.mycelium.task.completion',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTaskCompletion.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.task.completion'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTaskCompletion.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.task.completion'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'me.lqdev.mycelium.task.completion', ...params },
      { headers },
    )
  }
}

export class MeLqdevMyceliumTaskOfferRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: MeLqdevMyceliumTaskOffer.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'me.lqdev.mycelium.task.offer',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: MeLqdevMyceliumTaskOffer.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'me.lqdev.mycelium.task.offer',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTaskOffer.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.task.offer'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTaskOffer.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.task.offer'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'me.lqdev.mycelium.task.offer', ...params },
      { headers },
    )
  }
}

export class MeLqdevMyceliumTaskRecommendationRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: MeLqdevMyceliumTaskRecommendation.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'me.lqdev.mycelium.task.recommendation',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: MeLqdevMyceliumTaskRecommendation.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'me.lqdev.mycelium.task.recommendation',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTaskRecommendation.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.task.recommendation'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTaskRecommendation.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.task.recommendation'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'me.lqdev.mycelium.task.recommendation', ...params },
      { headers },
    )
  }
}

export class MeLqdevMyceliumTrustNS {
  _client: XrpcClient
  attestation: MeLqdevMyceliumTrustAttestationRecord
  revocation: MeLqdevMyceliumTrustRevocationRecord

  constructor(client: XrpcClient) {
    this._client = client
    this.attestation = new MeLqdevMyceliumTrustAttestationRecord(client)
    this.revocation = new MeLqdevMyceliumTrustRevocationRecord(client)
  }
}

export class MeLqdevMyceliumTrustAttestationRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: MeLqdevMyceliumTrustAttestation.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'me.lqdev.mycelium.trust.attestation',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: MeLqdevMyceliumTrustAttestation.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'me.lqdev.mycelium.trust.attestation',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTrustAttestation.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.trust.attestation'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTrustAttestation.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.trust.attestation'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'me.lqdev.mycelium.trust.attestation', ...params },
      { headers },
    )
  }
}

export class MeLqdevMyceliumTrustRevocationRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: MeLqdevMyceliumTrustRevocation.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'me.lqdev.mycelium.trust.revocation',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: MeLqdevMyceliumTrustRevocation.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'me.lqdev.mycelium.trust.revocation',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTrustRevocation.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.trust.revocation'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumTrustRevocation.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.trust.revocation'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'me.lqdev.mycelium.trust.revocation', ...params },
      { headers },
    )
  }
}

export class MeLqdevMyceliumVerificationNS {
  _client: XrpcClient
  result: MeLqdevMyceliumVerificationResultRecord

  constructor(client: XrpcClient) {
    this._client = client
    this.result = new MeLqdevMyceliumVerificationResultRecord(client)
  }
}

export class MeLqdevMyceliumVerificationResultRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: MeLqdevMyceliumVerificationResult.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'me.lqdev.mycelium.verification.result',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: MeLqdevMyceliumVerificationResult.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'me.lqdev.mycelium.verification.result',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumVerificationResult.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.verification.result'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<MeLqdevMyceliumVerificationResult.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'me.lqdev.mycelium.verification.result'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'me.lqdev.mycelium.verification.result', ...params },
      { headers },
    )
  }
}
