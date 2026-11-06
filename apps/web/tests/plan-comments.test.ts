import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import { archiveAgent, createAgent } from "@repo/database/models/agent-store";
import { writePage } from "@repo/database/models/plan-pages";
import { claimRuntimeSession } from "@repo/database/models/recorded-session";
import { createTask, savePlanText } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import { messages } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import {
  fakeWorkspaceSeams,
  getTestDB,
  joinWorkspace,
  openWorkspace,
} from "@repo/database/testing";
import { AGENT_PAYER, MAXIMUM_ATTACHMENTS_BODY_BYTES } from "@repo/features/agent-wire";
import { PAGE_SHOWER, taskPageOwner } from "@repo/features/page-wire";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_BOUNDS,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_REFUSAL,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  PLAN_COMMENTS_CURSOR_START,
  type PlanCommentActionRequest,
  type PlanCommentStart,
  type PlanCommentThread,
  planCommentsAnswerSchema,
  planCommentThreadAnswerSchema,
} from "@repo/features/plan-comment-wire";
import type { PlanEditRequest } from "@repo/features/plan-edit";
import { CODER } from "@repo/service/agents/coder-host/bounds";
import {
  type AgentSessions,
  EVE_SEND_OUTCOME,
  type EveMessage,
} from "@repo/service/agents/eve-host/eve-sessions";
import { sessionSandboxesLayer } from "@repo/service/agents/session-sandboxes";
import { recordingProductAnalytics, SERVER_EVENT } from "@repo/service/events/server-events";
import { type AfterResponse, keptAfterResponse } from "@repo/service/http/after-response";
import { HOSTED_HTTP_STATUS } from "@repo/service/http/http";
import { hostedFetch } from "@repo/service/orpc/handler";
import { modelCatalogOf } from "@repo/service/providers/model-catalog";
import type { WebServices } from "@repo/service/runtime";
import { planCommentsProcedures } from "@repo/service/tasks/plan-comments-procedures";
import { tasksProcedures } from "@repo/service/tasks/tasks-procedures";
import { connectAgentApiKeys } from "@repo/service/testing/agent-credentials";
import { announcingClock, driven } from "@repo/service/testing/clock-driven";
import { NO_GITHUB } from "@repo/service/testing/github-app-fake";
import {
  CONNECTOR_ASKED_NOTHING,
  integrationConnectOf,
} from "@repo/service/testing/integration-connect";
import { scriptedHarnessLayer } from "@repo/service/testing/native-harness-fake";
import { keepAwakeDetached } from "@repo/service/testing/session-sandboxes-fake";
import { EXPERIMENT } from "@repo/settings";
import { unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { sql } from "drizzle-orm";
import { Clock, type Context, DateTime, Effect, Layer, Option, Queue, Result } from "effect";
import { SqlClient } from "effect/sql";

/**
 * A plan's comment threads through the paths a desktop calls, answered by
 * the hosted oRPC router as the deployed route answers them, over a real
 * dialect: a member starts a thread on a teammate's plan and every member
 * reads it, named by its writer; a reader whose cursor is behind reads it at
 * once, and one whose cursor is current is held until something moves or
 * the hold ends, on the test's clock; an account outside the workspace
 * reads and writes nothing, exactly as for a plan that does not exist; and
 * the developer's edit that deletes the anchored words leaves the thread its
 * quote, while the edit their editor's undo sends anchors it again.
 *
 * Synthetic accounts, bearers, and plans throughout.
 */

const ORIGIN = "https://app.test";
const EDIT = (taskId: string) => `/api/plans/${taskId}/edit`;

const commentsPath = (taskId: string) => `/api/plans/${taskId}/comments`;
const threadPath = (taskId: string, threadId: string) => `${commentsPath(taskId)}/${threadId}`;

const PLAN_TEXT =
  "## Goal\n\nAn admin invites a teammate by email.\n\n## Approach\n\nAdmins can withdraw an invite from the members page. A withdrawn link never grants access again.\n";

const WORDS = "Admins can withdraw an invite from the members page.";

interface Answered {
  readonly status: number;
  readonly body: string;
}

/** The account's Plans turned on or off, which its agents are handed a plan's comment threads by. */
const plansFor = (userId: string, on: boolean) =>
  writeAccountPreferences(userId, { experiments: { [EXPERIMENT.PLANS]: on } });

/** An account with Plans on, whose agents are handed a plan's comment threads only then. */
const openAccount = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@app.test` });
    yield* plansFor(id, true);
    return id;
  });

/** Every bearer `Bearer <account>`. */
const resolveUserId = (incoming: Request) =>
  Effect.succeed(
    Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
  );

/** Every message the fake eve was asked to open a session with, in order. */
const opened: EveMessage[] = [];

/** eve as the routes reach it under the member's bearer: every open accepted and written down, no other call made. */
const fakeEve = (): AgentSessions => ({
  open: (message) =>
    Effect.sync(() => {
      opened.push(message);
      return {
        outcome: EVE_SEND_OUTCOME.ACCEPTED,
        sessionId: `wrun_01M${String(opened.length).padStart(22, "0")}`,
      };
    }),
  send: (sessionId, message) =>
    Effect.sync(() => {
      opened.push(message);
      return {
        outcome: EVE_SEND_OUTCOME.ACCEPTED,
        sessionId,
        deliveryId: `delivery-${opened.length}`,
      };
    }),
  cancel: () => Effect.die(new Error("this suite cancels nothing")),
  reset: () => Effect.die(new Error("this suite retires no session")),
});

/** What the routes counted, across the file; a case reads its own account's. */
const ANALYTICS = recordingProductAnalytics();

/** The properties of each event of one name the account was counted for, in order. */
const countedProperties = (userId: string, name: string) =>
  ANALYTICS.recorded
    .filter((event) => event.userId === userId && event.name === name)
    .map((event) => event.properties);

/** The services a request runs on: the test's own database and clock, the analytics, no GitHub or model catalog, and where a case keeps it, the work run past the answer. */
const servicesOver = (clock: Clock.Clock, after: Layer.Layer<AfterResponse> | undefined) =>
  Effect.gen(function* () {
    return Layer.mergeAll(
      after ?? Layer.empty,
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, clock),
      NO_GITHUB,
      modelCatalogOf([]),
      integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
      ANALYTICS.layer,
      scriptedHarnessLayer(fakeEve),
    );
  });

/** The web runtime's services as a request runs on them: the test's own database and clock. */
const webServicesOver = (clock: Clock.Clock, after?: Layer.Layer<AfterResponse>) =>
  Effect.gen(function* () {
    const provided = yield* Effect.context<Database>().pipe(
      Effect.provide(yield* servicesOver(clock, after)),
    );
    // SAFETY: the procedures yield the database, the clock, GitHub and the analytics alone, which is all a test provides of the web runtime's services.
    return provided as Context.Context<WebServices>;
  });

/** The comments resource behind the hosted handler, answering one request on the clock handed in, keeping the work past its answer where `after` keeps it. */
const commentsAnswer = (request: Request, clock: Clock.Clock, after?: Layer.Layer<AfterResponse>) =>
  Effect.gen(function* () {
    const services = yield* webServicesOver(clock, after);
    const handle = hostedFetch({
      planComments: planCommentsProcedures({
        resolveUserId,
      }),
    });
    const response = yield* Effect.promise(() => handle(request, services));
    return {
      status: response.status,
      body: yield* Effect.promise(() => response.text()),
      cacheControl: response.headers.get("cache-control"),
    };
  });

/** One request answered on the test's own clock: the comments resource, or the plans resource's edit. */
const answer = (routes: "comments" | "plans", request: Request) =>
  Effect.gen(function* () {
    if (routes === "comments") return yield* commentsAnswer(request, yield* Clock.Clock);
    const services = yield* webServicesOver(yield* Clock.Clock);
    const plans = hostedFetch({
      plans: tasksProcedures({
        resolveUserId,
        workspaces: yield* fakeWorkspaceSeams,
        sessionSandboxes: sessionSandboxesLayer,
        keepAwake: keepAwakeDetached,
      }),
    });
    const response = yield* Effect.promise(() => plans(request, services));
    return {
      status: response.status,
      body: yield* Effect.promise(() => response.text()),
    } satisfies Answered;
  });

function request(
  path: string,
  userId: string,
  query: Record<string, string>,
  body?: PlanCommentStart | PlanCommentActionRequest | PlanEditRequest,
): Request {
  const url = new URL(path, ORIGIN);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${userId}`,
      ...(body === undefined ? undefined : { "content-type": "application/json" }),
    },
    ...(body === undefined ? undefined : { body: JSON.stringify(body) }),
  });
}

/** The threads a read answered, failing the test where it does not read. */
function threadsIn(answered: Answered): readonly PlanCommentThread[] {
  const read = readEither(planCommentsAnswerSchema)(unparsedWire(JSON.parse(answered.body)));
  if (Result.isFailure(read)) return assert.fail(answered.body);
  return read.success.threads;
}

/** The thread a write answered, failing the test where it answered none. */
function threadIn(answered: Answered): PlanCommentThread {
  const read = readEither(planCommentThreadAnswerSchema)(unparsedWire(JSON.parse(answered.body)));
  if (Result.isFailure(read) || !("thread" in read.success)) return assert.fail(answered.body);
  return read.success.thread;
}

/** A plan with the text above, in a workspace the owner made and the teammate joined, and an account in neither. */
const openSharedTask = Effect.gen(function* () {
  const owner = yield* openAccount("Dean Stratakos");
  // Our key pays for no coding agent, so the owner's agent takes the thread on the owner's own keys.
  yield* connectAgentApiKeys(owner);
  const teammate = yield* openAccount("Charles Pan");
  const outsider = yield* openAccount("Someone Else");
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const { id: taskId } = yield* createTask(owner, { organizationId: workspace, name: "Invites" });
  yield* savePlanText(owner, taskId, PLAN_TEXT);
  return { owner, teammate, outsider, taskId };
});

/** A coding agent the owner started on the task, its session standing, which a comment's mention hands the thread. */
const startAgent = (owner: string, taskId: string) =>
  Effect.gen(function* () {
    const { agent } = Option.getOrThrow(
      yield* createAgent(owner, {
        taskId,
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        repository: null,
        planSnapshot: null,
        prompt: "Draft the invite email.",
        runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        payer: AGENT_PAYER.API_KEY,
      }),
    );
    const claimed = yield* claimRuntimeSession(
      { userId: owner, conversationId: agent.conversationId },
      `wrun_${randomUUID()}`,
      yield* DateTime.nowAsDate,
    );
    assert.ok(claimed, "the agent's session stands");
    return agent.id;
  });

/** An agent's mention link, as a member's chip writes it. */
const agentLink = (taskId: string, agentId: string) =>
  `[@Invite email](https://vespin.dev/acme/plan/${taskId}/agent/${agentId})`;

/** A task's mention of the app, as a chip wrote it while a task had one. */
const appLink = (taskId: string) => `[@Vespin](https://vespin.dev/acme/plan/${taskId}/luke)`;

/** A start of a thread on the sentence above. */
function startBody(comment: string) {
  const from = PLAN_TEXT.indexOf(WORDS);
  return {
    clientKey: randomUUID(),
    scope: PLAN_COMMENT_SCOPE.WORDS,
    quote: WORDS,
    anchor: { from, to: from + WORDS.length },
    text: PLAN_TEXT,
    words: comment,
  };
}

it.layer(getTestDB())("a plan's comment threads through the routes", (it) => {
  it.effect(
    "a thread a member started reads for every member past a stale cursor, and as nothing for an outsider",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, outsider, taskId } = yield* openSharedTask;

        const started = yield* answer(
          "comments",
          request(commentsPath(taskId), teammate, {}, startBody("Is withdrawing in v1?")),
        );
        assert.equal(started.status, HOSTED_HTTP_STATUS.CREATED);
        const thread = threadIn(started);

        const read = yield* answer(
          "comments",
          request(commentsPath(taskId), owner, { after: PLAN_COMMENTS_CURSOR_START }),
        );
        assert.equal(read.status, HOSTED_HTTP_STATUS.OK);
        const threads = threadsIn(read);
        assert.deepEqual(
          threads.map((each) => [each.id, each.section, each.entries[0]?.writer.by?.name]),
          [[thread.id, "Approach", "Charles Pan"]],
        );

        const outsiderRead = yield* answer("comments", request(commentsPath(taskId), outsider, {}));
        const outsiderStart = yield* answer(
          "comments",
          request(commentsPath(taskId), outsider, {}, startBody("Hello")),
        );
        const outsiderResolve = yield* answer(
          "comments",
          request(
            threadPath(taskId, thread.id),
            outsider,
            {},
            { action: PLAN_COMMENT_ACTION.RESOLVE },
          ),
        );
        assert.equal(outsiderRead.status, HOSTED_HTTP_STATUS.NOT_FOUND);
        assert.equal(outsiderStart.status, HOSTED_HTTP_STATUS.NOT_FOUND);
        assert.equal(outsiderResolve.status, HOSTED_HTTP_STATUS.NOT_FOUND);
        assert.deepEqual(countedProperties(teammate, SERVER_EVENT.PLAN_COMMENT), [
          { is_reply: false },
        ]);
        assert.deepEqual(
          countedProperties(outsider, SERVER_EVENT.PLAN_COMMENT),
          [],
          "a comment that wrote nothing counts nothing",
        );
      }),
  );

  it.effect("any member resolves a teammate's thread, and it reads resolved", () =>
    Effect.gen(function* () {
      const { owner, teammate, taskId } = yield* openSharedTask;
      const thread = threadIn(
        yield* answer("comments", request(commentsPath(taskId), teammate, {}, startBody("v1?"))),
      );

      const resolved = threadIn(
        yield* answer(
          "comments",
          request(
            threadPath(taskId, thread.id),
            owner,
            {},
            { action: PLAN_COMMENT_ACTION.RESOLVE },
          ),
        ),
      );

      assert.equal(resolved.status, PLAN_COMMENT_STATUS.RESOLVED);
    }),
  );

  it.effect(
    "an edit deleting the anchored words leaves the thread its quote, and the edit undo sends anchors it again",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;
        const thread = threadIn(
          yield* answer("comments", request(commentsPath(taskId), owner, {}, startBody("v1?"))),
        );
        const deleted = PLAN_TEXT.replace(`${WORDS} `, "");

        const deleting = yield* answer(
          "plans",
          request(
            EDIT(taskId),
            owner,
            {},
            {
              document: { base: PLAN_TEXT, value: deleted },
              comments: { anchors: [], carried: [thread.id] },
            },
          ),
        );
        assert.equal(deleting.status, HOSTED_HTTP_STATUS.OK);
        const afterDelete = threadsIn(
          yield* answer("comments", request(commentsPath(taskId), owner, {})),
        )[0];
        assert.equal(afterDelete?.anchor, undefined);
        assert.equal(afterDelete?.quote, WORDS);

        const from = PLAN_TEXT.indexOf(WORDS);
        yield* answer(
          "plans",
          request(
            EDIT(taskId),
            owner,
            {},
            {
              document: { base: deleted, value: PLAN_TEXT },
              comments: {
                anchors: [{ thread: thread.id, from, to: from + WORDS.length }],
                carried: [thread.id],
              },
            },
          ),
        );
        const afterUndo = threadsIn(
          yield* answer("comments", request(commentsPath(taskId), owner, {})),
        )[0];
        assert.deepEqual(afterUndo?.anchor, { from, to: from + WORDS.length });
        assert.deepEqual(countedProperties(owner, SERVER_EVENT.PLAN_EDIT), [{}, {}]);
      }),
  );
});

it.layer(getTestDB())("a plan's comment thread sent to an agent", (it) => {
  it.effect(
    "a thread started with an agent mentioned hands it the thread as the member's message, kept as the comment thread's line with what a window draws it by, and the thread says who asked it",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId } = yield* openSharedTask;
        const agentId = yield* startAgent(owner, taskId);
        const before = opened.length;

        const thread = threadIn(
          yield* answer(
            "comments",
            request(
              commentsPath(taskId),
              teammate,
              {},
              startBody(`${agentLink(taskId, agentId)} is withdrawing in v1?`),
            ),
          ),
        );

        const [message] = opened.slice(before);
        assert.ok(message, "the agent was handed the thread");
        // Note that the message is read as eve was handed it, its words wherever its parts hold them.
        const words = JSON.stringify(message.message);
        assert.ok(words.includes("Charles Pan sent you a comment thread"));
        assert.ok(words.includes(thread.id));
        const lines = yield* Database.use((db) =>
          db
            .select({ metadata: messages.metadata })
            .from(messages)
            .where(sql`${messages.metadata} ->> 'thread_id' = ${thread.id}`),
        );
        assert.deepEqual(
          lines.map((line) => line.metadata),
          [
            {
              channel: "comment",
              thread_id: thread.id,
              task_id: taskId,
              quote: WORDS,
              words: `${agentLink(taskId, agentId)} is withdrawing in v1?`,
            },
          ],
        );
        const [after] = threadsIn(
          yield* answer("comments", request(commentsPath(taskId), teammate, {})),
        );
        assert.deepEqual(
          after?.entries.map((entry) => [entry.kind, entry.asked?.actor]),
          [
            [PLAN_COMMENT_ENTRY.COMMENT, undefined],
            [PLAN_COMMENT_ENTRY.ASKED, PLAN_COMMENT_ACTOR.AGENT],
          ],
        );
      }),
  );

  it.effect(
    "a reply in a plan's thread reaches the agent an earlier comment mentioned, with no mention of its own, none while its starter has Plans off, said back as not sent, and none once it is archived",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId } = yield* openSharedTask;
        const agentId = yield* startAgent(owner, taskId);
        const thread = threadIn(
          yield* answer(
            "comments",
            request(
              commentsPath(taskId),
              teammate,
              {},
              startBody(`${agentLink(taskId, agentId)} is withdrawing in v1?`),
            ),
          ),
        );
        const before = opened.length;
        const reply = (words: string) =>
          answer(
            "comments",
            request(
              threadPath(taskId, thread.id),
              owner,
              {},
              { action: PLAN_COMMENT_ACTION.REPLY, clientKey: randomUUID(), words },
            ),
          );

        yield* reply("And withdrawing by email?");
        const [message] = opened.slice(before);
        assert.ok(message, "the agent in the thread was handed the reply");
        assert.ok(JSON.stringify(message.message).includes("And withdrawing by email?"));

        // An agent whose starter has Plans off is told nothing of the plan's comments.
        yield* plansFor(owner, false);
        const planless = readEither(planCommentThreadAnswerSchema)(
          unparsedWire(JSON.parse((yield* reply("And by link?")).body)),
        );
        assert.ok(Result.isSuccess(planless) && "thread" in planless.success);
        assert.deepEqual(planless.success.unsent, [{ actor: PLAN_COMMENT_ACTOR.AGENT, agentId }]);
        assert.equal(opened.length, before + 1, "the agent with Plans off was handed nothing");
        yield* plansFor(owner, true);

        yield* archiveAgent(owner, agentId, true);
        yield* reply("Never mind.");
        assert.equal(opened.length, before + 1, "the archived agent was handed nothing");
      }),
  );

  it.effect(
    "a comment on a page is answered first, then hands the thread to the agent that showed it, mentioned or not, naming the page and its version, Plans on or off, and one whose agent was archived is said back as not sent",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId } = yield* openSharedTask;
        const agentId = yield* startAgent(owner, taskId);
        // Note that a page's threads are no plan's, so its starter's Plans off keeps none of them from the agent.
        yield* plansFor(owner, false);
        const page = Option.getOrThrow(
          yield* writePage(
            owner,
            taskPageOwner(taskId),
            { title: "Invite funnel", html: "<h1>Invites</h1><p>12 sent</p>" },
            { kind: PAGE_SHOWER.AGENT, agentId },
          ),
        );
        const before = opened.length;
        const kept = keptAfterResponse();

        const thread = threadIn(
          yield* commentsAnswer(
            request(
              commentsPath(taskId),
              teammate,
              {},
              {
                clientKey: randomUUID(),
                page: { id: page.id, version: page.version },
                element: { path: "body > p", quote: "12 sent", section: "Invites" },
                words: "Is this a week's worth?",
              },
            ),
            yield* Clock.Clock,
            kept.layer,
          ),
        );
        assert.equal(opened.length, before, "the comment was answered before any agent was woken");
        yield* kept.run;

        const [message] = opened.slice(before);
        assert.ok(message, "the page's writer was handed the thread");
        const words = JSON.stringify(message.message);
        assert.ok(words.includes('the page \\"Invite funnel\\"'), words);
        assert.ok(words.includes(`version 1 of page ${page.id}`), words);
        assert.ok(words.includes(thread.id));

        yield* archiveAgent(owner, agentId, true);
        const replied = yield* answer(
          "comments",
          request(
            threadPath(taskId, thread.id),
            teammate,
            {},
            { action: PLAN_COMMENT_ACTION.REPLY, clientKey: randomUUID(), words: "Any news?" },
          ),
        );
        const read = readEither(planCommentThreadAnswerSchema)(
          unparsedWire(JSON.parse(replied.body)),
        );
        assert.ok(Result.isSuccess(read) && "thread" in read.success, replied.body);
        assert.deepEqual(read.success.unsent, [{ actor: PLAN_COMMENT_ACTOR.AGENT, agentId }]);
        assert.equal(opened.length, before + 1, "the archived agent was handed nothing");
      }),
  );

  it.effect(
    "a review of a page hands nothing over while its comments are held, then hands the page's writer every thread of it in one message once it is sent, each thread saying who was asked",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId } = yield* openSharedTask;
        const agentId = yield* startAgent(owner, taskId);
        const page = Option.getOrThrow(
          yield* writePage(
            owner,
            taskPageOwner(taskId),
            { title: "Invite funnel", html: "<h1>Invites</h1><p>12 sent</p>" },
            { kind: PAGE_SHOWER.AGENT, agentId },
          ),
        );
        const on = { id: page.id, version: page.version };
        const before = opened.length;

        const held = threadIn(
          yield* answer(
            "comments",
            request(
              commentsPath(taskId),
              teammate,
              {},
              {
                clientKey: randomUUID(),
                page: on,
                element: { path: "body > h1", quote: "Invites", section: "Invites" },
                words: "Say who it goes to.",
                held: true,
              },
            ),
          ),
        );
        assert.equal(opened.length, before, "a held comment hands over nothing");
        const sent = threadIn(
          yield* answer(
            "comments",
            request(
              commentsPath(taskId),
              teammate,
              {},
              {
                clientKey: randomUUID(),
                page: on,
                element: { path: "body > p", quote: "12 sent", section: "Invites" },
                words: "Is this a week's worth?",
                along: [held.id],
              },
            ),
          ),
        );

        const handed = opened.slice(before);
        assert.equal(handed.length, 1, "the review reached the page's writer as one message");
        const words = JSON.stringify(handed[0]?.message);
        assert.ok(words.includes("2 comment threads"), words);
        for (const said of [held.id, sent.id, "Say who it goes to.", "Is this a week's worth?"]) {
          assert.ok(words.includes(said), said);
        }
        const threads = threadsIn(
          yield* answer("comments", request(commentsPath(taskId), teammate, { page: page.id })),
        );
        assert.deepEqual(
          threads.map((thread) =>
            thread.entries.map((entry) => [entry.kind, entry.asked?.agentId]),
          ),
          [
            [
              [PLAN_COMMENT_ENTRY.COMMENT, undefined],
              [PLAN_COMMENT_ENTRY.ASKED, agentId],
            ],
            [
              [PLAN_COMMENT_ENTRY.COMMENT, undefined],
              [PLAN_COMMENT_ENTRY.ASKED, agentId],
            ],
          ],
        );
      }),
  );

  it.effect(
    "a thread started, or a reply, that mentions the task's Vespin hands no one the thread and writes nothing as Vespin, since no task has a Vespin of its own",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId } = yield* openSharedTask;
        const before = opened.length;

        const thread = threadIn(
          yield* answer(
            "comments",
            request(
              commentsPath(taskId),
              teammate,
              {},
              startBody(`${appLink(taskId)} is withdrawing in v1?`),
            ),
          ),
        );
        const replied = threadIn(
          yield* answer(
            "comments",
            request(
              threadPath(taskId, thread.id),
              owner,
              {},
              {
                action: PLAN_COMMENT_ACTION.REPLY,
                clientKey: randomUUID(),
                words: `${appLink(taskId)} what do you think?`,
              },
            ),
          ),
        );

        assert.equal(opened.length, before, "eve was asked nothing");
        assert.deepEqual(
          replied.entries.map((entry) => [entry.kind, entry.writer?.actor, entry.asked?.actor]),
          [
            [PLAN_COMMENT_ENTRY.COMMENT, PLAN_COMMENT_ACTOR.MEMBER, undefined],
            [PLAN_COMMENT_ENTRY.COMMENT, PLAN_COMMENT_ACTOR.MEMBER, undefined],
          ],
        );
        assert.deepEqual(countedProperties(teammate, SERVER_EVENT.PLAN_COMMENT), [
          { is_reply: false },
        ]);
        assert.deepEqual(countedProperties(owner, SERVER_EVENT.PLAN_COMMENT), [{ is_reply: true }]);
      }),
  );

  it.effect(
    "a reply that mentions an agent hands it the thread once, sent again or not, and one that mentions an agent not on the task asks it nothing",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId } = yield* openSharedTask;
        const agentId = yield* startAgent(owner, taskId);
        const thread = threadIn(
          yield* answer(
            "comments",
            request(commentsPath(taskId), teammate, {}, startBody("Is withdrawing in v1?")),
          ),
        );
        const reply = (words: string, clientKey: string) =>
          answer(
            "comments",
            request(
              threadPath(taskId, thread.id),
              owner,
              {},
              { action: PLAN_COMMENT_ACTION.REPLY, clientKey, words },
            ),
          );
        const before = opened.length;
        const key = randomUUID();
        const words = `${agentLink(taskId, agentId)} what do you think?`;

        yield* reply(words, key);
        yield* reply(words, key);
        assert.equal(opened.length - before, 1, "the agent was handed the thread once");
        assert.ok(
          JSON.stringify(opened.at(-1)?.message).includes(
            "Dean Stratakos sent you a comment thread",
          ),
        );
        yield* reply(
          `[@Other](https://vespin.dev/acme/plan/${randomUUID()}/agent/${randomUUID()}) saw this`,
          randomUUID(),
        );
        const [elsewhere] = threadsIn(
          yield* answer("comments", request(commentsPath(taskId), owner, {})),
        );

        assert.deepEqual(
          countedProperties(owner, SERVER_EVENT.PLAN_COMMENT),
          [{ is_reply: true }, { is_reply: true }],
          "the retry under the first key is not counted again",
        );
        assert.deepEqual(
          elsewhere?.entries.flatMap((entry) =>
            entry.kind === PLAN_COMMENT_ENTRY.ASKED ? [entry.asked?.agentId] : [],
          ),
          [agentId, agentId],
          "the other task's agent was asked nothing, and the agent in the thread was handed it again",
        );
      }),
  );

  it.effect(
    "a reply the store refuses hands no one the thread, though its words mention an agent",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;
        const agentId = yield* startAgent(owner, taskId);
        const taken = randomUUID();
        yield* answer(
          "comments",
          request(
            commentsPath(taskId),
            owner,
            {},
            { ...startBody("First thread"), clientKey: taken },
          ),
        );
        const other = threadIn(
          yield* answer("comments", request(commentsPath(taskId), owner, {}, startBody("Second"))),
        );
        const before = opened.length;

        const refused = yield* answer(
          "comments",
          request(
            threadPath(taskId, other.id),
            owner,
            {},
            {
              action: PLAN_COMMENT_ACTION.REPLY,
              clientKey: taken,
              words: `${agentLink(taskId, agentId)} please answer`,
            },
          ),
        );

        assert.deepEqual(JSON.parse(refused.body), { refused: PLAN_COMMENT_REFUSAL.KEY_TAKEN });
        assert.equal(opened.length, before, "the agent was handed nothing");
      }),
  );

  it.effect(
    "a reply sent again under its key with other words that mention an agent hands it nothing, since those words never posted",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;
        const agentId = yield* startAgent(owner, taskId);
        const thread = threadIn(
          yield* answer("comments", request(commentsPath(taskId), owner, {}, startBody("v1?"))),
        );
        const key = randomUUID();
        const reply = (words: string) =>
          answer(
            "comments",
            request(
              threadPath(taskId, thread.id),
              owner,
              {},
              { action: PLAN_COMMENT_ACTION.REPLY, clientKey: key, words },
            ),
          );
        yield* reply("No action needed.");
        const before = opened.length;

        const again = threadIn(yield* reply(`${agentLink(taskId, agentId)} please answer`));

        assert.equal(opened.length, before, "the agent was handed nothing");
        assert.equal(
          again.entries.filter((entry) => entry.kind === PLAN_COMMENT_ENTRY.ASKED).length,
          0,
        );
      }),
  );
});

it.layer(getTestDB())("a plan's comments read held on the test's clock", (it) => {
  /** A read past the cursor, forked on a clock that announces each wait it makes. */
  const heldRead = (userId: string, taskId: string, after: string) =>
    Effect.gen(function* () {
      const { clock, asleep } = yield* announcingClock;
      const fiber = yield* Effect.forkChild(
        commentsAnswer(request(commentsPath(taskId), userId, { after }), clock),
      );
      return { fiber, asleep };
    });

  it.effect(
    "a read at the current cursor is held, and answers the thread once one is started",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId } = yield* openSharedTask;
        const first = yield* answer("comments", request(commentsPath(taskId), owner, {}));
        const { cursor } = readEither(planCommentsAnswerSchema)(
          unparsedWire(JSON.parse(first.body)),
        ).pipe(Result.getOrThrow);

        const held = yield* heldRead(owner, taskId, cursor);
        yield* Queue.take(held.asleep);
        assert.equal(held.fiber.pollUnsafe(), undefined, "the read is held while nothing moved");
        const thread = threadIn(
          yield* answer(
            "comments",
            request(commentsPath(taskId), teammate, {}, startBody("Is withdrawing in v1?")),
          ),
        );
        const answered = yield* driven(held, CODER.MESSAGES_POLL);

        assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(answered.cacheControl, "private, no-store");
        assert.deepEqual(
          threadsIn(answered).map((each) => each.id),
          [thread.id],
        );
      }),
  );
});

it.layer(getTestDB())("the comment paths' refusals, byte for byte", (it) => {
  it.effect(
    "a plan the account does not reach is refused bare, as not found, with no cache header",
    () =>
      Effect.gen(function* () {
        const { outsider, taskId } = yield* openSharedTask;
        const answered = yield* answer("comments", request(commentsPath(taskId), outsider, {}));
        assert.deepEqual(answered, {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: '{"error":"not-found"}',
          cacheControl: null,
        });
      }),
  );

  it.effect("an id that is no UUID names no plan, as it always has", () =>
    Effect.gen(function* () {
      const { owner } = yield* openSharedTask;
      const answered = yield* answer("comments", request(commentsPath("not-a-plan"), owner, {}));
      assert.equal(answered.status, HOSTED_HTTP_STATUS.NOT_FOUND);
      assert.equal(answered.body, '{"error":"not-found"}');
    }),
  );

  it.effect(
    "a malformed cursor, and a body carrying a key its request does not name, are invalid",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;
        const cursor = yield* answer(
          "comments",
          request(commentsPath(taskId), owner, { after: "" }),
        );
        const excess = yield* answer(
          "comments",
          new Request(new URL(commentsPath(taskId), ORIGIN), {
            method: "POST",
            headers: { authorization: `Bearer ${owner}`, "content-type": "application/json" },
            body: JSON.stringify({ ...startBody("v1?"), extra: true }),
          }),
        );
        for (const answered of [cursor, excess]) {
          assert.equal(answered.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
          assert.equal(answered.body, '{"error":"invalid-request"}');
        }
      }),
  );

  it.effect("a reply whose stated length is past the action's cap is refused as too large", () =>
    Effect.gen(function* () {
      const { owner, taskId } = yield* openSharedTask;
      const thread = threadIn(
        yield* answer("comments", request(commentsPath(taskId), owner, {}, startBody("v1?"))),
      );
      const body = JSON.stringify({
        action: PLAN_COMMENT_ACTION.REPLY,
        clientKey: randomUUID(),
        words: "x".repeat(
          PLAN_COMMENT_BOUNDS.MAX_WORDS_CHARS * 6 + MAXIMUM_ATTACHMENTS_BODY_BYTES + 2_048,
        ),
      });
      const answered = yield* answer(
        "comments",
        new Request(new URL(threadPath(taskId, thread.id), ORIGIN), {
          method: "POST",
          headers: {
            authorization: `Bearer ${owner}`,
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(body)),
          },
          body,
        }),
      );
      assert.equal(answered.status, HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE);
      assert.equal(answered.body, '{"error":"request-too-large"}');
    }),
  );
});
