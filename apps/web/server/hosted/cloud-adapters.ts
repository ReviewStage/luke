import { ConductorSessionAdapter } from "../../../../packages/providers/src/conductor/adapter.js";
import type {
  CloudFetch,
  CloudSessionAdapter,
} from "../../../../packages/providers/src/shared/cloud-session-adapter.js";
import type { VaultProviderId } from "../core.js";
import { VAULT_PROVIDER_ID } from "../core.js";

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

type AdapterBuilder = (seams: CloudAdapterSeams) => CloudSessionAdapter;

function baseOptions(seams: CloudAdapterSeams) {
  return {
    readApiKey: seams.readApiKey,
    minimumRefreshIntervalMs: 0,
    ...(seams.fetch ? { fetch: seams.fetch } : undefined),
    ...(seams.now ? { now: seams.now } : undefined),
  };
}

const ADAPTER_BUILDERS = {
  [VAULT_PROVIDER_ID.CONDUCTOR]: (seams) => new ConductorSessionAdapter(baseOptions(seams)),
} satisfies Readonly<Record<VaultProviderId, AdapterBuilder>>;

/** Constructs one provider's cloud adapter for a single stateless request. */
export function cloudSessionAdapterFor(
  providerId: VaultProviderId,
  seams: CloudAdapterSeams,
): CloudSessionAdapter {
  return ADAPTER_BUILDERS[providerId](seams);
}
