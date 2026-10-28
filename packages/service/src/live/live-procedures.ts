/**
 * live-procedures.ts -- the reads the desktop follows, each answered polled for the account the bearer names and held until its rows move.
 *
 * `GET /api/live/inbox` answers what waits on the developer across the
 * account as statements, one per part of the account inbox's answer, each
 * with its rows inline at the poll address (`live-wire.ts`). The caller is
 * resolved first, on the resource's implementer, and each statement is
 * built with that account's id in it, as its held read's is, so it reads
 * that account's rows and no other's. A read that names where its rows
 * last stood (`after`) is held until they move past it, or answered
 * unchanged at the hold's end, its digests and no rows, and the desktop
 * asks again (`sealedParts`). The hold looks again every 3 s, or every
 * second for a read someone watches move, or, for a read Luke Sync wakes
 * (`../sync/live-queries.ts`), whenever a write to its topics lands, and
 * then answers with that write's txid (`liveQueryParts`). The account's
 * inbox is one such read (`inboxLive`).
 *
 * `GET /api/live/tasks` answers the task list the same way: the tasks the
 * account reaches and every agent of them and with no task, as two
 * statements built with the account's id (`task-list-live.ts`).
 *
 * `GET /api/live/task-record?id=` answers one task's plan, pages, and calls
 * the same way, one statement a part that marks where it stands
 * (`task-record-live.ts`), after the task is read as the account, so one it
 * does not reach is not found, as its own read answers. `GET
 * /api/live/task-browser-tabs?id=` answers its Browser tabs as one
 * statement, the agent's pointer on each among them, so a window draws the
 * pointer moving within a moment of the agent's action; a takeover is
 * delivered as it stands and lapsed by the reader, since no statement reads
 * the clock.
 *
 * `GET /api/live/mac-commands?kinds=` answers the commands of those kinds
 * no Mac of the account has claimed, as one statement, for the Mac to claim
 * each by its id (`../agents/mac-commands-procedures.ts`), woken by a write
 * to any command of the account (`macCommandsLive`).
 *
 * `GET /api/live/sidebar` answers the account's sidebar sections, the tasks
 * and agents in them, and its pinned repositories as four, woken by a write
 * to any of them (`sidebarLive`).
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
 * links itself. Both are woken by a write to the workspace's topic
 * (`workspaceMembersLive`, `workspaceInvitationsLive`).
 *
 * `GET /api/live/channels?workspaceId=` answers one workspace's channels as
 * two statements, its channels and where each one's threads stand
 * (`inbox-store.ts`'s `channelsLiveStatements`), after the account is read
 * as a member of it, so a workspace it is not in is not found, as its held
 * read answers; woken by Luke Sync (`channelsLive`).
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
 * not reach is not found, as its held read answers; each woken by Luke Sync
 * (`taskInboxLive`, `agentInboxLive`).
 */

import type { LiveStatement } from "@luke/database/core/live-statement";
import { taskBrowserTabsLiveStatement } from "@luke/database/models/agent-browser-tabs";
import { readAutomation } from "@luke/database/models/automation-store";
import { readCodingAgent } from "@luke/database/models/coding-agent-store";
import { childConversationId } from "@luke/database/models/ids";
import { readTaskHeader } from "@luke/database/models/task-store";
import {
  isWorkspaceMember,
  workspaceOf as workspaceOfAccount,
  workspacesLiveStatements,
} from "@luke/database/models/workspace-store";
import type { SyncTopic } from "@luke/database/sync/notification";
import { codingAgentCallIdSchema } from "@luke/features/coding-agent-wire";
import {
  LIVE_POLL,
  LIVE_USER_QUERY,
  liveDigestOf,
  type SealedLiveQueryWire,
} from "@luke/features/live-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { readEither } from "@luke/wire/effect";
import { Duration, Effect, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import { reachedAgentById } from "../agents/agent-reach.js";
import { agentFollowedBy, transcriptLiveStatements } from "../agents/coder-host/transcript-live.js";
import {
  automationRunsLiveStatements,
  automationsLiveStatements,
  automationWorkspaceRunsLiveStatements,
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
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  agentInboxLive,
  channelsLive,
  inboxLive,
  macCommandsLive,
  sidebarLive,
  taskInboxLive,
  workspaceInvitationsLive,
  workspaceMembersLive,
} from "../sync/live-queries.js";
import type { LiveParams, LiveQuery } from "../sync/live-query.js";
import { NO_TOPICS } from "../sync/watch.js";
import { taskHistoryLiveStatements } from "../tasks/task-history-live.js";
import { taskListLiveStatements } from "../tasks/task-list-live.js";
import { agentPagesLiveStatements, taskPagesLiveStatements } from "../tasks/task-pages-live.js";
import { taskRecordLiveStatements } from "../tasks/task-record-live.js";
import { type LiveSealer, pollSealer } from "./poll-sealer.js";

export interface LiveProcedureSeams {
  resolveUserId: UserIdResolver;
}

/**
 * How a poll past the reader's digest is held: looked at again each time a
 * write to its rows wakes it where it has a definition (`LIVE_QUERIES`),
 * and on a clock where it has none or nothing wakes it, and answered
 * unchanged after 25, well inside a function's limit and the client's held
 * deadline.
 *
 * Note that the clock looks every 3 s, because each look reads every row of
 * the read back from the database whether or not one moved, and a window
 * holds a read for each task its Inbox lists: at every second that was most
 * of the database's traffic. A read someone watches move, an agent's
 * transcript, a Browser tab's pointer, or the commands a Mac waits to claim,
 * still looks every second (`WATCHED_LOOK`).
 */
const LIVE_POLL_HOLD = {
  LOOK: Duration.seconds(3),
  WATCHED_LOOK: Duration.seconds(1),
  HOLD: Duration.seconds(25),
} as const;

/** How many of a read's parts are read at once: under the web pool's five connections, so one poll leaves room for the rest of its instance. */
const LIVE_PART_CONCURRENCY = 3;

/** Each part as it was read, carrying the ids of the transactions whose writes woke the hold that answered it, where any did. */
function wokenBy<Part extends string>(
  queries: Record<Part, SealedLiveQueryWire>,
  txids: readonly string[],
): Record<Part, SealedLiveQueryWire> {
  if (txids.length === 0) return queries;
  // SAFETY: every part is kept, each with the txids beside it.
  return Object.fromEntries(
    Object.entries<SealedLiveQueryWire>(queries).map(([part, sealed]) => [
      part,
      { ...sealed, txids },
    ]),
  ) as Record<Part, SealedLiveQueryWire>;
}

/**
 * Each part's rows read inline at the poll address (`pollSealer`); where
 * the reader names where they last stood (`after`), held until they move
 * past it, waiting between looks on a watch of the topics (or, where none
 * wakes it, the look), or answered unchanged at the hold's end. An answer a
 * write woke carries that write's txid, which is how the desktop confirms a
 * write once the read it follows shows it. Unavailable where the rows could
 * not be read.
 */
const sealedParts = /* @__PURE__ */ Effect.fnUntraced(function* <Part extends string>(
  statements: Readonly<Record<Part, LiveStatement>>,
  asked: { readonly [LIVE_POLL.AFTER]?: string },
  topics: readonly SyncTopic[] = NO_TOPICS,
  look: Duration.Duration = LIVE_POLL_HOLD.LOOK,
): Effect.fn.Return<
  {
    readonly url: string;
    readonly queries: Record<Part, Effect.Success<ReturnType<LiveSealer["seal"]>>>;
  },
  HostedRefusal,
  SqlClient.SqlClient
> {
  const polled = Effect.flatMap(SqlClient.SqlClient, (sql) => {
    const sealer = pollSealer(sql);
    return Effect.map(
      Effect.forEach(
        Object.entries<LiveStatement>(statements),
        ([part, statement]) =>
          Effect.map(sealer.seal(statement), (sealed) => [part, sealed] as const),
        { concurrency: LIVE_PART_CONCURRENCY },
      ),
      (sealed) => ({
        url: sealer.url,
        // SAFETY: every part of `statements` is read above, and no other.
        queries: Object.fromEntries(sealed) as Record<
          Part,
          Effect.Success<ReturnType<LiveSealer["seal"]>>
        >,
      }),
    );
  }).pipe(Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE));
  const after = asked[LIVE_POLL.AFTER];
  if (after === undefined) return yield* polled;
  // A poll past `after` is held until the rows move past it, or answered unchanged: its digests and no rows.
  const moved = yield* heldUntil(
    polled,
    (read) => liveDigestOf(read.queries) !== after,
    topics,
    look,
    LIVE_POLL_HOLD.HOLD,
  );
  if (Option.isSome(moved)) {
    const { read, txids } = moved.value;
    return { ...read, queries: wokenBy(read.queries, txids) };
  }
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
 * A defined live read's parts (`defineLiveQuery`), built from the params
 * its procedure bound once it admitted the caller, and held on a watch of
 * the topics those params name, which looks again every `look` where
 * nothing wakes it. This is how a procedure answers a read Luke Sync wakes;
 * unavailable where its statements can't be built.
 */
export const liveQueryParts = /* @__PURE__ */ Effect.fnUntraced(function* <
  Param extends string,
  Part extends string,
>(
  query: LiveQuery<Param, Part>,
  params: LiveParams<Param>,
  asked: { readonly [LIVE_POLL.AFTER]?: string },
  look: Duration.Duration = LIVE_POLL_HOLD.LOOK,
) {
  const statements = query.statements(params);
  if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  return yield* sealedParts(statements.value, asked, query.topics(params), look);
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
 * out otherwise, with the same 401 as no session, so a read or a held poll
 * from a page left open under another account's session reads nothing of
 * theirs.
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
      return yield* liveQueryParts(inboxLive, { userId: context.userId }, input);
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
    automationWorkspaceRuns: signedIn.automationWorkspaceRuns.effect(function* ({
      input,
      context,
    }) {
      yield* sameUser(input, context.userId);
      if (input.workspaceId === "") return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      const statements = automationWorkspaceRunsLiveStatements(context.userId, input.workspaceId);
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
    taskRecord: signedIn.taskRecord.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const task = yield* hostedStoreOrUnavailable(readTaskHeader(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = taskRecordLiveStatements(context.userId, taskId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    taskPages: signedIn.taskPages.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const task = yield* hostedStoreOrUnavailable(readTaskHeader(context.userId, taskId));
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
      const task = yield* hostedStoreOrUnavailable(readTaskHeader(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statements = taskHistoryLiveStatements(context.userId, taskId);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(statements.value, input);
    }),
    taskBrowserTabs: signedIn.taskBrowserTabs.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const task = yield* hostedStoreOrUnavailable(readTaskHeader(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const statement = taskBrowserTabsLiveStatement(context.userId, taskId);
      if (Option.isNone(statement)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      return yield* sealedParts(
        { tabs: statement.value },
        input,
        NO_TOPICS,
        LIVE_POLL_HOLD.WATCHED_LOOK,
      );
    }),
    macCommands: signedIn.macCommands.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      return yield* liveQueryParts(
        macCommandsLive,
        { userId: context.userId, kinds: input.kinds ?? "" },
        input,
        LIVE_POLL_HOLD.WATCHED_LOOK,
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
      return yield* sealedParts(statements.value, input, NO_TOPICS, LIVE_POLL_HOLD.WATCHED_LOOK);
    }),
    taskInbox: signedIn.taskInbox.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const task = yield* hostedStoreOrUnavailable(readTaskHeader(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* liveQueryParts(taskInboxLive, { userId: context.userId, taskId }, input);
    }),
    agentInbox: signedIn.agentInbox.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const agentId = yield* pathUuid(input.id);
      const agent = yield* hostedStoreOrUnavailable(readCodingAgent(context.userId, agentId));
      if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* liveQueryParts(
        agentInboxLive,
        { userId: context.userId, agentId: agent.value.id },
        input,
      );
    }),
    sidebar: signedIn.sidebar.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      return yield* liveQueryParts(sidebarLive, { userId: context.userId }, input);
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
      return yield* liveQueryParts(
        workspaceMembersLive,
        { userId: context.userId, workspaceId: input.workspaceId },
        input,
      );
    }),
    channels: signedIn.channels.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const member = yield* hostedStoreOrUnavailable(
        isWorkspaceMember(context.userId, input.workspaceId),
      );
      if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* liveQueryParts(
        channelsLive,
        { userId: context.userId, workspaceId: input.workspaceId },
        input,
      );
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
      const sealed = yield* liveQueryParts(
        workspaceInvitationsLive,
        { userId: context.userId, workspaceId: input.workspaceId },
        input,
      );
      return { ...sealed, origin: new URL(context.request.url).origin };
    }),
  };
}
