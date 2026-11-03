import { RUN_TURN_ORIGIN, type RunTurnOrigin, TURN_TRIGGER, type TurnTrigger } from "../../core.js";

/** What kind of turn a message opens. */
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
