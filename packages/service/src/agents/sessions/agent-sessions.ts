/**
 * agent-sessions.ts -- the one interface every caller reaches a coding agent's sessions through, and the words its calls answer in.
 *
 * Every implementation is a native harness's
 * (`../coder-host/runtime-sessions.ts` routes each conversation to its own).
 */

import { failureKind } from "@repo/runtime/effect";
import type { UserContent } from "ai";
import { Data, type Effect, Schema as EffectSchema } from "effect";
import type * as HttpClientError from "effect/http/HttpClientError";
import { RUN_TURN_ORIGIN, type RunTurnOrigin, TURN_TRIGGER, type TurnTrigger } from "../../core.js";

/** What kind of turn a message opens. */
export const SESSION_TURN = {
  TYPED: "typed",
} as const;

export type SessionTurn = (typeof SESSION_TURN)[keyof typeof SESSION_TURN];

/** The run stream's origin and trigger for each kind of turn a native runner's events record. */
export const SESSION_TURN_KIND = {
  [SESSION_TURN.TYPED]: {
    origin: RUN_TURN_ORIGIN.TYPED,
    trigger: TURN_TRIGGER.ASK,
  },
} as const satisfies Record<
  SessionTurn,
  { readonly origin: RunTurnOrigin; readonly trigger: TurnTrigger }
>;

/** A typed turn: the account's own words, the one kind a route's client may send. */
export type TypedTurn = typeof SESSION_TURN.TYPED;

/** The session's runtime was not reached, or never answered whole; the client's own error says which, for the operator. */
export class SessionUnreachable extends Data.TaggedError("SessionUnreachable")<{
  readonly cause: HttpClientError.HttpClientError;
}> {}

/**
 * The failure in the words a report carries: the client's kind of failure,
 * and the status where it answered at all. Note that the client's message
 * is not written, because it names the request's address and can describe
 * the body it sent, and the platform's error beneath it is not either.
 */
export function describeUnreachable(failure: SessionUnreachable): string {
  const kind = failureKind(failure.cause);
  const status = failure.cause.response?.status;
  return status === undefined ? kind : `${kind} ${status}`;
}

/** How a session answered a call: what it accepted, a session that no longer runs, one still coming up, or an answer this build cannot read as any. */
export const SESSION_SEND_OUTCOME = {
  ACCEPTED: "accepted",
  /** The session does not run: unknown, or ended; the conversation needs a new one. */
  RETIRED: "retired",
  /** The session runs but was not up in time; the same message later may be taken. */
  NOT_READY: "not_ready",
  /** The runtime refused or answered outside its shape; the status travels for the operator. */
  FAILED: "failed",
} as const;

/**
 * How the account's plan kept a native harness from launching or taking a
 * message, where it is why a call failed: no sign-in, one the provider
 * signed out, one the deployment cannot open, or the provider not reached.
 * The agent waits on it rather than turning to another payer.
 */
export const PLAN_REFUSAL = {
  NONE: "none",
  SIGNED_OUT: "signed_out",
  UNREADABLE: "unreadable",
  UNREACHABLE: "unreachable",
  /** The plan's usage limit refused its last turn and has not reset. */
  LIMIT_REACHED: "limit_reached",
  /** The provider said the account is not eligible to run on its plan. */
  INELIGIBLE: "ineligible",
} as const;

export type PlanRefusal = (typeof PLAN_REFUSAL)[keyof typeof PLAN_REFUSAL];

/**
 * Why the starter's own API key, which pays for an agent started on it,
 * could not launch the agent: none is saved any more, or the saved one does
 * not open under this deployment's key ring. Neither is mended by a retry,
 * only by saving the key in Settings › Agents, and neither turns to the plan.
 */
export const KEY_REFUSAL = {
  MISSING: "missing",
  UNREADABLE: "unreadable",
} as const;

export type KeyRefusal = (typeof KEY_REFUSAL)[keyof typeof KEY_REFUSAL];

/**
 * Why a coding agent's native runtime did not take a call, where that is
 * why it failed: its conversation runs on a native harness that this
 * function has no way to launch or write to, nor to relay to one that can.
 */
export const RUNTIME_REFUSAL = {
  NOT_HERE: "not_here",
  /** The agent's session ended for good, as one on the retired runtime has; nothing reaches it again, and only a new agent goes on from its work. */
  ENDED: "ended",
  /** The agent's device is a host its account removed; no message reaches it again. */
  DEVICE_REMOVED: "device_removed",
  /** The agent's device has not beaten lately, so nothing it is sent would be taken until it is back. */
  DEVICE_AWAY: "device_away",
} as const;

export type RuntimeRefusal = (typeof RUNTIME_REFUSAL)[keyof typeof RUNTIME_REFUSAL];

/**
 * A call that failed: the status for the operator, and the plan's, the
 * API key's, or the runtime's refusal where that is why. The one shape a failed open or send
 * has, here and as the native relay reads it off the wire.
 */
const SessionFailedSchema = EffectSchema.Struct({
  outcome: EffectSchema.Literal(SESSION_SEND_OUTCOME.FAILED),
  status: EffectSchema.Number,
  planRefusal: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(PLAN_REFUSAL))),
  /** When the plan's reached limit resets, in epoch milliseconds, where the provider said. */
  planResetsAt: EffectSchema.optionalKey(EffectSchema.Number),
  keyRefusal: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(KEY_REFUSAL))),
  runtimeRefusal: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(RUNTIME_REFUSAL))),
});

export type SessionFailed = typeof SessionFailedSchema.Type;

type SessionOpened =
  | { readonly outcome: typeof SESSION_SEND_OUTCOME.ACCEPTED; readonly sessionId: string }
  | SessionFailed;

type SessionSent =
  | {
      readonly outcome: typeof SESSION_SEND_OUTCOME.ACCEPTED;
      readonly sessionId: string;
      readonly deliveryId: string;
    }
  | { readonly outcome: typeof SESSION_SEND_OUTCOME.RETIRED }
  | { readonly outcome: typeof SESSION_SEND_OUTCOME.NOT_READY }
  | SessionFailed;

/** How a session answered a cancel: a turn canceled, none under way, or a failure. */
export const SESSION_CANCEL_OUTCOME = {
  ACCEPTED: "accepted",
  NO_ACTIVE_TURN: "no_active_turn",
  FAILED: "failed",
} as const;

type SessionCanceled =
  | { readonly outcome: typeof SESSION_CANCEL_OUTCOME.ACCEPTED }
  | { readonly outcome: typeof SESSION_CANCEL_OUTCOME.NO_ACTIVE_TURN }
  | {
      readonly outcome: typeof SESSION_CANCEL_OUTCOME.FAILED;
      readonly status: number;
      readonly runtimeRefusal?: RuntimeRefusal;
    };

/** How a session answered a reset: retired now, one that no longer ran, or a failure. */
export const SESSION_RESET_OUTCOME = {
  RESET: "reset",
  NO_ACTIVE_SESSION: "no_active_session",
  FAILED: "failed",
} as const;

type SessionReset =
  | { readonly outcome: typeof SESSION_RESET_OUTCOME.RESET }
  | { readonly outcome: typeof SESSION_RESET_OUTCOME.NO_ACTIVE_SESSION }
  | {
      readonly outcome: typeof SESSION_RESET_OUTCOME.FAILED;
      readonly status: number;
      readonly runtimeRefusal?: RuntimeRefusal;
    };

export interface SessionMessage<Turn extends SessionTurn = SessionTurn> {
  readonly conversationId: string;
  readonly turn: Turn;
  /** The words alone, or the AI SDK's user content where a coding agent's message carries files (`attached-files.ts`). */
  readonly message: string | UserContent;
  /** The sender's time zone, which the turn the message opens reads the day in; none reads UTC. */
  readonly timeZone?: string;
  /**
   * Our own id for the message, the client id of the line it wrote for
   * it: a native harness's runner names it back as it takes the message
   * (`runner-sessions.ts`).
   */
  readonly lineId?: string;
}

/**
 * An agent's sessions for one caller, sending the kinds of turn `Turn`
 * names: open, follow up, cancel a turn, and retire. Every caller
 * holds this interface rather than an implementation, so the runtime that
 * answers a conversation can change beneath it. Note that the two calls that carry a message are properties rather
 * than methods, because TypeScript checks a method's parameters both ways: a
 * client composed for one kind alone would pass for one that sends any
 * kind, and the narrowing would hold nothing.
 */
export interface AgentSessions<Turn extends SessionTurn = SessionTurn> {
  /** Opens a session over the conversation with its first message; the answer names the session, whose first turn is the message's. */
  readonly open: (
    message: SessionMessage<Turn>,
  ) => Effect.Effect<SessionOpened, SessionUnreachable>;
  /** Hands a message to the session the conversation runs in; the answer names the delivery its turn's events will carry. */
  readonly send: (
    sessionId: string,
    message: SessionMessage<Turn>,
  ) => Effect.Effect<SessionSent, SessionUnreachable>;
  /**
   * Cancels exactly the turn named, by the runtime's own id for it. A turn
   * no longer under way answers `no_active_turn` and the session's next turn
   * is left running; there is no form of the call that names the session's
   * turn under way, because between a caller's read and the answer that
   * turn can be the one queued after the one the caller meant.
   */
  cancel(sessionId: string, turnId: string): Effect.Effect<SessionCanceled, SessionUnreachable>;
  /**
   * Retires the session for good: a turn under way is canceled and the
   * session takes nothing again; a session that no longer runs answers
   * `no_active_session`.
   */
  reset(sessionId: string): Effect.Effect<SessionReset, SessionUnreachable>;
}
