/**
 * live-procedures.ts -- the reads the desktop follows, each answered polled for the account the bearer names and held until its rows move.
 *
 * `GET /api/live/inbox` answers what waits on the developer across the
 * account as statements, one per part of the account inbox's answer, each
 * with its rows inline at the poll address (`live-wire.ts`). The caller is
 * resolved first, on the resource's implementer, and each statement is
 * built with that account's id in it, as its held read's is, so it reads
 * that account's rows and no other's. A read that names where its rows
 * last stood (`after`) is held until they move past it, each look reading
 * only the digests Postgres computes of them, or answered unchanged at the
 * hold's end, its digests and no rows, and the desktop asks again
 * (`sealedParts`). The hold looks again every 3 s, or every
 * second for a read someone watches move, or, for a read Luke Sync wakes
 * (`../sync/live-queries.ts`), whenever a write to its topics lands, and
 * then answers with that write's txid (`liveQueryParts`). The account's
 * inbox is one such read (`inboxLive`).
 *
 * `GET /api/live/tasks` answers the task list the same way: the tasks the
 * account reaches and every agent of them and with no task, as statements
 * built with the account's id (`task-list-live.ts`), woken by a write to
 * the account's topic or to one of its workspaces' (`tasksLive`).
 *
 * `GET /api/live/task-record?id=` answers one task's plan, pages, and calls
 * the same way, one statement a part that marks where it stands
 * (`task-record-live.ts`), after the task is read as the account, so one it
 * does not reach is not found, as its own read answers, woken by a write
 * that names the task (`taskRecordLive`), as its pages and its history are.
 * `GET /api/live/task-browser-tabs?id=` answers its Browser tabs as one
 * statement, the agent's pointer on each among them, woken by a write that
 * names the task, so a window draws the pointer moving within a moment of
 * the agent's action; a takeover is delivered as it stands and lapsed by
 * the reader, since no statement reads the clock.
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
 * to them, woken as the task list is (`workspacesLive`). `GET /api/live/workspace-members?workspaceId=` answers one
 * workspace's people as two, its members and who its work names but left,
 * after the account is read as a member of it, so a workspace it is not in
 * is not found, as its held read answers.
 * `GET /api/live/workspace-invitations?workspaceId=` answers its pending
 * invitations as one, to an owner or an admin of it alone, with the origin
 * each accept link is built on, which the desktop needs since it builds the
 * links itself. Both are woken by a write to the workspace's topic
 * (`workspaceMembersLive`, `workspaceInvitationsLive`).
 *
 * `GET /api/live/automations?workspaceId=` answers a workspace's automations
 * the account reads, each with its newest run, and
 * `GET /api/live/automation-workspace-runs?workspaceId=` their newest runs,
 * one statement each (`automation-live.ts`); `GET /api/live/automation-runs?id=`
 * answers one automation's newest runs, after the automation is read as the
 * account, so one it does not read is not found. Each is woken by a write
 * that names the automation's workspace (`automationsLive`,
 * `automationWorkspaceRunsLive`, `automationRunsLive`).
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
 * conversation the call will open rather than wait for it. It is woken by
 * Luke Sync (`agentTranscriptLive`), and a reader that names where it holds
 * the newest messages (`cursor`) is answered only those written or amended
 * past it (`liveCursorParts`). Its answers are measured
 * (`transcript-metrics.ts`).
 *
 * `GET /api/live/task-inbox?id=` and `GET /api/live/agent-inbox?id=` answer
 * one plan's inbox, or one agent's, the same way: its open items and its
 * latest settled ones as one statement, their threads and files as two
 * more, after the plan or the agent is read as the account, so one it does
 * not reach is not found, as its held read answers; each woken by Luke Sync
 * (`taskInboxLive`, `agentInboxLive`).
 *
 * `GET /api/live/inbox-items?since=` answers every inbox item the account
 * reaches as four statements: where each item stands, every open one and
 * every settled one changed in the last thirty days, and those changed since the
 * reader's `since` whole, with their threads and files, as a plan's inbox
 * carries them (`inbox-store.ts`'s `accountItemsLiveStatements`). Its poll
 * is held on where the items stand alone (`ACCOUNT_INBOX_ITEMS.HELD_ON`),
 * so a reader whose `since` moved to the items it was just answered is
 * held rather than answered again; woken by Luke Sync on the account's
 * topic (`inboxItemsLive`).
 */

import type { LiveStatement } from "@luke/database/core/live-statement";
import { readVisibleAgent } from "@luke/database/models/agent-store";
import { readAutomation } from "@luke/database/models/automation-store";
import { childConversationId } from "@luke/database/models/ids";
import { readTaskHeader } from "@luke/database/models/task-store";
import {
  isWorkspaceMember,
  workspaceOf as workspaceOfAccount,
} from "@luke/database/models/workspace-store";
import type { SyncTopic } from "@luke/database/sync/notification";
import { ACCOUNT_INBOX_REPOSITORYLESS } from "@luke/features/account-inbox-wire";
import { agentCallIdSchema, agentCursorSchema } from "@luke/features/agent-wire";
import {
  ACCOUNT_INBOX_ITEMS,
  LIVE_POLL,
  LIVE_USER_QUERY,
  liveDigestOf,
  liveDigestOn,
  type SealedLiveQueryWire,
} from "@luke/features/live-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Duration, Effect, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import { reachedAgentById } from "../agents/agent-reach.js";
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
  agentBrowserTabsLive,
  agentInboxLive,
  agentPagesLive,
  agentTranscriptLive,
  automationRunsLive,
  automationsLive,
  automationWorkspaceRunsLive,
  channelsLive,
  inboxItemsLive,
  inboxLive,
  macCommandsLive,
  sidebarLive,
  taskBrowserTabsLive,
  taskHistoryLive,
  taskInboxLive,
  taskPagesLive,
  taskRecordLive,
  tasksLive,
  workspaceInvitationsLive,
  workspaceMembersLive,
  workspacesLive,
} from "../sync/live-queries.js";
import type { LiveParams, LiveQuery } from "../sync/live-query.js";
import { NO_TOPICS } from "../sync/watch.js";
import { type LiveSealer, NO_ROWS_DIGEST, pollSealer } from "./poll-sealer.js";
import { countAnswerBytes, countAnswerWait } from "./transcript-metrics.js";

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
 * Note that the clock looks every 3 s, because each look runs every part's
 * statement whether or not a row moved, and a window holds a read for each
 * task its Inbox lists: at every second that was most of the database's
 * traffic. A look carries only each part's digest off the database
 * (`heldParts`), but the database still reads every row to compute it. A
 * read someone watches move, an agent's transcript, a Browser tab's pointer,
 * or the commands a Mac waits to claim, still looks every second
 * (`WATCHED_LOOK`).
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

/** A read's parts as answered: the address it was read at, and each part's digest, with its rows where they were read. */
interface ReadParts<Part extends string> {
  readonly url: string;
  readonly queries: Record<Part, SealedLiveQueryWire>;
}

/** Which of the sealer's reads answers a part: its digest alone, or its rows with it. */
type PartRead = (sealer: LiveSealer) => LiveSealer["seal"];

/** Each part read now at the poll address (`pollSealer`), as `how` reads it; unavailable where it could not be read. */
function readParts<Part extends string>(
  statements: Readonly<Record<Part, LiveStatement>>,
  how: PartRead,
): Effect.Effect<ReadParts<Part>, HostedRefusal, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (sql) => {
    const sealer = pollSealer(sql);
    const read = how(sealer);
    return Effect.map(
      Effect.forEach(
        Object.entries<LiveStatement>(statements),
        ([part, statement]) => Effect.map(read(statement), (sealed) => [part, sealed] as const),
        { concurrency: LIVE_PART_CONCURRENCY },
      ),
      (sealed) => ({
        url: sealer.url,
        // SAFETY: every part of `statements` is read above, and no other.
        queries: Object.fromEntries(sealed) as Record<Part, SealedLiveQueryWire>,
      }),
    );
  }).pipe(Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE));
}

/**
 * A read held until `moved` says its digests moved, looking between waits
 * on a watch of the topics (or, where none wakes it, the look) at its
 * digests alone (`looked`), so a hold over rows that never move carries
 * none of them off the database. Once they moved, its rows are read
 * (`read`) and answered with their own digests, and with the txids of the
 * writes that woke it, which is how the desktop confirms a write once the
 * read it follows shows it. At the hold's end it looks once more, and
 * answers that look, its digests and no rows, where nothing moved. Where a
 * notification woke it, `onWoken` is handed the instant the first write was
 * heard, once the rows are read.
 */
const heldParts = /* @__PURE__ */ Effect.fnUntraced(function* <Part extends string, R>(
  looked: Effect.Effect<ReadParts<Part>, HostedRefusal, R>,
  read: Effect.Effect<ReadParts<Part>, HostedRefusal, R>,
  moved: (standing: ReadParts<Part>) => boolean,
  topics: readonly SyncTopic[],
  look: Duration.Duration,
  onWoken?: (heardAt: number) => Effect.Effect<void>,
): Effect.fn.Return<ReadParts<Part>, HostedRefusal, R> {
  const woken = yield* heldUntil(looked, moved, topics, look, LIVE_POLL_HOLD.HOLD);
  if (Option.isSome(woken)) {
    // Note that the rows are read after the look that saw them move, so they are at least as new as it, and are answered with their own digests rather than its.
    const answer = yield* read;
    if (onWoken !== undefined && Option.isSome(woken.value.heardAt)) {
      yield* onWoken(woken.value.heardAt.value);
    }
    return { ...answer, queries: wokenBy(answer.queries, woken.value.txids) };
  }
  const standing = yield* looked;
  return moved(standing) ? yield* read : standing;
});

/** Where a read's rows stand as the reader's `after` names them: every part's digest, or, for a read held on some of its parts alone (`heldOn`), those parts'. */
function standingDigest<Part extends string>(
  queries: Record<Part, SealedLiveQueryWire>,
  heldOn: readonly Part[] | undefined,
) {
  return heldOn === undefined ? liveDigestOf(queries) : liveDigestOn(queries, heldOn);
}

/**
 * Each part's rows read inline at the poll address (`pollSealer`); where
 * the reader names where they last stood (`after`), held until they move
 * past it (`heldParts`), or, where it is held on some parts alone
 * (`heldOn`), until those move, so a part whose rows the reader's own query
 * narrows, such as the items changed since its `since`, answers no poll
 * that only narrowed it. Unavailable where the rows could not be read.
 */
const sealedParts = /* @__PURE__ */ Effect.fnUntraced(function* <Part extends string>(
  statements: Readonly<Record<Part, LiveStatement>>,
  asked: { readonly [LIVE_POLL.AFTER]?: string },
  topics: readonly SyncTopic[] = NO_TOPICS,
  look: Duration.Duration = LIVE_POLL_HOLD.LOOK,
  heldOn?: readonly Part[],
): Effect.fn.Return<ReadParts<Part>, HostedRefusal, SqlClient.SqlClient> {
  const read = readParts(statements, (sealer) => sealer.seal);
  const after = asked[LIVE_POLL.AFTER];
  if (after === undefined) return yield* read;
  return yield* heldParts(
    readParts(statements, (sealer) => sealer.digest),
    read,
    (standing) => standingDigest(standing.queries, heldOn) !== after,
    topics,
    look,
  );
});

/** The topics a defined live read's params name, or that it looks up from them; unavailable where the lookup fails. */
function topicsOf<Param extends string, Part extends string>(
  query: LiveQuery<Param, Part>,
  params: LiveParams<Param>,
) {
  const named = query.topics(params);
  return Effect.isEffect(named) ? hostedStoreOrUnavailable(named) : Effect.succeed(named);
}

/**
 * A defined live read's parts (`defineLiveQuery`), built from the params
 * its procedure bound once it admitted the caller, and held on a watch of
 * the topics those params name, or that the read looks up from them, which
 * looks again every `look` where nothing wakes it, on every part or on
 * those it is held on alone (`heldOn`, `sealedParts`). This is how a
 * procedure answers a read Luke Sync wakes; unavailable where its
 * statements can't be built or its topics looked up.
 */
const queryParts = /* @__PURE__ */ Effect.fnUntraced(function* <
  Param extends string,
  Part extends string,
>(
  query: LiveQuery<Param, Part>,
  params: LiveParams<Param>,
  asked: { readonly [LIVE_POLL.AFTER]?: string },
  look: Duration.Duration = LIVE_POLL_HOLD.LOOK,
  heldOn?: readonly NoInfer<Part>[],
) {
  const statements = query.statements(params);
  if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  // A read that names no `after` is answered at once, so it needs no topics to wait on.
  const held = asked[LIVE_POLL.AFTER] !== undefined;
  const topics = held ? yield* topicsOf(query, params) : NO_TOPICS;
  return yield* sealedParts(statements.value, asked, topics, look, heldOn);
});

/**
 * Whether a cursor read moved for its reader: its cursor no longer stands,
 * so its cursor parts are answered whole, a cursor part stands at a row past
 * it (its digest is not that of no rows, which a look at its digest alone
 * tells as its rows would), or its other parts moved past `after`.
 */
function cursorMoved<Part extends string>(read: ReadParts<Part>, after: string | undefined) {
  const pastCursor = Object.values<SealedLiveQueryWire>(read.queries).some(
    ({ cursor, digest }) =>
      cursor !== undefined && (cursor.past === undefined || digest !== NO_ROWS_DIGEST),
  );
  return pastCursor || liveDigestOf(read.queries) !== after;
}

/**
 * A defined live read's parts in cursor mode (`LIVE_MODE.CURSOR`) for a
 * reader that names where it holds them (`cursor`): where the read stands
 * is read first (`standing`), then its cursor parts past the reader's
 * cursor, or whole where a rewind left it behind, each carrying where it
 * stands and the cursor to read past next, and its other parts whole, as
 * a snapshot's are. Held until any of that moves (`cursorMoved`). A reader
 * that names no cursor, or a read with no cursor parts, is answered as a
 * snapshot is (`liveQueryParts`), which is how a released desktop reads it.
 * Unavailable where its statements can't be built or read. `onWoken` is
 * handed to the hold (`heldParts`), which a snapshot's answer does not take.
 */
const cursorParts = /* @__PURE__ */ Effect.fnUntraced(function* <
  Param extends string,
  Part extends string,
>(
  query: LiveQuery<Param, Part>,
  params: LiveParams<Param>,
  asked: { readonly [LIVE_POLL.AFTER]?: string; readonly [LIVE_POLL.CURSOR]?: string },
  look: Duration.Duration = LIVE_POLL_HOLD.LOOK,
  onWoken?: (heardAt: number) => Effect.Effect<void>,
) {
  const following = query.cursor;
  const cursor = asked[LIVE_POLL.CURSOR];
  if (following === undefined || cursor === undefined) {
    return yield* queryParts(query, params, asked, look);
  }
  const followed: ReadonlySet<string> = new Set(following.parts);
  const polled = (how: PartRead) =>
    Effect.gen(function* () {
      // Note that where it stands is read before its rows, so a write that lands between the two is read again past the next cursor rather than missed.
      const standing = yield* following
        .standing(params)
        .pipe(Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE));
      const past = standing.stands(cursor) ? cursor : undefined;
      const statements = query.statements(params, past);
      if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      const read = yield* readParts(statements.value, how);
      const at = { ...(past === undefined ? undefined : { past }), next: standing.next };
      return {
        ...read,
        // SAFETY: every part is kept, each cursor part with where it stands beside it.
        queries: Object.fromEntries(
          Object.entries<SealedLiveQueryWire>(read.queries).map(([part, sealed]) => [
            part,
            followed.has(part) ? { ...sealed, cursor: at } : sealed,
          ]),
        ) as Record<Part, SealedLiveQueryWire>,
      };
    });
  const read = polled((sealer) => sealer.seal);
  const after = asked[LIVE_POLL.AFTER];
  if (after === undefined) return yield* read;
  const topics = yield* topicsOf(query, params);
  return yield* heldParts(
    polled((sealer) => sealer.digest),
    read,
    (standing) => cursorMoved(standing, after),
    topics,
    look,
    onWoken,
  );
});

/**
 * A defined live read's parts, as `queryParts` and `cursorParts` read them,
 * under a span named for the read (`web/live/<name>`). Note that every
 * statement of the read, each look of its hold among them, runs under it,
 * because a look resumes after a wait on no request's span, and each
 * statement Sentry saw then was a trace of its own named for the database.
 */
export function liveQueryParts<Param extends string, Part extends string>(
  query: LiveQuery<Param, Part>,
  params: LiveParams<Param>,
  asked: { readonly [LIVE_POLL.AFTER]?: string },
  look?: Duration.Duration,
  heldOn?: readonly NoInfer<Part>[],
) {
  return queryParts(query, params, asked, look, heldOn).pipe(
    Effect.withSpan(`web/live/${query.name}`),
  );
}

/** A defined live read's parts in cursor mode, under the read's span as `liveQueryParts` runs one. */
export function liveCursorParts<Param extends string, Part extends string>(
  query: LiveQuery<Param, Part>,
  params: LiveParams<Param>,
  asked: { readonly [LIVE_POLL.AFTER]?: string; readonly [LIVE_POLL.CURSOR]?: string },
  look?: Duration.Duration,
  onWoken?: (heardAt: number) => Effect.Effect<void>,
) {
  return cursorParts(query, params, asked, look, onWoken).pipe(
    Effect.withSpan(`web/live/${query.name}`),
  );
}

/** The instant a reader holds every item changed since, as its query spells it in epoch milliseconds; none for every item, and one of any other shape refused. */
const sinceOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  since: string | undefined,
): Effect.fn.Return<string, HostedRefusal> {
  if (since === undefined) return "0";
  if (!/^\d{1,15}$/.test(since)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return since;
});

/** The delegation call a query named, where one is a call id; one of any other shape names no worker, and is not found. */
const callIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  call: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(agentCallIdSchema)(unparsedWire(call));
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
      return yield* liveQueryParts(
        inboxLive,
        { userId: context.userId, repositoryless: input[ACCOUNT_INBOX_REPOSITORYLESS.QUERY] ?? "" },
        input,
      );
    }),
    inboxItems: signedIn.inboxItems.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const since = yield* sinceOf(input[ACCOUNT_INBOX_ITEMS.SINCE]);
      const now = yield* Clock.currentTimeMillis;
      const settledSince = String(now - ACCOUNT_INBOX_ITEMS.SETTLED_WINDOW_MILLIS);
      return yield* liveQueryParts(
        inboxItemsLive,
        { userId: context.userId, since, settledSince },
        input,
        LIVE_POLL_HOLD.LOOK,
        ACCOUNT_INBOX_ITEMS.HELD_ON,
      );
    }),
    tasks: signedIn.tasks.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      return yield* liveQueryParts(tasksLive, { userId: context.userId }, input);
    }),
    automations: signedIn.automations.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      if (input.workspaceId === "") return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      return yield* liveQueryParts(
        automationsLive,
        { userId: context.userId, workspaceId: input.workspaceId },
        input,
      );
    }),
    automationWorkspaceRuns: signedIn.automationWorkspaceRuns.effect(function* ({
      input,
      context,
    }) {
      yield* sameUser(input, context.userId);
      if (input.workspaceId === "") return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      return yield* liveQueryParts(
        automationWorkspaceRunsLive,
        { userId: context.userId, workspaceId: input.workspaceId },
        input,
      );
    }),
    automationRuns: signedIn.automationRuns.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const automationId = yield* pathUuid(input.id);
      const automation = yield* hostedStoreOrUnavailable(
        readAutomation(context.userId, automationId),
      );
      if (Option.isNone(automation)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* liveQueryParts(
        automationRunsLive,
        {
          userId: context.userId,
          automationId,
          workspaceId: automation.value.organizationId,
        },
        input,
      );
    }),
    taskRecord: signedIn.taskRecord.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const task = yield* hostedStoreOrUnavailable(readTaskHeader(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* liveQueryParts(taskRecordLive, { userId: context.userId, taskId }, input);
    }),
    taskPages: signedIn.taskPages.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const task = yield* hostedStoreOrUnavailable(readTaskHeader(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* liveQueryParts(taskPagesLive, { userId: context.userId, taskId }, input);
    }),
    agentPages: signedIn.agentPages.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const agentId = yield* pathUuid(input.id);
      const agent = yield* hostedStoreOrUnavailable(readVisibleAgent(context.userId, agentId));
      if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* liveQueryParts(agentPagesLive, { userId: context.userId, agentId }, input);
    }),
    taskHistory: signedIn.taskHistory.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const task = yield* hostedStoreOrUnavailable(readTaskHeader(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* liveQueryParts(taskHistoryLive, { userId: context.userId, taskId }, input);
    }),
    taskBrowserTabs: signedIn.taskBrowserTabs.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const task = yield* hostedStoreOrUnavailable(readTaskHeader(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* liveQueryParts(
        taskBrowserTabsLive,
        { userId: context.userId, taskId },
        input,
        LIVE_POLL_HOLD.WATCHED_LOOK,
      );
    }),
    agentBrowserTabs: signedIn.agentBrowserTabs.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const agentId = yield* pathUuid(input.id);
      const agent = yield* hostedStoreOrUnavailable(readVisibleAgent(context.userId, agentId));
      if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* liveQueryParts(
        agentBrowserTabsLive,
        { userId: context.userId, agentId },
        input,
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
      const cursor = input[LIVE_POLL.CURSOR];
      if (
        cursor !== undefined &&
        Result.isFailure(readEither(agentCursorSchema)(unparsedWire(cursor)))
      ) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }
      const { agent, target } = yield* reachedAgentById(context.userId, input.id);
      const params = {
        ownerId: target.userId,
        conversationId:
          callId === undefined
            ? target.conversationId
            : childConversationId(target.conversationId, callId),
        parentConversationId: target.conversationId,
        agentId: agent.id,
        readerId: context.userId,
      };
      const answer = yield* liveCursorParts(
        agentTranscriptLive,
        params,
        input,
        LIVE_POLL_HOLD.WATCHED_LOOK,
        countAnswerWait,
      );
      yield* countAnswerBytes(answer.queries);
      return answer;
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
      const agent = yield* hostedStoreOrUnavailable(readVisibleAgent(context.userId, agentId));
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
      return yield* liveQueryParts(workspacesLive, { userId: context.userId }, input);
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
