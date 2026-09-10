/**
 * What one local session's own state says it is doing, and how what the
 * observation hook last said sharpens it. A provider's files are the whole
 * story wherever the hook is absent; the hook only ever refines a verdict
 * these functions would reach without it.
 */

import { agedStatus, SESSION_STATUS, type SessionStatus } from "@sidecar/session";

export function localSessionStatus(
  status: SessionStatus,
  lastActivityAt: number,
  now: number,
  freshnessMs: number,
): SessionStatus {
  if (status === SESSION_STATUS.WORKING && now - lastActivityAt > freshnessMs) {
    return SESSION_STATUS.UNKNOWN;
  }
  return agedStatus(status, lastActivityAt, now, freshnessMs);
}

interface HookEventStatus<Event extends string> {
  event: Event;
  fresh: SessionStatus;
  stale?: SessionStatus;
}

export interface HookStatusRefinement<Event extends string> {
  definitive: readonly HookEventStatus<Event>[];
  fresh: readonly HookEventStatus<Event>[];
  /**
   * The token meaning the session is holding on a question only the developer
   * can answer. It is the one event granted no tolerance against the
   * provider's clock — holding writes nothing, so provider state at or past
   * the event is itself the news that the hold ended — and the one that marks
   * the observation as holding for the developer while it stands. A provider
   * whose hooks carry no such moment omits it, and the honest absence stands.
   */
  notificationEvent?: Event;
  /**
   * The token meaning the provider closed the session for good, which is what
   * lets the observation report the closure as the completion's cause. A
   * provider that fires no closing hook omits it.
   */
  sessionEndEvent?: Event;
}

function refineStatusWithHookEvent<Event extends string>(
  status: SessionStatus,
  event: Event,
  isFresh: boolean,
  refinement: HookStatusRefinement<Event>,
): SessionStatus {
  const definitive = refinement.definitive.find((candidate) => candidate.event === event);
  if (definitive) return definitive.fresh;
  if (status === SESSION_STATUS.COMPLETE || status === SESSION_STATUS.ERROR) return status;
  const candidate = refinement.fresh.find((entry) => entry.event === event);
  if (!candidate) return status;
  return isFresh ? candidate.fresh : (candidate.stale ?? status);
}

/**
 * How much older than the provider's clock a hook event may run and still
 * describe the same moment. The hook fires as a turn boundary happens and the
 * provider's own closing records land moments later under their own
 * timestamps, so a boundary's event usually trails the record it belongs with
 * by a breath — never by more than this. An event further behind describes a
 * turn the provider has already moved past, and refines nothing.
 */
const HOOK_EVENT_TOLERANCE_MS = 5_000;

/** What the hook settled for one observation, beyond the status itself. */
export interface HookRefinedStatus {
  status: SessionStatus;
  /**
   * The clock the freshness decay runs on: the provider's own, or the
   * event's when it stands past it.
   */
  lastActivityAt: number;
  /** The provider closed the session, on the hook's word. */
  sessionClosed: boolean;
  /** The session is holding on a question only the developer can answer. */
  holdingForDeveloper: boolean;
}

/**
 * Sharpens a provider's own verdict with what the observation hook last said,
 * in the order the meanings bind: a definitive event outranks the provider,
 * a provider that already settled on complete or error is never talked out
 * of it by a softer event, and the rest refine only a fresh session — the
 * decay to unknown exists because a hook can go silent (a killed process
 * fires no session end), so an old event must age the same way old provider
 * state does. A hook event trailing the provider's clock by more than the
 * tolerance describes a turn the session already moved past, so it is
 * ignored whole. One that stands is proof the session moved — only Luke's
 * own script writes the spool, so its date cannot suffer the bulk-touch
 * problem a provider's files can — and dates the session for the freshness
 * decay as well. A notification alone gets no tolerance: a granted
 * permission must not read as waiting for even one more pass.
 */
export function hookRefinedStatus<Event extends string>(options: {
  refinement: HookStatusRefinement<Event>;
  /** The spool's last word about the session, if the hook said anything. */
  hookEvent: { event: Event; atMs: number } | undefined;
  /** When the provider's own state last said the session moved. */
  providerAtMs: number;
  /** The provider's own verdict, given the clock the refinement settles on. */
  statusAt: (lastActivityAt: number) => SessionStatus;
  now: number;
  activeSessionFreshnessMs: number;
}): HookRefinedStatus {
  const { refinement, hookEvent, providerAtMs } = options;
  const toleranceMs =
    refinement.notificationEvent !== undefined && hookEvent?.event === refinement.notificationEvent
      ? 0
      : HOOK_EVENT_TOLERANCE_MS;
  const eventStands = hookEvent !== undefined && hookEvent.atMs + toleranceMs >= providerAtMs;
  const lastActivityAt = eventStands ? Math.max(providerAtMs, hookEvent.atMs) : providerAtMs;
  let status = options.statusAt(lastActivityAt);
  if (eventStands) {
    const isFresh = options.now - lastActivityAt <= options.activeSessionFreshnessMs;
    status = refineStatusWithHookEvent(status, hookEvent.event, isFresh, refinement);
  }
  return {
    status,
    lastActivityAt,
    sessionClosed:
      status === SESSION_STATUS.COMPLETE &&
      eventStands &&
      hookEvent.event === refinement.sessionEndEvent,
    holdingForDeveloper:
      status === SESSION_STATUS.WAITING &&
      eventStands &&
      hookEvent.event === refinement.notificationEvent,
  };
}
