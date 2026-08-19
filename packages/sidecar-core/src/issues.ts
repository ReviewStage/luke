/**
 * The issue-tracker model: the work items a tracker lists for the developer,
 * and the two acts a tracker may be asked to carry for one of them. It mirrors
 * the session model deliberately — bounded observations normalized once, acts
 * validated against what the latest observation advertised — so an issue and a
 * session are offered to the rest of the app under the same discipline.
 */

import type { Effect } from "effect";
import { text, type UnparsedWireValue } from "./json.js";

/**
 * Stable tracker identifiers shared by the tracker client, the settings that
 * hold its credential, and the UI that draws its mark.
 */
export const ISSUE_TRACKER_ID = {
  LINEAR: "linear",
} as const;

export type IssueTrackerId = (typeof ISSUE_TRACKER_ID)[keyof typeof ISSUE_TRACKER_ID];

const ISSUE_TRACKER_IDS: ReadonlySet<string> = new Set(Object.values(ISSUE_TRACKER_ID));

/** Whether this build knows the tracker an observation or an act names. */
export function isIssueTrackerId(value: string): value is IssueTrackerId {
  return ISSUE_TRACKER_IDS.has(value);
}

/** A stable tracker identity and the label that can be shown or spoken. */
export interface IssueTracker {
  id: string;
  displayName: string;
}

/** Identifies an issue without conflating identifiers from different trackers. */
export interface IssueIdentity {
  trackerId: string;
  /** The tracker's human identifier, such as LUKE-123 — listed, shown, spoken. */
  identifier: string;
}

/**
 * One state an issue's tracker will accept it into, advertised with the issue
 * the way a session's controls are: replaced with every observation, so a
 * transition can never outlive the snapshot that promised it.
 */
export interface IssueTransition {
  /** The tracker's own id for the state. Named in requests, never spoken. */
  id: string;
  /** The state's name as the tracker shows it, which is what is said aloud. */
  name: string;
}

/**
 * Tracker-owned data observed for one issue. Tracker clients are responsible
 * for observing without writing, and for reporting only what their tracker
 * actually lists — an issue with no advertised transitions cannot be moved.
 */
export interface TrackerIssueObservation {
  /** The tracker's internal id, which its write endpoints name issues by. */
  trackerIssueId: string;
  identifier: string;
  title: string;
  /** The name of the state the issue is in now. */
  stateName: string;
  observedAt: number;
  url?: string;
  /** The states the tracker will accept this issue into, besides its own. */
  transitions?: readonly IssueTransition[];
  /**
   * Set only by a client whose tracker documents taking a comment on this
   * issue. Absent means no, the same default a session's message field takes.
   */
  canComment?: boolean;
}

/** The normalized issue shared by the main process, the bridge, and the voice roster. */
export interface TrackedIssue extends IssueIdentity {
  tracker: IssueTracker;
  trackerIssueId: string;
  title: string;
  stateName: string;
  observedAt: number;
  url?: string;
  transitions: readonly IssueTransition[];
  canComment: boolean;
}

export const maximumIssueIdentifierLength = 30;
export const maximumIssueTitleLength = 160;
export const maximumIssueStateNameLength = 60;
/** Enough for any workflow worth saying aloud; a roster line stays a line. */
export const maximumIssueTransitions = 12;
/** Long enough for any tracker's issue address without becoming a payload. */
export const maximumIssueUrlLength = 300;
/** A remark added to an issue, not a document pasted onto one. */
export const maximumIssueCommentLength = 4_000;

/**
 * The text of a comment on its way to an issue, or nothing. Refused rather
 * than cut when it runs long, for the same reason a session message is: a
 * truncated comment says something its author did not.
 */
export function issueCommentText(value: UnparsedWireValue): string | undefined {
  const normalized = text(value);
  if (!normalized || normalized.length > maximumIssueCommentLength) return undefined;
  return normalized;
}

/** Required, and flattened for the same reason {@link boundedText} is. */
function requiredText(value: string): string | undefined {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

/**
 * Bounded and flattened to one line. Issue fields are written by anyone in
 * the tracker's workspace, and the roster they end up in is line-structured —
 * a title carrying its own line breaks could forge roster entries or a
 * bracketed label. Flattening here means no rendering of an issue ever has
 * to remember to.
 */
function boundedText(value: string | undefined, maximumLength: number): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  return normalized.slice(0, maximumLength);
}

/**
 * An issue's address, or nothing. Dropped rather than cut when it runs long —
 * a truncated address is a different address — and held to `https` alone: a
 * tracker lives in its own cloud, so an app scheme here would be improvised.
 */
function issueUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maximumIssueUrlLength) return undefined;
  try {
    return new URL(normalized).protocol === "https:" ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function timestamp(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function normalizeTransitions(
  transitions: readonly IssueTransition[] | undefined,
): readonly IssueTransition[] {
  if (!transitions) return [];

  const ids = new Set<string>();
  const normalized: IssueTransition[] = [];
  for (const transition of transitions.slice(0, maximumIssueTransitions)) {
    const id = requiredText(transition.id);
    // An empty or repeated id is tracker-authored junk, not a choice. Drop
    // the offending transition so the rest of the issue can still be listed.
    if (!id || ids.has(id)) continue;
    ids.add(id);
    normalized.push({
      id,
      name: boundedText(transition.name, maximumIssueStateNameLength) ?? id,
    });
  }
  return normalized;
}

/**
 * Bounds every field a tracker reported and fills the defaults, so the roster
 * can speak any present field and an absent capability stays a refusal.
 *
 * These values are written by anyone in the tracker's workspace, so a
 * malformed issue is discarded rather than raised: one empty identifier or
 * impossible timestamp cannot fail the observation pass. A bad transition is
 * dropped; the fields that validate still stand.
 */
export function normalizeTrackedIssue(
  tracker: IssueTracker,
  observation: TrackerIssueObservation,
): TrackedIssue | undefined {
  const trackerId = requiredText(tracker.id);
  const identifier = requiredText(observation.identifier)?.slice(0, maximumIssueIdentifierLength);
  const trackerIssueId = requiredText(observation.trackerIssueId);
  const observedAt = timestamp(observation.observedAt);
  if (!trackerId || !identifier || !trackerIssueId || observedAt === undefined) {
    return undefined;
  }
  const url = issueUrl(observation.url);

  const issue: TrackedIssue = {
    trackerId,
    identifier,
    tracker: {
      id: trackerId,
      displayName: boundedText(tracker.displayName, maximumIssueTitleLength) ?? trackerId,
    },
    trackerIssueId,
    title: boundedText(observation.title, maximumIssueTitleLength) ?? "Untitled issue",
    stateName: boundedText(observation.stateName, maximumIssueStateNameLength) ?? "Unknown",
    observedAt,
    transitions: normalizeTransitions(observation.transitions),
    // Anything but an explicit yes is a no, so a client that has not thought
    // about comments reports an issue that cannot take one.
    canComment: observation.canComment === true,
  };
  if (url) issue.url = url;
  return issue;
}

/** Returns whether a tracker explicitly advertised a transition for an issue. */
export function supportsIssueTransition(issue: TrackedIssue, transitionId: string): boolean {
  return issue.transitions.some((transition) => transition.id === transitionId);
}

export const TRACKER_ACTION_RESULT_STATUS = {
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  UNSUPPORTED: "unsupported",
} as const;

export type TrackerActionResultStatus =
  (typeof TRACKER_ACTION_RESULT_STATUS)[keyof typeof TRACKER_ACTION_RESULT_STATUS];

/**
 * What became of an act. A rejection carries a reason the developer can hear,
 * never the body itself; unsupported means the tracker has no documented way
 * to do this right now, which is an answer rather than a failure.
 */
export type TrackerActionResult =
  | { status: typeof TRACKER_ACTION_RESULT_STATUS.ACCEPTED }
  | { status: typeof TRACKER_ACTION_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof TRACKER_ACTION_RESULT_STATUS.UNSUPPORTED };

export const ISSUE_ACTION_KIND = {
  SET_STATE: "set-state",
  COMMENT: "comment",
} as const;

export type IssueActionKind = (typeof ISSUE_ACTION_KIND)[keyof typeof ISSUE_ACTION_KIND];

/**
 * A tracker-local request whose every field the main process resolved from its
 * own latest observation: the internal id, and a transition the issue actually
 * advertised. Nothing a model composed reaches a client as-is.
 */
export type TrackerIssueAction =
  | {
      kind: typeof ISSUE_ACTION_KIND.SET_STATE;
      trackerIssueId: string;
      transition: IssueTransition;
    }
  | {
      kind: typeof ISSUE_ACTION_KIND.COMMENT;
      trackerIssueId: string;
      body: string;
    };

/**
 * A tracker client has no dependency on Electron, a renderer, or live UI
 * state. Observing must issue only reads; `execute` is the one place a client
 * may change tracker state, and only ever with an act the developer asked for,
 * against an issue and a transition the latest observation advertised.
 * Nothing that decides on the developer's behalf may reach it.
 */
export interface IssueTrackerAdapter {
  readonly tracker: IssueTracker;
  /**
   * The issues the tracker lists for the developer. `undefined` means the
   * tracker is not connected — no credential, so nothing was asked — which is
   * a different answer from a connected tracker listing nothing.
   */
  observe(): Effect.Effect<readonly TrackerIssueObservation[] | undefined, unknown, unknown>;
  execute(action: TrackerIssueAction): Effect.Effect<TrackerActionResult, unknown, unknown>;
}
