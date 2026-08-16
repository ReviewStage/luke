import type { MeetingReading } from "./calendar-watch";
import {
  type CalendarEvent,
  MEETING_PARTICIPATION,
  type MeetingParticipation,
} from "./meeting-events";
import { CALENDAR_ACCESS, MEETING_STATUS, type MeetingState } from "./shared/contracts";

/**
 * The longest an event may run and still be treated as a meeting.
 *
 * Past a few hours a calendar entry has stopped describing a conversation and
 * started describing a day — an offsite, a travel day, a conference someone was
 * kind enough to invite the whole team to. Holding every notice for the length
 * of one is the failure this feature has to avoid above all others: a wrong
 * `OFF` talks over a meeting once, and a wrong `ON` is a Luke who said nothing
 * all day and never explained why.
 */
export const MAXIMUM_MEETING_MS = 4 * 60 * 60 * 1_000;

/**
 * How long the gate will sleep before looking at the clock again.
 *
 * The edges it actually cares about are the events' own start and end times, so
 * this is a ceiling rather than a poll: a Mac that slept through a boundary
 * wakes into a timer that is already overdue, and one that did not pays a
 * function call a minute while anything is on the calendar at all.
 */
export const MEETING_EDGE_MAX_MS = 60_000;

/**
 * Woken just past the boundary rather than exactly on it, so the comparison
 * that follows sees the edge it was scheduled for. A timer that fires a
 * millisecond early would find the meeting still not started and schedule
 * itself again for the same instant.
 */
const EDGE_SKEW_MS = 250;

/** The three answers that mean the developer is not expected there. */
const REFUSED_PARTICIPATION: ReadonlySet<MeetingParticipation> = new Set([
  MEETING_PARTICIPATION.DECLINED,
  MEETING_PARTICIPATION.PENDING,
  MEETING_PARTICIPATION.EXCUSED,
]);

/**
 * Whether one event on the calendar is a meeting Luke should wait out.
 *
 * Every rule here answers the same question — is the developer likely to be
 * mid-sentence to another person for a known stretch of time — and every one of
 * them errs the same way, towards saying no. That is deliberate: a notice
 * spoken into a meeting is one interruption, and a notice held on an event
 * nobody is at is a Luke who has gone quiet for a reason nobody can see.
 *
 * - **Cancelled** events are not happening.
 * - **All-day** events are a label on a day rather than an hour anyone is
 *   speaking in — a holiday, a conference, somebody else's leave — and holding
 *   a notice for one is holding it until tomorrow.
 * - **Nobody else on it** is a block, not a meeting. Focus time, a reminder, a
 *   flight, a repeating placeholder: the developer is the only person there, so
 *   there is nobody for Luke to talk over. This is also what keeps a calendar
 *   kept as a to-do list from silencing him permanently.
 * - **Declined** is the developer having said they are not going, which is the
 *   clearest answer anyone gives a calendar. **Excused** — delegated to
 *   somebody else, or already marked done — is the same answer arrived at
 *   differently. **Pending** is an invitation nobody has answered, and a
 *   silence Luke imposes on the strength of a question the developer
 *   themselves left open is a silence they never agreed to. Tentative and
 *   organised-by-me both count, as does an event whose records do not mention
 *   the developer at all — it is on their calendar with other people on it,
 *   which is a meeting unless they have said otherwise.
 * - **Longer than {@link MAXIMUM_MEETING_MS}**, or no length at all, is not an
 *   hour to wait out.
 */
export function isMeeting(event: CalendarEvent): boolean {
  if (event.canceled || event.allDay) return false;
  if (event.others < 1) return false;
  if (REFUSED_PARTICIPATION.has(event.participation)) return false;
  const length = event.end - event.start;
  return length > 0 && length <= MAXIMUM_MEETING_MS;
}

export interface MeetingPresenceOptions {
  onChanged(state: MeetingState): void;
  /** Injectable so a meeting can be started and ended without waiting for one. */
  now?: () => number;
}

/**
 * Decides whether the developer is in a meeting worth going quiet for.
 *
 * Two things and no others reach this: what the calendar said, and what time it
 * is. The trigger is a clock edge against an event's own start and end — a
 * deterministic boundary, never anything Luke read, heard, or decided — and the
 * event's text never arrives here to be read in the first place.
 *
 * Nothing about a spoken exchange is subtracted here, which is the one place
 * this differs from the microphone's gate. That subtraction exists because Luke
 * opens the very device a call does and would otherwise read himself as one;
 * the calendar has no such confusion, and a meeting is a meeting whether or not
 * the developer is whispering to Luke through it. Whether that whisper lifts
 * the hold is a question for the hold, and it is answered there for both
 * signals at once.
 */
export class MeetingPresence {
  readonly #options: MeetingPresenceOptions;
  readonly #now: () => number;
  #reading: MeetingReading | undefined;
  /** Whether a reading has ever arrived, which is what tells "not asked" from "asked and failed". */
  #asked = false;
  #edge: NodeJS.Timeout | undefined;
  #state: MeetingState = {
    status: MEETING_STATUS.UNAVAILABLE,
    access: CALENDAR_ACCESS.UNKNOWN,
  };

  constructor(options: MeetingPresenceOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  get state(): MeetingState {
    return this.#state;
  }

  setReading(reading: MeetingReading | undefined): void {
    this.#reading = reading;
    this.#asked = true;
    this.#settle();
  }

  /**
   * Forgets the calendar entirely — the watcher stopping, or the developer
   * switching the hold off. The state goes back to the one a build that never
   * looked reports, because that is what has just become true again.
   */
  reset(): void {
    this.#clearEdge();
    this.#reading = undefined;
    this.#asked = false;
    this.#settle();
  }

  /** Drops the pending edge on the app's way out; nothing is announced. */
  stop(): void {
    this.#clearEdge();
  }

  #settle(): void {
    const state = this.#resolve();
    this.#scheduleEdge();
    if (state.status === this.#state.status && state.access === this.#state.access) return;
    this.#state = state;
    this.#options.onChanged(state);
  }

  #resolve(): MeetingState {
    if (!this.#reading) {
      // Never asked and asked-but-unanswerable are the same answer to the gate
      // and different words on the settings row, which is the whole reason the
      // access travels beside the status.
      return {
        status: MEETING_STATUS.UNAVAILABLE,
        access: this.#asked ? CALENDAR_ACCESS.UNAVAILABLE : CALENDAR_ACCESS.UNKNOWN,
      };
    }
    const access = this.#reading.access;
    if (access !== CALENDAR_ACCESS.GRANTED) {
      return { status: MEETING_STATUS.UNAVAILABLE, access };
    }
    const now = this.#now();
    const inside = this.#meetings().some((event) => event.start <= now && now < event.end);
    return { status: inside ? MEETING_STATUS.ON : MEETING_STATUS.OFF, access };
  }

  #meetings(): readonly CalendarEvent[] {
    if (!this.#reading || this.#reading.access !== CALENDAR_ACCESS.GRANTED) return [];
    return this.#reading.events.filter(isMeeting);
  }

  /**
   * Wakes at the next boundary the calendar has, or at the ceiling above,
   * whichever is sooner. A calendar with nothing left on it schedules nothing:
   * a meeting cannot start without the helper saying so first.
   */
  #scheduleEdge(): void {
    this.#clearEdge();
    const now = this.#now();
    let next: number | undefined;
    for (const event of this.#meetings()) {
      const boundary = event.start > now ? event.start : event.end > now ? event.end : undefined;
      if (boundary === undefined) continue;
      if (next === undefined || boundary < next) next = boundary;
    }
    if (next === undefined) return;
    const delay = Math.min(Math.max(next - now, 0) + EDGE_SKEW_MS, MEETING_EDGE_MAX_MS);
    this.#edge = setTimeout(() => {
      this.#edge = undefined;
      this.#settle();
    }, delay);
    this.#edge.unref?.();
  }

  #clearEdge(): void {
    if (this.#edge === undefined) return;
    clearTimeout(this.#edge);
    this.#edge = undefined;
  }
}
