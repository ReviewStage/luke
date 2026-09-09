import { ConductorSessionAdapter } from "../../../../packages/providers/src/conductor/adapter.js";
import type { CloudAgentProviderId, CloudFetch, SessionProviderAdapter } from "../core.js";
import { CLOUD_AGENT_PROVIDER_ID } from "../core.js";

/**
 * What a stateless invocation supplies to a cloud adapter: the caller's own
 * decrypted key behind the same read-at-act-time seam the desktop uses, and
 * the fetch/now seams tests inject. The refresh debounce is always bypassed —
 * every server-side adapter lives for exactly one request, so a debounced
 * pass could only ever answer with nothing.
 */
export interface CloudAdapterSeams {
  readApiKey: () => Promise<string | undefined>;
  fetch?: CloudFetch;
  now?: () => number;
}

type AdapterBuilder = (seams: CloudAdapterSeams) => SessionProviderAdapter;

function baseOptions(seams: CloudAdapterSeams) {
  return {
    readApiKey: seams.readApiKey,
    minimumRefreshIntervalMs: 0,
    ...(seams.fetch ? { fetch: seams.fetch } : undefined),
    ...(seams.now ? { now: seams.now } : undefined),
  };
}

const ADAPTER_BUILDERS = {
  [CLOUD_AGENT_PROVIDER_ID.CONDUCTOR]: (seams) => new ConductorSessionAdapter(baseOptions(seams)),
} satisfies Readonly<Record<CloudAgentProviderId, AdapterBuilder>>;

/** Constructs one provider's cloud adapter for a single stateless request. */
export function cloudSessionAdapterFor(
  providerId: CloudAgentProviderId,
  seams: CloudAdapterSeams,
): SessionProviderAdapter {
  return ADAPTER_BUILDERS[providerId](seams);
}
