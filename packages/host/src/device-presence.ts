/**
 * What this machine reports of itself on every change-signal poll, and the
 * one rule that turns the machine's facts into the report. The report is two
 * instants and nothing wider: the instant presence holds until, and the
 * instant a meeting hold ends. The service records them and decides nothing
 * from them here; a quiet instant holds speech, and holding is the whole of
 * its power.
 */

import { activeMeetingEnd, type MeetingInterval } from "@sidecar/calendar";

/** The machine's own facts, read by the client that runs on it; the host never reads them itself. */
export interface MachinePresence {
  /** Seconds since input was last seen, as the operating system counts them. */
  readonly idleSeconds: number;
  readonly screenLocked: boolean;
}

/**
 * What one poll reports: each an epoch-millisecond instant, or `null` to
 * clear the one on file. The quiet instant has a third value: `undefined`
 * while the calendars have not been observed this run, which leaves the
 * field off the wire so the service keeps the instant it holds. Not knowing
 * whether a meeting stands is not the same fact as knowing none does, and
 * the store reads the two differently on purpose — an absent field leaves,
 * `null` clears — so the report never turns the first into the second.
 */
export interface DevicePresenceReport {
  readonly activeUntil: number | null;
  readonly quietUntil: number | null | undefined;
}

/** How often a signed-in Mac polls the change signal, which is also how often its presence is restated. */
export const DEVICE_POLL_INTERVAL_MS = 60_000;

/**
 * The developer is present while input was seen within the limit and the
 * screen is unlocked — both, not either — and presence is claimed only until
 * the second poll after this one, so a Mac that stops polling reads as gone
 * on its own without a poll to say so, and one poll that was missed does not
 * flicker it.
 */
export const PRESENCE_RULE = {
  IDLE_LIMIT_SECONDS: 120,
  ACTIVE_WINDOW_MS: 2 * DEVICE_POLL_INTERVAL_MS,
} as const;

/**
 * The instant a meeting hold ends: the end of the meeting covering `at`
 * while the quiet-during-meetings setting is on; `null` where the calendars
 * were observed and no hold stands, including a machine with no calendar
 * connected; and `undefined` before any observation has resolved, because a
 * poll that ran first would otherwise clear a hold the service still rightly
 * holds from before a relaunch, and Luke would speak into the meeting until
 * the calendars loaded.
 */
export function quietUntilFrom(
  meetings: readonly MeetingInterval[] | undefined,
  quietDuringMeetings: boolean,
  at: number,
): number | null | undefined {
  if (meetings === undefined) return undefined;
  const end = activeMeetingEnd(meetings, at);
  return end !== undefined && quietDuringMeetings ? end : null;
}

/** The instant presence holds until, or `null` for a machine that is idle, locked, or unknown to this host. */
export function activeUntilFrom(presence: MachinePresence | undefined, now: number): number | null {
  if (presence === undefined || presence.screenLocked) return null;
  if (presence.idleSeconds >= PRESENCE_RULE.IDLE_LIMIT_SECONDS) return null;
  return now + PRESENCE_RULE.ACTIVE_WINDOW_MS;
}
