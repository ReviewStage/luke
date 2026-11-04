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
 * second for a read someone watches move, or, for a read Sync wakes
 * (`../sync/live-queries.ts`), whenever a write to its topics lands, and
 * then answers with that write's txid (`liveQueryParts`). The account's
 * inbox is one such read (`inboxLive`).
 *
 * `GET /api/live/tasks` answers the task list the same way: the tasks the
 * account reaches and every agent of them and with no task, as statements
 * built with the account's id (`task-list-live.ts`), woken by a write to
 * the account's topic or to one of its workspaces' (`tasksLive`). Asked
 * with `&sync=`, it is answered in delta mode (`liveDeltaParts`): the rows
 * that moved past the reader's sync id alone, with the ids of those that
 * stand no longer for it and the sync id to ask past next, held until
 * something moves; or whole, with that sync id, to a reader that names
 * none, is too far behind, or whose admission to the rows moved.
 *
 * `GET /api/live/task-record?id=` answers one task's plan, pages, and calls
 * the same way, one statement a part that marks where it stands
 * (`task-record-live.ts`), after the task is read as the account, so one it
 * does not reach is not found, as its own read answers, woken by a write
 * that names the task (`taskRecordLive`), as its pages and its history are.
 * `GET /api/live/task-comments?id=` answers its plan's own comment threads,
 * or with `&page=` one page's on every version, as three statements, the
 * threads, their entries, and the files their comments carry
 * (`plan-comments-live.ts`), the same way and woken the same way
 * (`taskCommentsLive`).
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
 * `GET /api/live/workspace-memories?workspaceId=` answers its memories as
 * one, each with its keeper's name and whether the reader may forget it,
 * after the account is read as a member of it, so a workspace it is not in
 * is not found; woken by a memory kept, corrected, or forgotten, and by the
 * reader's own membership moving (`workspaceMemoriesLive`).
 * `GET /api/live/hosts` answers the account's hosts as one, with the install
 * script's address on the origin the request reached; woken by a host
 * enrolled, approved, renamed, removed, or moving through an update
 * (`hostsLive`).
 * `GET /api/live/installed-skills?workspaceId=` answers the skills the
 * account sees there, the workspace's and its own, each with whether it may
 * manage it, on the same membership check; woken by one of them installed,
 * changed, shared, or removed, and by the reader's membership moving
 * (`installedSkillsLive`).
 * `GET /api/live/workspace-integrations?workspaceId=` answers its active
 * Sentry installations, its Slack bot, and each Slack channel's repository
 * as three, to a member of it, so a workspace it is not in is not found,
 * with whether this deployment holds each integration beside them, which no
 * statement reads; woken by an install, a disconnect, Sentry's uninstall, a
 * repository named, and the reader's own membership moving
 * (`workspaceIntegrationsLive`).
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
 * `GET /api/live/agent-transcript?id=` answers what one coding agent's
 * transcript is read from, or one of its workers' with `&call=` naming the
 * delegation call (`transcript-live.ts`), after the agent is read as the
 * account, each statement joined through the caller's membership of the
 * agent's workspace. A worker's delegation may not be recorded yet, as a
 * tab opened on its call is read before it is, so its statements name the
 * conversation the call will open rather than wait for it. It is woken by
 * Sync (`agentTranscriptLive`), and a reader that names where it holds
 * the newest messages (`cursor`) is answered only those written or amended
 * past it (`liveCursorParts`). Its answers are measured
 * (`transcript-metrics.ts`).
 * `GET /api/live/agent-origin?id=` answers the run of an automation that
 * started one coding agent as one statement (`agent-origin-live.ts`), after
 * the agent is read as the account, so one it does not reach is not found,
 * woken by the agent's own row (`agentOriginLive`).
 *
 * `GET /api/live/task-inbox?id=` and `GET /api/live/agent-inbox?id=` answer
 * one plan's inbox, or one agent's, the same way: its open items and its
 * latest settled ones as one statement, their threads and files as two
 * more, after the plan or the agent is read as the account, so one it does
 * not reach is not found, as its held read answers; each woken by Sync
 * (`taskInboxLive`, `agentInboxLive`).
 *
 * `GET /api/live/inbox-items?since=` answers every inbox item the account
 * reaches as four statements: where each item stands, every open one and
 * every settled one changed in the last thirty days, and those changed since the
 * reader's `since` whole, with their threads and files, as a plan's inbox
 * carries them (`inbox-store.ts`'s `accountItemsLiveStatements`). Its poll
 * is held on where the items stand alone (`ACCOUNT_INBOX_ITEMS.HELD_ON`),
 * so a reader whose `since` moved to the items it was just answered is
 * held rather than answered again; woken by Sync on the account's
 * topic (`inboxItemsLive`).
 *
 * `GET /api/live/pull-request-chapters?id=&number=` answers one coding
 * agent's pull request's newest chapters as one statement, after the agent
 * is read as the account and a token minted for its repository confirms its
 * workspace still reaches it, as the agent's own read of them admits a
 * reader (`agentChaptersAdmission`), so an agent it does not reach is not
 * found; with whether the reader can generate them on a key of their own
 * beside it, which no statement can read. It is woken by a claim, finish,
 * or failure in the agent's workspace (`pullRequestChaptersLive`), so
 * another member's Generate reaches an open view without a Refresh.
 *
 * `GET /api/live/integration-statuses` answers every integration row the
 * account holds, each where it stands as stored, a sign-in counted under
 * way within its window from the instant the read is answered, with the
 * providers the deployment offers the account and those that take several
 * accounts beside them, which no statement can read. It is woken by a
 * sign-in begun, completed, or ended, a label, an expiry, or a disconnect
 * (`integrationStatusesLive`), so a sign-in finished in the browser reaches
 * an open view with no focus. GitHub's standing is
 * `/api/account/integrations/github`'s, read beside it.
 *
 * `GET /api/live/account-preferences` answers the account's preferences row
 * as one statement, its default agent, chapters model, and Slack
 * notifications as stored, none for an account that stored nothing, woken
 * by a write to any of them or to another column a view reads
 * (`accountPreferencesLive`), so a default chosen on another device reaches
 * an open window within one coalesce window.
 */

import type { LiveStatement } from "@repo/database/core/live-statement";
import type { DatabaseServices } from "@repo/database/core/query";
import { readVisibleAgent } from "@repo/database/models/agent-store";
import { readAutomation } from "@repo/database/models/automation-store";
import { childConversationId } from "@repo/database/models/ids";
import { readSyncWindow, SYNC_LOG, syncStanding } from "@repo/database/models/sync-log";
import { readTaskHeader } from "@repo/database/models/task-store";
import {
  isWorkspaceMember,
  workspaceOf as workspaceOfAccount,
} from "@repo/database/models/workspace-store";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { ACCOUNT_INBOX_REPOSITORYLESS } from "@repo/features/account-inbox-wire";
import { agentCallIdSchema, agentCursorSchema } from "@repo/features/agent-wire";
import { INTEGRATION_PROVIDER_LIST } from "@repo/features/integration-wire";
import {
  ACCOUNT_INBOX_ITEMS,
  LIVE_POLL,
  LIVE_USER_QUERY,
  liveDigestOf,
  liveDigestOn,
  type SealedLiveQueryWire,
} from "@repo/features/live-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { readEither } from "@repo/wire/effect";
import { Clock, Duration, Effect, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import { reachedAgentById } from "../agents/agent-reach.js";
import { pullRequestNumberOf } from "../agents/asked-pull-request.js";
import { installScriptUrlOf } from "../agents/hosts-procedures.js";
import { agentChaptersAdmission } from "../chapters/pull-request-chapters-procedures.js";
import { unparsedWire } from "../core.js";
import { heldUntil } from "../http/held-read.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountIntegrationConnect } from "../integrations/integration-connect.js";
import { signInIssuedSince } from "../integrations/integrations-app.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { SlackBot } from "../slack/slack-bot.js";
import {
  accountPreferencesLive,
  agentBrowserTabsLive,
  agentInboxLive,
  agentOriginLive,
  agentPagesLive,
  agentTranscriptLive,
  automationRunsLive,
  automationsLive,
  automationWorkspaceRunsLive,
  hostsLive,
  inboxItemsLive,
  inboxLive,
  installedSkillsLive,
  integrationStatusesLive,
  macCommandsLive,
  PLAN_THREADS,
  pullRequestChaptersLive,
  sidebarLive,
  taskBrowserTabsLive,
  taskCommentsLive,
  taskHistoryLive,
  taskInboxLive,
  taskPagesLive,
  taskRecordLive,
  tasksLive,
  workspaceIntegrationsLive,
  workspaceInvitationsLive,
  workspaceMembersLive,
  workspaceMemoriesLive,
  workspacesLive,
} from "../sync/live-queries.js";
import {
  type LiveParams,
  type LiveQuery,
  type LiveTopics,
  ownMovedKeys,
  syncMovedOf,
} from "../sync/live-query.js";
import { NO_TOPICS } from "../sync/watch.js";
import { SentryApp } from "../triggers/sentry/sentry-app-config.js";
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

/**
 * The account inbox's parts a released desktop (v0.22.0) keeps of its
 * answer, whose decode strips `agents`, so the `after` it sends is the
 * digest over these alone, which never equals the digest over every part.
 * Its poll is held on these too, or it is answered at once and asks again
 * every 0.6 s; a reader that keeps every part sends a digest over six,
 * which never equals the one over these, so it is still held on all.
 */
const INBOX_RELEASED_PARTS = ["items", "planless", "plans", "automations", "failedRuns"] as const;

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
 * that only narrowed it. Where an older reader keeps fewer parts than the
 * read answers (`olderParts`), the poll is answered only where the rows
 * moved past `after` over those parts as well, so a reader that sends
 * their digest is held as one that sends every part's. Unavailable where
 * the rows could not be read.
 */
const sealedParts = /* @__PURE__ */ Effect.fnUntraced(function* <Part extends string>(
  statements: Readonly<Record<Part, LiveStatement>>,
  asked: { readonly [LIVE_POLL.AFTER]?: string },
  topics: readonly SyncTopic[] = NO_TOPICS,
  look: Duration.Duration = LIVE_POLL_HOLD.LOOK,
  heldOn?: readonly Part[],
  olderParts?: readonly Part[],
): Effect.fn.Return<ReadParts<Part>, HostedRefusal, SqlClient.SqlClient> {
  const read = readParts(statements, (sealer) => sealer.seal);
  const after = asked[LIVE_POLL.AFTER];
  if (after === undefined) return yield* read;
  return yield* heldParts(
    readParts(statements, (sealer) => sealer.digest),
    read,
    (standing) =>
      standingDigest(standing.queries, heldOn) !== after &&
      (olderParts === undefined || liveDigestOn(standing.queries, olderParts) !== after),
    topics,
    look,
  );
});

/** Topics named outright, or looked up; unavailable where the lookup fails. */
function topicsNamed(named: LiveTopics) {
  return Effect.isEffect(named) ? hostedStoreOrUnavailable(named) : Effect.succeed(named);
}

/** The topics a defined live read's params name, or that it looks up from them; unavailable where the lookup fails. */
function topicsOf<Param extends string, Part extends string>(
  query: LiveQuery<Param, Part>,
  params: LiveParams<Param>,
) {
  return topicsNamed(query.topics(params));
}

/**
 * A defined live read's parts (`defineLiveQuery`), built from the params
 * its procedure bound once it admitted the caller, and held on a watch of
 * the topics those params name, or that the read looks up from them, which
 * looks again every `look` where nothing wakes it, on every part or on
 * those it is held on alone (`heldOn`), and for an older reader on the
 * parts it keeps (`olderParts`, `sealedParts`). This is how a
 * procedure answers a read Sync wakes; unavailable where its
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
  olderParts?: readonly NoInfer<Part>[],
) {
  const statements = query.statements(params);
  if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  // A read that names no `after` is answered at once, so it needs no topics to wait on.
  const held = asked[LIVE_POLL.AFTER] !== undefined;
  const topics = held ? yield* topicsOf(query, params) : NO_TOPICS;
  return yield* sealedParts(statements.value, asked, topics, look, heldOn, olderParts);
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
  olderParts?: readonly NoInfer<Part>[],
) {
  return queryParts(query, params, asked, look, heldOn, olderParts).pipe(
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

/** A sync id a reader holds every row at, as its query spells it; absent where it names none yet, and one of any other shape refused. */
const syncIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  sync: string,
): Effect.fn.Return<number | undefined, HostedRefusal> {
  if (sync === "") return undefined;
  const id = Number(sync);
  if (!/^\d{1,16}$/.test(sync) || !Number.isSafeInteger(id)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return id;
});

/** Where a delta read stands for its reader: the settled id, the log's window past the reader's id up to it, and whether the reader is answered whole. */
interface DeltaStanding {
  readonly settled: number;
  readonly window: Effect.Success<ReturnType<typeof readSyncWindow>>;
  readonly whole: boolean;
}

/** Each part as read, carrying where it stands for a reader that follows it by sync id, and, past one, the ids gone from it, the snapshot left out. */
function syncedParts<Part extends string>(
  queries: Record<Part, SealedLiveQueryWire>,
  sync: { readonly past?: string; readonly next: string },
  gone: ReadonlyMap<Part, readonly string[]>,
): Record<Part, SealedLiveQueryWire> {
  // SAFETY: every part is kept, each with where it stands beside it.
  return Object.fromEntries(
    Object.entries<SealedLiveQueryWire>(queries).map(([part, sealed]) => {
      if (sync.past === undefined) return [part, { ...sealed, sync }];
      // Note that a delta's rows are read at a snapshot past the settled id, which shows writes past it that no delta carries yet, so a writer confirms by `next` and the txids instead.
      const { snapshot: _snapshot, ...delta } = sealed;
      const ofPart = gone.get(part as Part) ?? [];
      return [part, { ...delta, sync, ...(ofPart.length === 0 ? {} : { gone: ofPart }) }];
    }),
  ) as Record<Part, SealedLiveQueryWire>;
}

/** The ids of a part's rows as read, which every delta part answers its key under. */
function rowIds(sealed: SealedLiveQueryWire): ReadonlySet<string> {
  return new Set(
    (sealed.rows ?? []).flatMap((row) => {
      const id = typeof row === "object" && row !== null ? (row as { id?: unknown }).id : undefined;
      return id === undefined ? [] : [String(id)];
    }),
  );
}

/**
 * A defined live read's parts in delta mode (`delta`), for a reader that
 * names the sync id it holds every row at. Each look reads the settled id
 * (`syncStanding`) and then the log's window from the reader's id up to it
 * (`readSyncWindow`), the rows the read's topics reach or that it takes
 * whatever they name, and the read is held, looking every second and on a
 * watch of its topics, until the window holds a row. Note that a look
 * reads the log alone, so it is cheap at a second, and that a wake can come
 * before the settled id passes its write, which the next look then carries.
 *
 * It is answered whole, each part with the settled id to ask past next, to
 * a reader that names no id, whose id is below the oldest the log kept or
 * past the settled one, that is more than `SYNC_LOG.MOST` rows behind, or
 * whose admission to the rows moved (a `whole` table's row naming its
 * account). Otherwise each part is its statement narrowed to what moved,
 * with the ids it was read past and is to read past next, the ids of its own
 * rows a write the reader's topics reach moved that the narrowed read no
 * longer finds (`gone`), and the txids of the writes it carries. At the
 * hold's end it looks once more and answers that look, its parts empty
 * where nothing moved. Unavailable where its statements can't be built or
 * the log read.
 */
const deltaParts = /* @__PURE__ */ Effect.fnUntraced(function* <
  Param extends string,
  Part extends string,
>(query: LiveQuery<Param, Part>, params: LiveParams<Param>, sync: string) {
  const delta = query.delta;
  if (delta === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const past = yield* syncIdOf(sync);
  const topics = yield* topicsOf(query, params);
  const reached = delta.reach === undefined ? topics : yield* topicsNamed(delta.reach(params));
  const accounts = new Set(reached.flatMap(([kind, id]) => (kind === TOPIC.ACCOUNT ? [id] : [])));
  const whole = new Set(delta.whole.map((table) => table.name));
  const looked: Effect.Effect<DeltaStanding, HostedRefusal, DatabaseServices> =
    hostedStoreOrUnavailable(
      Effect.gen(function* () {
        const { settled } = yield* syncStanding();
        const window = yield* readSyncWindow({
          past: past ?? settled,
          settled,
          tables: query.reads.map((table) => table.name),
          anyTopic: delta.anyTopic.map((table) => table.name),
          topics: reached,
        });
        const admissionMoved = window.rows.some(
          (row) =>
            row.reached &&
            whole.has(row.table) &&
            row.topics.some(([kind, id]) => kind === TOPIC.ACCOUNT && accounts.has(id)),
        );
        const behind =
          past === undefined ||
          past > settled ||
          (window.floor !== undefined && past < window.floor) ||
          window.rows.length > SYNC_LOG.MOST;
        return { settled, window, whole: behind || admissionMoved };
      }),
    );
  const moved = (standing: DeltaStanding) => standing.whole || standing.window.rows.length > 0;
  const held =
    past === undefined
      ? Option.none()
      : yield* heldUntil(looked, moved, topics, LIVE_POLL_HOLD.WATCHED_LOOK, LIVE_POLL_HOLD.HOLD);
  const standing = Option.isSome(held) ? held.value.read : yield* looked;
  const next = String(standing.settled);
  if (standing.whole) {
    const statements = query.statements(params);
    if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    const read = yield* readParts(statements.value, (sealer) => sealer.seal);
    return { ...read, queries: syncedParts(read.queries, { next }, new Map()) };
  }
  const statements = delta.statements(params, syncMovedOf(standing.window.rows));
  if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const read = yield* readParts(statements.value, (sealer) => sealer.seal);
  const gone = new Map<Part, readonly string[]>();
  for (const [part, keys] of ownMovedKeys(delta.own, standing.window.rows)) {
    const found = rowIds(read.queries[part]);
    gone.set(part, [...keys].filter((key) => !found.has(key)).toSorted());
  }
  const queries = syncedParts(read.queries, { past: String(past), next }, gone);
  return { ...read, queries: wokenBy(queries, standing.window.txids) };
});

/** A defined live read's parts in delta mode, under the read's span as `liveQueryParts` runs one. */
export function liveDeltaParts<Param extends string, Part extends string>(
  query: LiveQuery<Param, Part>,
  params: LiveParams<Param>,
  sync: string,
) {
  return deltaParts(query, params, sync).pipe(Effect.withSpan(`web/live/${query.name}`));
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
        LIVE_POLL_HOLD.LOOK,
        undefined,
        INBOX_RELEASED_PARTS,
      );
    }),
    inboxItems: signedIn.inboxItems.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const since = yield* sinceOf(input[ACCOUNT_INBOX_ITEMS.SINCE]);
      const now = yield* Clock.currentTimeMillis;
      const settledSince = String(now - ACCOUNT_INBOX_ITEMS.SETTLED_WINDOW_MILLIS);
      const params = { userId: context.userId, since, settledSince };
      const sync = input[LIVE_POLL.SYNC];
      return yield* sync === undefined
        ? liveQueryParts(
            inboxItemsLive,
            params,
            input,
            LIVE_POLL_HOLD.LOOK,
            ACCOUNT_INBOX_ITEMS.HELD_ON,
          )
        : liveDeltaParts(inboxItemsLive, params, sync);
    }),
    tasks: signedIn.tasks.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const sync = input[LIVE_POLL.SYNC];
      return yield* sync === undefined
        ? liveQueryParts(tasksLive, { userId: context.userId }, input)
        : liveDeltaParts(tasksLive, { userId: context.userId }, sync);
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
    agentOrigin: signedIn.agentOrigin.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const agentId = yield* pathUuid(input.id);
      const agent = yield* hostedStoreOrUnavailable(readVisibleAgent(context.userId, agentId));
      if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* liveQueryParts(agentOriginLive, { userId: context.userId, agentId }, input);
    }),
    taskHistory: signedIn.taskHistory.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const task = yield* hostedStoreOrUnavailable(readTaskHeader(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* liveQueryParts(taskHistoryLive, { userId: context.userId, taskId }, input);
    }),
    taskComments: signedIn.taskComments.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const taskId = yield* pathUuid(input.id);
      const pageId = input.page === undefined ? PLAN_THREADS : yield* pathUuid(input.page);
      const task = yield* hostedStoreOrUnavailable(readTaskHeader(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* liveQueryParts(
        taskCommentsLive,
        { userId: context.userId, taskId, pageId },
        input,
      );
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
    hosts: signedIn.hosts.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const sealed = yield* liveQueryParts(hostsLive, { userId: context.userId }, input);
      return { ...sealed, installScriptUrl: installScriptUrlOf(context.request) };
    }),
    workspaceMemories: signedIn.workspaceMemories.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const member = yield* hostedStoreOrUnavailable(
        isWorkspaceMember(context.userId, input.workspaceId),
      );
      if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* liveQueryParts(
        workspaceMemoriesLive,
        { userId: context.userId, workspaceId: input.workspaceId },
        input,
      );
    }),
    installedSkills: signedIn.installedSkills.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const member = yield* hostedStoreOrUnavailable(
        isWorkspaceMember(context.userId, input.workspaceId),
      );
      if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* liveQueryParts(
        installedSkillsLive,
        { userId: context.userId, workspaceId: input.workspaceId },
        input,
      );
    }),
    workspaceIntegrations: signedIn.workspaceIntegrations.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const member = yield* hostedStoreOrUnavailable(
        isWorkspaceMember(context.userId, input.workspaceId),
      );
      if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const sealed = yield* liveQueryParts(
        workspaceIntegrationsLive,
        { userId: context.userId, workspaceId: input.workspaceId },
        input,
      );
      const sentry = yield* SentryApp;
      const { configured: slackConfigured } = yield* SlackBot;
      return {
        ...sealed,
        sentryConfigured: Result.isSuccess(yield* Effect.result(sentry.settings)),
        slackConfigured,
      };
    }),
    pullRequestChapters: signedIn.pullRequestChapters.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const number = yield* pullRequestNumberOf([input.number]);
      // One number named always reads as one or is refused.
      if (number === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      const { agent } = yield* reachedAgentById(context.userId, input.id);
      // Note that an agent with no repository is answered as its rows stand, none, as it keeps no chapters.
      const { generatable } = yield* agentChaptersAdmission(context.userId, agent);
      const sealed = yield* liveQueryParts(
        pullRequestChaptersLive,
        {
          userId: context.userId,
          agentId: agent.id,
          number: String(number),
          workspaceId: agent.organizationId,
        },
        input,
      );
      return { ...sealed, generatable };
    }),
    integrationStatuses: signedIn.integrationStatuses.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      const connect = yield* hostedStoreOrUnavailable(accountIntegrationConnect(context.userId));
      const offered = INTEGRATION_PROVIDER_LIST.filter((provider) => connect[provider].configured);
      const now = yield* Clock.currentTimeMillis;
      const sealed = yield* liveQueryParts(
        integrationStatusesLive,
        { userId: context.userId, issuedSince: String(signInIssuedSince(now)) },
        input,
      );
      return {
        ...sealed,
        offered,
        multiple: offered.filter((provider) => connect[provider].multipleAccounts),
      };
    }),
    accountPreferences: signedIn.accountPreferences.effect(function* ({ input, context }) {
      yield* sameUser(input, context.userId);
      return yield* liveQueryParts(accountPreferencesLive, { userId: context.userId }, input);
    }),
  };
}
