import { ConductorSessionAdapter } from "../../../../packages/providers/src/conductor/adapter.js";
import { CopilotSessionAdapter } from "../../../../packages/providers/src/copilot/adapter.js";
import {
  CURSOR_PROJECT_REFRESH,
  type CursorProjectRefresh,
  CursorSessionAdapter,
} from "../../../../packages/providers/src/cursor/adapter.js";
import { DevinSessionAdapter } from "../../../../packages/providers/src/devin/adapter.js";
import { JulesSessionAdapter } from "../../../../packages/providers/src/jules/adapter.js";
import { ReplicasSessionAdapter } from "../../../../packages/providers/src/replicas/adapter.js";
import type { CloudFetch } from "../../../../packages/providers/src/shared/cloud-session-adapter.js";
import type { SessionProviderAdapter, VaultProviderId } from "../core.js";
import { VAULT_PROVIDER_ID } from "../core.js";

export { CURSOR_PROJECT_REFRESH, type CursorProjectRefresh };

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
  /**
   * How a Cursor adapter treats its project-list read. The default skips it:
   * a discarded instance can never use the result, and firing it anyway
   * spends the caller's rate-limited Cursor quota. A projects read or a
   * creation act awaits it instead, because that one pass is what must
   * populate the list a creation ask is validated against.
   */
  cursorProjectRefresh?: CursorProjectRefresh;
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
  [VAULT_PROVIDER_ID.CONDUCTOR]: (seams) => new ConductorSessionAdapter(baseOptions(seams)),
  [VAULT_PROVIDER_ID.COPILOT]: (seams) => new CopilotSessionAdapter(baseOptions(seams)),
  [VAULT_PROVIDER_ID.CURSOR]: (seams) =>
    new CursorSessionAdapter({
      ...baseOptions(seams),
      projectRefresh: seams.cursorProjectRefresh ?? CURSOR_PROJECT_REFRESH.SKIP,
    }),
  [VAULT_PROVIDER_ID.DEVIN]: (seams) => new DevinSessionAdapter(baseOptions(seams)),
  [VAULT_PROVIDER_ID.JULES]: (seams) => new JulesSessionAdapter(baseOptions(seams)),
  [VAULT_PROVIDER_ID.REPLICAS]: (seams) => new ReplicasSessionAdapter(baseOptions(seams)),
} satisfies Readonly<Record<VaultProviderId, AdapterBuilder>>;

/** Constructs one provider's cloud adapter for a single stateless request. */
export function cloudSessionAdapterFor(
  providerId: VaultProviderId,
  seams: CloudAdapterSeams,
): SessionProviderAdapter {
  return ADAPTER_BUILDERS[providerId](seams);
}
