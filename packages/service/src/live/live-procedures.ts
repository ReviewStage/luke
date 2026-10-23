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
 * statement a part (`task-record-live.ts`), on the same terms. `GET
 * /api/live/task-browser-tabs?id=` answers its Browser tabs as one
 * statement, the agent's pointer on each among them, so a window draws the
 * pointer moving within a moment of the agent's action; a takeover is
 * delivered as it stands and lapsed by the reader, since no statement reads
 * the clock.
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
 * `GET /api/live/sidebar` answers the account's sidebar sections, the tasks
 * in them, and its pinned repositories as three.
 *
 * `GET /api/live/workspaces` answers the account's workspaces the same way,
 * as two statements: the workspaces, and the GitHub installations connected
 * to them. `GET /api/live/workspace-members?workspaceId=` answers one
 * workspace's people as two, its members and who its work names but left,
 * after the account is read as a member of it, so a workspace it is not in
 * is not found, as its held read answers.
 * `GET /api/live/workspace-invitations?workspaceId=` answers its pending
 * invitations as one, to an owner or an admin of it alone, with the origin
 * each accept link is built on, which the desktop needs since it builds the
 * links itself.
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
import type { DatabaseServices } from "@luke/database/core/query";
import { taskBrowserTabsLiveStatement } from "@luke/database/models/agent-browser-tabs";
import { ownFailedRunsLiveStatement, readAutomation } from "@luke/database/models/automation-store";
import { boardLiveStatement } from "@luke/database/models/board-store";
import { workspaceChatLiveStatements, workspaceChatStamp } from "@luke/database/models/chat-store";
import { readCodingAgent } from "@luke/database/models/coding-agent-store";
import { childConversationId } from "@luke/database/models/ids";
import { macCommandsLiveStatement } from "@luke/database/models/mac-command-store";
import { repositoryPinsLiveStatement } from "@luke/database/models/repository-pin-store";
import { taskSectionsLiveStatements } from "@luke/database/models/task-section-store";
import { readTask } from "@luke/database/models/task-store";
import {
  isWorkspaceMember,
  workspaceOf as workspaceOfAccount,
  workspacesLiveStatements,
} from "@luke/database/models/workspace-store";
import { codingAgentCallIdSchema } from "@luke/features/coding-agent-wire";
import {
  LIVE_POLL,
  LIVE_USER_QUERY,
  liveDigestOf,
  type SealedLiveQueryWire,
} from "@luke/features/live-wire";
import { macCommandKindsRead } from "@luke/features/mac-command-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { readEither } from "@luke/wire/effect";
import { Duration, Effect, Equal, Option, Ref, Result, Schedule } from "effect";
import { SqlClient } from "effect/sql";
import { workspaceInvitationsLiveStatement } from "../accounts/workspace-invitations.js";
import { workspaceMembersLiveStatements } from "../accounts/workspace-members.js";
import { reachedAgentById } from "../agents/agent-reach.js";
import { joinedMember } from "../agents/coder-host/chat-page.js";
import { agentFollowedBy, transcriptLiveStatements } from "../agents/coder-host/transcript-live.js";
import { chatAccount, workspaceOf } from "../agents/workspace-chat.js";
import {
  automationRunsLiveStatements,
  automationsLiveStatements,
} from "../automations/automation-live.js";
import { unparsedWire } from "../core.js";
import { heldUntil } from "../http/held-read.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import {
  accountInboxLiveStatements,
  memberAgentInboxLiveStatements,
  taskInboxLiveStatements,
} from "../inbox/inbox-store.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { taskHistoryLiveStatements } from "../tasks/task-history-live.js";
import { taskListLiveStatements } from "../tasks/task-list-live.js";
import { agentPagesLiveStatements, taskPagesLiveStatements } from "../tasks/task-pages-live.js";
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

/** How many of a read's parts are sealed or read at once: under the web pool's five connections, so one poll leaves room for the rest of its instance. */
const LIVE_PART_CONCURRENCY = 3;

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
  stamp?: Effect.Effect<Option.Option<string>, HostedRefusal, DatabaseServices>,
): Effect.fn.Return<
  {
    readonly url: string;
    readonly queries: Record<Part, Effect.Success<ReturnType<LiveSealer["seal"]>>>;
  },
  HostedRefusal,
  DatabaseServices
> {
  const all = (sealer: LiveSealer) =>
    Effect.map(
      Effect.forEach(
        Object.entries<LiveStatement>(statements),
        ([part, statement]) =>
          Effect.map(sealer.seal(statement), (sealed) => [part, sealed] as const),
        { concurrency: LIVE_PART_CONCURRENCY },
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
  const moved =
    stamp === undefined
      ? yield* heldUntil(
          polled,
          (read) => liveDigestOf(read.queries) !== after,
          LIVE_POLL_HOLD.LOOK,
          LIVE_POLL_HOLD.HOLD,
        )
      : yield* heldUntilStampMoved(polled, stamp, (read) => liveDigestOf(read.queries) !== after);
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

/**
 * A held poll that reads the statements once, then only the stamp each
 * look, and the statements again only where the stamp moved: answers the
 * first read `moved` says moved, or none at the hold's end.
 */
function heldUntilStampMoved<A, R>(
  read: Effect.Effect<A, HostedRefusal, R>,
  stamp: Effect.Effect<Option.Option<string>, HostedRefusal, DatabaseServices>,
  moved: (read: A) => boolean,
): Effect.Effect<Option.Option<A>, HostedRefusal, R | DatabaseServices> {
  return Effect.gen(function* () {
    const seen = yield* Ref.make(yield* stamp);
    const first = yield* read;
    if (moved(first)) return Option.some(first);
    const look = Effect.gen(function* () {
      const now = yield* stamp;
      // Note that a stamp that reads nothing, as for an account gone from the workspace, always reads again.
      if (Option.isSome(now) && Equal.equals(now, yield* Ref.getAndSet(seen, now))) {
        return Option.none<A>();
      }
      const again = yield* read;
      return moved(again) ? Option.some(again) : Option.none<A>();
    });
    return yield* look.pipe(
      Effect.repeat({ schedule: Schedule.spaced(LIVE_POLL_HOLD.LOOK), until: Option.isSome }),
    );
  }).pipe(Effect.timeoutOption(LIVE_POLL_HOLD.HOLD), Effect.map(Option.flatten));
}

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
/** The roles that read and manage a workspace's invitations, as its held read admits them. */
const MANAGING_ROLES: ReadonlySet<string> = new Set([WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN]);

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
    automations: signedIn.automations.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      if (input.workspaceId === "") return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      const statements = automationsLiveStatements(context.userId, input.workspaceId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    automationRuns: signedIn.automationRuns.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const automationId = yield* pathUuid(input.id);
      const automation = yield* hostedStoreOrUnavailable(
        readAutomation(context.userId, automationId),
      );
      if (Option.isNone(automation)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = automationRunsLiveStatements(context.userId, automationId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    taskBoard: signedIn.taskBoard.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statement = boardLiveStatement(context.userId, taskId);
      if (Option.isNone(statement)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts({ board: statement.value }, input);
    }),
    taskRecord: signedIn.taskRecord.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = taskRecordLiveStatements(context.userId, taskId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    taskPages: signedIn.taskPages.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = taskPagesLiveStatements(context.userId, taskId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    agentPages: signedIn.agentPages.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const agentId = yield* pathUuid(input.id);
      const agent = yield* hostedStoreOrUnavailable(readCodingAgent(context.userId, agentId));
      if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = agentPagesLiveStatements(context.userId, agentId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    taskHistory: signedIn.taskHistory.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = taskHistoryLiveStatements(context.userId, taskId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    taskBrowserTabs: signedIn.taskBrowserTabs.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statement = taskBrowserTabsLiveStatement(context.userId, taskId);
      if (Option.isNone(statement)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts({ tabs: statement.value }, input);
    }),
    macCommands: signedIn.macCommands.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const statement = macCommandsLiveStatement(context.userId, macCommandKindsRead(input.kinds));
      if (Option.isNone(statement)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts({ commands: statement.value }, input);
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
    taskInbox: signedIn.taskInbox.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = taskInboxLiveStatements(context.userId, taskId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    agentInbox: signedIn.agentInbox.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const agentId = yield* pathUuid(input.id);
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
      const stamp = hostedStoreOrUnavailable(workspaceChatStamp(reader, self.value));
      return yield* sealedParts(statements.value, input, stamp);
    }),
    sidebar: signedIn.sidebar.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const statements = Option.zipWith(
        taskSectionsLiveStatements(context.userId),
        repositoryPinsLiveStatement(context.userId),
        (sections, pins) => ({ ...sections, pins }),
      );
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    workspaces: signedIn.workspaces.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const statements = workspacesLiveStatements(context.userId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    workspaceMembers: signedIn.workspaceMembers.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const member = yield* hostedStoreOrUnavailable(
        isWorkspaceMember(context.userId, input.workspaceId),
      );
      if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = workspaceMembersLiveStatements(context.userId, input.workspaceId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    workspaceInvitations: signedIn.workspaceInvitations.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const workspace = yield* hostedStoreOrUnavailable(
        workspaceOfAccount(context.userId, input.workspaceId),
      );
      if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      if (!MANAGING_ROLES.has(workspace.value.role)) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      }
      const statement = workspaceInvitationsLiveStatement(context.userId, input.workspaceId);
      if (Option.isNone(statement)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      const sealed = yield* sealedParts({ invitations: statement.value }, input);
      return { ...sealed, origin: new URL(context.request.url).origin };
    }),
  };
}
