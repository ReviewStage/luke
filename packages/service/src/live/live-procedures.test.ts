import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { pointBrowserTab, upsertBrowserTab } from "@luke/database/models/agent-browser-tabs";
import { writeDrawing } from "@luke/database/models/board-store";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { queueMacCommand } from "@luke/database/models/mac-command-store";
import { writePage } from "@luke/database/models/plan-pages";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace, startTask } from "@luke/database/testing";
import { AGENT_BROWSER_TAB_OPENER } from "@luke/features/agent-browser-tab-wire";
import { BOARD_ELEMENT_TYPE } from "@luke/features/board-vocabulary";
import { BROWSER_CURSOR_KIND } from "@luke/features/browser-agent-actions";
import {
  accountInboxLiveAnswerSchema,
  agentTranscriptLiveAnswerSchema,
  LIVE_POLL,
  LIVE_POLL_URL,
  LIVE_USER_QUERY,
  liveDigestOf,
  macCommandsLiveAnswerSchema,
  macCommandsLiveRowsSchema,
  macCommandsOfLiveRows,
  scopeInboxLiveAnswerSchema,
  taskBoardLiveAnswerSchema,
  taskBoardLiveRowsSchema,
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
import { sql } from "drizzle-orm";
import { Clock, Duration, Effect, Fiber, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { liveProcedures } from "./live-procedures.js";
import { pollSealer } from "./poll-sealer.js";

/**
 * The reads the desktop follows, answered by the procedure the way the
 * hosted oRPC route answers it: refused without a bearer, and otherwise
 * every part answered polled for the bearer's own account, its rows inline
 * at the poll address; a task's whiteboard, pages, and calls for an account
 * that reaches the task and not found for one that does not; a poll past
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

/** One box Luke drew, so the board has a row to read. */
const BOX = [{ type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "api", x: 0, y: 0, label: "API" }] as const;

/** The procedures answering a task's live read as `bearer`, its board's unless `path` names another, over the store. */
const askBoard = (options: {
  readonly bearer: string;
  /** The account the read names; the bearer's own where left out. */
  readonly forUser?: string;
  readonly taskId?: string;
  readonly path?: string;
  readonly poll?: boolean;
  /** The digest the reader last saw, which holds the poll until the rows move past it. */
  readonly after?: string;
}) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      // The test's own clock, so a held poll is moved by `TestClock` rather than waited out.
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );
    const procedures = liveProcedures({
      resolveUserId: () => Effect.succeed(Option.some(options.bearer)),
    });
    const url = readOf(
      options.taskId === undefined ? LIVE_INBOX : (options.path ?? "/api/live/task-board"),
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

it.layer(getTestDB())("the task board's live read", (it) => {
  it.effect(
    "a task's board is answered polled with its rows inline for an account that reaches it, and not found for one that does not",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const eli = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        yield* writeDrawing(dana, started.id, BOX);

        const own = yield* askBoard({ bearer: dana, taskId: started.id });
        assert.equal(own.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(taskBoardLiveAnswerSchema)(own.body);
        assert.equal(answer.url, LIVE_POLL_URL);
        assert.deepEqual(
          Schema.decodeUnknownSync(taskBoardLiveRowsSchema)({ board: answer.queries.board.rows }),
          { board: [{ taskId: started.id, drawingNumber: 1, appliedDrawing: 0, imaged: false }] },
        );

        const notFound = {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        };
        assert.deepEqual(yield* askBoard({ bearer: eli, taskId: started.id }), notFound);
        assert.deepEqual(yield* askBoard({ bearer: dana, taskId: "not-a-task" }), notFound);
      }),
  );

  it.effect(
    "a task's pages and calls are answered polled a part each for an account that reaches it, and not found for one that does not",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const eli = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        const ask = (bearer: string) =>
          askBoard({
            bearer,
            taskId: started.id,
            path: "/api/live/task-record",
          });

        const own = yield* ask(dana);
        assert.equal(own.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(taskRecordLiveAnswerSchema)(own.body);
        assert.equal(answer.url, LIVE_POLL_URL);
        for (const query of [answer.queries.pages, answer.queries.calls]) {
          assert.deepEqual(query.rows, [], "the task holds no pages or calls yet");
        }
        assert.deepEqual(yield* ask(eli), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        });
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
          yield* askBoard({
            bearer: eli,
            taskId: started.id,
            path,
          }),
          { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
        );
        assert.deepEqual(
          yield* askBoard({
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

        const polled = yield* askBoard({ bearer: dana, taskId: started.id, path });
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
        const coder = yield* createCodingAgent(dana, {
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
          yield* askBoard({
            bearer: eli,
            taskId: started.id,
            path,
          }),
          { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
        );

        const polled = yield* askBoard({ bearer: dana, taskId: started.id, path });
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

        const own = yield* askBoard({ bearer: dana, taskId: started.id, path });
        assert.equal(own.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(taskHistoryLiveAnswerSchema)(own.body);
        assert.equal(answer.url, LIVE_POLL_URL);
        assert.deepEqual(answer.queries.revisions.rows, [], "the plan is not saved yet");
        assert.deepEqual(
          yield* askBoard({
            bearer: eli,
            taskId: started.id,
            path,
          }),
          { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
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
        const started = yield* createCodingAgent(owner, {
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
        const poll = (after: string) =>
          askBoard({ bearer: dana, taskId: started.id, poll: true, after });
        const first = yield* askBoard({ bearer: dana, taskId: started.id });
        const seen = Schema.decodeUnknownSync(taskBoardLiveAnswerSchema)(first.body);
        const digest = liveDigestOf(seen.queries);
        assert.ok(digest !== undefined);

        const unchanged = yield* Effect.forkChild(poll(digest));
        yield* TestClock.adjust(Duration.seconds(25));
        const held = Schema.decodeUnknownSync(taskBoardLiveAnswerSchema)(
          (yield* Fiber.join(unchanged)).body,
        );
        assert.equal(held.queries.board.rows, undefined, "unchanged carries no rows");
        assert.equal(liveDigestOf(held.queries), digest);

        const moved = yield* Effect.forkChild(poll(digest));
        yield* TestClock.adjust(Duration.seconds(3));
        yield* writeDrawing(dana, started.id, BOX);
        yield* TestClock.adjust(Duration.seconds(3));
        const answer = Schema.decodeUnknownSync(taskBoardLiveAnswerSchema)(
          (yield* Fiber.join(moved)).body,
        );
        assert.deepEqual(
          Schema.decodeUnknownSync(taskBoardLiveRowsSchema)({ board: answer.queries.board.rows }),
          { board: [{ taskId: started.id, drawingNumber: 1, appliedDrawing: 0, imaged: false }] },
        );
        assert.notEqual(liveDigestOf(answer.queries), digest);
      }),
  );

  it.effect("a polled statement's rows in another order digest alike", () =>
    Effect.gen(function* () {
      const sealer = pollSealer(yield* SqlClient.SqlClient);
      const one = yield* sealer.seal({
        sql: "select * from (values (1), (2)) as rows(n) order by n",
        params: [],
      });
      const other = yield* sealer.seal({
        sql: "select * from (values (1), (2)) as rows(n) order by n desc",
        params: [],
      });
      assert.notDeepEqual(one.rows, other.rows);
      assert.equal(one.digest, other.digest);
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
            yield* askBoard({ bearer: dana, forUser, taskId: started.id }),
            signedOut,
          );
          assert.deepEqual(yield* askBoard({ bearer: dana, forUser }), signedOut);
          assert.deepEqual(
            yield* askBoard({
              bearer: dana,
              forUser,
              taskId: started.id,
              path: "/api/live/task-record",
            }),
            signedOut,
          );
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
        const started = yield* createCodingAgent(owner, {
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
