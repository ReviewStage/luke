/**
 * The calendar model: when the developer's meetings start and end, and nothing
 * else. A calendar is read for exactly one question — is the user in a meeting
 * now, and until when — so the reader keeps intervals alone. What arrives here
 * is a free/busy answer: the calendar service composes availability itself and
 * responds with busy periods, so a title or an attendee cannot travel in the
 * input at all, and this module only has to bound what it keeps.
 */

/** One meeting as the app keeps it: an interval, with nothing about it. */
export interface MeetingInterval {
  startsAt: number;
  endsAt: number;
}

/**
 * How far ahead meetings are kept. The one consumer asks about now, and the
 * feed is re-read long before this horizon arrives; everything further is
 * data with no question to answer.
 */
export const CALENDAR_LOOKAHEAD_MS = 48 * 3_600_000;

/**
 * The longest busy block still treated as a meeting. A day-long block is a
 * reminder or an out-of-office, not a conversation to keep quiet through —
 * holding announcements for twelve hours would silence the sidecar, not
 * respect a meeting.
 */
export const MAXIMUM_MEETING_LENGTH_MS = 12 * 3_600_000;

/** More meetings than two days hold; past this the answer is noise, not a diary. */
export const MAXIMUM_CALENDAR_MEETINGS = 200;

/**
 * Reads a free/busy answer into bounded meetings. The input is the untrusted
 * `busy` list a calendar service answered with: anything that is not a pair
 * of RFC 3339 instants is dropped, a block longer than a meeting can be is
 * not a meeting, and only blocks that could still matter — ending after
 * `now`, starting within the look-ahead — are kept, sorted and capped.
 */
export function meetingsFromBusyIntervals(busy: unknown, now: number): MeetingInterval[] {
  if (!Array.isArray(busy)) return [];
  const windowEnd = now + CALENDAR_LOOKAHEAD_MS;
  const meetings: MeetingInterval[] = [];
  for (const entry of busy) {
    if (entry === null || typeof entry !== "object") continue;
    const { start, end } = entry as Record<string, unknown>;
    if (typeof start !== "string" || typeof end !== "string") continue;
    const startsAt = Date.parse(start);
    const endsAt = Date.parse(end);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) continue;
    if (endsAt - startsAt <= 0 || endsAt - startsAt > MAXIMUM_MEETING_LENGTH_MS) continue;
    if (endsAt <= now || startsAt > windowEnd) continue;
    meetings.push({ startsAt, endsAt });
  }
  meetings.sort((a, b) => a.startsAt - b.startsAt || a.endsAt - b.endsAt);
  return meetings.slice(0, MAXIMUM_CALENDAR_MEETINGS);
}

/**
 * When the meeting covering `now` ends, or nothing outside one. Overlapping
 * meetings answer with the latest end, so back-to-back blocks read as one
 * quiet interval when they overlap — and a gap between them is a gap, which
 * the caller may treat as the meetings having ended.
 */
export function activeMeetingEnd(
  meetings: readonly MeetingInterval[],
  now: number,
): number | undefined {
  let latest: number | undefined;
  for (const meeting of meetings) {
    if (meeting.startsAt > now || meeting.endsAt <= now) continue;
    if (latest === undefined || meeting.endsAt > latest) latest = meeting.endsAt;
  }
  return latest;
}
