import type { SessionKey } from "@sidecar/runtime/vocabulary";
import type { Session, SessionIdentity } from "@sidecar/session";
import type { ActResultStatus, WireRecord } from "@sidecar/wire";
import type { BrainTurnTrigger } from "./turn.js";

/**
 * What wakes the brain, and what it hands back. A wake is a provider's hook
 * firing, or the scheduled look at the whole roster the brain takes on its
 * own clock; a delivery is one briefing the brain decided to give, for the
 * host to speak or hold. Nothing here detects a change: the brain notices
 * changes itself, against its own memory.
 */

export const BRAIN_WAKE_KIND = {
  HOOK: "hook",
  ROSTER: "roster",
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
  /** The session as the roster held it at the wake, when it still held it. */
  session?: Session;
  /** The session's fields as an inbox entry kept them, for a wake replayed from the durable inbox. */
  sessionSummary?: WireRecord;
  transcriptDelta?: BrainTranscriptDelta;
  atMs: number;
  /** The inbox entry this wake was captured as, so the turn that opens with it consumes it. */
  entryId?: string;
}

export interface BrainDelivery {
  briefing: string;
  decidedAt: number;
  /**
   * The conversation that decided the briefing, set by the host that routes
   * deliveries, so a briefing held through a meeting goes back to the
   * conversation that knows the session it was about, never to another.
   */
  sessionKey?: SessionKey;
}

/**
 * What one observation or heartbeat turn amounted to, in the host's own
 * counts and never a transcript's words: which sessions it looked at,
 * whether it briefed the developer and with what, and how many acts it
 * carried. An observed conversation hands one to the host after each of its
 * turns.
 */
export interface BrainTurnReport {
  trigger: BrainTurnTrigger;
  identities: readonly SessionIdentity[];
  briefings: readonly string[];
  performedActs: number;
  at: number;
}

/**
 * The same report once the host has named the session it was about: the
 * compact attributable notice main reads on its next turn, so main learns
 * what its sibling conversations did without ever being handed their raw
 * context.
 */
export interface BrainTurnNotice extends BrainTurnReport {
  /** The host's own name for the session the turn looked at, never a transcript's words. */
  label: string;
}
