import { conductorPlugin } from "../../../../packages/providers/src/conductor/index.js";
import type { CloudSessionPlugin } from "../../../../packages/providers/src/shared/cloud-pass.js";
import type { CloudAgentProviderId, CloudFetch, ProviderSessionObservation } from "../core.js";
import { CLOUD_AGENT_PROVIDER_ID } from "../core.js";

/**
 * What one invocation supplies to a cloud plugin: the caller's own decrypted
 * key behind the same read-at-action-time seam the desktop uses, and the
 * fetch, clock, and sleep seams tests inject. The refresh debounce is always
 * bypassed — every server-side plugin lives for exactly one pass, so a
 * debounced pass could only ever answer with nothing.
 */
export interface CloudAdapterSeams {
  readApiKey: () => Promise<string | undefined>;
  fetch?: CloudFetch;
  now?: () => number;
  /** How a 429's backoff wait is spent; injected in tests so a forced 429 costs no wall clock. */
  sleep?: (ms: number) => Promise<void>;
  /** The roster the brain's transcript reads answer for, when the caller holds the stored snapshot rather than running a pass. */
  reported?: () => readonly ProviderSessionObservation[];
}

type PluginBuilder = (seams: CloudAdapterSeams) => CloudSessionPlugin;

function baseOptions(seams: CloudAdapterSeams) {
  return {
    readApiKey: seams.readApiKey,
    minimumRefreshIntervalMs: 0,
    ...(seams.fetch ? { fetch: seams.fetch } : undefined),
    ...(seams.now ? { now: seams.now } : undefined),
    ...(seams.sleep ? { sleep: seams.sleep } : undefined),
    ...(seams.reported ? { reported: seams.reported } : undefined),
  };
}

const PLUGIN_BUILDERS = {
  [CLOUD_AGENT_PROVIDER_ID.CONDUCTOR]: (seams) => conductorPlugin(baseOptions(seams)),
} satisfies Readonly<Record<CloudAgentProviderId, PluginBuilder>>;

/** Builds one provider's cloud plugin for a single pass. */
export function cloudSessionPluginFor(
  providerId: CloudAgentProviderId,
  seams: CloudAdapterSeams,
): CloudSessionPlugin {
  return PLUGIN_BUILDERS[providerId](seams);
}

export type { CloudSessionPlugin };
