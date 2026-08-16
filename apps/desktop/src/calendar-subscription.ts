import ICAL from "ical.js";
import type { CalendarEvent, MeetingParticipation } from "./meeting-events";
import { MEETING_PARTICIPATION } from "./meeting-events";

/**
 * A calendar Luke reads, as a published address rather than as a permission.
 *
 * Every calendar worth watching already publishes itself: Google calls it a
 * secret address in iCal format, Outlook calls it a published calendar, and an
 * internal one is usually a URL somebody mailed round. Subscribing to that is
 * how a tool with no server and no business logging anybody in reads a
 * calendar — no OAuth client to register, no consent prompt to argue with, and
 * nothing on this Mac that has to be granted to anyone.
 *
 * The address is the secret. Anyone holding it can read the calendar, so it is
 * stored the way an API key is — encrypted at rest, never returned to a
 * renderer — and never drawn: the panel shows the name and the host, which is
 * enough to tell two subscriptions apart and not enough to be worth stealing.
 */
export interface CalendarSubscription {
  id: string;
  /** What the calendar calls itself, or what the developer typed instead. */
  label: string;
  /** Where it comes from, for a row that has to be recognisable at a glance. */
  host: string;
}

/**
 * How far either side of now a fetch is read for events.
 *
 * Behind, because an event that started before Luke looked is exactly the one
 * worth knowing about. Ahead, because the gate schedules itself on an event's
 * own start time and can only do that for one it has been told about.
 */
const WINDOW_BEHIND_MS = 6 * 60 * 60 * 1_000;
const WINDOW_AHEAD_MS = 12 * 60 * 60 * 1_000;

/** What one calendar may contribute, so a pathological file cannot fill memory. */
const MAXIMUM_EVENTS = 200;

/** How much of a calendar's own text is ever kept. */
const MAXIMUM_LABEL = 80;

/**
 * How long a fetch may take, and how large an answer may be.
 *
 * A calendar that hangs must not hold the watch open behind it, and a URL that
 * answers with something enormous is not a calendar. Both failures land in the
 * same place: this subscription is unreadable, which holds nothing back.
 */
export const FETCH_TIMEOUT_MS = 15_000;
export const MAXIMUM_CALENDAR_BYTES = 8 * 1024 * 1024;

/** What one subscription answered with, or why it could not. */
export interface CalendarFetch {
  events: readonly CalendarEvent[];
  /** The name the calendar gives itself, when it gives one. */
  label?: string;
}

/**
 * Reads the events happening around now out of one published calendar.
 *
 * Recurrence and time zones are why this leans on a parser rather than a
 * regular expression: a daily standup is one `RRULE` and a `VTIMEZONE`, and a
 * feature that exists to know whether the developer is in a meeting right now
 * cannot be wrong about either.
 *
 * Only what the gate needs is carried out of it — start, end, all-day, the
 * developer's own answer where the file records one, how many other people are
 * on it, and whether it was cancelled. The summary, the description, the
 * location and the attendee list are all in the file and none of them are read.
 */
export function calendarEventsFromIcs(
  text: string,
  now: number,
  self?: string,
): CalendarFetch | undefined {
  let component: ICAL.Component;
  try {
    component = new ICAL.Component(ICAL.parse(text));
  } catch {
    return undefined;
  }
  // A login page parses into something, so what it parsed into is checked: an
  // address that answers with HTML is a subscription that is not working, and
  // reading it as a calendar with no events on it would be read as a free
  // afternoon.
  if (component.name !== "vcalendar") return undefined;
  const label = trimmedLabel(component.getFirstPropertyValue("x-wr-calname"));
  const from = ICAL.Time.fromJSDate(new Date(now - WINDOW_BEHIND_MS), true);
  const to = ICAL.Time.fromJSDate(new Date(now + WINDOW_AHEAD_MS), true);

  const events: CalendarEvent[] = [];
  for (const item of component.getAllSubcomponents("vevent")) {
    if (events.length >= MAXIMUM_EVENTS) break;
    let event: ICAL.Event;
    try {
      event = new ICAL.Event(item);
    } catch {
      continue;
    }
    for (const occurrence of occurrences(event, from, to)) {
      if (events.length >= MAXIMUM_EVENTS) break;
      events.push(occurrence);
    }
  }
  return { events, ...(label ? { label } : {}) };

  function occurrences(event: ICAL.Event, start: ICAL.Time, end: ICAL.Time): CalendarEvent[] {
    const shared = {
      allDay: event.startDate?.isDate === true,
      participation: participation(event, self),
      others: others(event, self),
      canceled:
        String(event.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED",
    };
    // A calendar marks time it does not occupy as transparent — a birthday, an
    // out-of-office banner. It is not a meeting whatever else it says, so it is
    // dropped here rather than argued with downstream.
    const transparent =
      String(event.component.getFirstPropertyValue("transp") ?? "").toUpperCase() === "TRANSPARENT";
    if (transparent) return [];

    if (!event.isRecurring()) {
      const single = window(event.startDate, event.endDate);
      if (!single) return [];
      return overlaps(single, start, end) ? [{ ...single, ...shared }] : [];
    }

    const found: CalendarEvent[] = [];
    const iterator = event.iterator();
    let next = iterator.next();
    // Bounded twice over: by the window, and by a count, because a malformed
    // rule can iterate for ever and a hung read is worse than a missed meeting.
    for (let step = 0; next && step < 500; step += 1) {
      if (next.compare(end) > 0) break;
      const occurrence = event.getOccurrenceDetails(next);
      const span = window(occurrence.startDate, occurrence.endDate);
      if (span && overlaps(span, start, end)) found.push({ ...span, ...shared });
      next = iterator.next();
    }
    return found;
  }
}

function window(
  start: ICAL.Time | null,
  end: ICAL.Time | null,
): { start: number; end: number } | undefined {
  if (!start || !end) return undefined;
  const from = start.toJSDate().getTime();
  const to = end.toJSDate().getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return undefined;
  return { start: from, end: to };
}

function overlaps(span: { start: number; end: number }, from: ICAL.Time, to: ICAL.Time): boolean {
  return span.end >= from.toJSDate().getTime() && span.start <= to.toJSDate().getTime();
}

/**
 * How many people other than the developer are on it.
 *
 * A count, never a name: the addresses are in the file and this is the only
 * thing taken from them. The developer's own address is subtracted where it is
 * known, so a meeting they are alone on reads as the block it is.
 */
function others(event: ICAL.Event, self?: string): number {
  const attendees = event.attendees ?? [];
  let count = 0;
  for (const attendee of attendees) {
    // Rooms and equipment are attendees in a calendar file and are not people
    // here: an hour of focus time with a room booked is not a meeting.
    const type = String(attendee.getParameter("cutype") ?? "INDIVIDUAL").toUpperCase();
    if (type === "ROOM" || type === "RESOURCE") continue;
    if (self && address(attendee.getFirstValue()) === self) continue;
    count += 1;
  }
  return count;
}

/**
 * The developer's own answer to the invitation, where the file records one.
 *
 * Without an address to match on there is nobody to look for, so it is
 * `UNKNOWN` — which counts, because a calendar the developer subscribed to,
 * with other people on the event, is a meeting unless they said otherwise.
 */
function participation(event: ICAL.Event, self?: string): MeetingParticipation {
  if (!self) return MEETING_PARTICIPATION.UNKNOWN;
  if (address(event.organizer) === self) return MEETING_PARTICIPATION.ORGANIZER;
  for (const attendee of event.attendees ?? []) {
    if (address(attendee.getFirstValue()) !== self) continue;
    const status = String(attendee.getParameter("partstat") ?? "").toUpperCase();
    if (status === "ACCEPTED") return MEETING_PARTICIPATION.ACCEPTED;
    if (status === "TENTATIVE") return MEETING_PARTICIPATION.TENTATIVE;
    if (status === "DECLINED") return MEETING_PARTICIPATION.DECLINED;
    if (status === "NEEDS-ACTION") return MEETING_PARTICIPATION.PENDING;
    if (status === "DELEGATED" || status === "COMPLETED") return MEETING_PARTICIPATION.EXCUSED;
    return MEETING_PARTICIPATION.UNKNOWN;
  }
  return MEETING_PARTICIPATION.UNKNOWN;
}

/** A calendar address as a plain lowercase mailbox, or nothing. */
function address(value: unknown): string | undefined {
  const text = typeof value === "string" ? value : String(value ?? "");
  const match = /^mailto:(.+)$/i.exec(text.trim());
  return match?.[1]?.toLowerCase();
}

function trimmedLabel(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, MAXIMUM_LABEL) : undefined;
}

/** The host a subscription points at, which is all of the address a row draws. */
export function subscriptionHost(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    // Only ever `https`: a calendar address carries the right to read the
    // calendar, and there is no version of that worth sending in the clear.
    if (parsed.protocol !== "https:") return undefined;
    return parsed.host;
  } catch {
    return undefined;
  }
}

export interface CalendarReaderOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  onDiagnostic?(message: string): void;
}

/**
 * Fetches one subscription and reads the events around now out of it.
 *
 * Everything that goes wrong answers `undefined` — the calendar is unreadable —
 * because a calendar that could not be fetched and a calendar with nothing on
 * it must not be told apart by silence: only one of them is a reason to hold a
 * notice back, and it is neither.
 */
export async function readCalendar(
  url: string,
  self: string | undefined,
  options: CalendarReaderOptions = {},
): Promise<CalendarFetch | undefined> {
  const host = subscriptionHost(url);
  if (!host) {
    options.onDiagnostic?.("the address is not an https calendar URL");
    return undefined;
  }
  const fetching = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetching(url, {
      signal: controller.signal,
      headers: { accept: "text/calendar" },
    });
    if (!response.ok) {
      options.onDiagnostic?.(`${host} answered ${response.status}`);
      return undefined;
    }
    const text = await response.text();
    if (text.length > MAXIMUM_CALENDAR_BYTES) {
      options.onDiagnostic?.(`${host} answered with more than one calendar's worth of text`);
      return undefined;
    }
    const read = calendarEventsFromIcs(text, options.now?.() ?? Date.now(), self);
    if (!read) {
      options.onDiagnostic?.(`${host} answered with something that is not a calendar`);
      return undefined;
    }
    return read;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "no reason given";
    options.onDiagnostic?.(`${host} could not be read — ${reason}`);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
