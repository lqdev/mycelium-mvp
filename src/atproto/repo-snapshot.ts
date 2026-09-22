import { Repo, MemoryBlockstore, readCarWithRoot } from '@atproto/repo';
import type { ProtocolRecordEnvelope } from '../protocol/types.js';
import { isMyceliumCollection } from '../protocol/constants.js';
import { validateProtocolRecord } from '../protocol/validation.js';

export interface SnapshotQuarantine {
  collection: string;
  rkey: string;
  cid: string;
  reason: string;
}

export interface ProtocolRepoSnapshot {
  did: string;
  cursor: string;
  rootCid: string;
  records: ReadonlyArray<ProtocolRecordEnvelope>;
  quarantined: ReadonlyArray<SnapshotQuarantine>;
}

export interface RepoSnapshotAdapterOptions {
  endpoint: string;
  did: string;
  fetchImpl?: typeof fetch;
}

/**
 * Reads the official com.atproto.sync.getRepo CAR export for one repository.
 *
 * The returned cursor is the signed repository commit revision (`rev`), not a
 * locally invented sequence. A subscribeRepos consumer can use that revision
 * when it adds the live handoff in a later change.
 */
export class AtprotoRepoSnapshotAdapter {
  private readonly endpoint: string;
  private readonly did: string;
  private readonly fetchImpl: typeof fetch;
  private lastSnapshotValue: ProtocolRepoSnapshot | undefined;

  constructor(options: RepoSnapshotAdapterOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, '');
    this.did = options.did;
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
  expectedDid?: string,
): Promise<ProtocolRepoSnapshot> {
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
    cursor: repo.commit.rev,
    rootCid: root.toString(),
    records,
    quarantined,
  };
}
