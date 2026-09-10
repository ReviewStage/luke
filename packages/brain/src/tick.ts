import type { SessionIdentity } from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";

/**
 * What one tick of the host's clock found changed since the last: which
 * sessions appeared, moved, or left, and which of their roster fields moved.
 * The host computes it deterministically from what it observed, and it
 * carries no transcript text — only how much a transcript gained — so
 * the brain decides what to read for itself, through its own tools.
 */

export const TICK_CHANGE_KIND = {
  APPEARED: "appeared",
  CHANGED: "changed",
  VANISHED: "vanished",
} as const;

export type TickChangeKind = (typeof TICK_CHANGE_KIND)[keyof typeof TICK_CHANGE_KIND];

export interface BrainTickChange {
  kind: TickChangeKind;
  identity: SessionIdentity;
  /** The session's title as the roster shows it, when it still stands. */
  title?: string;
  /** The roster fields that moved, each with its new value; absent on a session that only gained transcript. */
  fields?: WireRecord;
  /** How much the session's transcript grew since the last tick, in characters; the text itself never travels here. */
  transcriptCharsGained?: number;
}

export interface BrainTick {
  changes: readonly BrainTickChange[];
}
