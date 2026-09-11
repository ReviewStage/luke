import type { UnparsedWireValue } from "@sidecar/wire";
import { Schema } from "effect";

export const PROVIDER_LOCATION_KIND = {
  LOCAL: "local",
  CLOUD: "cloud",
} as const;

export type ProviderLocationKind =
  (typeof PROVIDER_LOCATION_KIND)[keyof typeof PROVIDER_LOCATION_KIND];

/**
 * Stable provider identifiers shared by adapters, the registry, and the UI.
 * They key provider-specific facts without a renderer importing adapter code
 * or matching on a display name.
 */
export const PROVIDER_ID = {
  CLAUDE_CODE: "claude-code",
  CODEX: "codex",
  CONDUCTOR: "conductor",
  OMP: "omp",
} as const;

export type ProviderId = (typeof PROVIDER_ID)[keyof typeof PROVIDER_ID];

export const ProviderIdSchema = Schema.Literal(...Object.values(PROVIDER_ID));

export interface ProviderIdentity {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly location: ProviderLocationKind;
}

/**
 * Shared provider identity only. Capabilities, credentials, hooks, fixtures,
 * and presentation stay in the packages that own those decisions.
 */
export const PROVIDER_IDENTITY_BY_ID = {
  [PROVIDER_ID.CLAUDE_CODE]: {
    id: PROVIDER_ID.CLAUDE_CODE,
    displayName: "Claude Code",
    location: PROVIDER_LOCATION_KIND.LOCAL,
  },
  [PROVIDER_ID.CODEX]: {
    id: PROVIDER_ID.CODEX,
    displayName: "Codex",
    location: PROVIDER_LOCATION_KIND.LOCAL,
  },
  [PROVIDER_ID.CONDUCTOR]: {
    id: PROVIDER_ID.CONDUCTOR,
    displayName: "Conductor",
    location: PROVIDER_LOCATION_KIND.CLOUD,
  },
  [PROVIDER_ID.OMP]: {
    id: PROVIDER_ID.OMP,
    displayName: "OMP",
    location: PROVIDER_LOCATION_KIND.LOCAL,
  },
} as const satisfies Readonly<Record<ProviderId, ProviderIdentity>>;

/**
 * The providers whose sessions live in a cloud service Luke observes on the
 * user's behalf: the ones Settings lists as agents to hold a key for, and the
 * ones the hosted vault accepts a key for. One vocabulary rather than two,
 * because the two are the same fact — a key here buys cloud observation, and
 * a provider that offers no cloud observation has nowhere for a key to be
 * spent. Codex is absent deliberately: Luke observes it only on this machine,
 * from its own transcripts, so there is no key to hold. A new entry needs a
 * server-side observation strategy of its own before it can be added.
 */
export const CLOUD_AGENT_PROVIDER_ID = {
  CONDUCTOR: PROVIDER_ID.CONDUCTOR,
} as const satisfies Record<string, ProviderId>;

export type CloudAgentProviderId =
  (typeof CLOUD_AGENT_PROVIDER_ID)[keyof typeof CLOUD_AGENT_PROVIDER_ID];

export const CloudAgentProviderIdSchema = Schema.Literal(...Object.values(CLOUD_AGENT_PROVIDER_ID));

const readsCloudAgentProviderId = Schema.is(CloudAgentProviderIdSchema);

/** Whether an untrusted value names a provider whose sessions Luke observes in the cloud. */
export function isCloudAgentProviderId(value: UnparsedWireValue): value is CloudAgentProviderId {
  return readsCloudAgentProviderId(value);
}

/**
 * Every provider that can offer a workspace through the desktop app. Today
 * that is the observed session providers alone; the type keeps its own name
 * because a workspace provider is a different question from an observed one,
 * and a provider that creates workspaces without observing sessions would be
 * added here beside `ProviderId` rather than found within it.
 */
export type WorkspaceProviderId = ProviderId;

export const WorkspaceProviderIdSchema = ProviderIdSchema;

/**
 * The order any list of providers reads in. It is the registry's own order
 * rather than one derived from live sessions, so a list of agents does not
 * reshuffle as their sessions come and go.
 */
export const PROVIDER_ID_LIST: readonly ProviderId[] = Object.values(PROVIDER_IDENTITY_BY_ID).map(
  (identity) => identity.id,
);

/**
 * Agents Luke draws only inside a hosting app's workspaces — the agents
 * Conductor and Superset run beside Claude Code and Codex. Identity alone:
 * the id keys the agent's own mark and filter chip, and nothing else exists
 * behind it — no adapter, no files, no credential — so the hosting provider
 * stays the thing observed, credentialed, and written through.
 */
export const HOSTED_AGENT_ID = {
  COPILOT: "copilot",
  CURSOR: "cursor",
  GEMINI_CLI: "gemini-cli",
  GROK_BUILD: "grok-build",
  OPENCODE: "opencode",
} as const;

export type HostedAgentId = (typeof HOSTED_AGENT_ID)[keyof typeof HOSTED_AGENT_ID];

export const HostedAgentIdSchema = Schema.Literal(...Object.values(HOSTED_AGENT_ID));

/** The registry's own order, for the same reason `PROVIDER_ID_LIST` keeps one. */
export const HOSTED_AGENT_ID_LIST: readonly HostedAgentId[] = Object.values(HOSTED_AGENT_ID);

const readsHostedAgentId = Schema.is(HostedAgentIdSchema);

/** Whether this build draws the hosted agent an observation names. */
export function isHostedAgentId(value: string): value is HostedAgentId {
  return readsHostedAgentId(value);
}

const readsProviderId = Schema.is(ProviderIdSchema);

export function isProviderId(value: string): value is ProviderId {
  return readsProviderId(value);
}

const readsWorkspaceProviderId = Schema.is(WorkspaceProviderIdSchema);

export function isWorkspaceProviderId(value: string): value is WorkspaceProviderId {
  return readsWorkspaceProviderId(value);
}
