import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ProtocolAppView } from '../protocol/appview.js';
import {
  AtprotoRepoSnapshotAdapter,
  decodeProtocolRepoSnapshot,
} from './repo-snapshot.js';

const did = 'did:plc:myceliumfixture';
const car = await readFile(new URL('./minimal-repo.car', import.meta.url));

describe('official AT Protocol repository snapshots', () => {
  it('decodes a getRepo CAR, preserving repo identity, record paths, CIDs, and repo revision', async () => {
    const snapshot = await decodeProtocolRepoSnapshot(car, did);

    expect(snapshot.did).toBe(did);
    expect(snapshot.repoRev).toBe('3jzfcijyqzs2a');
    expect(snapshot.rootCid).toBe('bafyreibqlm3quhnjyhqlsjj24uauvaoonmyi3jfkzqr44mzecn2yq2xpmu');
    expect(snapshot.records).toHaveLength(2);
    expect(snapshot.records.map(({ uri }) => uri)).toEqual([
      `at://${did}/me.lqdev.mycelium.task.claim/claim-1`,
      `at://${did}/me.lqdev.mycelium.task.offer/offer-1`,
    ]);
    expect(snapshot.records.map(({ cid }) => cid)).toEqual([
      'bafyreigqbmaciid5olk5z5d5f3swqx25ztxpxsrozdvg3mrilixa2ahuhy',
      'bafyreihc5t3nlorry7yfo7ejk6ppokje5kdokfclvx4awho5goaotxbouy',
    ]);
  });

  it('quarantines unsupported, malformed, and forged records', async () => {
    const snapshot = await decodeProtocolRepoSnapshot(car, did);

    expect(snapshot.quarantined).toHaveLength(3);
    expect(snapshot.quarantined.map(({ reason }) => reason)).toEqual([
      'unsupported collection',
      'Protocol 0.1 validation failed for collection "me.lqdev.mycelium.task.offer"',
      'Protocol 0.1 validation failed for collection "me.lqdev.mycelium.task.offer"',
    ]);
    expect(snapshot.quarantined.map(({ collection, rkey }) => `${collection}/${rkey}`)).toEqual([
      'app.bsky.feed.post/post-1',
      'me.lqdev.mycelium.task.offer/bad-1',
      'me.lqdev.mycelium.task.offer/forged-1',
    ]);
  });

  it('populates the ProtocolAppView with a deterministic projection and hash', async () => {
    const snapshot = await decodeProtocolRepoSnapshot(car, did);
    const appView = new ProtocolAppView();

    appView.ingestSnapshot(snapshot.records, {
      did: snapshot.did,
      repoRev: snapshot.repoRev,
    });

    expect(appView.health()).toMatchObject({
      recordCount: 2,
      quarantinedCount: 0,
      repoRevs: { [did]: '3jzfcijyqzs2a' },
    });
    expect(appView.projectTasks()).toMatchObject([{
      taskUri: `at://${did}/me.lqdev.mycelium.task.offer/offer-1`,
      requesterDid: did,
      state: 'claimed',
      claimUris: [`at://${did}/me.lqdev.mycelium.task.claim/claim-1`],
    }]);
    expect(appView.projectionHash()).toBe(
      '4739e17934ba2744ffa38377da2a5dfd40a7bfe72f49da328c68b775815b7b7b',
    );
  });

  it('models the unauthenticated getRepo HTTP request without adding credentials', async () => {
    let requestedUrl = '';
    let requestedHeaders: Headers | undefined;
    const adapter = new AtprotoRepoSnapshotAdapter({
      endpoint: 'https://pds.example/',
      did,
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        requestedHeaders = new Headers(init?.headers);
        return new Response(car, {
          status: 200,
          headers: { 'content-type': 'application/vnd.ipld.car' },
        });
      },
    });

    await expect(adapter.snapshot()).resolves.toHaveLength(2);
    expect(requestedUrl).toBe(
      'https://pds.example/xrpc/com.atproto.sync.getRepo?did=did%3Aplc%3Amyceliumfixture',
    );
    expect(requestedHeaders?.get('accept')).toBe('application/vnd.ipld.car');
    expect(requestedHeaders?.has('authorization')).toBe(false);
    expect(adapter.lastSnapshot()?.repoRev).toBe('3jzfcijyqzs2a');
  });
});
