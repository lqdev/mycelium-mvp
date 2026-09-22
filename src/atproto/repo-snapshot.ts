import { Repo, MemoryBlockstore, readCarWithRoot } from '@atproto/repo';
import type { ProtocolRecordEnvelope } from '../protocol/types.js';
import { isMyceliumCollection } from '../protocol/constants.js';
import { validateProtocolRecord } from '../protocol/validation.js';
import type {
  RepositoryCommitVerifier,
} from './repository-auth.js';

export interface SnapshotQuarantine {
  collection: string;
  rkey: string;
  cid: string;
  reason: string;
}

export interface ProtocolRepoSnapshot {
  did: string;
  /** Signed per-repository revision from the getRepo commit. */
  repoRev: string;
  rootCid: string;
  records: ReadonlyArray<ProtocolRecordEnvelope>;
  quarantined: ReadonlyArray<SnapshotQuarantine>;
}

/**
 * A provider-issued assertion that a repository snapshot and global firehose
 * checkpoint describe one consistent point in the provider's source of truth.
 *
 * `repoRev` identifies the signed repository commit in the CAR. `streamSeq`
 * identifies the global subscribeRepos position. They are intentionally
 * separate values even when a provider can verify them together.
 */
export interface AuthoritativeStreamBoundary {
  readonly streamSeq: number;
  readonly repoDid: string;
  readonly repoRev: string;
  /** Opaque provider-issued proof checked by AuthoritativeRecoveryProvider. */
  readonly proof: string;
}

export interface AuthoritativeRecoverySnapshot {
  readonly snapshot: ProtocolRepoSnapshot;
  readonly boundary: AuthoritativeStreamBoundary;
}

/**
 * The production boundary is an injected capability. This repository does
 * not invent an upstream endpoint that atomically pairs getRepo with
 * subscribeRepos; a deployment must provide and verify that capability.
 */
export interface AuthoritativeRecoveryProvider {
  recover(reason: string): Promise<AuthoritativeRecoverySnapshot>;
  verifyBoundary(recovery: AuthoritativeRecoverySnapshot): Promise<boolean>;
}

export interface RepoSnapshotAdapterOptions {
  endpoint: string;
  did: string;
  commitVerifier: RepositoryCommitVerifier;
  fetchImpl?: typeof fetch;
}

/**
 * Reads the official com.atproto.sync.getRepo CAR export for one repository.
 *
 * getRepo exposes a signed repository revision, not a global subscribeRepos
 * sequence. The adapter therefore returns only `repoRev`; a global
 * `streamSeq` is populated only by an authoritative recovery provider.
 */
export class AtprotoRepoSnapshotAdapter {
  private readonly endpoint: string;
  private readonly did: string;
  private readonly commitVerifier: RepositoryCommitVerifier;
  private readonly fetchImpl: typeof fetch;
  private lastSnapshotValue: ProtocolRepoSnapshot | undefined;

  constructor(options: RepoSnapshotAdapterOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, '');
    this.did = options.did;
    this.commitVerifier = options.commitVerifier;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!this.endpoint) throw new Error('PDS endpoint is required');
    if (!this.did) throw new Error('Repository DID is required');
  }

  async snapshot(): Promise<ReadonlyArray<ProtocolRecordEnvelope>> {
    return (await this.snapshotWithMetadata()).records;
  }

  async snapshotWithMetadata(): Promise<ProtocolRepoSnapshot> {
    const url = `${this.endpoint}/xrpc/com.atproto.sync.getRepo?did=${encodeURIComponent(this.did)}`;
    const response = await this.fetchImpl(url, {
      headers: { Accept: 'application/vnd.ipld.car' },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`com.atproto.sync.getRepo failed (${response.status}): ${body}`);
    }

    const snapshot = await decodeProtocolRepoSnapshot(
      new Uint8Array(await response.arrayBuffer()),
      this.did,
      this.commitVerifier,
    );
    this.lastSnapshotValue = snapshot;
    return snapshot;
  }

  lastSnapshot(): ProtocolRepoSnapshot | undefined {
    return this.lastSnapshotValue;
  }
}

export async function decodeProtocolRepoSnapshot(
  carBytes: Uint8Array,
  expectedDid: string,
  commitVerifier: RepositoryCommitVerifier,
): Promise<ProtocolRepoSnapshot> {
  if (commitVerifier === undefined) {
    throw new Error('repository commit authenticity verifier is required');
  }
  if (expectedDid === undefined) {
    throw new Error('repository DID is required for authenticated snapshot decoding');
  }
  await commitVerifier.verifySnapshot(carBytes, expectedDid);
  const { root, blocks } = await readCarWithRoot(carBytes);
  const storage = new MemoryBlockstore(blocks);
  const repo = await Repo.load(storage, root);

  if (expectedDid !== undefined && repo.did !== expectedDid) {
    throw new Error(`CAR repository DID "${repo.did}" does not match expected DID "${expectedDid}"`);
  }

  const records: ProtocolRecordEnvelope[] = [];
  const quarantined: SnapshotQuarantine[] = [];

  for await (const leaf of repo.data.walkLeavesFrom('')) {
    const separator = leaf.key.indexOf('/');
    const collection = separator >= 0 ? leaf.key.slice(0, separator) : leaf.key;
    const rkey = separator >= 0 ? leaf.key.slice(separator + 1) : '';
    const cid = leaf.value.toString();

    if (separator <= 0 || !rkey || leaf.key.indexOf('/', separator + 1) >= 0) {
      quarantined.push({ collection, rkey, cid, reason: 'invalid repository record path' });
      continue;
    }

    if (!isMyceliumCollection(collection)) {
      quarantined.push({ collection, rkey, cid, reason: 'unsupported collection' });
      continue;
    }

    let record: unknown;
    try {
      record = await storage.readRecord(leaf.value);
    } catch (error) {
      quarantined.push({
        collection,
        rkey,
        cid,
        reason: `record decode failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    try {
      const validated = validateProtocolRecord(collection, record, repo.did);
      records.push({
        uri: `at://${repo.did}/${collection}/${rkey}`,
        did: repo.did,
        collection,
        rkey,
        cid,
        record: validated,
      });
    } catch (error) {
      quarantined.push({
        collection,
        rkey,
        cid,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  records.sort((a, b) => a.uri.localeCompare(b.uri));
  quarantined.sort((a, b) =>
    a.collection.localeCompare(b.collection) || a.rkey.localeCompare(b.rkey));

  return {
    did: repo.did,
    repoRev: repo.commit.rev,
    rootCid: root.toString(),
    records,
    quarantined,
  };
}
