/**
 * mac-commands-procedures.ts -- the developer's Mac takes the shell commands the account's agents queued for it, and says what each did.
 *
 * `GET /api/mac-commands` is the Mac's held read, naming in its `kinds`
 * query the kinds the Mac runs beyond shell (none from an older Mac): it
 * counts the Mac listening for them, and answers every command of those
 * kinds waiting for the account, claimed for this Mac, as soon as one
 * waits, or none once the hold ends (`agents/mac-command.ts`). `POST` keeps one claimed command's result,
 * which the agent's call is looking for; a command the account does not
 * hold claimed and unsettled is not found.
 *
 * A Mac that follows its commands live (`../live/live-procedures.ts`)
 * reads nothing here: it claims each command it hears of with
 * `POST /api/mac-commands/claim`, answered with the command or not found
 * where another Mac took it first or it waited past the claim window, and
 * says it listens for its kinds with `POST /api/mac-commands/listening` on
 * a timer of its own, since its read writes nothing. Every request resolves the
 * bearer before it touches a row, and every row it touches is the
 * bearer's account's own.
 */

import { markMacListening, settleMacCommand } from "@luke/database/models/mac-command-store";
import { macCommandKindsRead } from "@luke/features/mac-command-wire";
import { Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { bearerOnlyMiddleware, hosted } from "../orpc/base.js";
import { claimedMacCommand, macCommandsFor } from "./mac-command.js";

export interface MacCommandsProcedureSeams {
  /**
   * The account behind a request. The Mac's bearer alone is read, never a
   * browser's session cookie (`bearerOnlyMiddleware`): a held read claims
   * every waiting command for the Mac that asks, and a result is the word
   * of the Mac that ran its command, so no page may stand in for either.
   */
  resolveUserId: UserIdResolver;
}

/** The mac-commands resource: the held read and the result posted back, on the Mac's bearer. */
export function macCommandsProcedures(seams: MacCommandsProcedureSeams) {
  const macCommands = hosted.macCommands.use(bearerOnlyMiddleware(seams.resolveUserId));
  return {
    waiting: macCommands.waiting.effect(function* ({ context, input }) {
      const kinds = macCommandKindsRead(input.kinds);
      const commands = yield* hostedStoreOrUnavailable(macCommandsFor(context.userId, kinds));
      return { commands };
    }),
    settle: macCommands.settle.effect(function* ({ context, input }) {
      const settled = yield* hostedStoreOrUnavailable(
        settleMacCommand(context.userId, input.id, input.result),
      );
      if (!settled) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { settled: true } as const;
    }),
    claim: macCommands.claim.effect(function* ({ context, input }) {
      const claimed = yield* hostedStoreOrUnavailable(claimedMacCommand(context.userId, input.id));
      if (Option.isNone(claimed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { command: claimed.value };
    }),
    // Note that the kinds a presence names are read past, since every Mac that listens runs shell.
    listening: macCommands.listening.effect(function* ({ context }) {
      yield* hostedStoreOrUnavailable(markMacListening(context.userId));
      return { listening: true } as const;
    }),
  };
}
