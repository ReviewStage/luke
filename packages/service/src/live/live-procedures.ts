import type { LiveStatement } from "@repo/database/core/live-statement";
import type { DatabaseServices } from "@repo/database/core/query";
import { readVisibleAgent } from "@repo/database/models/agent-store";
import { readAutomation } from "@repo/database/models/automation-store";
import { childConversationId } from "@repo/database/models/ids";
import { readSyncWindow, SYNC_LOG, syncStanding } from "@repo/database/models/sync-log";
import { readTaskHeader } from "@repo/database/models/task-store";
import type { WorkspaceSeams } from "@repo/database/models/workspace-seams";
import {
  ensurePersonalWorkspace,
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
import { pluginWriteOrUnavailable } from "../accounts/workspaces-procedures.js";
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
  DESCRIPTION_THREADS,
  hostsLive,
  inboxItemsLive,
  inboxLive,
  installedSkillsLive,
  integrationStatusesLive,
  macCommandsLive,
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
  workspaces: WorkspaceSeams;
}

const LIVE_POLL_HOLD = {
  LOOK: Duration.seconds(3),
  WATCHED_LOOK: Duration.seconds(1),
  HOLD: Duration.seconds(25),
} as const;

const INBOX_RELEASED_PARTS = ["items", "planless", "plans", "automations", "failedRuns"] as const;

const TRANSCRIPT_FOLLOWED_PARTS = [
  "turns",
  "conversation",
  "agent",
  "workers",
  "queueRevision",
  "launch",
] as const;

const LIVE_PART_CONCURRENCY = 3;

function wokenBy<Part extends string>(
  queries: Record<Part, SealedLiveQueryWire>,
  txids: readonly string[],
): Record<Part, SealedLiveQueryWire> {
  if (txids.length === 0) return queries;
  return Object.fromEntries(
    Object.entries<SealedLiveQueryWire>(queries).map(([part, sealed]) => [
      part,
      { ...sealed, txids },
    ]),
  ) as Record<Part, SealedLiveQueryWire>;
}

interface ReadParts<Part extends string> {
  readonly url: string;
  readonly queries: Record<Part, SealedLiveQueryWire>;
}

type PartRead = (sealer: LiveSealer) => LiveSealer["seal"];

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
        queries: Object.fromEntries(sealed) as Record<Part, SealedLiveQueryWire>,
      }),
    );
  }).pipe(Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE));
}

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
    const answer = yield* read;
    if (onWoken !== undefined && Option.isSome(woken.value.heardAt)) {
      yield* onWoken(woken.value.heardAt.value);
    }
    return { ...answer, queries: wokenBy(answer.queries, woken.value.txids) };
  }
  const standing = yield* looked;
  return moved(standing) ? yield* read : standing;
});

function standingDigest<Part extends string>(
  queries: Record<Part, SealedLiveQueryWire>,
  heldOn: readonly Part[] | undefined,
) {
  return heldOn === undefined ? liveDigestOf(queries) : liveDigestOn(queries, heldOn);
}

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

function topicsNamed(named: LiveTopics) {
  return Effect.isEffect(named) ? hostedStoreOrUnavailable(named) : Effect.succeed(named);
}

function topicsOf<Param extends string, Part extends string>(
  query: LiveQuery<Param, Part>,
  params: LiveParams<Param>,
) {
  return topicsNamed(query.topics(params));
}

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
  const held = asked[LIVE_POLL.AFTER] !== undefined;
  const topics = held ? yield* topicsOf(query, params) : NO_TOPICS;
  return yield* sealedParts(statements.value, asked, topics, look, heldOn, olderParts);
});

function cursorMoved<Part extends string>(
  read: ReadParts<Part>,
  after: string | undefined,
  followedParts: readonly Part[] | undefined,
) {
  const pastCursor = Object.values<SealedLiveQueryWire>(read.queries).some(
    ({ cursor, digest }) =>
      cursor !== undefined && (cursor.past === undefined || digest !== NO_ROWS_DIGEST),
  );
  return (
    pastCursor ||
    (liveDigestOf(read.queries) !== after &&
      (followedParts === undefined || liveDigestOn(read.queries, followedParts) !== after))
  );
}

const cursorParts = /* @__PURE__ */ Effect.fnUntraced(function* <
  Param extends string,
  Part extends string,
>(
  query: LiveQuery<Param, Part>,
  params: LiveParams<Param>,
  asked: { readonly [LIVE_POLL.AFTER]?: string; readonly [LIVE_POLL.CURSOR]?: string },
  look: Duration.Duration = LIVE_POLL_HOLD.LOOK,
  onWoken?: (heardAt: number) => Effect.Effect<void>,
  followedParts?: readonly NoInfer<Part>[],
) {
  const following = query.cursor;
  const cursor = asked[LIVE_POLL.CURSOR];
  if (following === undefined || cursor === undefined) {
    return yield* queryParts(query, params, asked, look);
  }
  const followed: ReadonlySet<string> = new Set(following.parts);
  const polled = (how: PartRead) =>
    Effect.gen(function* () {
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
    (standing) => cursorMoved(standing, after, followedParts),
    topics,
    look,
    onWoken,
  );
});

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

export function liveCursorParts<Param extends string, Part extends string>(
  query: LiveQuery<Param, Part>,
  params: LiveParams<Param>,
  asked: { readonly [LIVE_POLL.AFTER]?: string; readonly [LIVE_POLL.CURSOR]?: string },
  look?: Duration.Duration,
  onWoken?: (heardAt: number) => Effect.Effect<void>,
  followedParts?: readonly NoInfer<Part>[],
) {
  return cursorParts(query, params, asked, look, onWoken, followedParts).pipe(
    Effect.withSpan(`web/live/${query.name}`),
  );
}

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

interface DeltaStanding {
  readonly settled: number;
  readonly window: Effect.Success<ReturnType<typeof readSyncWindow>>;
  readonly whole: boolean;
}

function syncedParts<Part extends string>(
  queries: Record<Part, SealedLiveQueryWire>,
  sync: { readonly past?: string; readonly next: string },
  gone: ReadonlyMap<Part, readonly string[]>,
): Record<Part, SealedLiveQueryWire> {
  return Object.fromEntries(
    Object.entries<SealedLiveQueryWire>(queries).map(([part, sealed]) => {
      if (sync.past === undefined) return [part, { ...sealed, sync }];
      const { snapshot: _snapshot, ...delta } = sealed;
      const ofPart = gone.get(part as Part) ?? [];
      return [part, { ...delta, sync, ...(ofPart.length === 0 ? {} : { gone: ofPart }) }];
    }),
  ) as Record<Part, SealedLiveQueryWire>;
}

function rowIds(sealed: SealedLiveQueryWire): ReadonlySet<string> {
  return new Set(
    (sealed.rows ?? []).flatMap((row) => {
      const id = typeof row === "object" && row !== null ? (row as { id?: unknown }).id : undefined;
      return id === undefined ? [] : [String(id)];
    }),
  );
}

interface DeltaNarrowed<Part extends string> {
  readonly read: ReadParts<Part>;
  readonly gone: ReadonlyMap<Part, readonly string[]>;
}

interface DeltaLook<Part extends string> {
  readonly standing: DeltaStanding;
  readonly narrowed: Option.Option<DeltaNarrowed<Part>>;
}

function carriesAny<Part extends string>({ read, gone }: DeltaNarrowed<Part>): boolean {
  return (
    Object.values<SealedLiveQueryWire>(read.queries).some(({ rows }) => (rows ?? []).length > 0) ||
    [...gone.values()].some((ids) => ids.length > 0)
  );
}

const narrowedParts = /* @__PURE__ */ Effect.fnUntraced(function* <
  Param extends string,
  Part extends string,
>(
  delta: NonNullable<LiveQuery<Param, Part>["delta"]>,
  params: LiveParams<Param>,
  rows: DeltaStanding["window"]["rows"],
): Effect.fn.Return<DeltaNarrowed<Part>, HostedRefusal, SqlClient.SqlClient> {
  const statements = delta.statements(params, syncMovedOf(rows));
  if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const read = yield* readParts(statements.value, (sealer) => sealer.seal);
  const gone = new Map<Part, readonly string[]>();
  for (const [part, keys] of ownMovedKeys(delta.own, rows)) {
    const found = rowIds(read.queries[part]);
    gone.set(part, [...keys].filter((key) => !found.has(key)).toSorted());
  }
  return { read, gone };
});

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
  let from = past;
  const passed = new Set<string>();
  const looked: Effect.Effect<DeltaStanding, HostedRefusal, DatabaseServices> =
    hostedStoreOrUnavailable(
      Effect.gen(function* () {
        const { settled } = yield* syncStanding();
        const window = yield* readSyncWindow({
          past: from ?? settled,
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
          from === undefined ||
          from > settled ||
          (window.floor !== undefined && from < window.floor) ||
          window.rows.length > SYNC_LOG.MOST;
        return { settled, window, whole: behind || admissionMoved };
      }),
    );
  const look: Effect.Effect<DeltaLook<Part>, HostedRefusal, DatabaseServices> = Effect.gen(
    function* () {
      const standing = yield* looked;
      if (standing.whole) return { standing, narrowed: Option.none() };
      const narrowed =
        standing.window.rows.length === 0
          ? Option.none()
          : Option.some(yield* narrowedParts<Param, Part>(delta, params, standing.window.rows));
      if (!Option.exists(narrowed, carriesAny)) {
        from = standing.settled;
        for (const txid of standing.window.txids) passed.add(txid);
      }
      return { standing, narrowed };
    },
  );
  const moved = ({ standing, narrowed }: DeltaLook<Part>) =>
    standing.whole || Option.exists(narrowed, carriesAny);
  const held =
    past === undefined
      ? Option.none()
      : yield* heldUntil(look, moved, topics, LIVE_POLL_HOLD.WATCHED_LOOK, LIVE_POLL_HOLD.HOLD);
  const { standing, narrowed } = Option.isSome(held) ? held.value.read : yield* look;
  const next = String(standing.settled);
  if (standing.whole) {
    const statements = query.statements(params);
    if (Option.isNone(statements)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    const read = yield* readParts(statements.value, (sealer) => sealer.seal);
    return { ...read, queries: syncedParts(read.queries, { next }, new Map()) };
  }
  const { read, gone } = Option.isSome(narrowed)
    ? narrowed.value
    : yield* narrowedParts<Param, Part>(delta, params, standing.window.rows);
  const queries = syncedParts(read.queries, { past: String(past), next }, gone);
  return {
    ...read,
    queries: wokenBy(queries, [...new Set([...passed, ...standing.window.txids])]),
  };
});

export function liveDeltaParts<Param extends string, Part extends string>(
  query: LiveQuery<Param, Part>,
  params: LiveParams<Param>,
  sync: string,
) {
  return deltaParts(query, params, sync).pipe(Effect.withSpan(`web/live/${query.name}`));
}

const sinceOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  since: string | undefined,
): Effect.fn.Return<string, HostedRefusal> {
  if (since === undefined) return "0";
  if (!/^\d{1,15}$/.test(since)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return since;
});

const callIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  call: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(agentCallIdSchema)(unparsedWire(call));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

const sameUser = (input: { readonly [LIVE_USER_QUERY]?: string }, userId: string) =>
  input[LIVE_USER_QUERY] === userId ? Effect.void : Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);

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
      const pageId = input.page === undefined ? DESCRIPTION_THREADS : yield* pathUuid(input.page);
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
        TRANSCRIPT_FOLLOWED_PARTS,
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
      yield* pluginWriteOrUnavailable(ensurePersonalWorkspace(context.userId, seams.workspaces));
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
      if (number === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      const { agent } = yield* reachedAgentById(context.userId, input.id);
      const { runsOn } = yield* agentChaptersAdmission(context.userId, agent);
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
      return {
        ...sealed,
        generatable: runsOn !== undefined,
        ...(runsOn === undefined ? {} : { runsOn }),
      };
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
