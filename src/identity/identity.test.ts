import { describe, it, expect } from 'vitest';
import {
  generateIdentity,
  canonicalize,
  signContent,
  verifySignature,
  didToKeyFragment,
  extractPublicKey,
} from './index.js';
import { InvalidDIDError, SignatureVerificationError } from '../errors.js';

describe('canonicalize()', () => {
  it('serializes primitives like JSON.stringify', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize('hello')).toBe('"hello"');
    expect(canonicalize(true)).toBe('true');
  });

  it('sorts object keys alphabetically', () => {
    const obj = { z: 1, a: 2, m: 3 };
    expect(canonicalize(obj)).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts nested object keys recursively', () => {
    const obj = { outer: { z: 1, a: 2 }, b: { y: 9, x: 8 } };
    expect(canonicalize(obj)).toBe('{"b":{"x":8,"y":9},"outer":{"a":2,"z":1}}');
  });

  it('preserves array order (does not sort arrays)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles arrays of objects with sorted keys', () => {
    const arr = [{ z: 1, a: 2 }, { y: 3, b: 4 }];
    expect(canonicalize(arr)).toBe('[{"a":2,"z":1},{"b":4,"y":3}]');
  });

  it('produces identical output for same object regardless of insertion order', () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('handles deeply nested structures', () => {
    const deep = { c: { b: { a: 1 } } };
    expect(canonicalize(deep)).toBe('{"c":{"b":{"a":1}}}');
  });
});

describe('generateIdentity()', () => {
  it('produces a valid did:key DID', () => {
    const identity = generateIdentity('test.local', 'Test Agent');
    expect(identity.did).toMatch(/^did:key:z6Mk/);
  });

  it('includes handle and displayName', () => {
    const identity = generateIdentity('atlas.mycelium.local', 'Atlas');
    expect(identity.handle).toBe('atlas.mycelium.local');
    expect(identity.displayName).toBe('Atlas');
  });

  it('produces unique DIDs for each call', () => {
    const a = generateIdentity('a.local', 'A');
    const b = generateIdentity('b.local', 'B');
    expect(a.did).not.toBe(b.did);
  });

  it('sets createdAt to a valid ISO 8601 timestamp', () => {
    const identity = generateIdentity('test.local', 'Test');
    expect(() => new Date(identity.createdAt)).not.toThrow();
    expect(identity.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('public key has 32 bytes', () => {
    const identity = generateIdentity('test.local', 'Test');
    expect(identity.publicKey).toHaveLength(32);
  });

  it('private key has 32 bytes', () => {
    const identity = generateIdentity('test.local', 'Test');
    expect(identity.privateKey).toHaveLength(32);
  });
});

describe('didToKeyFragment()', () => {
  it('extracts the z6Mk... portion from a DID', () => {
    const identity = generateIdentity('test.local', 'Test');
    const fragment = didToKeyFragment(identity.did);
    expect(fragment).toMatch(/^z6Mk/);
    expect(fragment).not.toContain(':');
  });

  it('throws InvalidDIDError for malformed DIDs', () => {
    expect(() => didToKeyFragment('not-a-did')).toThrow(InvalidDIDError);
    expect(() => didToKeyFragment('did:web:example.com')).toThrow(InvalidDIDError);
  });
});

describe('extractPublicKey()', () => {
  it('round-trips: extracted key matches the original public key', () => {
    const identity = generateIdentity('test.local', 'Test');
    const extracted = extractPublicKey(identity.did);
    expect(extracted).toEqual(identity.publicKey);
  });

  it('returns a 32-byte Uint8Array', () => {
    const identity = generateIdentity('test.local', 'Test');
    const extracted = extractPublicKey(identity.did);
    expect(extracted).toHaveLength(32);
    expect(extracted).toBeInstanceOf(Uint8Array);
  });

  it('throws InvalidDIDError for invalid DID', () => {
    expect(() => extractPublicKey('did:key:INVALID')).toThrow(InvalidDIDError);
  });
});

describe('signContent() + verifySignature()', () => {
  it('signs content and verifies successfully', () => {
    const identity = generateIdentity('test.local', 'Test');
    const content = { foo: 'bar', baz: 42 };
    const { sig, signerDid } = signContent(identity, content);
    expect(signerDid).toBe(identity.did);
    expect(() => verifySignature(identity.did, content, sig)).not.toThrow();
  });

  it('signature is base64url-encoded (no padding)', () => {
    const identity = generateIdentity('test.local', 'Test');
    const { sig } = signContent(identity, { x: 1 });
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/); // base64url chars only
    expect(sig).not.toContain('='); // no padding
    expect(sig).not.toContain('+');
    expect(sig).not.toContain('/');
  });

  it('different key order produces same signature (canonicalize is stable)', () => {
    const identity = generateIdentity('test.local', 'Test');
    const { sig: sig1 } = signContent(identity, { b: 2, a: 1 });
    const { sig: sig2 } = signContent(identity, { a: 1, b: 2 });
    expect(sig1).toBe(sig2);
  });

  it('different content produces different signature', () => {
    const identity = generateIdentity('test.local', 'Test');
    const { sig: sig1 } = signContent(identity, { x: 1 });
    const { sig: sig2 } = signContent(identity, { x: 2 });
    expect(sig1).not.toBe(sig2);
  });

  it('throws SignatureVerificationError for tampered content', () => {
    const identity = generateIdentity('test.local', 'Test');
    const { sig } = signContent(identity, { x: 1 });
    expect(() => verifySignature(identity.did, { x: 99 }, sig)).toThrow(
      SignatureVerificationError,
    );
  });

  it('throws SignatureVerificationError for wrong DID', () => {
    const a = generateIdentity('a.local', 'A');
    const b = generateIdentity('b.local', 'B');
    const content = { hello: 'world' };
    const { sig } = signContent(a, content);
    expect(() => verifySignature(b.did, content, sig)).toThrow(SignatureVerificationError);
  });

  it('handles complex nested objects', () => {
    const identity = generateIdentity('test.local', 'Test');
    const content = {
      $type: 'network.mycelium.agent.profile',
      did: identity.did,
      nested: { z: [1, 2, 3], a: { deep: true } },
    };
    const { sig } = signContent(identity, content);
    expect(() => verifySignature(identity.did, content, sig)).not.toThrow();
  });
});
