import "@orpc/experimental-effect/extensions/effect";
import { createORPCErrorConstructorMap } from "@orpc/contract";
import type { WithEffectContext } from "@orpc/experimental-effect";
import { type AnyProcedure, implement, ORPCError } from "@orpc/server";
import type { ActSender } from "../act-router/router.js";
import { ACT_ERROR, actContract } from "../contract/index.js";

/**
 * base.ts -- the implementer every act procedure is built from: who asked, and the refusal of a sender this build does not trust.
 *
 * A call reaches a procedure with the window that asked, read by the bridge
 * from the windows its own side opened, whether that window's frame is this
 * build's own renderer, read again for every call, and the launch's own
 * services as `effect/context`, so a row's effect runs on the desktop's
 * runtime rather than under a context of its own.
 */

/** What every act procedure is called with. */
export interface ActPortContext extends WithEffectContext<never> {
  /** The window that asked, and which surface it is drawing. */
  readonly actor: ActSender;
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
 * The act contract to implement. Every procedure first refuses a sender this
 * build does not trust, in its own sentence, before its input is read or
 * its row asks anything.
 */
export const actPort = implement(actContract)
  .$context<ActPortContext>()
  .use(({ context, next, procedure }) => {
    if (!context.trusted) throw refusedBy(procedure);
    return next();
  });
