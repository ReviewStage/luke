import { RUN_TURN_ORIGIN, type RunTurnOrigin, TURN_TRIGGER, type TurnTrigger } from "../../core.js";

/**
 * The request headers a client names the conversation, the turn's kind, and
 * its sender's time zone with, and the one the deployment names the account
 * it acts for with, the last read only from a request the deployment's own
 * credential admitted, never from an account's bearer, whose account is the
 * bearer's.
 */
export const EVE_HOST_HEADER = {
  CONVERSATION: "x-luke-conversation",
  TURN: "x-luke-turn",
  ACCOUNT: "x-luke-account",
  /** The sender's IANA time zone, which the turn its message opens reads the day in. */
  TIME_ZONE: "x-luke-time-zone",
} as const;

/** What kind of turn a request opens, as the header names it. */
export const EVE_HOST_TURN = {
  TYPED: "typed",
} as const;

export type EveHostTurn = (typeof EVE_HOST_TURN)[keyof typeof EVE_HOST_TURN];

/** The run stream's origin and trigger for each kind of turn a native runner's events record. */
export const EVE_HOST_TURN_KIND = {
  [EVE_HOST_TURN.TYPED]: {
    origin: RUN_TURN_ORIGIN.TYPED,
    trigger: TURN_TRIGGER.ASK,
  },
} as const satisfies Record<
  EveHostTurn,
  { readonly origin: RunTurnOrigin; readonly trigger: TurnTrigger }
>;

/** The environment the host reads beside the names every hosted route already honours. */
export const EVE_HOST_ENVIRONMENT = {
  /** The origin native runners report to; unset, the deployment's own: its production domain, or its own host (`eve-origin.ts`). */
  EVE_ORIGIN: "LUKE_EVE_ORIGIN",
  /**
   * The secret the deployment acts for an account under at eve's door, read on
   * both sides of it: the web functions and the eve service send it, and the
   * eve service admits it. It is never the cron's `CRON_SECRET`, so the bearer
   * Vercel's scheduler holds opens no eve session.
   */
  DEPLOYMENT_SECRET: "EVE_DEPLOYMENT_SECRET",
} as const;

/** Why the host refused a request's standing, in words the model or a route can read. */
export const EVE_HOST_REFUSAL = {
  NO_PRINCIPAL: "Not run: the session has no signed-in account.",
  NO_CONVERSATION: "Not run: the session names no conversation of this account.",
  NOT_OWNER: "Not run: this conversation belongs to another account.",
  NOT_INITIATOR: "Not run: this session was opened by another account.",
  NO_TURN_KIND: "Not run: the request names no kind of turn.",
  NO_ACCOUNT: "Not run: the deployment's request names no account.",
  NOT_DEPLOYMENT_ACT:
    "Not run: the deployment may only open the turns it is admitted for, stop one, or retire a session.",
  NOT_CURRENT_SESSION: "Not run: this conversation runs in another session now.",
} as const;

export type EveHostRefusal = (typeof EVE_HOST_REFUSAL)[keyof typeof EVE_HOST_REFUSAL];
