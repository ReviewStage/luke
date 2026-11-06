import type { SecretCipher } from "@repo/host";
import type { EffectDesktopService } from "@repo/host/desktop-service";
import { Effect } from "effect";
import { safeStorage } from "electron";

export interface KeychainService extends EffectDesktopService {
  readonly cipher: SecretCipher;
}

export function createKeychainService(): KeychainService {
  return {
    name: "keychain",
    cipher: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plainText) => safeStorage.encryptString(plainText),
      decrypt: (cipherText) => safeStorage.decryptString(Buffer.from(cipherText)),
    },
    start: () => Effect.void,
    stop: () => Effect.void,
  };
}
