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
import { HOSTED_HTTP_STATUS } from "@luke/service/http/http";
import { modelCatalogOf } from "@luke/service/providers/model-catalog";
import { planCommentsApp } from "@luke/service/tasks/plan-comments-app";
import { tasksApp } from "@luke/service/tasks/tasks-app";
import { NO_GITHUB } from "@luke/service/testing/github-app-fake";
import {
  CONNECTOR_ASKED_NOTHING,
  integrationConnectOf,
} from "@luke/service/testing/integration-connect";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";

/**
 * A plan's comment threads through the routes a desktop calls, over a real
 * dialect: a member starts a thread on a teammate's plan and every member
 * reads it, named by its writer; a reader whose cursor is behind reads it at
 * once; an account outside the workspace reads and writes nothing, exactly
 * as for a plan that does not exist; and the developer's edit that deletes
 * the anchored words leaves the thread its quote, while the edit their
 * editor's undo sends anchors it again.
 *
 * Synthetic accounts, bearers, and plans throughout.
 */

const ORIGIN = "https://luke.test";
const COMMENTS = "/api/plans/comments";
const THREAD = "/api/plans/comment-thread";
const EDIT = "/api/plans/edit";

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

/** One route group over the test's own database, answering one request. */
const answer = (routes: "comments" | "plans", request: Request) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      NO_GITHUB,
      modelCatalogOf([]),
      integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
    );
    const app =
      routes === "comments"
        ? planCommentsApp({ resolveUserId })
        : tasksApp({
            resolveUserId,
            workspaces: yield* fakeWorkspaceSeams,
            eveOrigin: () => undefined,
          });
    const { handler, dispose } = HttpRouter.toWebHandler(
      app.pipe(HttpRouter.provideRequest(services)),
      {
        disableLogger: true,
      },
    );
    const response = yield* Effect.promise(() => handler(request));
    const text = yield* Effect.promise(() => response.text());
    yield* Effect.promise(() => dispose());
    return {
      status: response.status,
      body: text,
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
    headers: { authorization: `Bearer ${userId}` },
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
const openSharedPlan = Effect.gen(function* () {
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
        const { owner, teammate, outsider, taskId } = yield* openSharedPlan;

        const started = yield* answer(
          "comments",
          request(COMMENTS, teammate, { id: taskId }, startBody("Is withdrawing in v1?")),
        );
        assert.equal(started.status, HOSTED_HTTP_STATUS.CREATED);
        const thread = threadIn(started);

        const read = yield* answer(
          "comments",
          request(COMMENTS, owner, { id: taskId, after: PLAN_COMMENTS_CURSOR_START }),
        );
        assert.equal(read.status, HOSTED_HTTP_STATUS.OK);
        const threads = threadsIn(read);
        assert.deepEqual(
          threads.map((each) => [each.id, each.section, each.entries[0]?.writer.by?.name]),
          [[thread.id, "Approach", "Charles Pan"]],
        );

        const outsiderRead = yield* answer("comments", request(COMMENTS, outsider, { id: taskId }));
        const outsiderStart = yield* answer(
          "comments",
          request(COMMENTS, outsider, { id: taskId }, startBody("Hello")),
        );
        const outsiderResolve = yield* answer(
          "comments",
          request(
            THREAD,
            outsider,
            { id: taskId, thread: thread.id },
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
      const { owner, teammate, taskId } = yield* openSharedPlan;
      const thread = threadIn(
        yield* answer("comments", request(COMMENTS, teammate, { id: taskId }, startBody("v1?"))),
      );

      const resolved = threadIn(
        yield* answer(
          "comments",
          request(
            THREAD,
            owner,
            { id: taskId, thread: thread.id },
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
        const { owner, taskId } = yield* openSharedPlan;
        const thread = threadIn(
          yield* answer("comments", request(COMMENTS, owner, { id: taskId }, startBody("v1?"))),
        );
        const deleted = PLAN_TEXT.replace(`${WORDS} `, "");

        const deleting = yield* answer(
          "plans",
          request(
            EDIT,
            owner,
            { id: taskId },
            {
              document: { base: PLAN_TEXT, value: deleted },
              comments: { anchors: [], carried: [thread.id] },
            },
          ),
        );
        assert.equal(deleting.status, HOSTED_HTTP_STATUS.OK);
        const afterDelete = threadsIn(
          yield* answer("comments", request(COMMENTS, owner, { id: taskId })),
        )[0];
        assert.equal(afterDelete?.anchor, undefined);
        assert.equal(afterDelete?.quote, WORDS);

        const from = PLAN_TEXT.indexOf(WORDS);
        yield* answer(
          "plans",
          request(
            EDIT,
            owner,
            { id: taskId },
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
          yield* answer("comments", request(COMMENTS, owner, { id: taskId })),
        )[0];
        assert.deepEqual(afterUndo?.anchor, { from, to: from + WORDS.length });
      }),
  );
});
