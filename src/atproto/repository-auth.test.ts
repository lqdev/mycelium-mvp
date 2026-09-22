import { readFile } from 'node:fs/promises';
import {
  bytesToMultibase,
  formatDidKey,
  P256Keypair,
  parseDidKey,
  parseMultikey,
} from '@atproto/crypto';
import {
  getFullRepo,
  MemoryBlockstore,
  Repo,
  WriteOpAction,
} from '@atproto/repo';
import { describe, expect, it } from 'vitest';
import {
  AtprotoRepositoryCommitVerifier,
  type DidDocument,
} from './repository-auth.js';

const did = 'did:plc:authenticated-fixture';
const collection = 'me.lqdev.mycelium.task.offer';
const rkey = 'task-1';
const minimalCar = await readFile(new URL('./minimal-repo.car', import.meta.url));

async function makeSignedRepository() {
  const keypair = await P256Keypair.create();
  const storage = new MemoryBlockstore();
  const repo = await Repo.create(storage, did, keypair, [{
    action: WriteOpAction.Create,
    collection,
    rkey,
    record: {
      $type: collection,
      taskId: rkey,
      title: 'Authenticated task',
    },
  }]);
  const chunks: Uint8Array[] = [];
  for await (const chunk of getFullRepo(storage, repo.cid)) chunks.push(chunk);
  const carBytes = concat(chunks);
  const parsed = parseDidKey(keypair.did());
  const publicKeyMultibase = formatDidKey(parsed.jwtAlg, parsed.keyBytes)
    .replace(/^did:key:/, '');
  const document: DidDocument = {
    id: did,
    verificationMethod: [{
      id: `${did}#atproto`,
      type: 'Multikey',
      controller: did,
      publicKeyMultibase,
    }],
    assertionMethod: [`${did}#atproto`],
  };
  const verifier = new AtprotoRepositoryCommitVerifier({
    async resolve() {
      return document;
    },
  });
  const recordCid = await repo.data.get(`${collection}/${rkey}`);
  if (recordCid === null) throw new Error('signed fixture record CID missing');
  return { carBytes, document, recordCid: recordCid.toString(), repo, verifier };
}

function concat(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

describe('AT Protocol repository commit authentication', () => {
  it('verifies a signed snapshot and a live CAR operation against the signed MST root', async () => {
    const fixture = await makeSignedRepository();

    await expect(fixture.verifier.verifySnapshot(fixture.carBytes, did))
      .resolves.toMatchObject({
        did,
        commitCid: fixture.repo.cid.toString(),
        repoRev: fixture.repo.commit.rev,
      });
    await expect(fixture.verifier.verifyLiveCommit({
      streamSeq: 12,
      did,
      commitCid: fixture.repo.cid.toString(),
      repoRev: fixture.repo.commit.rev,
      carBytes: fixture.carBytes,
      operations: [{
        action: 'create',
        collection,
        rkey,
        cid: fixture.recordCid,
      }],
    })).resolves.toMatchObject({
      did,
      commitCid: fixture.repo.cid.toString(),
    });
  });

  it('rejects a wrong key and a repository DID mismatch', async () => {
    const fixture = await makeSignedRepository();
    const wrongKey = await P256Keypair.create();
    const wrongParsed = parseDidKey(wrongKey.did());
    const wrongPublicKeyMultibase = formatDidKey(wrongParsed.jwtAlg, wrongParsed.keyBytes)
      .replace(/^did:key:/, '');
    const wrongKeyVerifier = new AtprotoRepositoryCommitVerifier({
      async resolve() {
        return {
          ...fixture.document,
          verificationMethod: [{
            ...fixture.document.verificationMethod[0]!,
            publicKeyMultibase: wrongPublicKeyMultibase,
          }],
        };
      },
    });

    await expect(wrongKeyVerifier.verifySnapshot(fixture.carBytes, did))
      .rejects.toThrow(/signature\/key authorization failed/);
    await expect(fixture.verifier.verifySnapshot(fixture.carBytes, 'did:plc:other-repository'))
      .rejects.toThrow(/DID document id|signature\/key authorization failed/);
  });

  it('rejects malformed CAR and malformed or unauthorized commit signatures', async () => {
    const fixture = await makeSignedRepository();

    await expect(fixture.verifier.verifySnapshot(new Uint8Array([0, 1, 2]), did))
      .rejects.toThrow();

    const malformedVerifier = new AtprotoRepositoryCommitVerifier({
      async resolve() {
        const malformedDid = 'did:plc:myceliumfixture';
        return {
          id: malformedDid,
          verificationMethod: [{
            ...fixture.document.verificationMethod[0]!,
            id: `${malformedDid}#atproto`,
            controller: malformedDid,
          }],
          assertionMethod: [`${malformedDid}#atproto`],
        };
      },
    });
    await expect(malformedVerifier.verifySnapshot(minimalCar, 'did:plc:myceliumfixture'))
      .rejects.toThrow(/signature\/key authorization failed/);
    await expect(fixture.verifier.verifyLiveCommit({
      streamSeq: 12,
      did,
      commitCid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      repoRev: fixture.repo.commit.rev,
      carBytes: fixture.carBytes,
      operations: [],
    })).rejects.toThrow(/does not match CAR root/);
  });

  it('accepts the deployed #atproto key without requiring assertionMethod', async () => {
    const fixture = await makeSignedRepository();
    const parsed = parseMultikey(fixture.document.verificationMethod[0]!.publicKeyMultibase!);
    const verifier = new AtprotoRepositoryCommitVerifier({
      async resolve() {
        return {
          id: did,
          verificationMethod: [{
            id: `${did}#atproto`,
            type: 'EcdsaSecp256r1VerificationKey2019',
            controller: did,
            publicKeyMultibase: bytesToMultibase(parsed.keyBytes, 'base58btc'),
          }],
        };
      },
    });

    await expect(verifier.verifySnapshot(fixture.carBytes, did))
      .resolves.toMatchObject({ did, commitCid: fixture.repo.cid.toString() });
  });
});
