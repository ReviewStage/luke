import type * as HttpClient from "@effect/platform/HttpClient";
import type { Layer } from "effect";
import { ADAPTER_FAILURE } from "../../../../packages/providers/src/shared/adapter-failure.js";
import type {
  CloudAgentProviderId,
  ProviderSessionObservation,
  WorkspaceProject,
} from "../core.js";
import { cloudSessionPluginFor } from "./cloud-adapters.js";

/**
 * Why one provider's pass cannot be written down as its whole roster. The
 * plugin answers a failed pass with its previous roster, which for a plugin
 * built for this pass alone is nothing, so a caller that would store the
 * roster has to be told the difference between nothing and unread.
 */
export const CLOUD_OBSERVE_FAILURE = {
  /** The provider refused the key. */
  UNAUTHORIZED: "unauthorized",
  /** The provider or the network did not answer. */
  TRANSIENT: "transient",
  /** The provider rate limited the pass past its backoff budget. */
  RATE_LIMITED: "rate-limited",
  /** A key row stands but could not be decrypted with this deployment's secret. */
  KEY_UNREADABLE: "key-unreadable",
  /** The pass itself threw: a bug in the adapter, not an answer from the provider. */
  PASS_FAILED: "pass-failed",
  /** The pass began and has not answered: it is still running, or it never finished. */
  UNFINISHED: "unfinished",
} as const;

export type CloudObserveFailure =
  (typeof CLOUD_OBSERVE_FAILURE)[keyof typeof CLOUD_OBSERVE_FAILURE];

const FAILURE_BY_ADAPTER_FAILURE = {
  [ADAPTER_FAILURE.UNAUTHORIZED]: CLOUD_OBSERVE_FAILURE.UNAUTHORIZED,
  [ADAPTER_FAILURE.UNAVAILABLE]: CLOUD_OBSERVE_FAILURE.KEY_UNREADABLE,
  [ADAPTER_FAILURE.TRANSIENT]: CLOUD_OBSERVE_FAILURE.TRANSIENT,
  [ADAPTER_FAILURE.RATE_LIMITED]: CLOUD_OBSERVE_FAILURE.RATE_LIMITED,
} as const satisfies Readonly<
  Record<(typeof ADAPTER_FAILURE)[keyof typeof ADAPTER_FAILURE], CloudObserveFailure>
>;

export interface CloudObserveSeams {
  /** Injected in tests; production uses the platform's own fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  now?: () => number;
}

/** What one provider's pass reported, and whether it may be trusted as the whole roster. */
export interface CloudProviderPass {
  providerId: CloudAgentProviderId;
  observations: readonly ProviderSessionObservation[];
  projects: readonly WorkspaceProject[];
  /** Set when the observations are not the provider's whole current roster. */
  failure?: CloudObserveFailure;
}

/**
 * One read-only pass over the named cloud providers, each on a plugin built
 * for this pass alone and reading the caller's key behind the same
 * read-at-action-time seam the desktop uses. A provider that fails answers
 * with its failure rather than failing the others; a key that cannot be
 * decrypted is a plugin with nothing to observe with, named as such.
 */
export async function observeCloudProviders(options: {
  providerIds: readonly CloudAgentProviderId[];
  readApiKey: (providerId: CloudAgentProviderId) => () => Promise<string | undefined>;
  seams: CloudObserveSeams;
}): Promise<CloudProviderPass[]> {
  const plugins = options.providerIds.map((providerId) =>
    cloudSessionPluginFor(providerId, {
      readApiKey: options.readApiKey(providerId),
      ...(options.seams.httpClient ? { httpClient: options.seams.httpClient } : undefined),
      ...(options.seams.now ? { now: options.seams.now } : undefined),
    }),
  );
  const results = await Promise.allSettled(plugins.map((plugin) => plugin.observe()));
  return options.providerIds.map((providerId, index) => {
    const result = results[index];
    const plugin = plugins[index];
    if (!result || !plugin) {
      return {
        providerId,
        observations: [],
        projects: [],
        failure: CLOUD_OBSERVE_FAILURE.PASS_FAILED,
      };
    }
    if (result.status === "rejected") {
      return {
        providerId,
        observations: [],
        projects: [],
        failure: CLOUD_OBSERVE_FAILURE.PASS_FAILED,
      };
    }
    const adapterFailure = plugin.lastObservationFailure();
    const failure =
      adapterFailure === undefined ? undefined : FAILURE_BY_ADAPTER_FAILURE[adapterFailure];
    return {
      providerId,
      observations: result.value,
      projects: plugin.projects?.() ?? [],
      ...(failure ? { failure } : undefined),
    };
  });
}
