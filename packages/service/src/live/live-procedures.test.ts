import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { pointBrowserTab, upsertBrowserTab } from "@luke/database/models/agent-browser-tabs";
import { createAgent } from "@luke/database/models/agent-store";
import { createChannel } from "@luke/database/models/channel-store";
import { queueMacCommand } from "@luke/database/models/mac-command-store";
import { writePage } from "@luke/database/models/plan-pages";
import { user } from "@luke/database/schemas/auth";
import { inboxItem } from "@luke/database/schemas/inbox";
import { getTestDB, joinWorkspace, openWorkspace, startTask } from "@luke/database/testing";
import { AGENT_BROWSER_TAB_OPENER } from "@luke/features/agent-browser-tab-wire";
import { BROWSER_CURSOR_KIND } from "@luke/features/browser-agent-actions";
import {
  workspaceChannelsLiveAnswerSchema,
  workspaceChannelsLiveRowsSchema,
} from "@luke/features/channel-live";
import { INBOX_ASK } from "@luke/features/inbox-wire";
import {
  ACCOUNT_INBOX_ITEMS,
  accountInboxItemsLiveAnswerSchema,
  accountInboxItemsLiveRowsSchema,
  accountInboxLiveAnswerSchema,
  agentTranscriptLiveAnswerSchema,
  LIVE_POLL,
  LIVE_POLL_URL,
  LIVE_USER_QUERY,
  liveDigestOf,
  liveDigestOn,
  macCommandsLiveAnswerSchema,
  macCommandsLiveRowsSchema,
  macCommandsOfLiveRows,
  scopeInboxLiveAnswerSchema,
  taskBrowserTabsLiveAnswerSchema,
  taskBrowserTabsLiveRowsSchema,
  taskHistoryLiveAnswerSchema,
  taskPagesLiveAnswerSchema,
  taskPagesLiveRowsSchema,
  taskRecordLiveAnswerSchema,
} from "@luke/features/live-wire";
import { MAC_COMMAND_KIND } from "@luke/features/mac-command-wire";
import { PAGE_SHOWER, taskPageOwner } from "@luke/features/page-wire";
import { sidebarLiveAnswerSchema } from "@luke/features/sidebar-live";
import { taskListLiveAnswerSchema, taskListLiveRowsSchema } from "@luke/features/task-list-live";
import {
  workspaceInvitationsLiveAnswerSchema,
  workspaceMembersLiveAnswerSchema,
  workspacesLiveAnswerSchema,
  workspacesLiveRowsSchema,
} from "@luke/features/workspace-live";
import type { WireBoundaryInput } from "@luke/wire";
import { eq, sql } from "drizzle-orm";
import { Clock, Duration, Effect, Fiber, Layer, Option, Result, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { moveChannelThread, postInboxThread } from "../inbox/inbox-store.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { liveProcedures } from "./live-procedures.js";
import { pollSealer } from "./poll-sealer.js";

/**
 * The reads the desktop follows, answered by the procedure the way the
 * hosted oRPC route answers it: refused without a bearer, and otherwise
 * every part answered polled for the bearer's own account, its rows inline
 * at the poll address; a task's record, pages, Browser tabs, and history
 * for an account that reaches the task and not found for one that does not; a poll past
 * the digest the reader saw held until the rows move; and a plan's inbox,
 * or an agent's, for an account that reaches it and not found for one that
 * does not. Whose rows each statement reads is held by its builder's own
 * tests (`task-list-live.test.ts`, `task-record-live.test.ts`, and the rest).
 *
 * Synthetic accounts and bearers throughout, over the test's own database.
 */

const ORIGIN = "https://luke.test";
const LIVE_INBOX = "/api/live/inbox";

/** A live read's address, naming the account it is for where one is named (`LIVE_USER_QUERY`). */
function readOf(path: string, forUser: string | undefined): URL {
  const url = new URL(path, ORIGIN);
  if (forUser !== undefined) url.searchParams.set(LIVE_USER_QUERY, forUser);
  return url;
}

/** The procedures answering one request as `bearer`, over the test's database. */
const ask = (options: {
  readonly bearer?: string;
  readonly method?: string;
  /** The live read asked; the account inbox where left out. */
  readonly path?: string;
  /** The account the read names; the bearer's own where left out. */
  readonly forUser?: string;
}) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
    );
    const procedures = liveProcedures({
      resolveUserId: (incoming) => {
        const bearer = incoming.headers.get("authorization") ?? "";
        return Effect.succeed(
          bearer.startsWith("Bearer ") ? Option.some(bearer.slice(7)) : Option.none(),
        );
      },
    });
    const response = yield* hostedAnswer(
      { live: procedures },
      services,
      new Request(readOf(options.path ?? LIVE_INBOX, options.forUser ?? options.bearer), {
        method: options.method ?? "GET",
        headers: options.bearer === undefined ? {} : { authorization: `Bearer ${options.bearer}` },
      }),
    );
    const text = yield* Effect.promise(() => response.text());
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return { status: response.status, body };
  });

/** A new account, as the store holds one. */
const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

it.layer(getTestDB())("the account's live reads", (it) => {
  it.effect("a request without a bearer is refused, and one by another method is not taken", () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* ask({}), {
        status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
        body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
      });
      assert.deepEqual(yield* ask({ bearer: "user-dana", method: "POST" }), {
        status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
        body: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
      });
    }),
  );

  it.effect(
    "the commands no Mac has claimed are answered polled for the bearer's own account, of the kinds the read names that this service queues, and a read naming another account is signed out",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const dana = yield* openUser;
        const shell = {
          id: randomUUID(),
          kind: MAC_COMMAND_KIND.SHELL,
          command: "git branch --show-current",
          timeoutSeconds: 60,
        };
        yield* queueMacCommand(dana, shell);
        // A row of a kind this service no longer queues, as an older build left one waiting.
        const queuedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
        yield* db.execute(
          sql`INSERT INTO mac_command (id, user_id, kind, timeout_seconds, queued_at)
              VALUES (${randomUUID()}, ${dana}, 'browser', 30, ${queuedAt})`,
        );

        const answered = yield* ask({
          bearer: dana,
          path: "/api/live/mac-commands?kinds=shell,browser",
        });
        assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(macCommandsLiveAnswerSchema)(answered.body);
        assert.equal(answer.url, LIVE_POLL_URL);
        assert.deepEqual(
          macCommandsOfLiveRows(
            Schema.decodeUnknownSync(macCommandsLiveRowsSchema)({
              commands: answer.queries.commands.rows,
            }),
          ),
          [shell],
          "a kind this service no longer queues is passed over",
        );
        assert.deepEqual(
          yield* ask({ bearer: dana, forUser: "user-eli", path: "/api/live/mac-commands" }),
          {
            status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
            body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
          },
          "a read naming another account is signed out",
        );
      }),
  );

  it.effect("every part of the account inbox is answered polled, each with its rows inline", () =>
    Effect.gen(function* () {
      const dana = yield* openUser;
      const polled = yield* ask({ bearer: dana });
      assert.equal(polled.status, HOSTED_HTTP_STATUS.OK);
      const answer = Schema.decodeUnknownSync(accountInboxLiveAnswerSchema)(polled.body);
      assert.equal(answer.url, LIVE_POLL_URL);
      assert.deepEqual(Object.keys(answer.queries).toSorted(), [
        "agents",
        "automations",
        "failedRuns",
        "items",
        "planless",
        "plans",
      ]);
      for (const [part, sealed] of Object.entries(answer.queries)) {
        assert.deepEqual(sealed.rows, [], `${part} holds nothing yet`);
      }
    }),
  );

  it.effect(
    "the task list is answered polled as its tasks, its agents, and its tasks' issues, the bearer's tasks among them",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });

        const answered = yield* ask({ bearer: dana, path: "/api/live/tasks" });
        assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(taskListLiveAnswerSchema)(answered.body);
        assert.equal(answer.url, LIVE_POLL_URL);
        assert.deepEqual(Object.keys(answer.queries).toSorted(), ["agents", "issues", "plans"]);
        const rows = Schema.decodeUnknownSync(taskListLiveRowsSchema)({
          plans: answer.queries.plans.rows,
          agents: answer.queries.agents.rows,
          issues: answer.queries.issues.rows,
        });
        assert.deepEqual(
          rows.plans.map((plan) => plan.id),
          [started.id],
        );
      }),
  );
});

/** The procedures answering a task's live read as `bearer`, its record's unless `path` names another, over the store. */
const askTask = (options: {
  readonly bearer: string;
  /** The account the read names; the bearer's own where left out. */
  readonly forUser?: string;
  readonly taskId?: string;
  readonly path?: string;
  readonly poll?: boolean;
  /** The digest the reader last saw, which holds the poll until the rows move past it. */
  readonly after?: string;
  /** The client the live statements run on; the test's database's own where left out. */
  readonly sql?: SqlClient.SqlClient;
}) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, options.sql ?? (yield* SqlClient.SqlClient)),
      Layer.succeed(Database, yield* Database),
      // The test's own clock, so a held poll is moved by `TestClock` rather than waited out.
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );
    const procedures = liveProcedures({
      resolveUserId: () => Effect.succeed(Option.some(options.bearer)),
    });
    const url = readOf(
      options.taskId === undefined ? LIVE_INBOX : (options.path ?? "/api/live/task-record"),
      options.forUser ?? options.bearer,
    );
    if (options.taskId !== undefined) url.searchParams.set("id", options.taskId);
    if (options.poll === true) url.searchParams.set(LIVE_POLL.QUERY, LIVE_POLL.ON);
    if (options.after !== undefined) url.searchParams.set(LIVE_POLL.AFTER, options.after);
    const response = yield* hostedAnswer(
      { live: procedures },
      services,
      new Request(url, { headers: { authorization: `Bearer ${options.bearer}` } }),
    );
    const text = yield* Effect.promise(() => response.text());
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return { status: response.status, body };
  });

it.layer(getTestDB())("a task's live reads", (it) => {
  it.effect(
    "a task's pages and calls are answered polled a part each for an account that reaches it, and not found for one that does not",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const eli = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        const ask = (bearer: string) => askTask({ bearer, taskId: started.id });

        const own = yield* ask(dana);
        assert.equal(own.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(taskRecordLiveAnswerSchema)(own.body);
        assert.equal(answer.url, LIVE_POLL_URL);
        for (const query of [answer.queries.pages, answer.queries.calls]) {
          assert.deepEqual(query.rows, [], "the task holds no pages or calls yet");
        }
        const notFound = {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        };
        assert.deepEqual(yield* ask(eli), notFound);
        assert.deepEqual(yield* askTask({ bearer: dana, taskId: "not-a-task" }), notFound);
      }),
  );

  it.effect(
    "a task's pages are answered polled with their rows inline for an account that reaches the task, and not found for one that does not",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const eli = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        const shown = Option.getOrThrow(
          yield* writePage(
            dana,
            taskPageOwner(started.id),
            { title: "Invite funnel", html: "<p>One</p>" },
            { kind: PAGE_SHOWER.LUKE },
          ),
        );
        const path = "/api/live/task-pages";

        assert.deepEqual(
          yield* askTask({
            bearer: eli,
            taskId: started.id,
            path,
          }),
          { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
        );
        assert.deepEqual(
          yield* askTask({
            bearer: dana,
            forUser: eli,
            taskId: started.id,
            path,
          }),
          {
            status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
            body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
          },
          "a read started for another account is signed out",
        );

        const polled = yield* askTask({ bearer: dana, taskId: started.id, path });
        assert.equal(polled.status, HOSTED_HTTP_STATUS.OK);
        const rows = Schema.decodeUnknownSync(taskPagesLiveAnswerSchema)(polled.body);
        assert.equal(rows.url, LIVE_POLL_URL);
        assert.deepEqual(
          Schema.decodeUnknownSync(taskPagesLiveRowsSchema)({
            pages: rows.queries.pages.rows,
          }).pages.map((page) => [page.id, page.version]),
          [[shown.id, 1]],
        );
      }),
  );

  it.effect(
    "a task's Browser tabs are answered polled with each tab's pointer inline for an account that reaches the task, and not found for one that does not",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const eli = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        const coder = yield* createAgent(dana, {
          taskId: started.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/relay",
          planSnapshot: "# Teammate invitations\n",
          prompt: null,
        });
        const { agent } = Option.getOrThrow(coder);
        const tab = yield* upsertBrowserTab({
          conversationId: agent.conversationId,
          targetId: "target-1",
          address: "http://localhost:3000/",
          title: "Invites",
          openedBy: { kind: AGENT_BROWSER_TAB_OPENER.AGENT },
        });
        const at = yield* Clock.currentTimeMillis;
        yield* pointBrowserTab(agent.conversationId, {
          tab: "target-1",
          x: 12,
          y: 34,
          kind: BROWSER_CURSOR_KIND.TYPE,
          viewport: { width: 1280, height: 800 },
          at,
        });
        const path = "/api/live/task-browser-tabs";

        assert.deepEqual(
          yield* askTask({
            bearer: eli,
            taskId: started.id,
            path,
          }),
          { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
        );

        const polled = yield* askTask({ bearer: dana, taskId: started.id, path });
        assert.equal(polled.status, HOSTED_HTTP_STATUS.OK);
        const rows = Schema.decodeUnknownSync(taskBrowserTabsLiveAnswerSchema)(polled.body);
        assert.equal(rows.url, LIVE_POLL_URL);
        const [line] = Schema.decodeUnknownSync(taskBrowserTabsLiveRowsSchema)({
          tabs: rows.queries.tabs.rows,
        }).tabs;
        assert.deepEqual(
          line && [
            line.id,
            line.agentId,
            line.cursorX,
            line.cursorY,
            line.cursorKind,
            line.cursorAt,
          ],
          [tab.id, agent.id, 12, 34, BROWSER_CURSOR_KIND.TYPE, at],
        );
      }),
  );

  it.effect(
    "a task's newest page of history is answered polled for an account that reaches the task, and not found for one that does not",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const eli = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        const path = "/api/live/task-history";

        const own = yield* askTask({ bearer: dana, taskId: started.id, path });
        assert.equal(own.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(taskHistoryLiveAnswerSchema)(own.body);
        assert.equal(answer.url, LIVE_POLL_URL);
        assert.deepEqual(answer.queries.revisions.rows, [], "the plan is not saved yet");
        assert.deepEqual(
          yield* askTask({
            bearer: eli,
            taskId: started.id,
            path,
          }),
          { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
        );
      }),
  );
});

/** A row a statement answered, column by column. */
type KeptRow = Readonly<Record<string, unknown>>;

/**
 * The test's database client, keeping every row a statement run on it as
 * text (`unsafe`, which a poll's sealer reads through) answers, so a test
 * sees what left the database rather than how often it was asked.
 */
function keepingRows(sql: SqlClient.SqlClient, kept: KeptRow[]): SqlClient.SqlClient {
  return new Proxy(sql, {
    get: (target, key, receiver) =>
      key === "unsafe"
        ? (text: string, params?: ReadonlyArray<unknown>) =>
            Effect.tap(target.unsafe<KeptRow>(text, params), (rows) =>
              Effect.sync(() => kept.push(...rows)),
            )
        : Reflect.get(target, key, receiver),
  });
}

/** The rows kept that carry a column of the read's own, rather than a look's digest alone. */
const rowsOfTheRead = (kept: readonly KeptRow[]) =>
  kept.filter((row) => Object.keys(row).some((column) => column !== "digest"));

it.layer(getTestDB())("a held live read's looks", (it) => {
  const path = "/api/live/task-pages";

  /** One page shown on the task, so its pages read has a row to carry. */
  const showPage = (userId: string, taskId: string) =>
    Effect.map(
      writePage(
        userId,
        taskPageOwner(taskId),
        { title: "Invite funnel", html: "<p>One</p>" },
        { kind: PAGE_SHOWER.LUKE },
      ),
      Option.getOrThrow,
    );

  it.effect(
    "a poll held over rows that never move carries none of them off the database: it looks at their digests alone to the hold's end, and answers unchanged",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        yield* showPage(dana, started.id);
        const kept: KeptRow[] = [];
        const sql = keepingRows(yield* SqlClient.SqlClient, kept);

        const first = yield* askTask({ bearer: dana, taskId: started.id, path, sql });
        const seen = Schema.decodeUnknownSync(taskPagesLiveAnswerSchema)(first.body);
        assert.equal(rowsOfTheRead(kept).length, 1, "a first read carries the page's row");
        const digest = liveDigestOf(seen.queries);
        assert.ok(digest !== undefined);

        const looked = kept.length;
        const unchanged = yield* Effect.forkChild(
          askTask({ bearer: dana, taskId: started.id, path, sql, poll: true, after: digest }),
        );
        yield* TestClock.adjust(Duration.seconds(25));
        const held = Schema.decodeUnknownSync(taskPagesLiveAnswerSchema)(
          (yield* Fiber.join(unchanged)).body,
        );
        assert.equal(held.queries.pages.rows, undefined, "unchanged carries no rows");
        assert.equal(liveDigestOf(held.queries), digest);
        const hold = kept.slice(looked);
        assert.ok(hold.length > 0, "the hold looked at the rows' digests");
        assert.deepEqual(rowsOfTheRead(hold), [], "no row of the read left the database");
      }),
  );

  it.effect(
    "a poll whose rows moved is answered them with the digest they stand at, so a reader that holds it is held again rather than answered at once",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        const poll = (after: string) =>
          askTask({ bearer: dana, taskId: started.id, path, poll: true, after });
        const first = yield* askTask({ bearer: dana, taskId: started.id, path });
        const digest = liveDigestOf(
          Schema.decodeUnknownSync(taskPagesLiveAnswerSchema)(first.body).queries,
        );
        assert.ok(digest !== undefined);

        const moved = yield* Effect.forkChild(poll(digest));
        yield* TestClock.adjust(Duration.seconds(3));
        const shown = yield* showPage(dana, started.id);
        yield* TestClock.adjust(Duration.seconds(3));
        const answer = Schema.decodeUnknownSync(taskPagesLiveAnswerSchema)(
          (yield* Fiber.join(moved)).body,
        );
        assert.deepEqual(
          Schema.decodeUnknownSync(taskPagesLiveRowsSchema)({
            pages: answer.queries.pages.rows,
          }).pages.map((page) => [page.id, page.version]),
          [[shown.id, 1]],
        );
        const standing = liveDigestOf(answer.queries);
        assert.ok(standing !== undefined && standing !== digest);

        const again = yield* Effect.forkChild(poll(standing));
        yield* TestClock.adjust(Duration.seconds(25));
        const held = Schema.decodeUnknownSync(taskPagesLiveAnswerSchema)(
          (yield* Fiber.join(again)).body,
        );
        assert.equal(held.queries.pages.rows, undefined, "the rows answered stand at their digest");
        assert.equal(liveDigestOf(held.queries), standing);
      }),
  );

  it.effect(
    "a part added to the read answers released desktops at once: the account inbox is held for one that sends where the parts it keeps stand",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const first = yield* askTask({ bearer: dana });
        const { agents: _, ...kept } = Schema.decodeUnknownSync(accountInboxLiveAnswerSchema)(
          first.body,
        ).queries;
        // As v0.22.0 sends it: its schema keeps five parts and strips `agents`, which it never knew.
        const after = liveDigestOf(kept);
        assert.ok(after !== undefined);

        const unchanged = yield* Effect.forkChild(askTask({ bearer: dana, poll: true, after }));
        yield* TestClock.adjust(Duration.seconds(25));
        const held = Schema.decodeUnknownSync(accountInboxLiveAnswerSchema)(
          (yield* Fiber.join(unchanged)).body,
        );
        assert.deepEqual(
          Object.values(held.queries).filter((query) => query.rows !== undefined),
          [],
          "unchanged carries no rows",
        );
      }),
  );
});

it.layer(getTestDB())("the account's inbox items' live read", (it) => {
  it.effect(
    "a poll held on where the items stand stays held when only the reader's `since` moved past the items it was answered, and is answered once an item moves between channels",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const task = yield* startTask(dana, { name: "Teammate invitations" });
        const started = yield* createAgent(dana, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/relay",
          planSnapshot: "# Teammate invitations\n",
          prompt: null,
        });
        assert.ok(Option.isSome(started));
        const posted = yield* postInboxThread(
          { userId: dana, taskId: task.id, agentId: started.value.agent.id },
          {
            key: "review",
            title: "Review the invite flow",
            body: "It is up.",
            ask: { type: INBOX_ASK.DO, steps: [] },
          },
        );
        const itemsPath = (query: Readonly<Record<string, string>>) =>
          `/api/live/inbox-items?${new URLSearchParams(query)}`;

        const first = yield* ask({ bearer: dana, path: itemsPath({}) });
        assert.equal(first.status, HOSTED_HTTP_STATUS.OK);
        const seen = Schema.decodeUnknownSync(accountInboxItemsLiveAnswerSchema)(first.body);
        assert.equal(seen.queries.items.rows?.length, 1, "the item is carried whole");
        const after = liveDigestOn(seen.queries, ACCOUNT_INBOX_ITEMS.HELD_ON);
        assert.ok(after !== undefined);

        // The reader holds every item now, so it asks only for those changed from here on.
        yield* TestClock.adjust(Duration.seconds(1));
        const since = String(yield* Clock.currentTimeMillis);
        const poll = yield* Effect.forkChild(
          ask({
            bearer: dana,
            path: itemsPath({ since, [LIVE_POLL.QUERY]: LIVE_POLL.ON, [LIVE_POLL.AFTER]: after }),
          }),
        );
        yield* TestClock.adjust(Duration.seconds(25));
        const held = Schema.decodeUnknownSync(accountInboxItemsLiveAnswerSchema)(
          (yield* Fiber.join(poll)).body,
        );
        assert.equal(held.queries.stamps.rows, undefined, "the poll was held to its end");
        assert.equal(liveDigestOn(held.queries, ACCOUNT_INBOX_ITEMS.HELD_ON), after);

        // A move between channels changes nothing of the item but its channel, which its stamp carries.
        const reviews = Result.getOrThrow(
          yield* createChannel(
            dana,
            task.workspaceId,
            { name: "reviews", purpose: "Where reviews wait.", project: false },
            new Date(yield* Clock.currentTimeMillis),
          ),
        );
        const itemId = Result.getOrThrow(posted).id;
        assert.ok(Result.isSuccess(yield* moveChannelThread(dana, itemId, reviews.id)));
        const again = yield* Effect.forkChild(
          ask({
            bearer: dana,
            path: itemsPath({ since, [LIVE_POLL.QUERY]: LIVE_POLL.ON, [LIVE_POLL.AFTER]: after }),
          }),
        );
        yield* TestClock.adjust(Duration.seconds(25));
        const moved = Schema.decodeUnknownSync(accountInboxItemsLiveAnswerSchema)(
          (yield* Fiber.join(again)).body,
        );
        assert.deepEqual(
          moved.queries.stamps.rows === undefined
            ? undefined
            : Schema.decodeUnknownSync(accountInboxItemsLiveRowsSchema.fields.stamps)(
                moved.queries.stamps.rows,
              ).map((stamp) => stamp.channelId),
          [reviews.id],
          "the moved item's stamp is answered",
        );
      }),
  );
});

it.layer(getTestDB())("a workspace's channels list's live read", (it) => {
  it.effect(
    "the list carries each channel with what it holds for the reader, a write to a thread that moves nothing it shows answers no held poll, and a channel made does",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const task = yield* startTask(dana, { name: "Teammate invitations" });
        const started = yield* createAgent(dana, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/relay",
          planSnapshot: "# Teammate invitations\n",
          prompt: null,
        });
        assert.ok(Option.isSome(started));
        const posted = yield* postInboxThread(
          { userId: dana, taskId: task.id, agentId: started.value.agent.id },
          { key: "review", title: "Review the invite flow", body: "It is up." },
        );
        const channelsPath = (query: Readonly<Record<string, string>>) =>
          `/api/live/workspace-channels?${new URLSearchParams({ workspaceId: task.workspaceId, ...query })}`;
        const polled = (after: string) =>
          Effect.gen(function* () {
            const poll = yield* Effect.forkChild(
              ask({
                bearer: dana,
                path: channelsPath({ [LIVE_POLL.QUERY]: LIVE_POLL.ON, [LIVE_POLL.AFTER]: after }),
              }),
            );
            yield* TestClock.adjust(Duration.seconds(25));
            return Schema.decodeUnknownSync(workspaceChannelsLiveAnswerSchema)(
              (yield* Fiber.join(poll)).body,
            );
          });

        const first = yield* ask({
          bearer: dana,
          path: channelsPath({ [LIVE_POLL.QUERY]: LIVE_POLL.ON }),
        });
        assert.equal(first.status, HOSTED_HTTP_STATUS.OK);
        const seen = Schema.decodeUnknownSync(workspaceChannelsLiveAnswerSchema)(first.body);
        const rows = Schema.decodeUnknownSync(workspaceChannelsLiveRowsSchema)(
          Object.fromEntries(
            Object.entries(seen.queries).map(([part, query]) => [part, query.rows]),
          ),
        );
        assert.deepEqual(
          rows.channels.map((channel) => channel.name),
          ["general"],
          "#general is minted for the read",
        );
        assert.deepEqual(
          rows.tallies.map((tally) => tally.threads),
          [1],
          "the thread posted is counted",
        );
        const after = liveDigestOf(seen.queries);
        assert.ok(after !== undefined);

        // A thread's last change moving, as a message on it does, moves no count, no post, and no ask.
        const db = yield* Database;
        yield* db
          .update(inboxItem)
          .set({ updatedAt: new Date((yield* Clock.currentTimeMillis) + 1000) })
          .where(eq(inboxItem.id, Result.getOrThrow(posted).id));
        const held = yield* polled(after);
        assert.equal(held.queries.channels.rows, undefined, "the poll was held to its end");
        assert.equal(liveDigestOf(held.queries), after);

        yield* createChannel(
          dana,
          task.workspaceId,
          { name: "reviews", purpose: "Where reviews wait.", project: false },
          new Date(yield* Clock.currentTimeMillis),
        );
        const made = yield* polled(after);
        assert.deepEqual(
          made.queries.channels.rows === undefined
            ? undefined
            : Schema.decodeUnknownSync(workspaceChannelsLiveRowsSchema.fields.channels)(
                made.queries.channels.rows,
              )
                .map((channel) => channel.name)
                .toSorted(),
          ["general", "reviews"],
          "the channel made is answered",
        );
      }),
  );
});

/** The procedures answering an agent's transcript's live read as `bearer`, the worker's where `call` names one. */
const askTranscript = (options: {
  readonly bearer: string;
  readonly agentId: string;
  readonly call?: string;
  /** The read asked, an agent's transcript where none is named. */
  readonly path?: string;
  /** The account the read names, the bearer's own where none is named. */
  readonly forUser?: string;
}) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
    );
    const procedures = liveProcedures({
      resolveUserId: () => Effect.succeed(Option.some(options.bearer)),
    });
    const url = readOf(
      options.path ?? "/api/live/agent-transcript",
      options.forUser ?? options.bearer,
    );
    url.searchParams.set("id", options.agentId);
    if (options.call !== undefined) url.searchParams.set("call", options.call);
    const response = yield* hostedAnswer(
      { live: procedures },
      services,
      new Request(url, { headers: { authorization: `Bearer ${options.bearer}` } }),
    );
    const text = yield* Effect.promise(() => response.text());
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return { status: response.status, body };
  });

it.layer(getTestDB())("an agent transcript's live read", (it) => {
  it.effect(
    "an agent's transcript, or a worker's by its call, is answered polled as what its pages are read from, for an account that reaches the agent and under the conversation the call opens, and not found otherwise",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const stranger = yield* openUser;
        const task = yield* startTask(owner, { name: "Teammate invitations" });
        const started = yield* createAgent(owner, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/relay",
          planSnapshot: "# Teammate invitations\n",
          prompt: null,
        });
        assert.ok(Option.isSome(started));
        const { agent } = started.value;

        const own = yield* askTranscript({ bearer: owner, agentId: agent.id });
        assert.equal(own.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(agentTranscriptLiveAnswerSchema)(own.body);
        assert.equal(answer.url, LIVE_POLL_URL);
        assert.deepEqual(Object.keys(answer.queries).toSorted(), [
          "agent",
          "conversation",
          "messages",
          "queueRevision",
          "turns",
          "window",
          "windowParts",
          "workers",
        ]);
        const idsOf = (rows: readonly unknown[] | undefined) =>
          Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String })))(rows).map(
            ({ id }) => id,
          );
        assert.deepEqual(idsOf(answer.queries.conversation.rows), [agent.conversationId]);
        assert.deepEqual(idsOf(answer.queries.agent.rows), [agent.id]);

        // Note that the call's conversation is not opened yet, so the worker's reads under it find none, beside its agent.
        const worker = Schema.decodeUnknownSync(agentTranscriptLiveAnswerSchema)(
          (yield* askTranscript({ bearer: owner, agentId: agent.id, call: "call-7" })).body,
        );
        assert.equal(worker.url, LIVE_POLL_URL);
        assert.deepEqual(idsOf(worker.queries.conversation.rows), []);
        assert.deepEqual(idsOf(worker.queries.agent.rows), [agent.id]);

        for (const call of [undefined, "call-7"]) {
          const named = call === undefined ? {} : { call };
          assert.deepEqual(
            yield* askTranscript({ bearer: stranger, agentId: agent.id, ...named }),
            { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
          );
        }
        assert.deepEqual(
          yield* askTranscript({
            bearer: owner,
            agentId: "not-an-agent",
          }),
          { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
        );
      }),
  );

  it.effect(
    "a poll past the digest the reader saw is held: answered within a beat of a change, and unchanged, with no rows, at the hold's end",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        const path = "/api/live/task-pages";
        const poll = (after: string) =>
          askTask({ bearer: dana, taskId: started.id, path, poll: true, after });
        const first = yield* askTask({ bearer: dana, taskId: started.id, path });
        const seen = Schema.decodeUnknownSync(taskPagesLiveAnswerSchema)(first.body);
        const digest = liveDigestOf(seen.queries);
        assert.ok(digest !== undefined);

        const unchanged = yield* Effect.forkChild(poll(digest));
        yield* TestClock.adjust(Duration.seconds(25));
        const held = Schema.decodeUnknownSync(taskPagesLiveAnswerSchema)(
          (yield* Fiber.join(unchanged)).body,
        );
        assert.equal(held.queries.pages.rows, undefined, "unchanged carries no rows");
        assert.equal(liveDigestOf(held.queries), digest);

        const moved = yield* Effect.forkChild(poll(digest));
        yield* TestClock.adjust(Duration.seconds(3));
        const shown = Option.getOrThrow(
          yield* writePage(
            dana,
            taskPageOwner(started.id),
            { title: "Invite funnel", html: "<p>One</p>" },
            { kind: PAGE_SHOWER.LUKE },
          ),
        );
        yield* TestClock.adjust(Duration.seconds(3));
        const answer = Schema.decodeUnknownSync(taskPagesLiveAnswerSchema)(
          (yield* Fiber.join(moved)).body,
        );
        assert.deepEqual(
          Schema.decodeUnknownSync(taskPagesLiveRowsSchema)({
            pages: answer.queries.pages.rows,
          }).pages.map((page) => [page.id, page.version]),
          [[shown.id, 1]],
        );
        assert.notEqual(liveDigestOf(answer.queries), digest);
      }),
  );

  it.effect(
    "a polled statement's rows in another order digest alike, and a look at its digest alone reads the digest its rows are answered with, none included",
    () =>
      Effect.gen(function* () {
        const sealer = pollSealer(yield* SqlClient.SqlClient);
        const ascending = {
          sql: "select * from (values (1), (2)) as rows(n) order by n",
          params: [],
        };
        const one = yield* sealer.seal(ascending);
        const other = yield* sealer.seal({
          sql: "select * from (values (1), (2)) as rows(n) order by n desc",
          params: [],
        });
        assert.notDeepEqual(one.rows, other.rows);
        assert.equal(one.digest, other.digest);
        assert.equal((yield* sealer.digest(ascending)).digest, one.digest);

        const none = { sql: "select * from (values (1)) as rows(n) where n > $1", params: [1] };
        const empty = yield* sealer.seal(none);
        assert.deepEqual(empty.rows, []);
        assert.equal((yield* sealer.digest(none)).digest, empty.digest);
      }),
  );

  it.effect(
    "a read naming another account than the caller's, or none, is answered as signed out, as no session is",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        const signedOut = {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
        };
        for (const forUser of ["user-eli", ""]) {
          assert.deepEqual(
            yield* askTask({ bearer: dana, forUser, taskId: started.id }),
            signedOut,
          );
          assert.deepEqual(yield* askTask({ bearer: dana, forUser }), signedOut);
        }
      }),
  );
});

/** The procedures answering a plan's or an agent's inbox read as `bearer`, over the store. */
const askScope = (options: {
  readonly bearer: string;
  readonly path: string;
  readonly id: string;
  /** The account the read names; the bearer's own unless a test names another. */
  readonly userId?: string;
}) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
    );
    const procedures = liveProcedures({
      resolveUserId: () => Effect.succeed(Option.some(options.bearer)),
    });
    const url = new URL(options.path, ORIGIN);
    url.searchParams.set("id", options.id);
    url.searchParams.set(LIVE_USER_QUERY, options.userId ?? options.bearer);
    const response = yield* hostedAnswer(
      { live: procedures },
      services,
      new Request(url, { headers: { authorization: `Bearer ${options.bearer}` } }),
    );
    const text = yield* Effect.promise(() => response.text());
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return { status: response.status, body };
  });

it.layer(getTestDB())("a plan's and an agent's inbox live reads", (it) => {
  it.effect(
    "a plan's inbox, or an agent's, is answered polled as its items, threads, and files for an account that reaches it, and not found for one that does not",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const stranger = yield* openUser;
        const task = yield* startTask(owner, { name: "Teammate invitations" });
        const started = yield* createAgent(owner, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/relay",
          planSnapshot: "# Teammate invitations\n",
          prompt: null,
        });
        assert.ok(Option.isSome(started));
        const scopes = [
          { path: "/api/live/task-inbox", id: task.id },
          { path: "/api/live/agent-inbox", id: started.value.agent.id },
        ];
        for (const scope of scopes) {
          const polled = yield* askScope({ bearer: owner, ...scope });
          assert.equal(polled.status, HOSTED_HTTP_STATUS.OK, scope.path);
          const answer = Schema.decodeUnknownSync(scopeInboxLiveAnswerSchema)(polled.body);
          assert.equal(answer.url, LIVE_POLL_URL);
          assert.deepEqual(Object.keys(answer.queries).toSorted(), ["files", "items", "messages"]);
          for (const [part, query] of Object.entries(answer.queries)) {
            assert.deepEqual(query.rows, [], `${part} holds nothing yet`);
          }
          assert.deepEqual(yield* askScope({ bearer: stranger, ...scope }), {
            status: HOSTED_HTTP_STATUS.NOT_FOUND,
            body: { error: HOSTED_API_ERROR.NOT_FOUND },
          });
          assert.deepEqual(
            yield* askScope({
              bearer: owner,
              userId: stranger,
              ...scope,
            }),
            {
              status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
              body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
            },
            "a read naming another account is signed out",
          );
        }
        assert.deepEqual(
          yield* askScope({
            bearer: owner,
            path: "/api/live/task-inbox",
            id: "not-a-plan",
          }),
          { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
        );
      }),
  );
});

it.layer(getTestDB())("the account's workspaces' live read", (it) => {
  it.effect(
    "the account's workspaces are answered polled as its workspaces and their installations, the bearer's own among them",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const workspaceId = yield* openWorkspace(dana);
        const path = "/api/live/workspaces";
        const polled = yield* ask({ bearer: dana, path });
        assert.equal(polled.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(workspacesLiveAnswerSchema)(polled.body);
        assert.equal(answer.url, LIVE_POLL_URL);
        assert.deepEqual(Object.keys(answer.queries).toSorted(), ["installations", "workspaces"]);
        assert.deepEqual(
          Schema.decodeUnknownSync(workspacesLiveRowsSchema)({
            workspaces: answer.queries.workspaces.rows,
            installations: answer.queries.installations.rows,
          }).workspaces.map(({ id }) => id),
          [workspaceId],
        );
        assert.deepEqual(yield* ask({ path }), {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
        });
        // A read started for another account, as a page left open under a changed session asks, is signed out.
        assert.deepEqual(yield* ask({ bearer: dana, forUser: "user-erin", path }), {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
        });
      }),
  );
});

it.layer(getTestDB())("a workspace's people's live read", (it) => {
  it.effect(
    "a workspace's people are answered polled as its members and former members for a member, and not found for an outsider",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const [owner, outsider] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
        for (const id of [owner, outsider]) {
          yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
        }
        const workspaceId = yield* openWorkspace(owner);
        const path = `/api/live/workspace-members?workspaceId=${workspaceId}`;

        const polled = yield* ask({ bearer: owner, path });
        assert.equal(polled.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(workspaceMembersLiveAnswerSchema)(polled.body);
        assert.equal(answer.url, LIVE_POLL_URL);
        assert.deepEqual(Object.keys(answer.queries).toSorted(), ["former", "members"]);
        assert.deepEqual(
          Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ userId: Schema.String })))(
            answer.queries.members.rows,
          ).map(({ userId }) => userId),
          [owner],
        );
        assert.deepEqual(yield* ask({ bearer: outsider, path }), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        });
        // A read started for another account is signed out, before the workspace is looked at.
        assert.equal(
          (yield* ask({ bearer: owner, forUser: outsider, path })).status,
          HOSTED_HTTP_STATUS.UNAUTHORIZED,
        );
      }),
  );

  it.effect(
    "a workspace's invitations are answered polled with the service's origin for its owner, refused to a member, and not found for an outsider",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const owner = `user-${randomUUID()}`;
        const teammate = `user-${randomUUID()}`;
        const outsider = `user-${randomUUID()}`;
        for (const id of [owner, teammate, outsider]) {
          yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
        }
        const workspaceId = yield* openWorkspace(owner);
        yield* joinWorkspace(workspaceId, teammate);
        const path = `/api/live/workspace-invitations?workspaceId=${workspaceId}`;

        const polled = yield* ask({ bearer: owner, path });
        assert.equal(polled.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(workspaceInvitationsLiveAnswerSchema)(polled.body);
        assert.equal(answer.origin, ORIGIN);
        assert.equal(answer.url, LIVE_POLL_URL);
        assert.deepEqual(answer.queries.invitations.rows, [], "nobody is invited yet");
        assert.deepEqual(yield* ask({ bearer: teammate, path }), {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: { error: HOSTED_API_ERROR.NOT_PERMITTED },
        });
        assert.deepEqual(yield* ask({ bearer: outsider, path }), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        });
        assert.equal(
          (yield* ask({ bearer: owner, forUser: outsider, path })).status,
          HOSTED_HTTP_STATUS.UNAUTHORIZED,
        );
      }),
  );
});

it.layer(getTestDB())("the account's sidebar's live read", (it) => {
  it.effect(
    "the account's sidebar is answered polled as its sections, the tasks in them, and its pins",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const path = "/api/live/sidebar";
        const polled = yield* ask({ bearer: dana, path });
        assert.equal(polled.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(sidebarLiveAnswerSchema)(polled.body);
        assert.equal(answer.url, LIVE_POLL_URL);
        assert.deepEqual(Object.keys(answer.queries).toSorted(), [
          "agentEntries",
          "entries",
          "pins",
          "sections",
        ]);
        for (const [part, query] of Object.entries(answer.queries)) {
          assert.deepEqual(query.rows, [], `${part} holds nothing yet`);
        }
        assert.equal(
          (yield* ask({ bearer: dana, forUser: "user-erin", path })).status,
          HOSTED_HTTP_STATUS.UNAUTHORIZED,
        );
      }),
  );
});
