import { execFile } from "node:child_process";
import path from "node:path";
import {
  type AccountCalendar,
  CALENDAR_COLOR_PATTERN,
  CALENDAR_LOOKAHEAD_MS,
  MAXIMUM_ACCOUNT_CALENDARS,
  MAXIMUM_CALENDAR_LABEL_LENGTH,
  MAXIMUM_MEETING_LENGTH_MS,
  type MeetingInterval,
  meetingsFromBusyIntervals,
  type ObservedAccountCalendars,
} from "@sidecar/calendar";
import {
  isWireString,
  wireRecord as readWireRecord,
  text,
  type UnparsedWireValue,
  unparsedWire,
} from "@sidecar/wire";
import { app } from "electron";
import {
  APPLE_CALENDAR_ACCESS,
  APPLE_CALENDAR_ID,
  type AppleCalendarAccess,
} from "#shared/apple-calendar";

const ACCESS_WORDS = new Set<string>(Object.values(APPLE_CALENDAR_ACCESS));

/** An access word as the helper reported it, or nothing it can claim. */
function appleCalendarAccessWord(value: UnparsedWireValue): AppleCalendarAccess | undefined {
  if (!isWireString(value) || !ACCESS_WORDS.has(value)) return undefined;
  // SAFETY: The preceding membership check establishes the union member.
  return value as AppleCalendarAccess;
}

/** The commands the helper answers; nothing else ever enters an invocation. */
const HELPER_COMMAND = {
  STATUS: "status",
  REQUEST_ACCESS: "request-access",
  OBSERVE: "observe",
} as const;

/** Reads answer from local data; a request waits on the user's hands. */
const OBSERVE_TIMEOUT_MS = 10_000;
const REQUEST_ACCESS_TIMEOUT_MS = 180_000;

/** Long enough to find the switch in System Settings; not an open-ended hold. */
const SETTINGS_WAIT_TIMEOUT_MS = 180_000;
const SETTINGS_WAIT_POLL_MS = 3_000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** A source's name heads a settings section; a paragraph is not a heading. */
const MAXIMUM_CALENDAR_GROUP_LENGTH = 40;

/** The Mac's calendars as the settings store keeps the user's choice of them. */
export interface AppleCalendarConnection {
  selectedCalendarIds: readonly string[];
}

/**
 * What one pass learned from this Mac's Calendar: its list, and the
 * meetings. The inherited `failure` and `revoked` say when and why a pass
 * could not read — a transient failure stands what the Mac last showed,
 * while access withdrawn empties both lists, because nothing may keep
 * standing on consent taken back.
 */
export interface AppleCalendarObservation extends ObservedAccountCalendars {
  meetings: readonly MeetingInterval[];
}

/** What the connect flow needs back from the system's own consent dialog. */
export interface AppleCalendarAccessOutcome {
  access: AppleCalendarAccess;
  calendars: readonly AccountCalendar[];
  defaultCalendarId?: string;
  /** Why the ask itself failed, when it did — not the user's answer. */
  failure?: string;
}

/**
 * Runs one helper invocation and answers with its stdout. Injectable so tests
 * exercise the reader without a Mac or a binary.
 */
export type AppleCalendarHelperRun = (
  helperArguments: readonly string[],
  timeoutMs: number,
) => Promise<string>;

export interface AppleCalendarReaderOptions {
  /**
   * Resolved at observation time, so connecting or disconnecting in settings
   * takes effect on the next pass without the reader being rebuilt. Absent
   * means not connected, and the helper is never run at all.
   */
  readConnection: () => Promise<AppleCalendarConnection | undefined>;
  runHelper?: AppleCalendarHelperRun;
  now?: () => number;
}

/** Named for what every fallback shows, like Chromium's helper bundles. */
const HELPER_BUNDLE_NAME = "Luke.app";

/**
 * Where LaunchServices takes registrations. System Settings resolves the
 * consent row's name and icon through LaunchServices, and a bundle buried
 * inside Resources is never seen by it unless told — untold, the row falls
 * back to whatever name the record was made under.
 */
const LSREGISTER_PATH =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

let helperBundleRegistered = false;

/**
 * Where the helper's executable stands this run, with the bundle taught to
 * LaunchServices on the way — once per process, converging like the hook
 * registrations. The helper lives in a minimal bundle of its own — its TCC
 * identity — so the executable sits one bundle deep where every other helper
 * sits bare, named Luke because the consent dialog may name the process by
 * this file.
 */
function appleCalendarHelperPath(): string {
  const bundlePath = app.isPackaged
    ? path.join(process.resourcesPath, HELPER_BUNDLE_NAME)
    : path.join(app.getAppPath(), ".build", "native", HELPER_BUNDLE_NAME);
  if (!helperBundleRegistered) {
    helperBundleRegistered = true;
    // What it teaches LaunchServices is the bundle's own name and icon,
    // nothing more, and a registration that fails costs only the row's
    // looks — but says so, because a fallback name is otherwise
    // indistinguishable from this line never having run.
    execFile(LSREGISTER_PATH, ["-f", bundlePath], (error) => {
      if (error) process.stderr.write(`Calendar helper registration failed: ${error.message}\n`);
    });
  }
  return path.join(bundlePath, "Contents", "MacOS", "Luke");
}

/**
 * Resolves the packaged helper the way every native helper is resolved, and
 * refuses to run anywhere but a Mac: on any other platform the calendar
 * simply cannot answer, which the reader reports rather than hides.
 */
function defaultRunHelper(helperArguments: readonly string[], timeoutMs: number): Promise<string> {
  if (process.platform !== "darwin") {
    return Promise.reject(new Error("Apple Calendar is only readable on macOS"));
  }
  return new Promise((resolve, reject) => {
    execFile(
      appleCalendarHelperPath(),
      [...helperArguments],
      { encoding: "utf8", timeout: timeoutMs },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

/** One helper answer, held to shape before anything downstream reads it. */
interface ParsedHelperReport {
  access: AppleCalendarAccess;
  calendars: readonly AccountCalendar[];
  defaultCalendarId?: string;
  /** As the helper wrote it; the shared interval parser is its one reader. */
  busy: UnparsedWireValue;
  failure?: string;
}

/**
 * The helper's JSON document as this reader will trust it: an access word it
 * knows, and a calendar list bounded exactly the way the Google list is —
 * the settings rows drawing them cannot tell the two sources apart.
 */
export function parseHelperReport(output: string): ParsedHelperReport {
  let payload: UnparsedWireValue;
  try {
    payload = unparsedWire(JSON.parse(output));
  } catch {
    throw new Error("the calendar helper answered unreadably");
  }
  const report = readWireRecord(payload);
  if (!report) throw new Error("the calendar helper answered unreadably");
  const access = appleCalendarAccessWord(report.access);
  if (!access) throw new Error("the calendar helper answered unreadably");
  const listed = Array.isArray(report.calendars) ? report.calendars : [];
  const calendars: AccountCalendar[] = [];
  for (const entry of listed) {
    if (calendars.length >= MAXIMUM_ACCOUNT_CALENDARS) break;
    const entryRecord = readWireRecord(unparsedWire(entry));
    if (!entryRecord) continue;
    const id = text(entryRecord.id);
    if (!id || calendars.some((calendar) => calendar.id === id)) continue;
    const label = (text(entryRecord.label) ?? id).slice(0, MAXIMUM_CALENDAR_LABEL_LENGTH);
    const color = text(entryRecord.color);
    const group = text(entryRecord.group)?.slice(0, MAXIMUM_CALENDAR_GROUP_LENGTH);
    calendars.push({
      id,
      label,
      ...(color && CALENDAR_COLOR_PATTERN.test(color) ? { color } : undefined),
      ...(group ? { group } : undefined),
    });
  }
  // EventKit's list order follows account internals; the settings rows need
  // one that holds still between passes and reads at a glance — sectioned by
  // source the way Calendar.app sections its sidebar, then by name.
  calendars.sort(
    (left, right) =>
      (left.group ?? "").localeCompare(right.group ?? "", undefined, { sensitivity: "base" }) ||
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) ||
      left.id.localeCompare(right.id),
  );
  const defaultCalendarId = text(report.defaultCalendarId);
  const failure = text(report.failure);
  return {
    access,
    calendars,
    ...(defaultCalendarId ? { defaultCalendarId } : undefined),
    busy: report.busy,
    ...(failure ? { failure } : undefined),
  };
}

/**
 * The words for a grant that stops short of readable, shown on the row when a
 * connect meets one and logged when a pass does. The fix is the user's own
 * act in System Settings, so the sentence has to say where.
 */
export const APPLE_CALENDAR_ACCESS_REFUSAL = {
  [APPLE_CALENDAR_ACCESS.WRITE_ONLY]:
    "macOS granted Luke only write access to the calendar. Allow full access in System Settings under Privacy & Security, Calendars.",
  [APPLE_CALENDAR_ACCESS.DENIED]:
    "macOS has calendar access turned off for Luke. Allow it in System Settings under Privacy & Security, Calendars.",
  [APPLE_CALENDAR_ACCESS.RESTRICTED]: "Calendar access is restricted on this Mac.",
  [APPLE_CALENDAR_ACCESS.NOT_DETERMINED]: "macOS did not grant calendar access.",
} as const satisfies Readonly<
  Record<Exclude<AppleCalendarAccess, typeof APPLE_CALENDAR_ACCESS.FULL>, string>
>;

/**
 * Reads meeting times from this Mac's own Calendar through the EventKit
 * helper. Not connected means the helper is never run — the same silence a
 * key-observed provider keeps with no key — and a connected read asks for
 * exactly the window and the calendar ids the user's stored choice names,
 * which the helper itself intersects with the list the same read produced.
 */
export class AppleCalendarReader {
  readonly #readConnection: () => Promise<AppleCalendarConnection | undefined>;
  readonly #runHelper: AppleCalendarHelperRun;
  readonly #now: () => number;
  /** The last good observation, which stands in when a pass fails. */
  #lastObservation: AppleCalendarObservation | undefined;

  constructor(options: AppleCalendarReaderOptions) {
    this.#readConnection = options.readConnection;
    this.#runHelper = options.runHelper ?? defaultRunHelper;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Forgets the held observation — the sign-out's act, so a failing pass
   * after reconnecting cannot resurrect meetings from an era the stop
   * already ended.
   */
  forget(): void {
    this.#lastObservation = undefined;
  }

  async observe(): Promise<AppleCalendarObservation | undefined> {
    const connection = await this.#readConnection();
    // Not connected, no read: the calendar is not connected, which is a
    // different answer from a connected calendar with no meetings.
    if (!connection) {
      this.#lastObservation = undefined;
      return undefined;
    }
    try {
      const observation = await this.#observeConnection(connection);
      // What the next failing pass stands: a clean read's lists, or a
      // refusal's emptiness with its `revoked` — a transient failure after a
      // withdrawal must not resurrect what the withdrawal already took, nor
      // dress the row back up as connected.
      this.#lastObservation = {
        accountId: observation.accountId,
        calendars: observation.calendars,
        meetings: observation.meetings,
        ...(observation.revoked ? { revoked: true } : undefined),
      };
      return observation;
    } catch (error) {
      // A read that merely failed — the helper crashed, or answered
      // unreadably — says nothing about the user's intent, so what the Mac
      // last showed stands, with the why beside it.
      const message = error instanceof Error ? error.message : String(error);
      return {
        accountId: APPLE_CALENDAR_ID,
        calendars: this.#lastObservation?.calendars ?? [],
        meetings: this.#lastObservation?.meetings ?? [],
        ...(this.#lastObservation?.revoked ? { revoked: true } : undefined),
        failure: `${APPLE_CALENDAR_ID}: ${message}`,
      };
    }
  }

  /**
   * How far macOS currently lets the read go, without prompting: what the
   * connect press consults, so the panel only stands down for a dialog that
   * will actually appear.
   */
  async status(): Promise<AppleCalendarAccess> {
    return parseHelperReport(await this.#runHelper([HELPER_COMMAND.STATUS], OBSERVE_TIMEOUT_MS))
      .access;
  }

  /**
   * Runs the system's own consent ask — the connect flow's one act. The
   * helper asks as its own TCC identity, so the dialog and the grant hold
   * whatever launched Luke; what comes back is what seeding the connection
   * needs — how far the grant went, the calendar list, and the calendar new
   * events land on.
   */
  async requestAccess(): Promise<AppleCalendarAccessOutcome> {
    const report = parseHelperReport(
      await this.#runHelper([HELPER_COMMAND.REQUEST_ACCESS], REQUEST_ACCESS_TIMEOUT_MS),
    );
    return {
      access: report.access,
      calendars: report.calendars,
      ...(report.defaultCalendarId ? { defaultCalendarId: report.defaultCalendarId } : undefined),
      ...(report.failure ? { failure: report.failure } : undefined),
    };
  }

  /**
   * The consent ask, carried through to a grant where one can still come:
   * macOS asks an app once, so a standing refusal — recorded earlier, or the
   * Don't Allow just pressed — can only be undone in System Settings. The
   * caller's opener takes the user there, and the wait watches for the
   * switch: flipping it is the consent, and the wait is what turns it into a
   * connection without a second press. `superseded` is the caller's cancel —
   * a newer attempt, or the user giving up — and ends the wait where it
   * stands.
   */
  async obtainAccess(options: {
    openSystemSettings: () => void;
    superseded: () => boolean;
  }): Promise<AppleCalendarAccessOutcome> {
    let outcome = await this.requestAccess();
    // A cancel that landed while the dialog stood ends the flow here: the
    // grant, if given, stays macOS's own, but nobody is taken to System
    // Settings for an ask they already gave up on.
    if (options.superseded()) return outcome;
    if (outcome.access !== APPLE_CALENDAR_ACCESS.FULL && !outcome.failure) {
      options.openSystemSettings();
      const deadline = this.#now() + SETTINGS_WAIT_TIMEOUT_MS;
      while (this.#now() < deadline && !options.superseded()) {
        await sleep(SETTINGS_WAIT_POLL_MS);
        const granted = await this.status()
          .then((access) => access === APPLE_CALENDAR_ACCESS.FULL)
          .catch(() => false);
        if (granted) {
          // Already authorized, so this raises no dialog: it is the seed
          // read, run under the grant the switch just gave.
          outcome = await this.requestAccess();
          break;
        }
      }
    }
    return outcome;
  }

  async #observeConnection(connection: AppleCalendarConnection): Promise<AppleCalendarObservation> {
    const now = this.#now();
    // The same window the Google free/busy read keeps to, so the two sources
    // hold and release announcements on identical terms.
    const output = await this.#runHelper(
      [
        HELPER_COMMAND.OBSERVE,
        new Date(now - MAXIMUM_MEETING_LENGTH_MS).toISOString(),
        new Date(now + CALENDAR_LOOKAHEAD_MS).toISOString(),
        ...connection.selectedCalendarIds,
      ],
      OBSERVE_TIMEOUT_MS,
    );
    const report = parseHelperReport(output);
    if (report.access !== APPLE_CALENDAR_ACCESS.FULL) {
      // The system's own answer, not a read that failed: access withdrawn in
      // System Settings takes the calendars and the meetings with it —
      // nothing may keep standing on consent taken back. The connection and
      // its choices stay stored, so access re-allowed reconnects on the next
      // pass by itself.
      return {
        accountId: APPLE_CALENDAR_ID,
        calendars: [],
        meetings: [],
        failure: APPLE_CALENDAR_ACCESS_REFUSAL[report.access],
        revoked: true,
      };
    }
    return {
      accountId: APPLE_CALENDAR_ID,
      calendars: report.calendars,
      meetings: meetingsFromBusyIntervals(report.busy, now),
    };
  }
}
