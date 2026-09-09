import { isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { SESSION_APPLICATION_ID } from "./session-identity.js";

export const PROVIDER_LOCATION_KIND = {
  LOCAL: "local",
  CLOUD: "cloud",
  LOCAL_AND_CLOUD: "local-and-cloud",
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
    location: PROVIDER_LOCATION_KIND.LOCAL_AND_CLOUD,
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
 * spent. Codex is absent deliberately: its cloud surface documents no
 * key-scoped API and is observed through the user's own CLI instead, so there
 * is no key to hold. A new entry needs a server-side observation strategy of
 * its own before it can be added.
 */
export const CLOUD_AGENT_PROVIDER_ID = {
  CONDUCTOR: PROVIDER_ID.CONDUCTOR,
} as const satisfies Record<string, ProviderId>;

export type CloudAgentProviderId =
  (typeof CLOUD_AGENT_PROVIDER_ID)[keyof typeof CLOUD_AGENT_PROVIDER_ID];

const CLOUD_AGENT_PROVIDER_IDS: ReadonlySet<string> = new Set(
  Object.values(CLOUD_AGENT_PROVIDER_ID),
);

/** Whether an untrusted value names a provider whose sessions Luke observes in the cloud. */
export function isCloudAgentProviderId(value: UnparsedWireValue): value is CloudAgentProviderId {
  return isWireString(value) && CLOUD_AGENT_PROVIDER_IDS.has(value);
}

/**
 * The provider id the local Conductor workspace creator answers to. It names
 * no observed session provider — `isProviderId` stays false for it — because a
 * local Conductor chat is already observed by the agent that runs it. The id
 * exists only so the repositories Conductor holds can offer their creation
 * projects apart from the cloud Conductor adapter, which owns
 * `PROVIDER_ID.CONDUCTOR`: a creation request resolves to exactly one adapter,
 * so a local repository and a cloud project must route under ids of their own,
 * even as both wear Conductor's name and mark.
 */
export const CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID = "conductor-local";

export const SUPERSET_WORKSPACE_PROVIDER_ID = SESSION_APPLICATION_ID.SUPERSET;

/**
 * Every provider that can offer a workspace through the desktop app: the
 * observed session providers, Superset's own workspace provider, and local
 * Conductor's — the last two name no observed session provider, so they are
 * added beside `ProviderId` rather than found within it.
 */
export type WorkspaceProviderId =
  | ProviderId
  | typeof SUPERSET_WORKSPACE_PROVIDER_ID
  | typeof CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID;

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

/** The registry's own order, for the same reason `PROVIDER_ID_LIST` keeps one. */
export const HOSTED_AGENT_ID_LIST: readonly HostedAgentId[] = Object.values(HOSTED_AGENT_ID);

const HOSTED_AGENT_IDS: ReadonlySet<string> = new Set(HOSTED_AGENT_ID_LIST);

/** Whether this build draws the hosted agent an observation names. */
export function isHostedAgentId(value: string): value is HostedAgentId {
  return HOSTED_AGENT_IDS.has(value);
}

const PROVIDER_IDS: ReadonlySet<string> = new Set(PROVIDER_ID_LIST);

/** Whether this build knows the provider an observation names. */
export function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.has(value);
}

export function isWorkspaceProviderId(value: string): value is WorkspaceProviderId {
  return (
    isProviderId(value) ||
    value === SUPERSET_WORKSPACE_PROVIDER_ID ||
    value === CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID
  );
}

/**
 * Whether a CLI-observed provider can be observed right now, without ever
 * exposing the login behind it — the CLI analogue of the credential sources a keyed provider reports.
 * Unknown is the state before the first pass has asked; the other three are
 * what the latest pass learned from the provider's own CLI.
 */
export const CLI_CONNECTION = {
  UNKNOWN: "unknown",
  CONNECTED: "connected",
  SIGNED_OUT: "signed-out",
  CLI_MISSING: "cli-missing",
} as const;

export type CliConnection = (typeof CLI_CONNECTION)[keyof typeof CLI_CONNECTION];
