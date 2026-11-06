import { failureKind } from "@repo/runtime/effect";
import type { UserContent } from "ai";
import { Data, type Effect, Schema as EffectSchema } from "effect";
import type * as HttpClientError from "effect/http/HttpClientError";
import type { EVE_HOST_TURN, EveHostTurn } from "./bounds.js";

export type EveTypedTurn = typeof EVE_HOST_TURN.TYPED;

const EVE_CANCEL_STATUS = { ACCEPTED: "accepted", NO_ACTIVE_TURN: "no_active_turn" } as const;
const EVE_RESET_STATUS = { RESET: "reset", NO_ACTIVE_SESSION: "no_active_session" } as const;

export class EveUnreachable extends Data.TaggedError("EveUnreachable")<{
  readonly cause: HttpClientError.HttpClientError;
}> {}

export function describeUnreachable(failure: EveUnreachable): string {
  const kind = failureKind(failure.cause);
  const status = failure.cause.response?.status;
  return status === undefined ? kind : `${kind} ${status}`;
}

export const EVE_SEND_OUTCOME = {
  ACCEPTED: "accepted",
  RETIRED: "retired",
  NOT_READY: "not_ready",
  FAILED: "failed",
} as const;

export const PLAN_REFUSAL = {
  NONE: "none",
  SIGNED_OUT: "signed_out",
  UNREADABLE: "unreadable",
  UNREACHABLE: "unreachable",
  LIMIT_REACHED: "limit_reached",
  INELIGIBLE: "ineligible",
} as const;

export type PlanRefusal = (typeof PLAN_REFUSAL)[keyof typeof PLAN_REFUSAL];

export const KEY_REFUSAL = {
  MISSING: "missing",
  UNREADABLE: "unreadable",
} as const;

export type KeyRefusal = (typeof KEY_REFUSAL)[keyof typeof KEY_REFUSAL];

export const RUNTIME_REFUSAL = {
  NOT_HERE: "not_here",
  ENDED: "ended",
  DEVICE_REMOVED: "device_removed",
  DEVICE_AWAY: "device_away",
} as const;

export type RuntimeRefusal = (typeof RUNTIME_REFUSAL)[keyof typeof RUNTIME_REFUSAL];

export const EveFailedSchema = EffectSchema.Struct({
  outcome: EffectSchema.Literal(EVE_SEND_OUTCOME.FAILED),
  status: EffectSchema.Number,
  planRefusal: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(PLAN_REFUSAL))),
  planResetsAt: EffectSchema.optionalKey(EffectSchema.Number),
  keyRefusal: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(KEY_REFUSAL))),
  runtimeRefusal: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(RUNTIME_REFUSAL))),
});

export type EveFailed = typeof EveFailedSchema.Type;

type EveOpened =
  | { readonly outcome: typeof EVE_SEND_OUTCOME.ACCEPTED; readonly sessionId: string }
  | EveFailed;

type EveSent =
  | {
      readonly outcome: typeof EVE_SEND_OUTCOME.ACCEPTED;
      readonly sessionId: string;
      readonly deliveryId: string;
    }
  | { readonly outcome: typeof EVE_SEND_OUTCOME.RETIRED }
  | { readonly outcome: typeof EVE_SEND_OUTCOME.NOT_READY }
  | EveFailed;

export const EVE_CANCEL_OUTCOME = {
  ACCEPTED: EVE_CANCEL_STATUS.ACCEPTED,
  NO_ACTIVE_TURN: EVE_CANCEL_STATUS.NO_ACTIVE_TURN,
  FAILED: "failed",
} as const;

type EveCanceled =
  | { readonly outcome: typeof EVE_CANCEL_OUTCOME.ACCEPTED }
  | { readonly outcome: typeof EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN }
  | {
      readonly outcome: typeof EVE_CANCEL_OUTCOME.FAILED;
      readonly status: number;
      readonly runtimeRefusal?: RuntimeRefusal;
    };

export const EVE_RESET_OUTCOME = {
  RESET: EVE_RESET_STATUS.RESET,
  NO_ACTIVE_SESSION: EVE_RESET_STATUS.NO_ACTIVE_SESSION,
  FAILED: "failed",
} as const;

type EveReset =
  | { readonly outcome: typeof EVE_RESET_OUTCOME.RESET }
  | { readonly outcome: typeof EVE_RESET_OUTCOME.NO_ACTIVE_SESSION }
  | {
      readonly outcome: typeof EVE_RESET_OUTCOME.FAILED;
      readonly status: number;
      readonly runtimeRefusal?: RuntimeRefusal;
    };

export interface EveMessage<Turn extends EveHostTurn = EveHostTurn> {
  readonly conversationId: string;
  readonly turn: Turn;
  readonly message: string | UserContent;
  readonly timeZone?: string;
  readonly lineId?: string;
}

export interface AgentSessions<Turn extends EveHostTurn = EveHostTurn> {
  readonly open: (message: EveMessage<Turn>) => Effect.Effect<EveOpened, EveUnreachable>;
  readonly send: (
    sessionId: string,
    message: EveMessage<Turn>,
  ) => Effect.Effect<EveSent, EveUnreachable>;
  cancel(sessionId: string, eveTurnId: string): Effect.Effect<EveCanceled, EveUnreachable>;
  reset(sessionId: string): Effect.Effect<EveReset, EveUnreachable>;
}
