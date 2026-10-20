import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createTask, savePlanText } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import {
  fakeWorkspaceSeams,
  getTestDB,
  joinWorkspace,
  openWorkspace,
} from "@luke/database/testing";
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
  type PlanCommentStartRequest,
  type PlanCommentThread,
  planCommentsAnswerSchema,
  planCommentThreadAnswerSchema,
} from "@luke/features/plan-comment-wire";
import type { PlanEditRequest } from "@luke/features/plan-edit";
import {
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "@luke/service/agents/brain-host/eve-sessions";
import { CODER } from "@luke/service/agents/coder-host/bounds";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "@luke/service/http/http";
import { hostedFetch } from "@luke/service/orpc/handler";
import { modelCatalogOf } from "@luke/service/providers/model-catalog";
import type { WebServices } from "@luke/service/runtime";
import { planCommentsProcedures } from "@luke/service/tasks/plan-comments-procedures";
import { tasksProcedures } from "@luke/service/tasks/tasks-procedures";
import { announcingClock, driven } from "@luke/service/testing/clock-driven";
import { NO_GITHUB } from "@luke/service/testing/github-app-fake";
import {
  CONNECTOR_ASKED_NOTHING,
  integrationConnectOf,
} from "@luke/service/testing/integration-connect";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import {
  Clock,
  type Context,
  Duration,
  Effect,
  Layer,
  Option,
  Queue,
  Result,
  Stream,
} from "effect";
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

const ORIGIN = "https://luke.test";
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

const openAccount = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@luke.test` });
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
const fakeEve = (): EveSessions => ({
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
  stream: () => Stream.empty,
});

/** The services a request runs on: the test's own database and clock, and no GitHub or model catalog. */
const servicesOver = (clock: Clock.Clock) =>
  Effect.gen(function* () {
    return Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, clock),
      NO_GITHUB,
      modelCatalogOf([]),
      integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
    );
  });

/** The web runtime's services as a request runs on them: the test's own database and clock. */
const webServicesOver = (clock: Clock.Clock) =>
  Effect.gen(function* () {
    const provided = yield* Effect.context<Database>().pipe(
      Effect.provide(yield* servicesOver(clock)),
    );
    // SAFETY: the procedures yield the database, the clock and GitHub alone, which is all a test provides of the web runtime's services.
    return provided as Context.Context<WebServices>;
  });

/** The comments resource behind the hosted handler, answering one request on the clock handed in. */
const commentsAnswer = (request: Request, clock: Clock.Clock) =>
  Effect.gen(function* () {
    const services = yield* webServicesOver(clock);
    const handle = hostedFetch({
      planComments: planCommentsProcedures({
        resolveUserId,
        eveOrigin: () => undefined,
        eve: fakeEve,
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
        eveOrigin: () => undefined,
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
  body?: PlanCommentStartRequest | PlanCommentActionRequest | PlanEditRequest,
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
  const teammate = yield* openAccount("Charles Pan");
  const outsider = yield* openAccount("Someone Else");
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const { id: taskId } = yield* createTask(owner, { organizationId: workspace, name: "Invites" });
  yield* savePlanText(owner, taskId, PLAN_TEXT);
  return { owner, teammate, outsider, taskId };
});

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
      }),
  );
});

it.layer(getTestDB())("a plan's comment thread sent to Luke or an agent", (it) => {
  it.effect(
    "a thread started with Luke mentioned opens his planning turn on the thread, and the thread says who asked him",
    () =>
      Effect.gen(function* () {
        const { teammate, taskId } = yield* openSharedTask;
        const before = opened.length;

        const thread = threadIn(
          yield* answer(
            "comments",
            request(
              commentsPath(taskId),
              teammate,
              {},
              startBody(
                `[@Luke](https://tryluke.dev/acme/plan/${taskId}/luke) is withdrawing in v1?`,
              ),
            ),
          ),
        );

        const [message] = opened.slice(before);
        assert.ok(message, "Luke's planning turn was opened");
        // Note that the message is read as eve was handed it, its words wherever its parts hold them.
        const words = JSON.stringify(message.message);
        assert.ok(words.includes("Charles Pan sent you a comment thread"));
        assert.ok(words.includes(thread.id));
        const [after] = threadsIn(
          yield* answer("comments", request(commentsPath(taskId), teammate, {})),
        );
        assert.deepEqual(
          after?.entries.map((entry) => [entry.kind, entry.asked?.actor]),
          [
            [PLAN_COMMENT_ENTRY.COMMENT, undefined],
            [PLAN_COMMENT_ENTRY.ASKED, PLAN_COMMENT_ACTOR.LUKE],
          ],
        );
      }),
  );

  it.effect(
    "a reply that mentions Luke hands him the thread once, sent again or not, and one that mentions an agent not on the task asks no one",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId } = yield* openSharedTask;
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
        const words = `[@Luke](https://tryluke.dev/acme/plan/${taskId}/luke) what do you think?`;

        yield* reply(words, key);
        yield* reply(words, key);
        const elsewhere = threadIn(
          yield* reply(
            `[@Other](https://tryluke.dev/acme/plan/${randomUUID()}/agent/${randomUUID()}) saw this`,
            randomUUID(),
          ),
        );

        assert.equal(opened.length - before, 1, "Luke was handed the thread once");
        assert.ok(
          JSON.stringify(opened.at(-1)?.message).includes(
            "Dean Stratakos sent you a comment thread",
          ),
        );
        const [first] = threadsIn(
          yield* answer("comments", request(commentsPath(taskId), owner, {})),
        );
        assert.deepEqual(
          first?.entries.map((entry) => [entry.kind, entry.asked?.actor]),
          [
            [PLAN_COMMENT_ENTRY.COMMENT, undefined],
            [PLAN_COMMENT_ENTRY.COMMENT, undefined],
            [PLAN_COMMENT_ENTRY.ASKED, PLAN_COMMENT_ACTOR.LUKE],
            [PLAN_COMMENT_ENTRY.COMMENT, undefined],
          ],
        );
        assert.equal(
          elsewhere.entries.filter((entry) => entry.kind === PLAN_COMMENT_ENTRY.ASKED).length,
          1,
          "the other task's agent was asked nothing",
        );
      }),
  );

  it.effect(
    "a reply the store refuses hands no one the thread, though its words mention Luke",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;
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
              words: `[@Luke](https://tryluke.dev/acme/plan/${taskId}/luke) please answer`,
            },
          ),
        );

        assert.deepEqual(JSON.parse(refused.body), { refused: PLAN_COMMENT_REFUSAL.KEY_TAKEN });
        assert.equal(opened.length, before, "Luke was handed nothing");
      }),
  );

  it.effect(
    "a reply sent again under its key with other words that mention Luke hands him nothing, since those words never posted",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;
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

        const again = threadIn(
          yield* reply(`[@Luke](https://tryluke.dev/acme/plan/${taskId}/luke) please answer`),
        );

        assert.equal(opened.length, before, "Luke was handed nothing");
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

  it.effect(
    "a read at the current cursor is let go at the route's own hold, no sooner, answering the threads unchanged",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;
        const first = yield* answer("comments", request(commentsPath(taskId), owner, {}));
        const before = JSON.parse(first.body);

        const startedAt = yield* Clock.currentTimeMillis;
        const held = yield* heldRead(owner, taskId, before.cursor);
        const answered = yield* driven(held, CODER.MESSAGES_POLL);
        const heldFor = (yield* Clock.currentTimeMillis) - startedAt;

        assert.equal(heldFor, Duration.toMillis(CODER.MESSAGES_HOLD));
        assert.deepEqual(
          { status: answered.status, body: JSON.parse(answered.body) },
          { status: HOSTED_HTTP_STATUS.OK, body: before },
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
    "an unsigned caller is refused as unauthenticated, though its body is malformed too",
    () =>
      Effect.gen(function* () {
        const { taskId } = yield* openSharedTask;
        const answered = yield* answer(
          "comments",
          new Request(new URL(commentsPath(taskId), ORIGIN), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ words: 42 }),
          }),
        );
        assert.equal(answered.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
        assert.equal(answered.body, JSON.stringify({ error: HOSTED_API_ERROR.INVALID_TOKEN }));
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
        words: "x".repeat(PLAN_COMMENT_BOUNDS.MAX_WORDS_CHARS * 7),
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
