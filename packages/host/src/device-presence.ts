/**
 * What this machine reports of itself on every change-signal poll, and the
 * rules that turn the machine's facts into the report. The report is two
 * instants and nothing wider: the instant presence holds until, and the
 * instant the quiet this Mac observes ends — a meeting's end, or the stepped
 * instant an announcement hold with no end of its own is restated as. The
 * service records them and decides nothing from them here; a quiet instant
 * holds speech, and holding is the whole of its power.
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
 * while the calendars have not been observed this run and no hold of the
 * Mac's own stands, which leaves the field off the wire so the service keeps
 * the instant it holds. Not knowing whether a meeting stands is not the same
 * fact as knowing none does, and the store reads the two differently on
 * purpose — an absent field leaves, `null` clears — so the report never
 * turns the first into the second.
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

/**
 * How an announcement hold with no end of its own — the pause switch, the
 * spoken introduction still owed — is restated as an instant. Presence is
 * the model: claimed a bounded distance ahead and restated by every beat, so
 * a hold lapses on its own once the Mac asserting it stops beating. A far
 * instant sent once would not: the row outlives the Mac that wrote it, and
 * nothing on the service ages a quiet instant by when the row was last
 * seen, so a Mac gone mid-pause would hold its account's briefings from
 * every device, the phone included, until a sign-out that may never come.
 * The instant is stepped rather than rolling because the service re-holds
 * every open offer each time an account's quiet instant moves later: an
 * instant one beat ahead would move every minute and write a hold per offer
 * per minute for as long as the pause lasts, where one stepped to the hour
 * moves once an hour. So it is the second hour boundary from now: at least
 * one step ahead, so no beat's instant lapses before the next beat restates
 * it, and at most two, so a Mac gone mid-hold frees its account within that.
 */
export const QUIET_HOLD_RULE = {
  STEP_MS: 60 * 60_000,
  STEPS_AHEAD: 2,
} as const;

/** The instant an open-ended hold is restated as at `at`: the second step boundary from now. */
export function openEndedQuietUntil(at: number): number {
  return (
    (Math.floor(at / QUIET_HOLD_RULE.STEP_MS) + QUIET_HOLD_RULE.STEPS_AHEAD) *
    QUIET_HOLD_RULE.STEP_MS
  );
}

/** The two holds this Mac decides for itself, each with no instant of its own. */
export interface AnnouncementHolds {
  /** The announce-sessions switch is off. */
  readonly paused: boolean;
  /** The spoken introduction is owed and its completion is not yet on file. */
  readonly introductionOwed: boolean;
}

/**
 * The quiet instant a poll reports: the meeting hold as observed, with an
 * open-ended hold folded in where one stands. The latest instant wins, so a
 * meeting ending after the stepped instant holds to its end and a pause
 * outlasting the meeting holds past it. With no hold of the Mac's own, the
 * meeting's three states pass through untouched, absence included; with one,
 * the instant is known whether or not the calendars have been observed yet,
 * since the hold stands either way.
 */
export function reportedQuietUntil(
  meetingQuietUntil: number | null | undefined,
  holds: AnnouncementHolds,
  at: number,
): number | null | undefined {
  if (!holds.paused && !holds.introductionOwed) return meetingQuietUntil;
  const held = openEndedQuietUntil(at);
  if (meetingQuietUntil === undefined || meetingQuietUntil === null) return held;
  return Math.max(meetingQuietUntil, held);
}

/** The instant presence holds until, or `null` for a machine that is idle, locked, or unknown to this host. */
export function activeUntilFrom(presence: MachinePresence | undefined, now: number): number | null {
  if (presence === undefined || presence.screenLocked) return null;
  if (presence.idleSeconds >= PRESENCE_RULE.IDLE_LIMIT_SECONDS) return null;
  return now + PRESENCE_RULE.ACTIVE_WINDOW_MS;
}
