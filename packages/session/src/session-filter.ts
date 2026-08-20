import { isProviderId, type ProviderId } from "./providers.js";
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
  | SessionApplicationId;

export function isSessionFilter(value: string): value is SessionFilter {
  return (
    value === SESSION_FILTER.LOCAL ||
    value === SESSION_FILTER.CLOUD ||
    value === SESSION_FILTER.VOICE ||
    isProviderId(value) ||
    isSessionApplicationId(value)
  );
}
