import { Cause, Effect, Exit, type Layer } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import {
  CLOUD_AGENT_PROVIDER_ID,
  type CloudAgentProviderId,
  type SessionProviderPlugin,
} from "../core.js";
import { cloudSessionPluginFor } from "./cloud-adapters.js";
import { decryptProviderKey } from "./encryption.js";
import type { VaultKeyRow } from "./vault-route.js";

/**
 * Reading a caller's stored keys and running the providers they open, which
 * observe, projects, and the phone's mint each need and none of them owns.
 * A key that cannot be decrypted is a provider with no key rather than a
 * failed request: the pass answers what it could reach.
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

export interface ProviderPassSeams {
  /** Injected in tests; production uses the platform's own fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient> | undefined;
  now?: (() => number) | undefined;
}

/** What one provider's leg of a fan-out answered, or nothing where it failed. */
export interface ProviderPassResult<Answer> {
  providerId: CloudAgentProviderId;
  answer: Answer | undefined;
}

/**
 * Runs one read against each named provider at once, on a request-scoped
 * plugin holding that provider's own key. A provider that throws is one
 * whose leg answered nothing; it never fails the others.
 */
export function observeProviders<Answer>(options: {
  providerIds?: readonly CloudAgentProviderId[];
  readApiKey: (providerId: string) => () => Effect.Effect<string | undefined>;
  read: (plugin: SessionProviderPlugin) => Effect.Effect<Answer>;
  seams: ProviderPassSeams;
}): Effect.Effect<ProviderPassResult<Answer>[]> {
  return Effect.suspend(() => {
    const providerIds = options.providerIds ?? Object.values(CLOUD_AGENT_PROVIDER_ID);
    return Effect.forEach(
      providerIds,
      (providerId) =>
        Effect.flatMap(
          Effect.exit(
            options.read(
              cloudSessionPluginFor(providerId, {
                readApiKey: options.readApiKey(providerId),
                ...(options.seams.httpClient
                  ? { httpClient: options.seams.httpClient }
                  : undefined),
                ...(options.seams.now ? { now: options.seams.now } : undefined),
              }),
            ),
          ),
          (exit): Effect.Effect<ProviderPassResult<Answer>> =>
            // A leg the caller's own deadline ended is not a leg that answered
            // nothing, so an interruption fails the fan-out rather than being
            // read as this provider's answer.
            Exit.isFailure(exit) && Cause.isInterruptedOnly(exit.cause)
              ? Effect.failCause(exit.cause)
              : Effect.succeed({
                  providerId,
                  answer: Exit.isSuccess(exit) ? exit.value : undefined,
                }),
        ),
      { concurrency: "unbounded" },
    );
  });
}
