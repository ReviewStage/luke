import type { HostSeams } from "@sidecar/host";
import { safeStorage } from "electron";
import type { DesktopService } from "./service";

export interface KeychainService extends DesktopService {
  /** The one cipher the host encrypts a credential with, and the one place `safeStorage` is named. */
  readonly cipher: HostSeams["cipher"];
}

/**
 * This machine's own credential protection, as the seam the host takes.
 * Nothing here asks whether the Keychain will answer: every member of the
 * cipher reaches it, `isAvailable` included, so asking is a Keychain read and
 * the permission dialog that comes with one. The store asks at most once per
 * run, and only from a path that already holds a credential to protect.
 */
export function createKeychainService(): KeychainService {
  return {
    name: "keychain",
    cipher: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plainText) => safeStorage.encryptString(plainText),
      decrypt: (cipherText) => safeStorage.decryptString(cipherText),
    },
    start: async () => undefined,
    stop: async () => undefined,
  };
}
