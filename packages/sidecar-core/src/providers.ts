import type { ProviderSessionObservation, SessionControl, SessionProvider } from "./session";

/**
 * Stable provider identifiers shared by adapters, the registry, and the UI.
 * They key provider-specific presentation (such as a mark) without a renderer
 * having to import adapter code or match on a display name.
 */
export const PROVIDER_ID = {
  CLAUDE_CODE: "claude-code",
  CODEX: "codex",
  CONDUCTOR: "conductor",
  CURSOR: "cursor",
} as const;

export type ProviderId = (typeof PROVIDER_ID)[keyof typeof PROVIDER_ID];

/** The order any list of providers reads in, so it never depends on live state. */
export const PROVIDER_ID_LIST: readonly ProviderId[] = Object.values(PROVIDER_ID);

/**
 * Where a provider's sessions are read from. A local provider is observed from
 * state this Mac already holds; a cloud provider has no local state at all and
 * observes nothing until the user supplies a key. It is the difference between
 * what keeps working offline and what does not, which is why it is a property
 * of the provider rather than of any one session.
 */
export const PROVIDER_ORIGIN = {
  LOCAL: "local",
  CLOUD: "cloud",
} as const;

export type ProviderOrigin = (typeof PROVIDER_ORIGIN)[keyof typeof PROVIDER_ORIGIN];

/** Keyed by provider id so no caller has to build a key from an identifier. */
export const PROVIDER_ORIGINS: Readonly<Record<ProviderId, ProviderOrigin>> = {
  [PROVIDER_ID.CLAUDE_CODE]: PROVIDER_ORIGIN.LOCAL,
  [PROVIDER_ID.CODEX]: PROVIDER_ORIGIN.LOCAL,
  [PROVIDER_ID.CONDUCTOR]: PROVIDER_ORIGIN.CLOUD,
  [PROVIDER_ID.CURSOR]: PROVIDER_ORIGIN.CLOUD,
};

/**
 * `hasOwn` rather than `in`: an inherited name such as `toString` is not a
 * provider id.
 */
export function isProviderId(value: string): value is ProviderId {
  return Object.hasOwn(PROVIDER_ORIGINS, value);
}

/**
 * A provider this build does not know is not claimed to be either kind. It
 * still has a session and is still counted; it simply answers no question about
 * where it runs, rather than being filed under a guess.
 */
export function providerOrigin(providerId: string): ProviderOrigin | undefined {
  return isProviderId(providerId) ? PROVIDER_ORIGINS[providerId] : undefined;
}

export const PROVIDER_CONTROL_RESULT_STATUS = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  UNSUPPORTED: "unsupported",
} as const;

export type ProviderControlResultStatus =
  (typeof PROVIDER_CONTROL_RESULT_STATUS)[keyof typeof PROVIDER_CONTROL_RESULT_STATUS];

/** A provider adapter has no dependency on Electron, a renderer, or live UI state. */
export interface SessionProviderAdapter {
  readonly provider: SessionProvider;
  observe(): Promise<readonly ProviderSessionObservation[]>;
}

/** A provider-local request for a control that was previously exposed by observation. */
export interface ProviderControlRequest {
  providerSessionId: string;
  control: SessionControl;
}

/**
 * Providers must report unsupported or rejected controls explicitly; the core
 * deliberately provides no fallback path such as terminal input injection.
 */
export type ProviderControlResult =
  | { status: typeof PROVIDER_CONTROL_RESULT_STATUS.ACCEPTED }
  | { status: typeof PROVIDER_CONTROL_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof PROVIDER_CONTROL_RESULT_STATUS.UNSUPPORTED };

/**
 * Optional extension for adapters with a reliable provider-owned control path.
 * Adapters must reject any request whose control was not advertised for the
 * observed session.
 */
export interface ControllableSessionProviderAdapter extends SessionProviderAdapter {
  executeControl(request: ProviderControlRequest): Promise<ProviderControlResult>;
}
