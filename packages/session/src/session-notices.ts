import { isRecord, text, type UnparsedWireValue, wholeNumber } from "@sidecar/wire";
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
  /** Why the session stopped, when its provider said. */
  error?: string;
  /** The provider's bounded description of the action currently awaiting permission. */
  activity?: string;
  repository?: string;
  branch?: string;
  /** Whether the provider will take a reply for this session right now. */
  canReceiveMessage: boolean;
  lastActivityAt: number;
}

/**
 * Distinguishes a turn that needs the developer from one that merely finished.
 * Only a provider that saw a permission, an approval, or an open question and
 * said so on the observation counts: a waiting session whose adapter could
 * not tell is the panel's to show, not a notice's to speak.
 */
function waitingHoldsForDeveloper(session: Session): boolean {
  return session.status === SESSION_STATUS.WAITING && session.holdingForDeveloper === true;
}

interface TrackedSessionState {
  status: SessionStatus;
  /** When each notice-worthy status was last noticed, for the repeat window. */
  noticedAt: Map<SessionNoticeStatus, number>;
}

/**
 * One session's place in the tracker's memory, in values that survive a
 * process: what the tracker needs to tell an edge from a first sight is where
 * a session stood and when it was last spoken of, never its title, activity,
 * or error, so a memory that stands in a row carries identifiers and
 * timestamps alone.
 */
export interface TrackedSessionMemory {
  providerId: string;
  providerSessionId: string;
  status: SessionStatus;
  /** When each notice-worthy status was last noticed, one entry per status. */
  noticedAt: readonly NoticedAtMemory[];
}

export interface NoticedAtMemory {
  status: SessionNoticeStatus;
  at: number;
}

export type SessionNoticeMemory = readonly TrackedSessionMemory[];

function noticeStatus(status: SessionStatus): SessionNoticeStatus | undefined {
  return Object.values(SESSION_NOTICE_STATUS).find((candidate) => candidate === status);
}

function sessionStatus(value: UnparsedWireValue): SessionStatus | undefined {
  const candidate = text(value);
  return Object.values(SESSION_STATUS).find((status) => status === candidate);
}

/**
 * Reads a memory back from wherever it was kept. A record the reader cannot
 * place — an unknown status, an identifier that is not text — is dropped
 * rather than trusted, and a dropped session is merely seen for the first
 * time again on the next pass, which is the tracker's own answer to a session
 * it has never met. A timestamp under a status that is not notice-worthy is
 * dropped the same way; the statuses the repeat window guards are the only
 * ones it could ever have recorded.
 */
export function sessionNoticeMemoryFromWire(value: UnparsedWireValue): SessionNoticeMemory {
  if (!Array.isArray(value)) return [];
  const memory: TrackedSessionMemory[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const providerId = text(entry.providerId);
    const providerSessionId = text(entry.providerSessionId);
    const status = sessionStatus(entry.status);
    if (!providerId || !providerSessionId || !status) continue;
    const noticedAt: NoticedAtMemory[] = [];
    if (Array.isArray(entry.noticedAt)) {
      for (const noticed of entry.noticedAt) {
        if (!isRecord(noticed)) continue;
        const noticedStatus = sessionStatus(noticed.status);
        const candidate = noticedStatus === undefined ? undefined : noticeStatus(noticedStatus);
        const at = wholeNumber(noticed.at);
        if (candidate === undefined || at === undefined) continue;
        noticedAt.push({ status: candidate, at });
      }
    }
    memory.push({ providerId, providerSessionId, status, noticedAt });
  }
  return memory;
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
    lastActivityAt: session.lastActivityAt,
  };
  if (session.workspace?.name) notice.workspace = session.workspace.name;
  if (status === SESSION_NOTICE_STATUS.WAITING) {
    notice.holdingForDeveloper = waitingHoldsForDeveloper(session);
  }
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
 * The edge is the whole test: no provider records when a status was entered,
 * only when it last wrote about the session, so the timestamp's age says
 * nothing about whether the change is news, and an edge first seen after a
 * long sleep is announced like any other. A waiting edge says whether the
 * turn merely finished or is holding for the developer, so the voice never
 * turns an ordinary finish into a false ask.
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
   * A tracker standing where a previous one left off, so the pass after a
   * restart diffs against the last reading rather than seeding afresh: a
   * memory kept between processes is what lets a watcher with no resident
   * process tell an edge from a first sight. A session named twice keeps the
   * later record.
   */
  static restore(memory: SessionNoticeMemory): SessionNoticeTracker {
    const tracker = new SessionNoticeTracker();
    for (const record of memory) {
      let provider = tracker.#sessions.get(record.providerId);
      if (!provider) {
        provider = new Map();
        tracker.#sessions.set(record.providerId, provider);
      }
      const noticedAt = new Map<SessionNoticeStatus, number>();
      for (const noticed of record.noticedAt) noticedAt.set(noticed.status, noticed.at);
      provider.set(record.providerSessionId, { status: record.status, noticedAt });
    }
    return tracker;
  }

  /**
   * The tracker's memory as plain values: everything a later `restore` needs
   * to continue this tracker's picture, and nothing else.
   */
  snapshot(): SessionNoticeMemory {
    const memory: TrackedSessionMemory[] = [];
    for (const [providerId, provider] of this.#sessions) {
      for (const [providerSessionId, state] of provider) {
        const noticedAt: NoticedAtMemory[] = [];
        for (const [status, at] of state.noticedAt) noticedAt.push({ status, at });
        memory.push({ providerId, providerSessionId, status: state.status, noticedAt });
      }
    }
    return memory;
  }

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
