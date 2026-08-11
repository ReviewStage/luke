import type { ProviderSessionObservation, SessionControl, SessionProvider } from "./session";

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
  | { status: "accepted" }
  | { status: "rejected"; reason: string }
  | { status: "unsupported" };

/**
 * Optional extension for adapters with a reliable provider-owned control path.
 * Adapters must reject any request whose control was not advertised for the
 * observed session.
 */
export interface ControllableSessionProviderAdapter extends SessionProviderAdapter {
  executeControl(request: ProviderControlRequest): Promise<ProviderControlResult>;
}
