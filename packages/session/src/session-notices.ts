import type { Session, SessionStatus } from "./session.js";
import { SESSION_COMPLETION_CAUSE, SESSION_STATUS } from "./session.js";

/**
 * The statuses worth telling the user about when a session arrives at one.
 * `working` is the quiet default and `unknown` is an adapter losing sight of a
 * session, so neither is news; the three that remain are the three things a
 * developer steps away from an agent to wait for.
 */
export const SESSION_NOTICE_STATUS = {
  WAITING: SESSION_STATUS.WAITING,
  ERROR: SESSION_STATUS.ERROR,
  COMPLETE: SESSION_STATUS.COMPLETE,
} as const;

export type SessionNoticeStatus =
  (typeof SESSION_NOTICE_STATUS)[keyof typeof SESSION_NOTICE_STATUS];

/**
 * When a pass produces more notices than the cap, stopped sessions survive
 * first, then waiting turns, then final completions that will keep.
 */
const NOTICE_PRIORITY: readonly SessionNoticeStatus[] = [
  SESSION_NOTICE_STATUS.ERROR,
  SESSION_NOTICE_STATUS.WAITING,
  SESSION_NOTICE_STATUS.COMPLETE,
];

/**
 * How long the same session stays quiet about the same status once it has been
 * noticed. An adapter that flaps between two readings must not turn each flap
 * into a banner; a session genuinely stopping twice in an afternoon still gets
 * its second notice.
 */
export const SESSION_NOTICE_REPEAT_WINDOW_MS = 5 * 60_000;

/**
 * The most notices one pass may produce. A burst larger than this is a
 * provider reconnecting or re-reading its world, not six agents finishing in
 * the same five seconds, and the panel still shows every session either way.
 */
export const MAXIMUM_NOTICES_PER_PASS = 6;

/**
 * How recently a status must have been entered to be announced as news. The
 * tracker sees the edge between two readings, not the event itself, and the
 * two usually coincide only because passes run every few seconds: a Mac
 * waking from hours of sleep, or a provider back from an outage, delivers
 * edges whose events happened long ago. `observedAt` is the provider's own
 * timestamp for when the status was entered, so an edge older than this is
 * history arriving late — the panel's to show, not a banner's to announce as
 * though it just happened. Generous next to the refresh cadence, so a fresh
 * finish is never lost to one slow pass.
 */
export const SESSION_NOTICE_FRESH_AGE_MS = 5 * 60_000;

/**
 * One session arriving at a status the user may want to know about. Fields,
 * not sentences: the surface that shows a notice words it, the way it words a
 * row. Everything here is already bounded by `normalizeSession`.
 */
export interface SessionNotice {
  providerId: string;
  providerSessionId: string;
  providerName: string;
  title: string;
  /** The workspace the session is one chat of, by name, when its provider groups them. */
  workspace?: string;
  status: SessionNoticeStatus;
  previousStatus: SessionStatus;
  /** Whether this waiting turn cannot continue without the developer. */
  holdingForDeveloper?: boolean;
  /**
   * Where the settled turn left the work — provider-designated, or the agent's
   * own parting words. For a waiting session this may be the question holding
   * it, or simply the result of the turn that finished.
   */
  recap?: string;
  /** Why the session stopped, when its provider said. */
  error?: string;
  /** The provider's bounded description of the action currently awaiting permission. */
  activity?: string;
  repository?: string;
  branch?: string;
  /** Whether the provider will take a reply for this session right now. */
  canReceiveMessage: boolean;
  observedAt: number;
}

/**
 * Distinguishes a turn that needs the developer from one that merely finished.
 * A provider that saw a permission, an approval, or an open question says so
 * on the observation; a recap that itself asks is the same evidence when the
 * adapter could not tell. A query string inside
 * a URL is not a question. A `?` that ends a sentence after a link still
 * is: a query string has characters after the mark, and a trailing ask
 * does not.
 */
function waitingHoldsForDeveloper(session: Session): boolean {
  if (session.status !== SESSION_STATUS.WAITING) return false;
  if (session.holdingForDeveloper === true) return true;
  if (!session.recap) return false;
  return session.recap
    .replace(/\bhttps?:\/\/[^\s?]+(?:\?[^\s#]+)?(?:#[^\s]+)?/gi, "")
    .includes("?");
}

interface TrackedSessionState {
  status: SessionStatus;
  /** When each notice-worthy status was last noticed, for the repeat window. */
  noticedAt: Map<SessionNoticeStatus, number>;
}

function noticeStatus(status: SessionStatus): SessionNoticeStatus | undefined {
  return Object.values(SESSION_NOTICE_STATUS).find((candidate) => candidate === status);
}

function sessionNotice(session: Session, previousStatus: SessionStatus): SessionNotice {
  const status = noticeStatus(session.status);
  if (!status) throw new Error(`Not a notice status: ${session.status}`);
  const notice: SessionNotice = {
    providerId: session.providerId,
    providerSessionId: session.providerSessionId,
    providerName: session.provider.displayName,
    title: session.title,
    status,
    previousStatus,
    canReceiveMessage: session.canReceiveMessage,
    observedAt: session.observedAt,
  };
  if (session.workspace?.name) notice.workspace = session.workspace.name;
  if (status === SESSION_NOTICE_STATUS.WAITING) {
    notice.holdingForDeveloper = waitingHoldsForDeveloper(session);
  }
  if (session.recap) notice.recap = session.recap;
  if (session.detail.error) notice.error = session.detail.error;
  if (session.detail.activity) notice.activity = session.detail.activity;
  if (session.detail.repository) notice.repository = session.detail.repository;
  if (session.detail.branch) notice.branch = session.detail.branch;
  return notice;
}

/**
 * Derives notices from the edges between one observation pass and the next: a
 * session already waiting when Luke first sees it is the panel's to show, not
 * a banner's to announce, so only a change of status while watched is news.
 * A watched edge speaks only while its event is fresh — the status's own
 * timestamp within `SESSION_NOTICE_FRESH_AGE_MS` of now — so a wake from
 * sleep or a provider back from an outage never reads out the afternoon's
 * history as though it just happened. A waiting edge says whether the turn
 * merely finished or is holding for the developer, so the voice never turns
 * an ordinary finish into a false ask.
 * Deterministic by construction — nothing a model wrote can reach it — and
 * purely derived from the roster, so it can never act on a session, only
 * describe one.
 *
 * The tracker must be fed every pass whether or not anything will be shown:
 * feeding is what keeps its picture current, so switching notices on never
 * replays edges that happened while they were off.
 */
export class SessionNoticeTracker {
  /** Keyed by the original identifiers, never a composite string. */
  readonly #sessions = new Map<string, Map<string, TrackedSessionState>>();

  /**
   * Consumes one full observation pass and returns the notices it produced.
   * `now` anchors the repeat window; sessions absent from the pass are
   * forgotten, so a session that returns later is seeded again rather than
   * diffed against a stale reading.
   */
  notices(sessions: readonly Session[], now: number): readonly SessionNotice[] {
    const produced: SessionNotice[] = [];
    const next = new Map<string, Map<string, TrackedSessionState>>();

    for (const session of sessions) {
      const previous = this.#sessions.get(session.providerId)?.get(session.providerSessionId);
      const state: TrackedSessionState = {
        status: session.status,
        noticedAt: previous?.noticedAt ?? new Map(),
      };
      let provider = next.get(session.providerId);
      if (!provider) {
        provider = new Map();
        next.set(session.providerId, provider);
      }
      provider.set(session.providerSessionId, state);

      // A session the developer is speaking with announces nothing: its turn
      // boundaries are the rhythm of a conversation being heard first-hand,
      // and a voice reading them out would talk over the very exchange it is
      // reporting. The edge is still tracked, so the conversation ending never
      // replays what happened inside it — only a fresh edge after it speaks.
      if (session.realtimeVoiceLive === true) continue;
      // First sight seeds silently; an unchanged status is not an edge.
      if (!previous || previous.status === session.status) continue;
      if (session.completionCause === SESSION_COMPLETION_CAUSE.SESSION_CLOSED) continue;
      const status = noticeStatus(session.status);
      if (!status) continue;
      // The edge is still tracked above — it just is not news any more.
      if (now - session.observedAt > SESSION_NOTICE_FRESH_AGE_MS) continue;
      const lastNoticed = state.noticedAt.get(status);
      if (lastNoticed !== undefined && now - lastNoticed < SESSION_NOTICE_REPEAT_WINDOW_MS) {
        continue;
      }
      state.noticedAt.set(status, now);
      produced.push(sessionNotice(session, previous.status));
    }

    this.#sessions.clear();
    for (const [providerId, provider] of next) this.#sessions.set(providerId, provider);

    if (produced.length <= MAXIMUM_NOTICES_PER_PASS) return produced;
    // A stable sort by urgency, then the cap: what is dropped is the tail of
    // a burst, and every dropped session still shows its state in the panel.
    return produced
      .map((notice, index) => ({ notice, index }))
      .sort((a, b) => {
        const byPriority =
          NOTICE_PRIORITY.indexOf(a.notice.status) - NOTICE_PRIORITY.indexOf(b.notice.status);
        return byPriority !== 0 ? byPriority : a.index - b.index;
      })
      .slice(0, MAXIMUM_NOTICES_PER_PASS)
      .map((entry) => entry.notice);
  }
}
