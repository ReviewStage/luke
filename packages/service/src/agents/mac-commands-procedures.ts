/**
 * mac-commands-procedures.ts -- the developer's Mac takes the shell commands the account's agents queued for it, and says what each did.
 *
 * `GET /api/mac-commands` is the Mac's held read: it counts the Mac
 * listening, and answers every command waiting for the account, claimed
 * for this Mac, as soon as one waits, or none once the hold ends
 * (`agents/mac-command.ts`). `POST` keeps one claimed command's result,
 * which the agent's call is looking for; a command the account does not
 * hold claimed and unsettled is not found. Every request resolves the
 * bearer before it touches a row, and every row it touches is the
 * bearer's account's own.
 */

import { settleMacCommand } from "@luke/database/models/mac-command-store";
import { Effect } from "effect";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { bearerOnlyMiddleware, bodyLimit, hosted } from "../orpc/base.js";
import { macCommandsFor } from "./mac-command.js";

/** Two outputs at their bound, and room for the rest of the body. */
const MAXIMUM_RESULT_BODY_BYTES = 256 * 1_024;

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
    waiting: macCommands.waiting.effect(function* ({ context }) {
      const commands = yield* hostedStoreOrUnavailable(macCommandsFor(context.userId));
      return { commands };
    }),
    settle: macCommands.use(bodyLimit(MAXIMUM_RESULT_BODY_BYTES)).settle.effect(function* ({
      context,
      input,
    }) {
      const settled = yield* hostedStoreOrUnavailable(
        settleMacCommand(context.userId, input.id, input.result),
      );
      if (!settled) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { settled: true } as const;
    }),
  };
}
