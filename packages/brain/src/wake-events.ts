import type { Session, SessionIdentity } from "@sidecar/session";
import type { ActionResultStatus, WireRecord } from "@sidecar/wire";

/**
 * What wakes the brain, and what it hands back. A wake is a roster edge for
 * one session, handed in by the host or read on the scheduled look the brain
 * takes on its own clock; a delivery is one briefing the brain decided to
 * give, for the host to speak or hold. Nothing here detects a change: the
 * brain notices changes itself, against its own memory.
 */

export const BRAIN_WAKE_KIND = {
  ROSTER: "roster",
} as const;

type BrainWakeKind = (typeof BRAIN_WAKE_KIND)[keyof typeof BRAIN_WAKE_KIND];

/**
 * The transcript written since the brain last looked at a session, as the
 * turn carries it: the text, whether the front was cut to the per-session
 * bound, and the read's own status, so an unsupported provider reads as
 * nothing to show rather than nothing happening.
 */
export interface BrainTranscriptDelta {
  text: string;
  truncated: boolean;
  status: ActionResultStatus;
}

export interface BrainWakeEvent {
  kind: BrainWakeKind;
  identity: SessionIdentity;
  /** The session as the roster held it at the wake, when it still held it. */
  session?: Session;
  /** The session's fields as an inbox entry kept them, for a wake replayed from the durable inbox. */
  sessionSummary?: WireRecord;
  transcriptDelta?: BrainTranscriptDelta;
  atMs: number;
}
