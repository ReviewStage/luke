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
