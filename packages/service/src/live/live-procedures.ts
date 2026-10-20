/**
 * live-procedures.ts -- the reads the desktop follows over Neon Realtime, sealed for the account the bearer names.
 *
 * `GET /api/live/inbox` answers what waits on the developer across the
 * account as sealed statements, one per part of the account inbox's answer,
 * and the address to subscribe at (`live-wire.ts`). It is Neon's "Exposing
 * an endpoint" step: the caller is resolved first, on the resource's
 * implementer, each statement is built with that account's id in it, as its
 * held read's is, and sealed, so a subscription reads that account's rows
 * and no other's, and stays bound to the same rule of who may read them as
 * the rows change. A deployment whose Realtime is misconfigured answers
 * `unavailable`, and the desktop asks again a moment later.
 *
 * `GET /api/live/task-board?id=` answers one task's whiteboard the same way,
 * as one statement that marks where it stands, after the task is read as
 * the account, so one it does not reach is not found, as its board read
 * answers. Nothing else here reads a row: the store is read by Realtime.
 */

import { ownFailedRunsLiveStatement } from "@luke/database/models/automation-store";
import { boardLiveStatement } from "@luke/database/models/board-store";
import { readTask } from "@luke/database/models/task-store";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result } from "effect";
import { unparsedWire, wireUuidSchema } from "../core.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountInboxLiveStatements } from "../inbox/inbox-store.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { LiveSealing } from "./realtime.js";

export interface LiveProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The id a query named, where it is a UUID; any other names no row, and is not found. */
const rowIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  id: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/** The live reads, each to a signed-in caller. */
export function liveProcedures(seams: LiveProcedureSeams) {
  const signedIn = hosted.live.use(accountMiddleware(seams.resolveUserId));
  return {
    inbox: signedIn.inbox.effect(function* ({ context }) {
      const sealing = yield* LiveSealing;
      const statements = Option.zipWith(
        accountInboxLiveStatements(context.userId),
        ownFailedRunsLiveStatement(context.userId),
        (parts, failedRuns) => ({ ...parts, failedRuns }),
      );
      if (Option.isNone(sealing) || Option.isNone(statements)) {
        return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      }
      const { seal, url } = sealing.value;
      const queries = yield* Effect.all({
        items: seal(statements.value.items),
        planless: seal(statements.value.planless),
        plans: seal(statements.value.plans),
        automations: seal(statements.value.automations),
        failedRuns: seal(statements.value.failedRuns),
        chatAsks: seal(statements.value.chatAsks),
        chatNotices: seal(statements.value.chatNotices),
      }).pipe(Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE));
      return { url, queries };
    }),
    taskBoard: signedIn.taskBoard.effect(function* ({ input, context }) {
      const taskId = yield* rowIdOf(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const sealing = yield* LiveSealing;
      const statement = boardLiveStatement(context.userId, taskId);
      if (Option.isNone(sealing) || Option.isNone(statement)) {
        return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      }
      const { seal, url } = sealing.value;
      const board = yield* seal(statement.value).pipe(
        Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
      );
      return { url, queries: { board } };
    }),
  };
}
