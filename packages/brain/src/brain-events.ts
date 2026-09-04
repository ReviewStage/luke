import type { Session, SessionIdentity } from "@sidecar/session";
import type { ActResultStatus } from "@sidecar/wire";

/**
 * What the brain observes, and what it hands back. An event is one session as
 * the roster look found it, carrying the hook that fired for it when one did;
 * a delivery is one briefing the brain decided to give, for the host to speak
 * or hold. Nothing here detects a change: the brain notices changes itself,
 * against its own memory.
 */

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
  identity: SessionIdentity;
  /** The provider's own name for the hook that fired, when one did. */
  hookEvent?: string;
  /** The session as the roster held it at the look, when it still held it. */
  session?: Session;
  transcriptDelta?: BrainTranscriptDelta;
  atMs: number;
}

export interface BrainDelivery {
  briefing: string;
  decidedAt: number;
}
