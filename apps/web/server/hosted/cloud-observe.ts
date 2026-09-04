import {
  CLOUD_FAILURE,
  type CloudFailure,
  type CloudFetch,
} from "../../../../packages/providers/src/shared/cloud-session-adapter.js";
import type { ProviderSessionObservation } from "../core.js";
import { VAULT_PROVIDER_ID, type VaultProviderId } from "../core.js";
import { cloudSessionAdapterFor } from "./cloud-adapters.js";
import { decryptProviderKey } from "./encryption.js";

/** Stored vault key row as the API routes supply it. */
export interface VaultKeyRow {
  providerId: string;
  ciphertext: string;
}

export interface CloudObserveSeams {
  /** Injected in tests; production uses the global fetch. */
  fetch?: CloudFetch;
  now?: () => number;
}

/**
 * Why one provider's pass could not be trusted as its whole roster. The
 * adapter answers an unreadable pass with its previous snapshot, which for a
 * pass built fresh is nothing, so a caller that would write the roster down
 * has to be told the difference between nothing and unread.
 */
export const CLOUD_OBSERVE_FAILURE = {
  /** The provider refused the key. */
  UNAUTHORIZED: "unauthorized",
  /** The provider or the network did not answer. */
  TRANSIENT: "transient",
  /** A key row stands but could not be decrypted with this deployment's secret. */
  KEY_UNREADABLE: "key-unreadable",
  /** The pass itself threw; a bug in the adapter, not an answer from the provider. */
  PASS_FAILED: "pass-failed",
} as const;

export type CloudObserveFailure =
  (typeof CLOUD_OBSERVE_FAILURE)[keyof typeof CLOUD_OBSERVE_FAILURE];

export interface CloudProviderObservations {
  providerId: VaultProviderId;
  observations: readonly ProviderSessionObservation[];
  /** Set when the observations are not the provider's whole current roster. */
  failure?: CloudObserveFailure;
}

/**
 * One read-only pass over every cloud provider the vault holds a key for:
 * each adapter is built for this pass alone, reads the caller's decrypted key
 * behind the same read-at-act-time seam the desktop uses, and is discarded
 * with the pass. A provider that fails answers nothing rather than failing
 * the others, and a key that cannot be decrypted is a key that is absent.
 */
export async function observeCloudProviders(
  rows: readonly VaultKeyRow[],
  secret: string,
  seams: CloudObserveSeams = {},
): Promise<CloudProviderObservations[]> {
  const ciphertextByProviderId = new Map<string, string>(
    rows.map((row) => [row.providerId, row.ciphertext]),
  );
  const unreadableKeys = new Set<string>();

  function readApiKeyFor(providerId: string): () => Promise<string | undefined> {
    return async () => {
      const ciphertext = ciphertextByProviderId.get(providerId);
      if (!ciphertext) return undefined;
      try {
        return decryptProviderKey(ciphertext, secret);
      } catch {
        unreadableKeys.add(providerId);
        return undefined;
      }
    };
  }

  const providerIds = Object.values(VAULT_PROVIDER_ID);
  const adapters = providerIds.map((providerId) =>
    cloudSessionAdapterFor(providerId, {
      readApiKey: readApiKeyFor(providerId),
      ...(seams.fetch ? { fetch: seams.fetch } : undefined),
      ...(seams.now ? { now: seams.now } : undefined),
    }),
  );
  const results = await Promise.allSettled(adapters.map((adapter) => adapter.observe()));

  const observed: CloudProviderObservations[] = [];
  for (const [index, providerId] of providerIds.entries()) {
    const result = results[index];
    const adapter = adapters[index];
    if (!result || !adapter) continue;
    const failure = unreadableKeys.has(providerId)
      ? CLOUD_OBSERVE_FAILURE.KEY_UNREADABLE
      : result.status === "rejected"
        ? CLOUD_OBSERVE_FAILURE.PASS_FAILED
        : adapterFailure(adapter.lastObserveFailure());
    const observations = result.status === "fulfilled" ? result.value : [];
    observed.push({ providerId, observations, ...(failure ? { failure } : undefined) });
  }
  return observed;
}

function adapterFailure(failure: CloudFailure | undefined): CloudObserveFailure | undefined {
  if (failure === CLOUD_FAILURE.UNAUTHORIZED) return CLOUD_OBSERVE_FAILURE.UNAUTHORIZED;
  if (failure === CLOUD_FAILURE.TRANSIENT) return CLOUD_OBSERVE_FAILURE.TRANSIENT;
  return undefined;
}
