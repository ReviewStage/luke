import type { HookEvent, Session, SessionIdentity } from "@sidecar/session";
import type { ActResultStatus } from "@sidecar/wire";
import type { BrainSessionDigest, DigestSource } from "./brain-digest.js";

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
 * What the turn carries about a session's transcript since the brain last
 * looked: never the text, only a digest of it — the read's own status, so an
 * unsupported provider reads as nothing to show rather than nothing
 * happening; whether the front of the slice the summarizer saw was cut to the
 * per-session bound; whether a model wrote the digest or the deterministic
 * fallback did; and the digest itself.
 */
export interface BrainTranscriptDigest {
  status: ActResultStatus;
  truncated: boolean;
  source: DigestSource;
  digest: BrainSessionDigest;
}

export interface BrainWakeEvent {
  kind: BrainWakeKind;
  identity: SessionIdentity;
  /** The spool token the provider's hook wrote, when the wake is one. */
  hookEvent?: HookEvent;
  /** The session as the roster held it at the wake, when it still held it. */
  session?: Session;
  digest?: BrainTranscriptDigest;
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
  decidedAt: number;
  source: BrainDeliverySource;
}
