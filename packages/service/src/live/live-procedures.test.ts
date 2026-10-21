import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import { pointBrowserTab, upsertBrowserTab } from "@luke/database/models/agent-browser-tabs";
import { writeDrawing } from "@luke/database/models/board-store";
import { ensureMember } from "@luke/database/models/chat-store";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { childConversationId } from "@luke/database/models/ids";
import { writePage } from "@luke/database/models/plan-pages";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace, startTask } from "@luke/database/testing";
import { AGENT_BROWSER_TAB_OPENER } from "@luke/features/agent-browser-tab-wire";
import { BOARD_ELEMENT_TYPE } from "@luke/features/board-vocabulary";
import { BROWSER_CURSOR_KIND } from "@luke/features/browser-agent-actions";
import { MEMBER_KIND } from "@luke/features/chat-wire";
import {
  accountInboxLiveAnswerSchema,
  agentTranscriptLiveAnswerSchema,
  LIVE_POLL,
  LIVE_POLL_URL,
  LIVE_USER_QUERY,
  liveDigestOf,
  macCommandsLiveAnswerSchema,
  scopeInboxLiveAnswerSchema,
  taskBoardLiveAnswerSchema,
  taskBoardLiveRowsSchema,
  taskBrowserTabsLiveAnswerSchema,
  taskBrowserTabsLiveRowsSchema,
  taskHistoryLiveAnswerSchema,
  taskPagesLiveAnswerSchema,
  taskPagesLiveRowsSchema,
  taskRecordLiveAnswerSchema,
  workspaceChatLiveAnswerSchema,
} from "@luke/features/live-wire";
import { PAGE_SHOWER } from "@luke/features/page-wire";
import { sidebarLiveAnswerSchema } from "@luke/features/sidebar-live";
import { taskListLiveAnswerSchema } from "@luke/features/task-list-live";
import {
  workspaceInvitationsLiveAnswerSchema,
  workspaceMembersLiveAnswerSchema,
  workspacesLiveAnswerSchema,
} from "@luke/features/workspace-live";
import { EXPERIMENT } from "@luke/settings";
import type { WireBoundaryInput } from "@luke/wire";
import { Clock, Duration, Effect, Fiber, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { liveProcedures } from "./live-procedures.js";
import { type LiveSealer, LiveSealing, pollSealer, SealRefused } from "./realtime.js";

/**
 * The reads the desktop follows over Neon Realtime, sealed by the
 * procedure the way the hosted oRPC route answers it:
 * refused without a bearer, and otherwise every part of the account inbox
 * sealed for the bearer's own account, with the address to subscribe at;
 * a task's whiteboard sealed for an account that reaches the task and not
 * found for one that does not; and either answered with its rows inline at
 * the poll address where the reader asks to poll or Realtime is off or
 * cannot seal it; and a plan's inbox, or an agent's, sealed for an account
 * that reaches it and not found for one that does not.
 *
 * Synthetic accounts and bearers throughout; the secret is a script that
 * seals a statement as the values it was bound to, so a test can read whose
 * rows each sealed statement reads.
 */

const ORIGIN = "https://luke.test";
const LIVE_INBOX = "/api/live/inbox";
const REALTIME_URL = "wss://realtime.example/v1";

/** A sealer that seals a statement as its values, so whose read it is shows. */
const SCRIPTED: LiveSealer = {
  url: REALTIME_URL,
  seal: (statement: LiveStatement) =>
    Effect.succeed({
      capability: JSON.stringify(statement.params),
      queryFingerprint: statement.sql,
      expiresAt: 1_800_000_060_000,
    }),
};

/** A live read's address, naming the account it is for where one is named (`LIVE_USER_QUERY`). */
function readOf(path: string, forUser: string | undefined): URL {
  const url = new URL(path, ORIGIN);
  if (forUser !== undefined) url.searchParams.set(LIVE_USER_QUERY, forUser);
  return url;
}

/** The procedures answering one request as `bearer`, over the deployment's Realtime where it has one. */
const ask = (options: {
  readonly bearer?: string;
  readonly method?: string;
  /** The live read asked; the account inbox where left out. */
  readonly path?: string;
  /** The account the read names; the bearer's own where left out. */
  readonly forUser?: string;
  readonly sealing: Option.Option<LiveSealer>;
}) =>
  Effect.gen(function* () {
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
      Layer.succeed(LiveSealing, options.sealing),
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

it.effect("a request without a bearer is refused, and one by another method is not taken", () =>
  Effect.gen(function* () {
    assert.deepEqual(yield* ask({ sealing: Option.some(SCRIPTED) }), {
      status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
      body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
    });
    assert.deepEqual(
      yield* ask({ bearer: "user-dana", method: "POST", sealing: Option.some(SCRIPTED) }),
      {
        status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
        body: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
      },
    );
  }),
);

it.effect(
  "the commands no Mac has claimed are sealed for the bearer's own account, of the kinds the read names that this service queues, and a read naming another account is signed out",
  () =>
    Effect.gen(function* () {
      const dana = yield* ask({
        bearer: "user-dana",
        path: "/api/live/mac-commands?kinds=shell,browser",
        sealing: Option.some(SCRIPTED),
      });

      assert.equal(dana.status, HOSTED_HTTP_STATUS.OK);
      const answer = Schema.decodeUnknownSync(macCommandsLiveAnswerSchema)(dana.body);
      assert.equal(answer.url, REALTIME_URL);
      const read = answer.queries.commands.capability;
      assert.ok(read.includes('"user-dana"'), "read for the bearer");
      assert.ok(read.includes('"shell"'), "of the kinds the read names");
      assert.ok(!read.includes('"browser"'), "a kind this service no longer queues is passed over");
      assert.deepEqual(
        yield* ask({
          bearer: "user-dana",
          forUser: "user-eli",
          path: "/api/live/mac-commands",
          sealing: Option.some(SCRIPTED),
        }),
        {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
        },
        "a read naming another account is signed out",
      );
    }),
);

it.effect(
  "every part of the account inbox is sealed for the bearer's own account, with the address to subscribe at",
  () =>
    Effect.gen(function* () {
      const dana = yield* ask({ bearer: "user-dana", sealing: Option.some(SCRIPTED) });
      const eli = yield* ask({ bearer: "user-eli", sealing: Option.some(SCRIPTED) });

      assert.equal(dana.status, HOSTED_HTTP_STATUS.OK);
      const answer = Schema.decodeUnknownSync(accountInboxLiveAnswerSchema)(dana.body);
      assert.equal(answer.url, REALTIME_URL);
      const parts = Object.entries(answer.queries);
      assert.deepEqual(parts.map(([part]) => part).toSorted(), [
        "automations",
        "chatAsks",
        "chatNotices",
        "failedRuns",
        "items",
        "planless",
        "plans",
      ]);
      for (const [part, sealed] of parts) {
        assert.ok(sealed.capability.includes('"user-dana"'), `${part} is read for the bearer`);
        assert.ok(!sealed.capability.includes("user-eli"), `${part} is read for no one else`);
      }
      const theirs = Schema.decodeUnknownSync(accountInboxLiveAnswerSchema)(eli.body);
      assert.ok(
        Object.values(theirs.queries).every((sealed) => sealed.capability.includes('"user-eli"')),
      );
    }),
);

it.effect(
  "the task list is sealed as its tasks, its agents, and its tasks' issues for the bearer's own account",
  () =>
    Effect.gen(function* () {
      const dana = yield* ask({
        bearer: "user-dana",
        path: "/api/live/tasks",
        sealing: Option.some(SCRIPTED),
      });

      assert.equal(dana.status, HOSTED_HTTP_STATUS.OK);
      const answer = Schema.decodeUnknownSync(taskListLiveAnswerSchema)(dana.body);
      assert.equal(answer.url, REALTIME_URL);
      assert.deepEqual(Object.keys(answer.queries).toSorted(), ["agents", "issues", "plans"]);
      for (const sealed of Object.values(answer.queries)) {
        assert.ok(sealed.capability.includes('"user-dana"'), "read for the bearer");
      }
    }),
);

/** One box Luke drew, so the board has a row to read. */
const BOX = [{ type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "api", x: 0, y: 0, label: "API" }] as const;

/** A new account, as the store holds one. */
const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** The procedures answering a task's live read as `bearer`, its board's unless `path` names another, over the store and the deployment's Realtime. */
const askBoard = (options: {
  readonly bearer: string;
  /** The account the read names; the bearer's own where left out. */
  readonly forUser?: string;
  readonly taskId?: string;
  readonly path?: string;
  readonly poll?: boolean;
  /** The digest the reader last saw, which holds the poll until the rows move past it. */
  readonly after?: string;
  readonly sealing: Option.Option<LiveSealer>;
}) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(LiveSealing, options.sealing),
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
    "a task's board is sealed for an account that reaches it, not found for one that does not, and unavailable without Realtime",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const eli = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });

        const own = yield* askBoard({
          bearer: dana,
          taskId: started.id,
          sealing: Option.some(SCRIPTED),
        });
        assert.equal(own.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(taskBoardLiveAnswerSchema)(own.body);
        assert.equal(answer.url, REALTIME_URL);
        assert.ok(answer.queries.board.capability.includes(`"${dana}"`), "read for the bearer");
        assert.ok(answer.queries.board.capability.includes(`"${started.id}"`), "read for the task");

        const notFound = {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        };
        assert.deepEqual(
          yield* askBoard({ bearer: eli, taskId: started.id, sealing: Option.some(SCRIPTED) }),
          notFound,
        );
        assert.deepEqual(
          yield* askBoard({ bearer: dana, taskId: "not-a-task", sealing: Option.some(SCRIPTED) }),
          notFound,
        );
      }),
  );

  it.effect(
    "a board asked to poll, or one Realtime is off for or cannot seal, is answered with its rows inline at the poll address, as the statement reads them",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        yield* writeDrawing(dana, started.id, BOX);
        const refusing: LiveSealer = {
          url: REALTIME_URL,
          seal: () => Effect.fail(new SealRefused({ reason: "refused" })),
        };
        for (const [why, sealing, poll] of [
          ["asked to poll", Option.some(SCRIPTED), true],
          ["Realtime off", Option.none(), false],
          ["Realtime refusing", Option.some(refusing), false],
        ] as const) {
          const polled = yield* askBoard({ bearer: dana, taskId: started.id, poll, sealing });
          assert.equal(polled.status, HOSTED_HTTP_STATUS.OK, why);
          const answer = Schema.decodeUnknownSync(taskBoardLiveAnswerSchema)(polled.body);
          assert.equal(answer.url, LIVE_POLL_URL, why);
          assert.deepEqual(
            Schema.decodeUnknownSync(taskBoardLiveRowsSchema)({ board: answer.queries.board.rows }),
            {
              board: [{ taskId: started.id, drawingNumber: 1, appliedDrawing: 0, imaged: false }],
            },
            why,
          );
        }
        const sealed = yield* askBoard({
          bearer: dana,
          taskId: started.id,
          sealing: Option.some(SCRIPTED),
        });
        const answer = Schema.decodeUnknownSync(taskBoardLiveAnswerSchema)(sealed.body);
        assert.equal(answer.url, REALTIME_URL, "sealed where Realtime seals and nobody polls");
        assert.equal(answer.queries.board.rows, undefined);
      }),
  );

  it.effect(
    "a task's pages and calls are sealed a part each for an account that reaches it, and not found for one that does not",
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
            sealing: Option.some(SCRIPTED),
          });

        const own = yield* ask(dana);
        assert.equal(own.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(taskRecordLiveAnswerSchema)(own.body);
        assert.equal(answer.url, REALTIME_URL);
        for (const query of [answer.queries.pages, answer.queries.calls]) {
          assert.ok(query.capability.includes(`"${dana}"`), "read for the bearer");
          assert.ok(query.capability.includes(`"${started.id}"`), "read for the task");
        }
        assert.deepEqual(yield* ask(eli), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        });
      }),
  );

  it.effect(
    "a task's pages are sealed for an account that reaches the task, not found for one that does not, and asked to poll answered with their rows inline",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const eli = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        const shown = Option.getOrThrow(
          yield* writePage(
            dana,
            started.id,
            { title: "Invite funnel", html: "<p>One</p>" },
            { kind: PAGE_SHOWER.LUKE },
          ),
        );
        const path = "/api/live/task-pages";

        const sealed = yield* askBoard({
          bearer: dana,
          taskId: started.id,
          path,
          sealing: Option.some(SCRIPTED),
        });
        assert.equal(sealed.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(taskPagesLiveAnswerSchema)(sealed.body);
        assert.equal(answer.url, REALTIME_URL);
        assert.ok(answer.queries.pages.capability.includes(`"${dana}"`), "read for the bearer");
        assert.ok(answer.queries.pages.capability.includes(`"${started.id}"`), "read for the task");

        assert.deepEqual(
          yield* askBoard({
            bearer: eli,
            taskId: started.id,
            path,
            sealing: Option.some(SCRIPTED),
          }),
          { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
        );
        assert.deepEqual(
          yield* askBoard({
            bearer: dana,
            forUser: eli,
            taskId: started.id,
            path,
            sealing: Option.some(SCRIPTED),
          }),
          {
            status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
            body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
          },
          "a read started for another account is signed out",
        );

        const polled = yield* askBoard({
          bearer: dana,
          taskId: started.id,
          path,
          poll: true,
          sealing: Option.some(SCRIPTED),
        });
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
    "a task's Browser tabs are sealed for an account that reaches the task, not found for one that does not, and asked to poll answered with each tab's pointer inline",
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

        const sealed = yield* askBoard({
          bearer: dana,
          taskId: started.id,
          path,
          sealing: Option.some(SCRIPTED),
        });
        assert.equal(sealed.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(taskBrowserTabsLiveAnswerSchema)(sealed.body);
        assert.equal(answer.url, REALTIME_URL);
        assert.ok(answer.queries.tabs.capability.includes(`"${dana}"`), "read for the bearer");
        assert.ok(answer.queries.tabs.capability.includes(`"${started.id}"`), "read for the task");
        assert.deepEqual(
          yield* askBoard({
            bearer: eli,
            taskId: started.id,
            path,
            sealing: Option.some(SCRIPTED),
          }),
          { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
        );

        const polled = yield* askBoard({
          bearer: dana,
          taskId: started.id,
          path,
          poll: true,
          sealing: Option.some(SCRIPTED),
        });
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
    "a task's newest page of history is sealed for an account that reaches the task, and not found for one that does not",
    () =>
      Effect.gen(function* () {
        const dana = yield* openUser;
        const eli = yield* openUser;
        const started = yield* startTask(dana, { name: "Teammate invitations" });
        const path = "/api/live/task-history";

        const sealed = yield* askBoard({
          bearer: dana,
          taskId: started.id,
          path,
          sealing: Option.some(SCRIPTED),
        });
        assert.equal(sealed.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(taskHistoryLiveAnswerSchema)(sealed.body);
        assert.equal(answer.url, REALTIME_URL);
        const { capability } = answer.queries.revisions;
        assert.ok(capability.includes(`"${dana}"`), "read for the bearer");
        assert.ok(capability.includes(`"${started.id}"`), "read for the task");
        assert.deepEqual(
          yield* askBoard({
            bearer: eli,
            taskId: started.id,
            path,
            sealing: Option.some(SCRIPTED),
          }),
          { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
        );
      }),
  );

  it.effect("the account inbox Realtime is off for is answered with every part's rows inline", () =>
    Effect.gen(function* () {
      const dana = yield* openUser;
      const polled = yield* askBoard({ bearer: dana, sealing: Option.none() });
      assert.equal(polled.status, HOSTED_HTTP_STATUS.OK);
      const answer = Schema.decodeUnknownSync(accountInboxLiveAnswerSchema)(polled.body);
      assert.equal(answer.url, LIVE_POLL_URL);
      for (const [part, sealed] of Object.entries(answer.queries)) {
        assert.deepEqual(sealed.rows, [], `${part} holds nothing yet`);
      }
    }),
  );
});

/** The procedures answering an agent's transcript's live read as `bearer`, the worker's where `call` names one. */
const askTranscript = (options: {
  readonly bearer: string;
  readonly agentId: string;
  readonly call?: string;
  readonly sealing: Option.Option<LiveSealer>;
  /** The read asked, an agent's transcript where none is named. */
  readonly path?: string;
  /** The account the read names, the bearer's own where none is named. */
  readonly forUser?: string;
}) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(LiveSealing, options.sealing),
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
    "an agent's transcript, or a worker's by its call, is sealed as what its pages are read from, for an account that reaches the agent and under the conversation the call opens, and not found otherwise",
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

        const own = yield* askTranscript({
          bearer: owner,
          agentId: agent.id,
          sealing: Option.some(SCRIPTED),
        });
        assert.equal(own.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(agentTranscriptLiveAnswerSchema)(own.body);
        assert.equal(answer.url, REALTIME_URL);
        assert.deepEqual(Object.keys(answer.queries).toSorted(), [
          "agent",
          "conversation",
          "messages",
          "turns",
          "workers",
        ]);
        for (const query of Object.values(answer.queries)) {
          assert.ok(query.capability.includes(`"${owner}"`), "read for the agent's owner");
        }
        assert.ok(answer.queries.messages.capability.includes(`"${agent.conversationId}"`));

        const worker = Schema.decodeUnknownSync(agentTranscriptLiveAnswerSchema)(
          (yield* askTranscript({
            bearer: owner,
            agentId: agent.id,
            call: "call-7",
            sealing: Option.some(SCRIPTED),
          })).body,
        );
        const child = childConversationId(agent.conversationId, "call-7");
        assert.ok(worker.queries.messages.capability.includes(`"${child}"`));
        assert.ok(worker.queries.workers.capability.includes(`"${agent.conversationId}"`));

        for (const call of [undefined, "call-7"]) {
          const named = call === undefined ? {} : { call };
          assert.deepEqual(
            yield* askTranscript({
              bearer: stranger,
              agentId: agent.id,
              ...named,
              sealing: Option.some(SCRIPTED),
            }),
            { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
          );
          const polled = yield* askTranscript({
            bearer: owner,
            agentId: agent.id,
            ...named,
            sealing: Option.none(),
          });
          // Without Realtime the read is answered polled, its rows inline.
          assert.equal(
            Schema.decodeUnknownSync(agentTranscriptLiveAnswerSchema)(polled.body).url,
            LIVE_POLL_URL,
          );
        }
        assert.deepEqual(
          yield* askTranscript({
            bearer: owner,
            agentId: "not-an-agent",
            sealing: Option.some(SCRIPTED),
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
          askBoard({ bearer: dana, taskId: started.id, poll: true, after, sealing: Option.none() });
        const first = yield* askBoard({ bearer: dana, taskId: started.id, sealing: Option.none() });
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
        yield* TestClock.adjust(Duration.seconds(1));
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
          for (const poll of [false, true]) {
            assert.deepEqual(
              yield* askBoard({
                bearer: dana,
                forUser,
                taskId: started.id,
                poll,
                sealing: Option.none(),
              }),
              signedOut,
            );
          }
          assert.deepEqual(
            yield* askBoard({ bearer: dana, forUser, sealing: Option.none() }),
            signedOut,
          );
          assert.deepEqual(
            yield* askBoard({
              bearer: dana,
              forUser,
              taskId: started.id,
              path: "/api/live/task-record",
              sealing: Option.none(),
            }),
            signedOut,
          );
        }
      }),
  );
});

it.layer(getTestDB())("an agent transcript's live read", (it) => {
  it.effect(
    "an agent's transcript, or a worker's by its call, is sealed as what its pages are read from, for an account that reaches the agent and under the conversation the call opens, and not found otherwise",
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

        const own = yield* askTranscript({
          bearer: owner,
          agentId: agent.id,
          sealing: Option.some(SCRIPTED),
        });
        assert.equal(own.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(agentTranscriptLiveAnswerSchema)(own.body);
        assert.equal(answer.url, REALTIME_URL);
        assert.deepEqual(Object.keys(answer.queries).toSorted(), [
          "agent",
          "conversation",
          "messages",
          "turns",
          "workers",
        ]);
        for (const query of Object.values(answer.queries)) {
          assert.ok(query.capability.includes(`"${owner}"`), "read for the agent's owner");
        }
        assert.ok(answer.queries.messages.capability.includes(`"${agent.conversationId}"`));

        const worker = Schema.decodeUnknownSync(agentTranscriptLiveAnswerSchema)(
          (yield* askTranscript({
            bearer: owner,
            agentId: agent.id,
            call: "call-7",
            sealing: Option.some(SCRIPTED),
          })).body,
        );
        const child = childConversationId(agent.conversationId, "call-7");
        assert.ok(worker.queries.messages.capability.includes(`"${child}"`));
        assert.ok(worker.queries.workers.capability.includes(`"${agent.conversationId}"`));

        for (const call of [undefined, "call-7"]) {
          const named = call === undefined ? {} : { call };
          assert.deepEqual(
            yield* askTranscript({
              bearer: stranger,
              agentId: agent.id,
              ...named,
              sealing: Option.some(SCRIPTED),
            }),
            { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
          );
          const polled = yield* askTranscript({
            bearer: owner,
            agentId: agent.id,
            ...named,
            sealing: Option.none(),
          });
          // Without Realtime the read is answered polled, its rows inline.
          assert.equal(
            Schema.decodeUnknownSync(agentTranscriptLiveAnswerSchema)(polled.body).url,
            LIVE_POLL_URL,
          );
        }
        assert.deepEqual(
          yield* askTranscript({
            bearer: owner,
            agentId: "not-an-agent",
            sealing: Option.some(SCRIPTED),
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
          askBoard({ bearer: dana, taskId: started.id, poll: true, after, sealing: Option.none() });
        const first = yield* askBoard({ bearer: dana, taskId: started.id, sealing: Option.none() });
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
        yield* TestClock.adjust(Duration.seconds(1));
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
          for (const poll of [false, true]) {
            assert.deepEqual(
              yield* askBoard({
                bearer: dana,
                forUser,
                taskId: started.id,
                poll,
                sealing: Option.none(),
              }),
              signedOut,
            );
          }
          assert.deepEqual(
            yield* askBoard({ bearer: dana, forUser, sealing: Option.none() }),
            signedOut,
          );
          assert.deepEqual(
            yield* askBoard({
              bearer: dana,
              forUser,
              taskId: started.id,
              path: "/api/live/task-record",
              sealing: Option.none(),
            }),
            signedOut,
          );
        }
      }),
  );
});

/** The procedures answering a plan's or an agent's inbox read as `bearer`, over the store and the deployment's Realtime. */
const askScope = (options: {
  readonly bearer: string;
  readonly path: string;
  readonly id: string;
  readonly poll?: boolean;
  /** The account the read names; the bearer's own unless a test names another. */
  readonly userId?: string;
  readonly sealing: Option.Option<LiveSealer>;
}) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(LiveSealing, options.sealing),
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
    );
    const procedures = liveProcedures({
      resolveUserId: () => Effect.succeed(Option.some(options.bearer)),
    });
    const url = new URL(options.path, ORIGIN);
    url.searchParams.set("id", options.id);
    url.searchParams.set(LIVE_USER_QUERY, options.userId ?? options.bearer);
    if (options.poll === true) url.searchParams.set(LIVE_POLL.QUERY, LIVE_POLL.ON);
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
    "a plan's inbox, or an agent's, is sealed as its items, threads, and files for an account that reaches it, answered polled where asked, and not found for one that does not",
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
          const sealed = yield* askScope({
            bearer: owner,
            ...scope,
            sealing: Option.some(SCRIPTED),
          });
          assert.equal(sealed.status, HOSTED_HTTP_STATUS.OK, scope.path);
          const answer = Schema.decodeUnknownSync(scopeInboxLiveAnswerSchema)(sealed.body);
          assert.equal(answer.url, REALTIME_URL);
          assert.deepEqual(Object.keys(answer.queries).toSorted(), ["files", "items", "messages"]);
          for (const query of Object.values(answer.queries)) {
            assert.ok(query.capability.includes(`"${owner}"`), "read for the bearer");
          }
          const polled = yield* askScope({
            bearer: owner,
            ...scope,
            poll: true,
            sealing: Option.some(SCRIPTED),
          });
          const inline = Schema.decodeUnknownSync(scopeInboxLiveAnswerSchema)(polled.body);
          assert.equal(inline.url, LIVE_POLL_URL);
          assert.deepEqual(inline.queries.items.rows, []);
          assert.deepEqual(
            yield* askScope({ bearer: stranger, ...scope, sealing: Option.some(SCRIPTED) }),
            { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
          );
          assert.deepEqual(
            yield* askScope({
              bearer: owner,
              userId: stranger,
              ...scope,
              sealing: Option.some(SCRIPTED),
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
            sealing: Option.some(SCRIPTED),
          }),
          { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
        );
      }),
  );
});

/** The procedures answering a workspace chat's live read as `bearer`, over the store and the deployment's Realtime. */
const askChat = (options: {
  readonly bearer: string;
  readonly forUser?: string;
  readonly workspaceId?: string;
  readonly sealing: Option.Option<LiveSealer>;
}) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(LiveSealing, options.sealing),
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
    );
    const procedures = liveProcedures({
      resolveUserId: () => Effect.succeed(Option.some(options.bearer)),
    });
    const url = readOf("/api/live/workspace-chat", options.forUser ?? options.bearer);
    if (options.workspaceId !== undefined) url.searchParams.set("workspaceId", options.workspaceId);
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

it.layer(getTestDB())("the workspace chat's live read", (it) => {
  it.effect(
    "a workspace's chat is sealed part by part for a member who joined it, and not found for one who has not, an outsider, or one with Chat off",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const stranger = yield* openUser;
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        for (const account of [owner, teammate, stranger]) {
          yield* writeAccountPreferences(account, { experiments: { [EXPERIMENT.CHAT]: true } });
        }
        assert.ok(
          Option.isSome(
            yield* ensureMember(owner, workspace, { kind: MEMBER_KIND.HUMAN, userId: owner }),
          ),
        );
        const notFound = {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        };
        const chat = (bearer: string) =>
          askChat({ bearer, workspaceId: workspace, sealing: Option.some(SCRIPTED) });

        const sealed = yield* chat(owner);
        assert.equal(sealed.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(workspaceChatLiveAnswerSchema)(sealed.body);
        assert.equal(answer.url, REALTIME_URL);
        for (const [part, query] of Object.entries(answer.queries)) {
          assert.ok(query.capability.includes(`"${owner}"`), `${part} is read for the bearer`);
        }
        // The teammate has not joined, and sealing joins no one, so asking again is not found again.
        assert.deepEqual(yield* chat(teammate), notFound);
        assert.deepEqual(yield* chat(teammate), notFound);
        assert.deepEqual(yield* chat(stranger), notFound);
        // A session of another account than the read names is signed out.
        assert.deepEqual(
          yield* askChat({
            bearer: teammate,
            forUser: owner,
            workspaceId: workspace,
            sealing: Option.some(SCRIPTED),
          }),
          {
            status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
            body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
          },
        );
        yield* writeAccountPreferences(owner, { experiments: { [EXPERIMENT.CHAT]: false } });
        assert.deepEqual(yield* chat(owner), notFound);
      }),
  );
});

it.effect(
  "the account's workspaces are sealed as its workspaces and their installations for the bearer's own account",
  () =>
    Effect.gen(function* () {
      const path = "/api/live/workspaces";
      const sealed = yield* ask({ bearer: "user-dana", path, sealing: Option.some(SCRIPTED) });
      assert.equal(sealed.status, HOSTED_HTTP_STATUS.OK);
      const answer = Schema.decodeUnknownSync(workspacesLiveAnswerSchema)(sealed.body);
      assert.equal(answer.url, REALTIME_URL);
      assert.deepEqual(Object.keys(answer.queries).toSorted(), ["installations", "workspaces"]);
      for (const query of Object.values(answer.queries)) {
        assert.ok(query.capability.includes('"user-dana"'), "read for the bearer");
      }
      assert.deepEqual(yield* ask({ path, sealing: Option.some(SCRIPTED) }), {
        status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
        body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
      });
      // A read started for another account, as a page left open under a changed session asks, is signed out.
      assert.deepEqual(
        yield* ask({
          bearer: "user-dana",
          forUser: "user-erin",
          path,
          sealing: Option.some(SCRIPTED),
        }),
        {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
        },
      );
    }),
);

it.layer(getTestDB())("a workspace's people's live read", (it) => {
  it.effect(
    "a workspace's people are sealed as its members and former members for a member, and not found for an outsider",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const [owner, outsider] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
        for (const id of [owner, outsider]) {
          yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
        }
        const workspaceId = yield* openWorkspace(owner);
        const path = `/api/live/workspace-members?workspaceId=${workspaceId}`;

        const sealed = yield* ask({ bearer: owner, path, sealing: Option.some(SCRIPTED) });
        assert.equal(sealed.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(workspaceMembersLiveAnswerSchema)(sealed.body);
        assert.deepEqual(Object.keys(answer.queries).toSorted(), ["former", "members"]);
        for (const query of Object.values(answer.queries)) {
          assert.ok(query.capability.includes(`"${owner}"`), "read for the bearer");
          assert.ok(query.capability.includes(`"${workspaceId}"`), "read of the workspace");
        }
        assert.deepEqual(yield* ask({ bearer: outsider, path, sealing: Option.some(SCRIPTED) }), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        });
        // A read started for another account is signed out, before the workspace is looked at.
        assert.equal(
          (yield* ask({ bearer: owner, forUser: outsider, path, sealing: Option.some(SCRIPTED) }))
            .status,
          HOSTED_HTTP_STATUS.UNAUTHORIZED,
        );
      }),
  );

  it.effect(
    "a workspace's invitations are sealed with the service's origin for its owner, refused to a member, and not found for an outsider",
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

        const sealed = yield* ask({ bearer: owner, path, sealing: Option.some(SCRIPTED) });
        assert.equal(sealed.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(workspaceInvitationsLiveAnswerSchema)(sealed.body);
        assert.equal(answer.origin, ORIGIN);
        assert.ok(answer.queries.invitations.capability.includes(`"${owner}"`));
        assert.deepEqual(yield* ask({ bearer: teammate, path, sealing: Option.some(SCRIPTED) }), {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: { error: HOSTED_API_ERROR.NOT_PERMITTED },
        });
        assert.deepEqual(yield* ask({ bearer: outsider, path, sealing: Option.some(SCRIPTED) }), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        });
        assert.equal(
          (yield* ask({ bearer: owner, forUser: outsider, path, sealing: Option.some(SCRIPTED) }))
            .status,
          HOSTED_HTTP_STATUS.UNAUTHORIZED,
        );
      }),
  );
});

it.effect(
  "the account's sidebar is sealed as its sections, the tasks in them, and its pins, for the bearer's own account",
  () =>
    Effect.gen(function* () {
      const path = "/api/live/sidebar";
      const sealed = yield* ask({ bearer: "user-dana", path, sealing: Option.some(SCRIPTED) });
      assert.equal(sealed.status, HOSTED_HTTP_STATUS.OK);
      const answer = Schema.decodeUnknownSync(sidebarLiveAnswerSchema)(sealed.body);
      assert.deepEqual(Object.keys(answer.queries).toSorted(), ["entries", "pins", "sections"]);
      for (const query of Object.values(answer.queries)) {
        assert.ok(query.capability.includes('"user-dana"'), "read for the bearer");
      }
      assert.equal(
        (yield* ask({
          bearer: "user-dana",
          forUser: "user-erin",
          path,
          sealing: Option.some(SCRIPTED),
        })).status,
        HOSTED_HTTP_STATUS.UNAUTHORIZED,
      );
    }),
);
