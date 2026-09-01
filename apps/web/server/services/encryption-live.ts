import { Effect, Layer } from "effect";
import {
  decryptProviderKey,
  encryptProviderKey,
  VAULT_ENCRYPTION_ENVIRONMENT,
} from "../hosted/encryption.js";
import { HostedEncryption } from "./tags.js";

function trimmedSecret(): string | undefined {
  const secret = process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET]?.trim();
  return secret || undefined;
}

export const HostedEncryptionLive = Layer.succeed(HostedEncryption, {
  secret: trimmedSecret(),
  encrypt: (plaintext) =>
    Effect.sync(() => {
      const secret = trimmedSecret();
      if (!secret) throw new Error("encryption secret unavailable");
      return encryptProviderKey(plaintext, secret);
    }),
  decrypt: (ciphertext) =>
    Effect.sync(() => {
      const secret = trimmedSecret();
      if (!secret) throw new Error("encryption secret unavailable");
      return decryptProviderKey(ciphertext, secret);
    }),
});
