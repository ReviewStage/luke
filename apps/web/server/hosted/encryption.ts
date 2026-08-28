import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

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
