import { conductorPlugin } from "../../../../packages/providers/src/conductor/index.js";
import type { CloudAgentProviderId, CloudFetch, SessionProviderPlugin } from "../core.js";
import { CLOUD_AGENT_PROVIDER_ID } from "../core.js";

/**
 * What a stateless invocation supplies to a cloud plugin: the caller's own
 * decrypted key behind the same read-at-act-time seam the desktop uses, and
 * the fetch/now seams tests inject. The refresh debounce is always bypassed —
 * every server-side plugin lives for exactly one request, so a debounced
 * pass could only ever answer with nothing.
 */
export interface CloudAdapterSeams {
  readApiKey: () => Promise<string | undefined>;
  fetch?: CloudFetch;
  now?: () => number;
}

type PluginBuilder = (seams: CloudAdapterSeams) => SessionProviderPlugin;

function baseOptions(seams: CloudAdapterSeams) {
  return {
    readApiKey: seams.readApiKey,
    minimumRefreshIntervalMs: 0,
    ...(seams.fetch ? { fetch: seams.fetch } : undefined),
    ...(seams.now ? { now: seams.now } : undefined),
  };
}

const PLUGIN_BUILDERS = {
  [CLOUD_AGENT_PROVIDER_ID.CONDUCTOR]: (seams) => conductorPlugin(baseOptions(seams)),
} satisfies Readonly<Record<CloudAgentProviderId, PluginBuilder>>;

/** Builds one provider's cloud plugin for a single stateless request. */
export function cloudSessionPluginFor(
  providerId: CloudAgentProviderId,
  seams: CloudAdapterSeams,
): SessionProviderPlugin {
  return PLUGIN_BUILDERS[providerId](seams);
}
