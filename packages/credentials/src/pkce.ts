import { createHash, randomBytes } from "node:crypto";

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

/** A high-entropy RFC 7636 verifier suitable for a native public client. */
export function createCodeVerifier(): string {
  return base64Url(randomBytes(32));
}

/** The S256 challenge sent in place of the verifier during authorization. */
export function codeChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier, "ascii").digest());
}
