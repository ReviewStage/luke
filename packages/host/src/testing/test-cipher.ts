import type { SecretCipher } from "../settings-store.js";

export const TEST_CIPHER_PREFIX = "sealed:";

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
