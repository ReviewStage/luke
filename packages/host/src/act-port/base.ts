import "@orpc/experimental-effect/extensions/effect";
import { createORPCErrorConstructorMap } from "@orpc/contract";
import type { WithEffectContext } from "@orpc/experimental-effect";
import { type AnyProcedure, implement, ORPCError } from "@orpc/server";
import { ACT_ERROR, actPortContract } from "../contract/index.js";

export interface ActSender<Sender = unknown> {
  sender: Sender;
  panel: boolean;
}

export interface ActPortContext<Sender = unknown> extends WithEffectContext<never> {
  readonly actor: ActSender<Sender>;
  readonly trusted: boolean;
}

export function refusedBy(procedure: AnyProcedure, cause?: unknown): ORPCError<string, unknown> {
  const errors = createORPCErrorConstructorMap(procedure["~orpc"].errorMap);
  const refused = errors[ACT_ERROR.REFUSED];
  if (refused === undefined) throw new Error("An act procedure declares no refusal.");
  return refused({ cause });
}

export function isRefusal(error: unknown): error is ORPCError<string, unknown> {
  return error instanceof ORPCError && error.code === ACT_ERROR.REFUSED;
}

export function actPortFor<Sender>() {
  return implement(actPortContract)
    .$context<ActPortContext<Sender>>()
    .use(({ context, next, procedure }) => {
      if (!context.trusted) throw refusedBy(procedure);
      return next();
    });
}

export const actPort = actPortFor<unknown>();
