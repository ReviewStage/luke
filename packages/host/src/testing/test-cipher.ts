/**
 * test-cipher.ts -- a cipher that stands in for Electron's Keychain-backed `safeStorage`, for the stores that seal what they keep.
 *
 * It seals by prefixing the text and opens only text it sealed, so a test
 * can tell sealed bytes from plain ones and a body sealed elsewhere fails to
 * open as the Keychain's would.
 */

import type { SecretCipher } from "../settings-store.js";

/** What every text `testCipher` seals begins with. */
export const TEST_CIPHER_PREFIX = "sealed:";

/** Stands in for Electron's Keychain-backed `safeStorage`, available or not. */
export function testCipher(available = true): SecretCipher {
  return {
    isAvailable: () => available,
    encrypt: (plainText) => new TextEncoder().encode(`${TEST_CIPHER_PREFIX}${plainText}`),
    decrypt: (cipherText) => {
      const value = new TextDecoder().decode(cipherText);
      if (!value.startsWith(TEST_CIPHER_PREFIX)) throw new Error("Unreadable ciphertext");
      return value.slice(TEST_CIPHER_PREFIX.length);
    },
  };
}
