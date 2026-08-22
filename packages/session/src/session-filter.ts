import { type HostedAgentId, isHostedAgentId, isProviderId, type ProviderId } from "./providers.js";
import {
  isSessionApplicationId,
  SESSION_APPLICATION_ID,
  SESSION_LOCATION,
  type SessionApplicationId,
} from "./session.js";

/**
 * One narrowing a session list can hold: a place work runs, the realtime voice
 * kind, one app that associates with sessions, or one agent. The values are
 * identities a row already carries: its location, voice kind, app associations
 * and provider. Conductor deliberately occupies both app and provider
 * vocabularies, so its filter takes the union — native Conductor chats and
 * local chats annotated as running in Conductor — while no identity collides
 * with `local`, `cloud`, or `voice`.
 *
 * The vocabulary lives here rather than with the surface that draws the chips
 * because the stored view reads it too: a persisted selection is restored only
 * as far as this set still recognizes it, and two readings of what a filter is
 * must not drift apart.
 */
export const SESSION_FILTER = {
  LOCAL: SESSION_LOCATION.LOCAL,
  CLOUD: SESSION_LOCATION.CLOUD,
  VOICE: "voice",
  SUPERSET: SESSION_APPLICATION_ID.SUPERSET,
} as const;

export type SessionFilter =
  | (typeof SESSION_FILTER)[keyof typeof SESSION_FILTER]
  | ProviderId
  | HostedAgentId
  | SessionApplicationId;

export function isSessionFilter(value: string): value is SessionFilter {
  return (
    value === SESSION_FILTER.LOCAL ||
    value === SESSION_FILTER.CLOUD ||
    value === SESSION_FILTER.VOICE ||
    isProviderId(value) ||
    isHostedAgentId(value) ||
    isSessionApplicationId(value)
  );
}

/**
 * The independent questions the filters answer. Each filter value belongs to
 * exactly one axis, and the axis is what gives a combined selection its
 * meaning: values on one axis are alternatives (either place, either agent),
 * where values on different axes are each a further narrowing. The axes live
 * beside the vocabulary because a combination is read in two places — the
 * chips narrowing the drawn list, and a spoken ask validated against the
 * observed roster — and the two readings must not drift apart.
 */
export const SESSION_FILTER_AXIS = {
  LOCATION: "location",
  KIND: "kind",
  APP: "app",
  AGENT: "agent",
} as const;

export type SessionFilterAxis = (typeof SESSION_FILTER_AXIS)[keyof typeof SESSION_FILTER_AXIS];

/**
 * Conductor and Superset land on the app axis even where a namesake provider
 * exists, because "associated with that app" is the question their chips
 * answer — a native cloud Conductor chat and a local Codex chat annotated by
 * Conductor answer the same chip, and an agent chip beside it stays a further
 * narrowing rather than a widening. Cursor deliberately does not share one
 * id: its app chip counts the chats the Cursor app can open and its agent
 * chip every Cursor chat, so each axis holds its own Cursor value. The
 * parameter is wider than {@link SessionFilter} because a spoken ask may
 * name an identity only the roster knows — a hosted agent's own id — and it
 * lands on the agent axis like the provider ids do.
 */
export function sessionFilterAxis(filter: string): SessionFilterAxis {
  if (filter === SESSION_FILTER.LOCAL || filter === SESSION_FILTER.CLOUD) {
    return SESSION_FILTER_AXIS.LOCATION;
  }
  if (filter === SESSION_FILTER.VOICE) return SESSION_FILTER_AXIS.KIND;
  if (isSessionApplicationId(filter)) return SESSION_FILTER_AXIS.APP;
  return SESSION_FILTER_AXIS.AGENT;
}

/**
 * Whether a candidate answers the whole selection. Within one axis the values
 * are ORed — Local and Cloud together is either place — and across axes they
 * are ANDed — Codex beside Conductor is Codex chats associated with Conductor.
 * An axis nothing is chosen on asks nothing, so an empty selection is the
 * unnarrowed list. The candidate stays behind the predicate because the two
 * callers hold sessions of different shapes; only the combining is shared.
 */
export function matchesFilterSelection<T extends string>(
  filters: readonly T[],
  matches: (filter: T) => boolean,
): boolean {
  const byAxis = new Map<SessionFilterAxis, T[]>();
  for (const filter of filters) {
    const axis = sessionFilterAxis(filter);
    const held = byAxis.get(axis) ?? [];
    held.push(filter);
    byAxis.set(axis, held);
  }
  for (const alternatives of byAxis.values()) {
    if (!alternatives.some(matches)) return false;
  }
  return true;
}
