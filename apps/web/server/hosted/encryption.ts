import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./http.js";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** The env var name for the 32-byte (64 hex char) AES-256-GCM key. */
export const VAULT_ENCRYPTION_ENVIRONMENT = {
  SECRET: "PROVIDER_KEY_ENCRYPTION_SECRET",
} as const;

function secretBuffer(secret: string): Buffer {
  const buf = Buffer.from(secret, "hex");
  if (buf.length !== 32) {
    throw new Error(
      "PROVIDER_KEY_ENCRYPTION_SECRET must be 64 hex characters (32 bytes); generate with: openssl rand -hex 32",
    );
  }
  return buf;
}

/**
 * Encrypts `plaintext` under AES-256-GCM. Returns base64(nonce || ciphertext
 * || authTag). The nonce is random per call; the auth tag provides integrity.
 * `secret` must be a 64-character hex string (32 bytes).
 */
export function encryptProviderKey(plaintext: string, secret: string): string {
  const key = secretBuffer(secret);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, body, tag]).toString("base64");
}

/**
 * Decrypts a value produced by `encryptProviderKey`. Throws if the auth tag
 * does not verify — meaning the ciphertext has been tampered with or the
 * wrong secret was supplied.
 */
export function decryptProviderKey(encoded: string, secret: string): string {
  const key = secretBuffer(secret);
  const buf = Buffer.from(encoded, "base64");
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const body = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/**
 * The trimmed secret, or the 503 every endpoint that needs one answers
 * without it. Its absence is a kill switch for the whole vault, so the
 * refusal is the same wherever it is read.
 */
export function secretOrUnavailable(secret: string | undefined): { secret: string } | Response {
  const trimmed = secret?.trim();
  if (!trimmed) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
  return { secret: trimmed };
}

/**
 * A key the payload envelope may be sealed under or opened with, named by a
 * small positive integer so a rotation can add the next key beside the last
 * and every stored envelope still says which one opens it.
 */
export type PayloadKeyId = number;

export const CURRENT_PAYLOAD_KEY_ID: PayloadKeyId = 1;

export interface PayloadKeyRing {
  /** The key new envelopes are sealed under. */
  readonly current: PayloadKeyId;
  /** Every key an envelope on record may name, the current one included; each a 64-character hex secret. */
  readonly keys: ReadonlyMap<PayloadKeyId, string>;
}

/** The ring this build runs on: the vault's secret as key 1, and nothing older. */
export function payloadKeyRing(secret: string): PayloadKeyRing {
  return { current: CURRENT_PAYLOAD_KEY_ID, keys: new Map([[CURRENT_PAYLOAD_KEY_ID, secret]]) };
}

const PAYLOAD_ENVELOPE_SEPARATOR = ":";

/**
 * Seals a stored payload: `<keyId>:base64(nonce || ciphertext || authTag)`
 * under AES-256-GCM, the key id in the clear so a later rotation can open
 * what an earlier key sealed. `boundTo` is authenticated but not stored — the
 * row's own user id — so an envelope lifted onto another user's row does not
 * open there. The vault's key format is left exactly as it was: this is the
 * variant beside it, for the conversation tables.
 */
export function sealPayload(plaintext: string, ring: PayloadKeyRing, boundTo: string): string {
  const secret = ring.keys.get(ring.current);
  if (secret === undefined) {
    throw new Error(`the payload key ring names no key ${ring.current} to seal under`);
  }
  const key = secretBuffer(secret);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(Buffer.from(boundTo, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ring.current}${PAYLOAD_ENVELOPE_SEPARATOR}${Buffer.concat([nonce, body, tag]).toString("base64")}`;
}

/**
 * Opens an envelope `sealPayload` produced. Throws for a key id the ring does
 * not hold, an envelope that is not one, and a tag that does not verify —
 * tampering, another key, or another `boundTo` — so a caller never reads a
 * payload the ring cannot vouch for.
 */
export function openPayload(sealed: string, ring: PayloadKeyRing, boundTo: string): string {
  const separator = sealed.indexOf(PAYLOAD_ENVELOPE_SEPARATOR);
  if (separator <= 0) throw new Error("the sealed payload names no key");
  const keyId = Number(sealed.slice(0, separator));
  if (!Number.isInteger(keyId) || keyId <= 0) throw new Error("the sealed payload names no key");
  const secret = ring.keys.get(keyId);
  if (secret === undefined) throw new Error(`the payload key ring holds no key ${keyId}`);
  const key = secretBuffer(secret);
  const buf = Buffer.from(sealed.slice(separator + 1), "base64");
  if (buf.length < NONCE_BYTES + TAG_BYTES) throw new Error("the sealed payload is too short");
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const body = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAAD(Buffer.from(boundTo, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
