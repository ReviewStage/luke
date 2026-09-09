import {
  CLOUD_AGENT_PROVIDER_ID,
  type CloudAgentProviderId,
  type CloudFetch,
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
): (providerId: string) => () => Promise<string | undefined> {
  const ciphertextByProviderId = new Map<string, string>(
    rows.map((row) => [row.providerId, row.ciphertext]),
  );
  return (providerId) => async () => {
    const ciphertext = ciphertextByProviderId.get(providerId);
    if (!ciphertext) return undefined;
    try {
      return decryptProviderKey(ciphertext, secret);
    } catch {
      return undefined;
    }
  };
}

export interface ProviderPassSeams {
  /** Injected in tests; production uses the global fetch. */
  fetch?: CloudFetch;
  now?: () => number;
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
export async function observeProviders<Answer>(options: {
  providerIds?: readonly CloudAgentProviderId[];
  readApiKey: (providerId: string) => () => Promise<string | undefined>;
  read: (plugin: SessionProviderPlugin) => Promise<Answer>;
  seams: ProviderPassSeams;
}): Promise<ProviderPassResult<Answer>[]> {
  const providerIds = options.providerIds ?? Object.values(CLOUD_AGENT_PROVIDER_ID);
  const results = await Promise.allSettled(
    providerIds.map((providerId) =>
      options.read(
        cloudSessionPluginFor(providerId, {
          readApiKey: options.readApiKey(providerId),
          ...(options.seams.fetch ? { fetch: options.seams.fetch } : undefined),
          ...(options.seams.now ? { now: options.seams.now } : undefined),
        }),
      ),
    ),
  );
  return providerIds.map((providerId, index) => {
    const result = results[index];
    return {
      providerId,
      answer: result?.status === "fulfilled" ? result.value : undefined,
    };
  });
}
