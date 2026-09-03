import type { Session, SessionIdentity, SessionStatus } from "@sidecar/session";
import type { ActResultStatus } from "@sidecar/wire";

/**
 * What wakes the brain, and what it hands back. A wake is a provider's hook
 * firing or a status edge the poll saw; a delivery is one briefing the brain
 * decided to give, for the host to speak or hold.
 */

export const BRAIN_WAKE_KIND = {
  HOOK: "hook",
  STATUS_EDGE: "status-edge",
} as const;

export type BrainWakeKind = (typeof BRAIN_WAKE_KIND)[keyof typeof BRAIN_WAKE_KIND];

/**
 * The transcript written since the brain last looked at a session, as the
 * turn carries it: the text, whether the front was cut to the per-session
 * bound, and the read's own status, so an unsupported provider reads as
 * nothing to show rather than nothing happening.
 */
export interface BrainTranscriptDelta {
  text: string;
  truncated: boolean;
  status: ActResultStatus;
}

export interface BrainWakeEvent {
  kind: BrainWakeKind;
  identity: SessionIdentity;
  /** The provider's own name for the hook that fired, when the wake is one. */
  hookEvent?: string;
  previousStatus?: SessionStatus;
  /** The session as the roster held it at the wake, when it still held it. */
  session?: Session;
  transcriptDelta?: BrainTranscriptDelta;
  atMs: number;
}

export const BRAIN_DELIVERY_SOURCE = {
  WAKE: "wake",
  HOLD_RELEASED: "hold-released",
} as const;

export type BrainDeliverySource =
  (typeof BRAIN_DELIVERY_SOURCE)[keyof typeof BRAIN_DELIVERY_SOURCE];

export interface BrainDelivery {
  briefing: string;
  /** The observed sessions the briefing is about, each validated against the roster at the decision. */
  sessionIds: readonly SessionIdentity[];
  decidedAt: number;
  source: BrainDeliverySource;
}
