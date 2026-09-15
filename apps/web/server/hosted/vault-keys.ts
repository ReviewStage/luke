import { Effect } from "effect";
import { decryptProviderKey } from "./encryption.js";
import type { VaultKeyRow } from "./vault-route.js";

/**
 * Reading a caller's stored keys, which the observation pass, the projects
 * read, and the brain host each need and none of them owns. A key that
 * cannot be decrypted is a provider with no key rather than a failed request:
 * the pass answers what it could reach.
 */

/** Opens one provider's stored key on demand, or answers that there is none. */
export function readApiKeyFor(
  rows: readonly VaultKeyRow[],
  secret: string,
): (providerId: string) => () => Effect.Effect<string | undefined> {
  const ciphertextByProviderId = new Map<string, string>(
    rows.map((row) => [row.providerId, row.ciphertext]),
  );
  return (providerId) => () =>
    Effect.sync(() => {
      const ciphertext = ciphertextByProviderId.get(providerId);
      if (!ciphertext) return undefined;
      try {
        return decryptProviderKey(ciphertext, secret);
      } catch {
        return undefined;
      }
    });
}
