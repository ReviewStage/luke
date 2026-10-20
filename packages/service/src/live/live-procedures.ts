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
 * `GET /api/live/tasks` answers the task list the same way: the tasks the
 * account reaches and every agent of them and with no task, as two sealed
 * statements built with the account's id (`task-list-live.ts`).
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
import { LIVE_POLL, LIVE_USER_QUERY } from "@luke/features/live-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import { reachedAgentById } from "../agents/agent-reach.js";
import { agentFollowedBy, transcriptLiveStatements } from "../agents/coder-host/transcript-live.js";
import { unparsedWire, wireUuidSchema } from "../core.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountInboxLiveStatements } from "../inbox/inbox-store.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { taskListLiveStatements } from "../tasks/task-list-live.js";
import { type LiveSealer, LiveSealing, pollSealer } from "./realtime.js";

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

/**
 * Each part sealed and the address to subscribe at; or, where the reader
 * asked to poll, or Realtime is off or could not seal a part, each part's
 * rows read inline at the poll address (`pollSealer`), so a read Realtime
 * fails is still answered, behind the same caller. Unavailable where even
 * the rows could not be read.
 */
const sealedParts = /* @__PURE__ */ Effect.fnUntraced(function* <Part extends string>(
  statements: Readonly<Record<Part, LiveStatement>>,
  poll: boolean,
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
  const sealing = yield* LiveSealing;
  if (poll || Option.isNone(sealing)) return yield* polled;
  return yield* all(sealing.value).pipe(
    Effect.catch(() =>
      Effect.andThen(
        Effect.logWarning("live: Realtime could not seal a read; it is answered polled"),
        polled,
      ),
    ),
  );
});

/** The delegation call a query named, where one is a call id; one of any other shape names no worker, and is not found. */
const callIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  call: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(codingAgentCallIdSchema)(unparsedWire(call));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/**
 * The caller, where they are the account the read names; refused as signed
 * out otherwise, with the same 401 as no session, as Neon's guide says
 * ("When the session changes"), so a renewal from a page left open under
 * another account's session reads nothing of theirs.
 */
const sameUser = (input: { readonly [LIVE_USER_QUERY]?: string }, userId: string) =>
  input[LIVE_USER_QUERY] === userId ? Effect.void : Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);

/** The live reads, each to a signed-in caller who is the account it names. */
export function liveProcedures(seams: LiveProcedureSeams) {
  const signedIn = hosted.live.use(accountMiddleware(seams.resolveUserId));
  return {
    inbox: signedIn.inbox.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const statements = Option.zipWith(
        accountInboxLiveStatements(context.userId),
        ownFailedRunsLiveStatement(context.userId),
        (parts, failedRuns) => ({ ...parts, failedRuns }),
      );
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input[LIVE_POLL.QUERY] === LIVE_POLL.ON);
    }),
    tasks: signedIn.tasks.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const statements = taskListLiveStatements(context.userId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input[LIVE_POLL.QUERY] === LIVE_POLL.ON);
    }),
    taskBoard: signedIn.taskBoard.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* rowIdOf(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statement = boardLiveStatement(context.userId, taskId);
      if (Option.isNone(statement)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(
        { board: statement.value },
        input[LIVE_POLL.QUERY] === LIVE_POLL.ON,
      );
    }),
    agentTranscript: signedIn.agentTranscript.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
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
      return yield* sealedParts(statements.value, input[LIVE_POLL.QUERY] === LIVE_POLL.ON);
    }),
  };
}
