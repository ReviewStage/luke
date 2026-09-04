import { CONNECTION_KIND, type ConnectionKind } from "@sidecar/credentials/connections";
import {
  PROVIDER_ID,
  PROVIDER_ID_LIST,
  PROVIDER_LOCATION_KIND,
  type ProviderId,
  type ProviderLocationKind,
} from "@sidecar/session";

/**
 * The acts an adapter can implement, one name per seam of the total
 * `SessionProviderAdapter` interface that the base class answers unsupported.
 * A read is an act here too: it is a thing an adapter either does or refuses.
 */
export const PROVIDER_ACT = {
  MESSAGE: "message",
  CONTROL: "control",
  CREATE_WORKSPACE: "create-workspace",
  ADD_AGENT: "add-agent",
  RENAME_WORKSPACE: "rename-workspace",
  RENAME_SESSION: "rename-session",
  READ_TRANSCRIPT: "read-transcript",
  READ_CONVERSATION: "read-conversation",
} as const;

export type ProviderAct = (typeof PROVIDER_ACT)[keyof typeof PROVIDER_ACT];

export const PROVIDER_ACT_LIST: readonly ProviderAct[] = Object.values(PROVIDER_ACT);

/**
 * What one provider's adapter, hooks, and credential amount to, stated in one
 * place. This declares nothing the code does not already do: the conformance
 * test compares `acts` against the seams each adapter actually overrides,
 * `observationHook` against the hook table, and `credential` against the
 * registration, so the declaration can neither advertise an act the adapter
 * lacks nor forget one it has. Changing a row is a product and privacy
 * decision, not registry housekeeping.
 */
export interface ProviderCapabilities {
  location: ProviderLocationKind;
  observationHook: boolean;
  credential: ConnectionKind;
  acts: readonly ProviderAct[];
  /** Whether the provider's workspaces run agents whose kinds this build lists. */
  hostsAgents: boolean;
}

export const PROVIDER_CAPABILITIES = {
  [PROVIDER_ID.CLAUDE_CODE]: {
    location: PROVIDER_LOCATION_KIND.LOCAL,
    observationHook: true,
    credential: CONNECTION_KIND.LOCAL,
    acts: [PROVIDER_ACT.READ_TRANSCRIPT],
    hostsAgents: false,
  },
  [PROVIDER_ID.CODEX]: {
    location: PROVIDER_LOCATION_KIND.LOCAL_AND_CLOUD,
    observationHook: true,
    credential: CONNECTION_KIND.CLI_LOGIN,
    acts: [PROVIDER_ACT.READ_TRANSCRIPT, PROVIDER_ACT.CREATE_WORKSPACE],
    hostsAgents: false,
  },
  [PROVIDER_ID.CONDUCTOR]: {
    location: PROVIDER_LOCATION_KIND.CLOUD,
    observationHook: false,
    credential: CONNECTION_KIND.KEY,
    acts: [
      PROVIDER_ACT.MESSAGE,
      PROVIDER_ACT.CONTROL,
      PROVIDER_ACT.CREATE_WORKSPACE,
      PROVIDER_ACT.ADD_AGENT,
      PROVIDER_ACT.RENAME_WORKSPACE,
      PROVIDER_ACT.RENAME_SESSION,
      PROVIDER_ACT.READ_CONVERSATION,
    ],
    hostsAgents: true,
  },
  [PROVIDER_ID.OMP]: {
    location: PROVIDER_LOCATION_KIND.LOCAL,
    observationHook: false,
    credential: CONNECTION_KIND.LOCAL,
    acts: [PROVIDER_ACT.READ_TRANSCRIPT],
    hostsAgents: false,
  },
} as const satisfies Readonly<Record<ProviderId, ProviderCapabilities>>;

/** One provider's row, widened from its literal shape to the declared contract. */
export function providerCapabilities(providerId: ProviderId): ProviderCapabilities {
  return PROVIDER_CAPABILITIES[providerId];
}

/** The providers declaring one act, in registry order. */
export function providersWithAct(act: ProviderAct): readonly ProviderId[] {
  return PROVIDER_ID_LIST.filter((providerId) =>
    providerCapabilities(providerId).acts.includes(act),
  );
}
