import { describe, it, expect, vi } from 'vitest';
import { createFirehose, subscribe, unsubscribe, publish, getEventLog } from './index.js';
import { SubscriptionNotFoundError } from '../errors.js';
import type { FirehoseEvent } from '../schemas/types.js';

function makeEvent(seq: number, collection: string, did = 'did:key:z6Mk'): FirehoseEvent {
  return {
    seq,
    type: 'commit',
    operation: 'create',
    did,
    collection,
    rkey: `item-${seq}`,
    record: { data: seq },
    timestamp: new Date().toISOString(),
  };
}

describe('createFirehose()', () => {
  it('initializes with empty log and no subscriptions', () => {
    const fh = createFirehose();
    expect(fh.log).toHaveLength(0);
    expect(fh.subscriptions.size).toBe(0);
    expect(fh.seq).toBe(1); // CONSTANTS.FIREHOSE_SEQ_START = 1
  });
});

describe('subscribe()', () => {
  it('returns a unique subscription id', () => {
    const fh = createFirehose();
    const id = subscribe(fh, undefined, vi.fn());
    expect(id).toBeTruthy();
    expect(fh.subscriptions.has(id)).toBe(true);
  });

  it('multiple subscribers get unique ids', () => {
    const fh = createFirehose();
    const id1 = subscribe(fh, undefined, vi.fn());
    const id2 = subscribe(fh, undefined, vi.fn());
    expect(id1).not.toBe(id2);
  });
});

describe('unsubscribe()', () => {
  it('removes the subscription', () => {
    const fh = createFirehose();
    const id = subscribe(fh, undefined, vi.fn());
    unsubscribe(fh, id);
    expect(fh.subscriptions.has(id)).toBe(false);
  });

  it('throws SubscriptionNotFoundError for unknown id', () => {
    const fh = createFirehose();
    expect(() => unsubscribe(fh, 'nonexistent')).toThrow(SubscriptionNotFoundError);
  });
});

describe('getEventLog()', () => {
  it('returns empty array for a fresh firehose', () => {
    const fh = createFirehose();
    expect(getEventLog(fh)).toHaveLength(0);
  });

  it('preserves insertion order', () => {
    const fh = createFirehose();
    publish(fh, makeEvent(1, 'net.test.a'));
    publish(fh, makeEvent(2, 'net.test.b'));
    const log = getEventLog(fh);
    expect(log[0]?.seq).toBe(1);
    expect(log[1]?.seq).toBe(2);
  });

  it('returns a defensive copy', () => {
    const fh = createFirehose();
    const log = getEventLog(fh);
    log.push(makeEvent(99, 'net.test.x'));
    expect(getEventLog(fh)).toHaveLength(0);
  });
});

describe('publish() — filtering', () => {
  it('unfiltered subscriber receives all events', () => {
    const fh = createFirehose();
    const received: FirehoseEvent[] = [];
    subscribe(fh, undefined, (e) => received.push(e));

    publish(fh, makeEvent(1, 'net.test.foo'));
    publish(fh, makeEvent(2, 'net.test.bar'));

    expect(received).toHaveLength(2);
  });

  it('collection filter only delivers matching events', () => {
    const fh = createFirehose();
    const received: FirehoseEvent[] = [];
    subscribe(fh, { collections: ['net.test.foo'] }, (e) => received.push(e));

    publish(fh, makeEvent(1, 'net.test.foo'));
    publish(fh, makeEvent(2, 'net.test.bar')); // filtered out

    expect(received).toHaveLength(1);
    expect(received[0]?.collection).toBe('net.test.foo');
  });

  it('DID filter only delivers events from matching DID', () => {
    const fh = createFirehose();
    const received: FirehoseEvent[] = [];
    subscribe(fh, { dids: ['did:key:z6MkAAA'] }, (e) => received.push(e));

    publish(fh, makeEvent(1, 'net.test.x', 'did:key:z6MkAAA'));
    publish(fh, makeEvent(2, 'net.test.x', 'did:key:z6MkBBB')); // filtered out

    expect(received).toHaveLength(1);
    expect(received[0]?.did).toBe('did:key:z6MkAAA');
  });

  it('combined filter requires both collection AND did to match', () => {
    const fh = createFirehose();
    const received: FirehoseEvent[] = [];
    subscribe(fh, { collections: ['net.test.x'], dids: ['did:key:z6MkAAA'] }, (e) =>
      received.push(e),
    );

    publish(fh, makeEvent(1, 'net.test.x', 'did:key:z6MkAAA')); // ✓ both match
    publish(fh, makeEvent(2, 'net.test.y', 'did:key:z6MkAAA')); // ✗ wrong collection
    publish(fh, makeEvent(3, 'net.test.x', 'did:key:z6MkBBB')); // ✗ wrong DID

    expect(received).toHaveLength(1);
    expect(received[0]?.seq).toBe(1);
  });

  it('multiple subscribers all receive the same event', () => {
    const fh = createFirehose();
    const r1: FirehoseEvent[] = [];
    const r2: FirehoseEvent[] = [];
    subscribe(fh, undefined, (e) => r1.push(e));
    subscribe(fh, undefined, (e) => r2.push(e));

    const e = makeEvent(1, 'net.test.foo');
    publish(fh, e);

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r1[0]).toBe(r2[0]);
  });

  it('publish appends to event log regardless of filters', () => {
    const fh = createFirehose();
    subscribe(fh, { collections: ['net.test.x'] }, vi.fn()); // filter excludes bar

    publish(fh, makeEvent(1, 'net.test.x'));
    publish(fh, makeEvent(2, 'net.test.bar')); // filtered from handler but still logged

    expect(getEventLog(fh)).toHaveLength(2);
  });
});
