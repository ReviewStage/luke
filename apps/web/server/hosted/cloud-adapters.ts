import type * as HttpClient from "@effect/platform/HttpClient";
import type { Layer } from "effect";
import { conductorPlugin } from "../../../../packages/providers/src/conductor/index.js";
import type { CloudSessionPlugin } from "../../../../packages/providers/src/shared/cloud-pass.js";
import type { CloudAgentProviderId, ProviderSessionObservation } from "../core.js";
import { CLOUD_AGENT_PROVIDER_ID } from "../core.js";

/**
 * What one invocation supplies to a cloud plugin: the caller's own decrypted
 * key behind the same read-at-action-time seam the desktop uses, and the
 * client and clock seams tests inject. The refresh debounce is always
 * bypassed — every server-side plugin lives for exactly one pass, so a
 * debounced pass could only ever answer with nothing.
 */
export interface CloudAdapterSeams {
  readApiKey: () => Promise<string | undefined>;
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  now?: () => number;
  /**
   * The roster the plugin's transcript reads answer for, when the host holds
   * one the plugin did not read itself: the brain host reads a chat against
   * the stored snapshot its turns were shown. Absent, the plugin's own pass.
   */
  reported?: () => readonly ProviderSessionObservation[];
}

type PluginBuilder = (seams: CloudAdapterSeams) => CloudSessionPlugin;

function baseOptions(seams: CloudAdapterSeams) {
  return {
    readApiKey: seams.readApiKey,
    minimumRefreshIntervalMs: 0,
    ...(seams.httpClient ? { httpClient: seams.httpClient } : undefined),
    ...(seams.now ? { now: seams.now } : undefined),
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
