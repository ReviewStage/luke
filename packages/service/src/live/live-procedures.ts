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
 * answers; and `GET /api/live/task-record?id=` its pages and calls, one
 * statement a part (`task-record-live.ts`), on the same terms.
 *
 * Either read asked with `?poll=true`, or one Realtime is off for or could
 * not seal, is answered with each statement's rows inline at the poll
 * address instead (`sealedParts`), so a reader polls it while Realtime
 * fails, behind the same caller and no other route.
 *
 * `GET /api/live/mac-commands?kinds=` answers the commands of those kinds
 * no Mac of the account has claimed, as one statement, for the Mac to claim
 * each by its id (`../agents/mac-commands-procedures.ts`).
 *
 * `GET /api/live/agent-transcript?id=` answers what one coding agent's
 * transcript is read from, or one of its workers' with `&call=` naming the
 * delegation call (`transcript-live.ts`), after the agent is read as the
 * account, each statement joined through the caller's membership of the
 * agent's workspace. A worker's delegation may not be recorded yet, as a
 * tab opened on its call is read before it is, so its statements name the
 * conversation the call will open rather than wait for it.
 *
 * `GET /api/live/task-inbox?id=` and `GET /api/live/agent-inbox?id=` answer
 * one plan's inbox, or one agent's, the same way: its open items and its
 * latest settled ones as one statement, their threads and files as two
 * more, after the plan or the agent is read as the account, so one it does
 * not reach is not found, as its held read answers.
 *
 * `GET /api/live/workspace-chat?workspaceId=` answers a workspace's chat as
 * the account's person reads it, one statement per part of the window's
 * read, after the account's own member of it is read: a workspace it is not
 * in, whose chat it has not joined, or with Chat off for it is not found.
 * Sealing writes nothing, so the desktop joins once before it follows.
 */

import type { LiveStatement } from "@luke/database/core/live-statement";
import { ownFailedRunsLiveStatement } from "@luke/database/models/automation-store";
import { boardLiveStatement } from "@luke/database/models/board-store";
import { workspaceChatLiveStatements } from "@luke/database/models/chat-store";
import { readCodingAgent } from "@luke/database/models/coding-agent-store";
import { childConversationId } from "@luke/database/models/ids";
import { macCommandsLiveStatement } from "@luke/database/models/mac-command-store";
import { readTask } from "@luke/database/models/task-store";
import { CODING_AGENT_STATUS, codingAgentCallIdSchema } from "@luke/features/coding-agent-wire";
import {
  LIVE_POLL,
  LIVE_USER_QUERY,
  liveDigestOf,
  type SealedLiveQueryWire,
} from "@luke/features/live-wire";
import { macCommandKindsRead } from "@luke/features/mac-command-wire";
import { readEither } from "@luke/wire/effect";
import { Duration, Effect, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import { reachedAgentById } from "../agents/agent-reach.js";
import { joinedMember } from "../agents/coder-host/chat-page.js";
import {
  agentFollowedBy,
  taskFollowedBy,
  transcriptLiveStatements,
} from "../agents/coder-host/transcript-live.js";
import { chatAccount, workspaceOf } from "../agents/workspace-chat.js";
import { unparsedWire, wireUuidSchema } from "../core.js";
import { heldUntil } from "../http/held-read.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import {
  accountInboxLiveStatements,
  memberAgentInboxLiveStatements,
  taskInboxLiveStatements,
} from "../inbox/inbox-store.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  brainStatusNow,
  brainWorkerSession,
  taskConversationLiveStatements,
} from "../tasks/brain-transcript.js";
import { taskHistoryLiveStatements } from "../tasks/task-history-live.js";
import { taskListLiveStatements } from "../tasks/task-list-live.js";
import { taskPagesLiveStatements } from "../tasks/task-pages-live.js";
import { taskRecordLiveStatements } from "../tasks/task-record-live.js";
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

/**
 * The caller, where they are the account the read names; refused as signed
 * out otherwise, with the same 401 as no session, as Neon's guide says
 * ("When the session changes"), so a seal, a renewal or a held poll from a
 * page left open under another account's session reads nothing of theirs.
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
      return yield* sealedParts(statements.value, input);
    }),
    tasks: signedIn.tasks.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const statements = taskListLiveStatements(context.userId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    taskBoard: signedIn.taskBoard.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* rowIdOf(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statement = boardLiveStatement(context.userId, taskId);
      if (Option.isNone(statement)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts({ board: statement.value }, input);
    }),
    taskRecord: signedIn.taskRecord.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* rowIdOf(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = taskRecordLiveStatements(context.userId, taskId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    taskPages: signedIn.taskPages.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* rowIdOf(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = taskPagesLiveStatements(context.userId, taskId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    taskHistory: signedIn.taskHistory.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* rowIdOf(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = taskHistoryLiveStatements(context.userId, taskId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    macCommands: signedIn.macCommands.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const statement = macCommandsLiveStatement(context.userId, macCommandKindsRead(input.kinds));
      if (Option.isNone(statement)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts({ commands: statement.value }, input);
    }),
    taskConversation: signedIn.taskConversation.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* rowIdOf(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = taskConversationLiveStatements(context.userId, taskId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
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
      return yield* sealedParts(statements.value, input);
    }),
    taskWorkerTranscript: signedIn.taskWorkerTranscript.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const callId = yield* callIdOf(input.call);
      const taskId = yield* rowIdOf(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task) || task.value.conversationId === undefined) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      }
      const parent = { userId: context.userId, conversationId: task.value.conversationId };
      const session = yield* hostedStoreOrUnavailable(brainWorkerSession(parent, callId));
      if (session === undefined) {
        // A call the planner's journal does not name yet may send more work to an earlier worker, so nothing is sealed until it names the worker the call reaches, and the reader asks again; once the planning has ended, none is none for good, as the page read says.
        const status = yield* hostedStoreOrUnavailable(brainStatusNow(parent));
        return yield* Effect.fail(
          status === CODING_AGENT_STATUS.RUNNING
            ? HOSTED_REFUSAL.UNAVAILABLE
            : HOSTED_REFUSAL.NOT_FOUND,
        );
      }
      const worker = {
        userId: context.userId,
        conversationId: childConversationId(parent.conversationId, session),
      };
      const statements = transcriptLiveStatements(
        worker,
        parent.conversationId,
        taskFollowedBy(taskId, context.userId),
      );
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    taskInbox: signedIn.taskInbox.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* rowIdOf(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = taskInboxLiveStatements(context.userId, taskId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    agentInbox: signedIn.agentInbox.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const agentId = yield* rowIdOf(input.id);
      const agent = yield* hostedStoreOrUnavailable(readCodingAgent(context.userId, agentId));
      if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = memberAgentInboxLiveStatements(context.userId, agent.value.id);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    workspaceChat: signedIn.workspaceChat.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const workspace = yield* workspaceOf(input.workspaceId);
      const reader = yield* chatAccount(context.userId);
      const self = yield* hostedStoreOrUnavailable(joinedMember(reader, workspace));
      if (Option.isNone(self)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = workspaceChatLiveStatements(reader, self.value);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
  };
}
