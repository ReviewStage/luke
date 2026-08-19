import {
  CALENDAR_LOOKAHEAD_MS,
  isRecord,
  MAXIMUM_MEETING_LENGTH_MS,
  type MeetingInterval,
  meetingsFromBusyIntervals,
  text,
} from "@sidecar/core";
import {
  GOOGLE_TOKEN_URL,
  type GoogleCalendarSignInConfig,
  googleCalendarSignInConfig,
} from "./google-calendar-oauth";
import type { AccountCalendar, ObservedAccountCalendars } from "./shared/contracts";

/**
 * The two reads a signed-in calendar account answers, both fixed by this
 * build. The calendar list is how the account is named and how the user
 * chooses which calendars count; free/busy is the only thing ever read about
 * them, and it answers with intervals alone — under the availability scope, a
 * title cannot travel. The free/busy document names only calendar ids the
 * same pass's list reported, so nothing stored or spoken can steer the read
 * anywhere the account did not already establish.
 */
const GOOGLE_CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const GOOGLE_FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";

const REQUEST_TIMEOUT_MS = 10_000;

/** Refreshed a minute early, so a pass never rides a token mid-expiry. */
const ACCESS_TOKEN_EXPIRY_SLACK_MS = 60_000;

/** More calendars than anyone chooses between; past this the list is noise. */
const MAXIMUM_ACCOUNT_CALENDARS = 50;

/** A calendar's name is drawn on one settings row; a paragraph is not a name. */
const MAXIMUM_CALENDAR_LABEL_LENGTH = 80;

/** The one colour shape Google lists calendars in; anything else is dropped. */
const CALENDAR_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

interface CachedAccessToken {
  /** The refresh token it was minted from; a replaced grant empties the cache. */
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
}

/** One connected account as the settings store resolves it for this reader. */
export interface CalendarAccountCredential {
  id: string;
  refreshToken: string;
  selectedCalendarIds: readonly string[];
}

/** What one pass learned about one account: its calendars, and the meetings. */
export interface CalendarAccountObservation extends ObservedAccountCalendars {
  meetings: readonly MeetingInterval[];
  /**
   * Why this pass could not read the account, when it could not. The
   * calendars and meetings beside it are what the account last showed — a
   * calendar that cannot answer is not an empty diary.
   */
  failure?: string;
}

/** A calendar as the list endpoint names it, plus whether it is the primary. */
export interface ListedCalendar extends AccountCalendar {
  primary: boolean;
}

export interface GoogleCalendarReaderOptions {
  /**
   * Resolved at observation time, so an account connected or removed in
   * settings takes effect on the next pass without the reader being rebuilt.
   */
  readAccounts: () => Promise<readonly CalendarAccountCredential[]>;
  /** The OAuth client this build carries, without which a grant buys nothing. */
  signInConfig?: () => GoogleCalendarSignInConfig | undefined;
  /** Injectable so tests exercise the reader without a network. */
  fetchImplementation?: typeof fetch;
  now?: () => number;
}

/**
 * Reads meeting times for every connected Google account. With no accounts it
 * observes nothing and issues no request at all; with some, each pass reads
 * each account's calendar list and then the free/busy of the calendars the
 * user selected — intersected with that same list, so the read document never
 * names a calendar the account did not just report.
 */
export class GoogleCalendarReader {
  readonly #readAccounts: () => Promise<readonly CalendarAccountCredential[]>;
  readonly #signInConfig: () => GoogleCalendarSignInConfig | undefined;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  /** Short-lived access tokens by account id, so passes never drum the minter. */
  readonly #accessTokens = new Map<string, CachedAccessToken>();
  /** Each account's last good observation, which stands in when a pass fails. */
  readonly #lastObservations = new Map<string, CalendarAccountObservation>();

  constructor(options: GoogleCalendarReaderOptions) {
    this.#readAccounts = options.readAccounts;
    this.#signInConfig = options.signInConfig ?? googleCalendarSignInConfig;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Forgets every account's held observation — the sign-out's act, so a
   * failing pass after signing back in cannot resurrect meetings from an
   * era the stop already ended. The stored grants are the settings store's
   * to keep; this clears only what observation itself held.
   */
  forget(): void {
    this.#lastObservations.clear();
    this.#accessTokens.clear();
  }

  async observe(): Promise<readonly CalendarAccountObservation[] | undefined> {
    const accounts = await this.#readAccounts();
    // No accounts, no request: the calendar is not connected, which is a
    // different answer from a connected calendar with no meetings.
    if (accounts.length === 0) {
      this.#lastObservations.clear();
      return undefined;
    }
    // An account disconnected since the last pass has nothing to stand.
    const connected = new Set(accounts.map((account) => account.id));
    for (const id of this.#lastObservations.keys()) {
      if (!connected.has(id)) this.#lastObservations.delete(id);
    }
    const observations: CalendarAccountObservation[] = [];
    for (const account of accounts) {
      try {
        const observation = await this.#observeAccount(account);
        this.#lastObservations.set(account.id, observation);
        observations.push(observation);
      } catch (error) {
        // One bad account must not blind the rest of the pass: the others
        // still read, and this one answers with what it last showed and why
        // it could not answer now. Which account failed is the whole fix —
        // sign into that one again.
        const message = error instanceof Error ? error.message : String(error);
        const held = this.#lastObservations.get(account.id);
        observations.push({
          accountId: account.id,
          calendars: held?.calendars ?? [],
          meetings: held?.meetings ?? [],
          failure: `${account.id}: ${message}`,
        });
      }
    }
    return observations;
  }

  /**
   * The calendars an access token can see, for the connect flow: naming the
   * new account by its primary calendar and seeding what is selected.
   */
  async listCalendars(accessToken: string): Promise<readonly ListedCalendar[]> {
    const response = await this.#fetch(GOOGLE_CALENDAR_LIST_URL, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Google Calendar answered ${response.status}`);
    const payload: unknown = await response.json();
    const items = isRecord(payload) && Array.isArray(payload.items) ? payload.items : [];
    const calendars: ListedCalendar[] = [];
    for (const item of items) {
      if (calendars.length >= MAXIMUM_ACCOUNT_CALENDARS) break;
      if (!isRecord(item)) continue;
      const id = text(item.id);
      if (!id) continue;
      // The calendar's own name, for its settings row alone; the id stands in
      // when Google sent none.
      const label = (text(item.summary) ?? id).slice(0, MAXIMUM_CALENDAR_LABEL_LENGTH);
      // The calendar's own colour, so its checkbox is drawn the way the
      // user's calendar app draws it. Held to one shape: a colour is the one
      // listed value that becomes a style, so nothing freeform passes.
      const color = text(item.backgroundColor);
      calendars.push({
        id,
        label,
        ...(color && CALENDAR_COLOR_PATTERN.test(color) ? { color } : {}),
        primary: item.primary === true,
      });
    }
    // Google's list order is its own; the settings rows need one that holds
    // still between passes and reads at a glance — the account's primary
    // calendar first, the rest by name.
    return calendars.sort(
      (left, right) =>
        Number(right.primary) - Number(left.primary) ||
        left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) ||
        left.id.localeCompare(right.id),
    );
  }

  async #observeAccount(account: CalendarAccountCredential): Promise<CalendarAccountObservation> {
    const now = this.#now();
    const accessToken = await this.#accessTokenFor(account, now);
    const calendars = await this.listCalendars(accessToken);
    // Only calendars this very pass listed may enter the read document; a
    // selection outlives the calendars it named, and a stale id steers
    // nothing until its calendar is listed again.
    const selected = account.selectedCalendarIds.filter((id) =>
      calendars.some((calendar) => calendar.id === id),
    );
    return {
      accountId: account.id,
      calendars: calendars.map(({ id, label, color }) => ({
        id,
        label,
        ...(color ? { color } : {}),
      })),
      meetings: selected.length > 0 ? await this.#freeBusy(accessToken, selected, now) : [],
    };
  }

  /**
   * One POST of the free/busy document over the window the meetings keep to.
   * The document is fixed by this build, and nothing enters it but the two
   * instants the window computes and the calendar ids validated above.
   */
  async #freeBusy(
    accessToken: string,
    calendarIds: readonly string[],
    now: number,
  ): Promise<MeetingInterval[]> {
    const response = await this.#fetch(GOOGLE_FREEBUSY_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        timeMin: new Date(now - MAXIMUM_MEETING_LENGTH_MS).toISOString(),
        timeMax: new Date(now + CALENDAR_LOOKAHEAD_MS).toISOString(),
        items: calendarIds.map((id) => ({ id })),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Google Calendar answered ${response.status}`);
    const payload: unknown = await response.json();
    const calendars = isRecord(payload) && isRecord(payload.calendars) ? payload.calendars : {};
    // Every asked-for calendar's busy blocks, together: which calendar a
    // meeting sits on does not matter to a hold, only that the user is in it.
    // Every asked-for calendar must also have answered: Google reports a
    // calendar it could not read just then as an `errors` entry inside a 200,
    // not as a failing request, and a calendar that cannot answer is not an
    // empty diary. Read as free, one such entry would end a quiet mid-meeting
    // and dump the held announcements aloud — so the pass fails instead, and
    // the account stands what it last showed.
    const busy: unknown[] = [];
    for (const id of calendarIds) {
      const entry = calendars[id];
      const errored = isRecord(entry) && Array.isArray(entry.errors) && entry.errors.length > 0;
      if (!isRecord(entry) || errored || !Array.isArray(entry.busy)) {
        throw new Error(`Google Calendar could not read free/busy for "${id}"`);
      }
      busy.push(...entry.busy);
    }
    return meetingsFromBusyIntervals(busy, now);
  }

  /**
   * A short-lived access token for one account's grant, cached until just
   * before it expires. The refresh token it was minted from travels with it,
   * so an account reconnected under a new grant is never served a token
   * belonging to the old one.
   */
  async #accessTokenFor(account: CalendarAccountCredential, now: number): Promise<string> {
    const cached = this.#accessTokens.get(account.id);
    if (
      cached &&
      cached.refreshToken === account.refreshToken &&
      cached.expiresAt - ACCESS_TOKEN_EXPIRY_SLACK_MS > now
    ) {
      return cached.accessToken;
    }
    const config = this.#signInConfig();
    if (!config) throw new Error("sign-in is not configured in this build");
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    const response = await this.#fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      this.#accessTokens.delete(account.id);
      throw new Error("Google no longer honours the sign-in; connect the account again");
    }
    const payload: unknown = await response.json();
    const accessToken =
      isRecord(payload) && typeof payload.access_token === "string" ? payload.access_token : "";
    if (!accessToken) throw new Error("Google answered the token refresh without a token");
    const expiresIn =
      isRecord(payload) && typeof payload.expires_in === "number" ? payload.expires_in : 0;
    this.#accessTokens.set(account.id, {
      refreshToken: account.refreshToken,
      accessToken,
      expiresAt: now + expiresIn * 1_000,
    });
    return accessToken;
  }
}
