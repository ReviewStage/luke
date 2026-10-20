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
 * answers.
 *
 * Either read asked with `?poll=true`, or one Realtime is off for or could
 * not seal, is answered with each statement's rows inline at the poll
 * address instead (`sealedParts`), so a reader polls it while Realtime
 * fails, behind the same caller and no other route.
 *
 * `GET /api/live/agent-transcript?id=` answers what one coding agent's
 * transcript is read from, or one of its workers' with `&call=` naming the
 * delegation call (`transcript-live.ts`), after the agent is read as the
 * account, each statement joined through the caller's membership of the
 * agent's workspace. A worker's delegation may not be recorded yet, as a
 * tab opened on its call is read before it is, so its statements name the
 * conversation the call will open rather than wait for it.
 */

import type { LiveStatement } from "@luke/database/core/live-statement";
import { ownFailedRunsLiveStatement } from "@luke/database/models/automation-store";
import { boardLiveStatement } from "@luke/database/models/board-store";
import { childConversationId } from "@luke/database/models/ids";
import { readTask } from "@luke/database/models/task-store";
import { codingAgentCallIdSchema } from "@luke/features/coding-agent-wire";
import { LIVE_POLL, liveDigestOf, type SealedLiveQueryWire } from "@luke/features/live-wire";
import { readEither } from "@luke/wire/effect";
import { Duration, Effect, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import { reachedAgentById } from "../agents/agent-reach.js";
import { agentFollowedBy, transcriptLiveStatements } from "../agents/coder-host/transcript-live.js";
import { unparsedWire, wireUuidSchema } from "../core.js";
import { heldUntil } from "../http/held-read.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountInboxLiveStatements } from "../inbox/inbox-store.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { type LiveSealer, LiveSealing, pollSealer } from "./realtime.js";

export interface LiveProcedureSeams {
  resolveUserId: UserIdResolver;
}

/**
 * How a poll past the reader's digest is held: looked at again every
 * second, and answered unchanged after 25, well inside a function's limit
 * and the client's held deadline.
 */
const LIVE_POLL_HOLD = { LOOK: Duration.seconds(1), HOLD: Duration.seconds(25) } as const;

/** The id a query named, where it is a UUID; any other names no row, and is not found. */
const rowIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  id: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/**
 * Each part sealed and the address to subscribe at; or, where the reader
 * asked to poll, or Realtime is off or could not seal a part, each part's
 * rows read inline at the poll address (`pollSealer`), so a read Realtime
 * fails is still answered, behind the same caller. Unavailable where even
 * the rows could not be read.
 */
const sealedParts = /* @__PURE__ */ Effect.fnUntraced(function* <Part extends string>(
  statements: Readonly<Record<Part, LiveStatement>>,
  asked: { readonly [LIVE_POLL.QUERY]?: string; readonly [LIVE_POLL.AFTER]?: string },
): Effect.fn.Return<
  {
    readonly url: string;
    readonly queries: Record<Part, Effect.Success<ReturnType<LiveSealer["seal"]>>>;
  },
  HostedRefusal,
  SqlClient.SqlClient
> {
  const all = (sealer: LiveSealer) =>
    Effect.map(
      Effect.forEach(Object.entries<LiveStatement>(statements), ([part, statement]) =>
        Effect.map(sealer.seal(statement), (sealed) => [part, sealed] as const),
      ),
      (sealed) => ({
        url: sealer.url,
        // SAFETY: every part of `statements` is sealed above, and no other.
        queries: Object.fromEntries(sealed) as Record<
          Part,
          Effect.Success<ReturnType<LiveSealer["seal"]>>
        >,
      }),
    );
  const polled = Effect.flatMap(SqlClient.SqlClient, (sql) => all(pollSealer(sql))).pipe(
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
  const after = asked[LIVE_POLL.AFTER];
  const sealing = yield* LiveSealing;
  if (asked[LIVE_POLL.QUERY] !== LIVE_POLL.ON && Option.isSome(sealing)) {
    return yield* all(sealing.value).pipe(
      Effect.catch(() =>
        Effect.andThen(
          Effect.logWarning("live: Realtime could not seal a read; it is answered polled"),
          polled,
        ),
      ),
    );
  }
  if (after === undefined) return yield* polled;
  // A poll past `after` is held until the rows move past it, or answered unchanged: its digests and no rows.
  const moved = yield* heldUntil(
    polled,
    (read) => liveDigestOf(read.queries) !== after,
    LIVE_POLL_HOLD.LOOK,
    LIVE_POLL_HOLD.HOLD,
  );
  if (Option.isSome(moved)) return moved.value;
  const standing = yield* polled;
  if (liveDigestOf(standing.queries) !== after) return standing;
  return {
    ...standing,
    // SAFETY: every part is kept, each with its rows left out.
    queries: Object.fromEntries(
      Object.entries<SealedLiveQueryWire>(standing.queries).map(([part, sealed]) => {
        const { rows: _rows, ...unchanged } = sealed;
        return [part, unchanged];
      }),
    ) as typeof standing.queries,
  };
});

/** The delegation call a query named, where one is a call id; one of any other shape names no worker, and is not found. */
const callIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  call: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(codingAgentCallIdSchema)(unparsedWire(call));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/** The live reads, each to a signed-in caller. */
export function liveProcedures(seams: LiveProcedureSeams) {
  const signedIn = hosted.live.use(accountMiddleware(seams.resolveUserId));
  return {
    inbox: signedIn.inbox.effect(function* ({ input, context }) {
      const statements = Option.zipWith(
        accountInboxLiveStatements(context.userId),
        ownFailedRunsLiveStatement(context.userId),
        (parts, failedRuns) => ({ ...parts, failedRuns }),
      );
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    taskBoard: signedIn.taskBoard.effect(function* ({ input, context }) {
      const taskId = yield* rowIdOf(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statement = boardLiveStatement(context.userId, taskId);
      if (Option.isNone(statement)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts({ board: statement.value }, input);
    }),
    agentTranscript: signedIn.agentTranscript.effect(function* ({ input, context }) {
      const callId = input.call === undefined ? undefined : yield* callIdOf(input.call);
      const { target } = yield* reachedAgentById(context.userId, input.id);
      const read =
        callId === undefined
          ? target
          : {
              userId: target.userId,
              conversationId: childConversationId(target.conversationId, callId),
            };
      const statements = transcriptLiveStatements(
        read,
        target.conversationId,
        agentFollowedBy(target.userId, target.conversationId, context.userId),
      );
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
  };
}
