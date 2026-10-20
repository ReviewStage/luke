import "@orpc/experimental-effect/extensions/effect";
import { createORPCErrorConstructorMap } from "@orpc/contract";
import type { WithEffectContext } from "@orpc/experimental-effect";
import { type AnyProcedure, implement, ORPCError } from "@orpc/server";
import type { ActSender } from "../act-router/router.js";
import { ACT_ERROR, actPortContract } from "../contract/index.js";

/**
 * base.ts -- the implementer every act procedure is built from: who asked, and the refusal of a sender this build does not trust.
 *
 * A call reaches a procedure with the window that asked, read by the bridge
 * from the windows its own side opened, whether that window's frame is this
 * build's own renderer, read again for every call, and the launch's own
 * services as `effect/context`, so a row's effect runs on the desktop's
 * runtime rather than under a context of its own.
 */

/** What every act procedure is called with, `Sender` being the platform's own handle on the window that asked. */
export interface ActPortContext<Sender = unknown> extends WithEffectContext<never> {
  /** The window that asked, and which surface it is drawing. */
  readonly actor: ActSender<Sender>;
  /** Whether that window's frame is this build's own renderer. */
  readonly trusted: boolean;
}

/**
 * A procedure's own refusal, as the error its contract declares, worded in
 * the sentence it declares; `cause` is what it replaced, which stays in main.
 */
export function refusedBy(procedure: AnyProcedure, cause?: unknown): ORPCError<string, unknown> {
  const errors = createORPCErrorConstructorMap(procedure["~orpc"].errorMap);
  const refused = errors[ACT_ERROR.REFUSED];
  // Note that every act contract declares the refusal (`contract/base.ts`), so this is an invariant rather than a branch.
  if (refused === undefined) throw new Error("An act procedure declares no refusal.");
  return refused({ cause });
}

/** Whether an error is a declared refusal, which crosses as it is. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- What a call threw is unknown until this guard reads it; it is the guard.
export function isRefusal(error: unknown): error is ORPCError<string, unknown> {
  return error instanceof ORPCError && error.code === ACT_ERROR.REFUSED;
}

/**
 * The act port's contract to implement, for a platform whose handle on a window is
 * a `Sender`. Every procedure first refuses a sender this build does not
 * trust, in its own sentence, before its input is read or its row asks
 * anything.
 */
export function actPortFor<Sender>() {
  return implement(actPortContract)
    .$context<ActPortContext<Sender>>()
    .use(({ context, next, procedure }) => {
      if (!context.trusted) throw refusedBy(procedure);
      return next();
    });
}

/** The act contract to implement, for the host's own procedures, which read no platform's handle on a window. */
export const actPort = actPortFor<unknown>();
