import {
  bytesToMultibase,
  formatDidKey,
  multibaseToBytes,
  parseMultikey,
  P256_JWT_ALG,
  SECP256K1_JWT_ALG,
} from '@atproto/crypto';
import {
  type BlockMap,
  readCarWithRoot,
  MemoryBlockstore,
  Repo,
} from '@atproto/repo';
import { verifyCommitSig, verifyRepo } from '@atproto/repo';
import type { Commit } from '@atproto/repo';

export interface DidVerificationMethod {
  readonly id: string;
  readonly type: string;
  readonly controller: string;
  readonly publicKeyMultibase?: string | undefined;
}

export interface DidDocument {
  readonly id: string;
  readonly verificationMethod?: ReadonlyArray<DidVerificationMethod> | undefined;
}

/**
 * Resolves a DID document from the deployment's identity service.
 *
 * Implementations must resolve a fresh enough document for the caller's key
 * rotation policy. The verifier intentionally does not fetch the network.
 */
export interface DidDocumentResolver {
  resolve(did: string): Promise<DidDocument>;
}

export interface ResolvedRepositoryVerificationKey {
  readonly id: string;
  /** A did:key form accepted by @atproto/crypto verification. */
  readonly didKey: string;
}

/**
 * Selects the currently authorized AT Protocol signing keys from a DID
 * document. Returning more than one key lets a deployment overlap rotations.
 */
export interface RepositoryVerificationKeyResolver {
  resolve(
    did: string,
    document: DidDocument,
  ): Promise<ReadonlyArray<ResolvedRepositoryVerificationKey>>;
}

export interface RepositoryCommitVerification {
  readonly did: string;
  readonly commitCid: string;
  readonly repoRev: string;
}

export interface LiveCommitOperationClaim {
  readonly action: 'create' | 'update' | 'delete';
  readonly collection: string;
  readonly rkey: string;
  readonly cid?: string | undefined;
}

export interface LiveCommitVerificationInput {
  readonly streamSeq: number;
  readonly did: string;
  readonly commitCid: string;
  readonly repoRev: string;
  readonly carBytes: Uint8Array;
  readonly operations: ReadonlyArray<LiveCommitOperationClaim>;
}

export interface RepositoryCommitVerifier {
  verifySnapshot(
    carBytes: Uint8Array,
    expectedDid: string,
  ): Promise<RepositoryCommitVerification>;
  verifyLiveCommit(input: LiveCommitVerificationInput): Promise<RepositoryCommitVerification>;
}

/**
 * Converts an injected DID document resolver into the verification-key
 * contract used by the repository verifier.
 *
 * Only the DID document's explicitly authorized `#atproto` Multikey is
 * accepted. A PLC/web repository never falls back to a did:key derived from
 * the repository DID itself.
 */
export class AtprotoDidDocumentKeyResolver implements RepositoryVerificationKeyResolver {
  async resolve(
    did: string,
    document: DidDocument,
  ): Promise<ReadonlyArray<ResolvedRepositoryVerificationKey>> {
    if (!isSupportedRepositoryDid(did)) {
      throw new Error(`unsupported repository DID method "${did.split(':')[1] ?? ''}"`);
    }
    if (document.id !== did) {
      throw new Error(`DID document id "${document.id}" does not match repository DID "${did}"`);
    }

    const methods = (document.verificationMethod ?? [])
      .filter((method) => {
        const absoluteId = method.id.startsWith('#') ? `${did}${method.id}` : method.id;
        return absoluteId === `${did}#atproto` && method.controller === did;
      });
    if (methods.length === 0) {
      throw new Error(`DID document for "${did}" has no authorized #atproto Multikey`);
    }

    return methods.map((method) => {
      if (method.publicKeyMultibase === undefined) {
        throw new Error(`DID verification method "${method.id}" has no publicKeyMultibase`);
      }
      const parsed = parseVerificationKey(method.type, method.publicKeyMultibase);
      return {
        id: method.id.startsWith('#') ? `${did}${method.id}` : method.id,
        didKey: formatDidKey(parsed.jwtAlg, parsed.keyBytes),
      };
    });
  }

}

function parseVerificationKey(type: string, publicKeyMultibase: string): {
  jwtAlg: string;
  keyBytes: Uint8Array;
} {
  if (type === 'Multikey') {
    return parseMultikey(publicKeyMultibase);
  }
  if (type === 'EcdsaSecp256r1VerificationKey2019') {
    return { jwtAlg: P256_JWT_ALG, keyBytes: multibaseToBytes(publicKeyMultibase) };
  }
  if (type === 'EcdsaSecp256k1VerificationKey2019') {
    return { jwtAlg: SECP256K1_JWT_ALG, keyBytes: multibaseToBytes(publicKeyMultibase) };
  }
  throw new Error(`unsupported AT Protocol verification method type "${type}"`);
}

/**
 * Uses the official @atproto/repo and @atproto/crypto primitives:
 * `verifyRepo` validates the signed root and complete snapshot MST, while the
 * live path validates the signed root and each operation's post-commit MST
 * claim. The live CAR is often a proof slice rather than a full repository,
 * so it deliberately does not claim full diff verification without prior
 * verified repo state.
 */
export class AtprotoRepositoryCommitVerifier implements RepositoryCommitVerifier {
  constructor(
    private readonly documents: DidDocumentResolver,
    private readonly keys: RepositoryVerificationKeyResolver =
      new AtprotoDidDocumentKeyResolver(),
  ) {}

  async verifySnapshot(
    carBytes: Uint8Array,
    expectedDid: string,
  ): Promise<RepositoryCommitVerification> {
    const car = await readCarWithRoot(carBytes);
    const commit = await this.verifyRoot(
      car.blocks,
      car.root,
      expectedDid,
      true,
    );
    return toVerification(commit.commit, car.root);
  }

  async verifyLiveCommit(
    input: LiveCommitVerificationInput,
  ): Promise<RepositoryCommitVerification> {
    const car = await readCarWithRoot(input.carBytes);
    if (car.root.toString() !== input.commitCid) {
      throw new Error(
        `subscribeRepos commit CID "${input.commitCid}" does not match CAR root "${car.root}"`,
      );
    }
    const repo = await this.verifyRoot(
      car.blocks,
      car.root,
      input.did,
      false,
    );
    if (repo.commit.rev !== input.repoRev) {
      throw new Error(
        `subscribeRepos repo revision "${input.repoRev}" does not match signed commit "${repo.commit.rev}"`,
      );
    }
    for (const operation of input.operations) {
      const committedCid = await repo.data.get(`${operation.collection}/${operation.rkey}`);
      if (operation.action === 'delete') {
        if (committedCid !== null) {
          throw new Error(
            `signed commit still contains deleted path "${operation.collection}/${operation.rkey}"`,
          );
        }
        continue;
      }
      if (operation.cid === undefined || committedCid?.toString() !== operation.cid) {
        throw new Error(
          `operation CID does not match signed MST path "${operation.collection}/${operation.rkey}"`,
        );
      }
    }
    return toVerification(repo.commit, car.root);
  }

  private async verifyRoot(
    blocks: BlockMap,
    root: Awaited<ReturnType<typeof readCarWithRoot>>['root'],
    expectedDid: string,
    ensureLeaves: boolean,
  ): Promise<Repo> {
    const document = await this.documents.resolve(expectedDid);
    const candidates = await this.keys.resolve(expectedDid, document);
    if (candidates.length === 0) {
      throw new Error(`DID document resolver returned no repository signing keys for "${expectedDid}"`);
    }

    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        const storage = new MemoryBlockstore(blocks);
        const repo = await Repo.load(storage, root);
        if (repo.did !== expectedDid) {
          throw new Error(`signed commit DID "${repo.did}" does not match "${expectedDid}"`);
        }
        if (ensureLeaves) {
          await verifyRepo(
            blocks,
            root,
            expectedDid,
            candidate.didKey,
          );
        } else if (!await verifyCommitSig(repo.commit, candidate.didKey)) {
          throw new Error(`invalid signature on commit "${root.toString()}"`);
        }
        return repo;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `repository commit signature/key authorization failed for "${expectedDid}": ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}

function toVerification(
  commit: Commit,
  root: Awaited<ReturnType<typeof readCarWithRoot>>['root'],
): RepositoryCommitVerification {
  return {
    did: commit.did,
    commitCid: root.toString(),
    repoRev: commit.rev,
  };
}

function isSupportedRepositoryDid(did: string): boolean {
  return did.startsWith('did:plc:') || did.startsWith('did:web:');
}
