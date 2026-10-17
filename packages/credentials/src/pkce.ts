/**
 * pkce.ts -- RFC 7636's verifier and S256 challenge, on Web Crypto so a browser can mint them too.
 */
import { Effect } from "effect";
import { Base64Url } from "effect/encoding";

/** The verifier's random bytes: 43 characters once encoded, RFC 7636's own floor. */
const VERIFIER_BYTES = 32;

/** A high-entropy RFC 7636 verifier suitable for a native public client. */
export function createCodeVerifier(): string {
  return Base64Url.encode(crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES)));
}

/**
 * The S256 challenge sent in place of the verifier during authorization. A
 * verifier is unreserved ASCII alone, so its UTF-8 bytes are its ASCII ones.
 */
export function codeChallenge(verifier: string): Effect.Effect<string> {
  return Effect.map(
    Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
    (digest) => Base64Url.encode(new Uint8Array(digest)),
  );
}
