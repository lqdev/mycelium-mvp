// Identity module: DID generation, canonical JSON, Ed25519 signing/verification.
// Uses did:key method with Ed25519 keypairs (multicodec prefix 0xed01).

import { etc, getPublicKey, sign, utils, verify } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import bs58 from 'bs58';
import type { AgentIdentity } from '../schemas/types.js';
import { InvalidDIDError, SignatureVerificationError } from '../errors.js';

// Enable synchronous Ed25519 operations (requires @noble/hashes)
etc.sha512Sync = sha512;

// Multicodec prefix bytes for Ed25519 public keys (varint encoding of 0xed01)
const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);

// ─── Canonical JSON ────────────────────────────────────────────────────────────

/**
 * Recursively sort all object keys alphabetically at every nesting depth.
 * Produces deterministic JSON regardless of property insertion order.
 * Used for signing (must match exactly on verify) and commit hash chains.
 *
 * @throws Never — handles all JSON-serializable values.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalize(item)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map(
    (key) => JSON.stringify(key) + ':' + canonicalize(obj[key]),
  );
  return '{' + entries.join(',') + '}';
}

// ─── DID utilities ─────────────────────────────────────────────────────────────

/**
 * Extract the key fragment (z6Mk... portion) from a did:key DID.
 * Used for database filenames and short display.
 */
export function didToKeyFragment(did: string): string {
  const parts = did.split(':');
  if (parts.length !== 3 || parts[0] !== 'did' || parts[1] !== 'key') {
    throw new InvalidDIDError(did);
  }
  return parts[2] as string;
}

/**
 * Extract the raw 32-byte Ed25519 public key from a did:key DID.
 * Strips the 'z' multibase prefix and 0xed01 multicodec prefix.
 *
 * @throws InvalidDIDError if the DID format is invalid
 */
export function extractPublicKey(did: string): Uint8Array {
  const fragment = didToKeyFragment(did);
  if (!fragment.startsWith('z')) {
    throw new InvalidDIDError(did);
  }
  const multicodecBytes = bs58.decode(fragment.slice(1));
  if (
    multicodecBytes.length !== 34 ||
    multicodecBytes[0] !== 0xed ||
    multicodecBytes[1] !== 0x01
  ) {
    throw new InvalidDIDError(did);
  }
  return multicodecBytes.slice(2); // 32-byte public key
}

// ─── Identity generation ───────────────────────────────────────────────────────

/**
 * Generate a new agent identity with a fresh Ed25519 keypair.
 * The same function is used for agents, intelligence providers, and models —
 * all Mycelium entities have DIDs.
 */
export function generateIdentity(handle: string, displayName: string): AgentIdentity {
  const privateKey = utils.randomPrivateKey();          // 32 random bytes
  const publicKey = getPublicKey(privateKey);            // 32-byte public key (sync)

  // Prepend multicodec prefix → 34 bytes
  const multicodecBytes = new Uint8Array(ED25519_MULTICODEC.length + publicKey.length);
  multicodecBytes.set(ED25519_MULTICODEC);
  multicodecBytes.set(publicKey, ED25519_MULTICODEC.length);

  // Encode as base58btc with 'z' multibase prefix
  const encoded = 'z' + bs58.encode(multicodecBytes);
  const did = 'did:key:' + encoded;

  return {
    did,
    handle,
    displayName,
    publicKey,
    privateKey,
    createdAt: new Date().toISOString(),
  };
}

// ─── Signing & Verification ───────────────────────────────────────────────────

/**
 * Sign a record's content using the identity's private key.
 * Signing uses canonical JSON serialization to ensure deterministic byte order.
 *
 * @returns base64url-encoded Ed25519 signature and the signer's DID
 */
export function signContent(
  identity: AgentIdentity,
  content: unknown,
): { sig: string; signerDid: string } {
  const canonical = canonicalize(content);
  const bytes = new TextEncoder().encode(canonical);
  const signature = sign(bytes, identity.privateKey); // sync (sha512Sync is set)
  const sig = Buffer.from(signature).toString('base64url');
  return { sig, signerDid: identity.did };
}

/**
 * Verify an Ed25519 signature against a DID and record content.
 * Reconstructs the canonical bytes and checks against the signature.
 *
 * @throws InvalidDIDError if the DID format is invalid
 * @throws SignatureVerificationError if the signature is invalid
 */
export function verifySignature(did: string, content: unknown, sig: string): void {
  const publicKey = extractPublicKey(did);
  const canonical = canonicalize(content);
  const bytes = new TextEncoder().encode(canonical);
  const signature = Buffer.from(sig, 'base64url');
  const valid = verify(new Uint8Array(signature), bytes, publicKey); // sync
  if (!valid) {
    throw new SignatureVerificationError(did);
  }
}
