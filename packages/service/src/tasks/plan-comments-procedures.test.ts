import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  actOnPlanCommentThread,
  PLAN_COMMENT_OUTCOME,
  startPlanCommentThread,
} from "@luke/database/models/plan-comments";
import { createTask, savePlanText } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, leaveWorkspace, openWorkspace } from "@luke/database/testing";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_SCOPE,
  planCommentsAnswerSchema,
} from "@luke/features/plan-comment-wire";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Context, Duration, Effect, Layer, Option, Queue, Result } from "effect";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { syncHub } from "../sync/hub.js";
import { Sync, type SyncShape } from "../sync/watch.js";
import { announcingClock, driven } from "../testing/clock-driven.js";
import { planCommentsProcedures } from "./plan-comments-procedures.js";

/**
 * A plan's comments read held on Luke Sync, through the route a desktop
 * holds: a read at the current cursor answers within a coalesce window of
 * a thread started, answered, or deleted on the plan, and of the reader
 * leaving the plan's workspace, which it then answers as not found. A hold
 * that watched the wrong topics would answer none of these before the hold
 * ends. The hub's waits run on a clock that announces each one, so a write
 * the database is still delivering is never outrun.
 *
 * Synthetic accounts, plans, and comments throughout.
 */

const ORIGIN = "https://luke.test";

/** The hub's coalesce window: how long a woken watch gathers before it answers. */
const COALESCE = Duration.millis(100);

const PLAN_TEXT = "## Goal\n\nAn admin invites a teammate by email.\n";

const WORDS = "An admin invites a teammate by email.";

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** A plan in a workspace its owner made and a teammate joined. */
const openSharedPlan = Effect.gen(function* () {
  const owner = yield* openAccount;
  const teammate = yield* openAccount;
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const { id: taskId } = yield* createTask(owner, { organizationId: workspace, name: "Invites" });
  yield* savePlanText(owner, taskId, PLAN_TEXT);
  return { owner, teammate, workspace, taskId };
});

/** A thread the member starts on the plan's one sentence, answering its id. */
const started = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const from = PLAN_TEXT.indexOf(WORDS);
    const outcome = yield* startPlanCommentThread(
      { actor: PLAN_COMMENT_ACTOR.MEMBER, userId },
      taskId,
      {
        clientKey: randomUUID(),
        scope: PLAN_COMMENT_SCOPE.WORDS,
        quote: WORDS,
        anchor: { from, to: from + WORDS.length },
        text: PLAN_TEXT,
        words: "Is this in v1?",
      },
    );
    if (outcome.status !== PLAN_COMMENT_OUTCOME.DONE || !("thread" in outcome.answer)) {
      return assert.fail("the thread was not started");
    }
    return outcome.answer.thread.id;
  });

/** The comments route on the hub, each wait announced on `asleep` and each look a held read begins on `looking`. */
const onHub = Effect.gen(function* () {
  const { clock, asleep } = yield* announcingClock;
  const looking = yield* Queue.unbounded<void>();
  const hub = Context.get(yield* Layer.build(syncHub), Sync);
  const announcing: SyncShape = {
    watch: (topics, fallback) =>
      Effect.map(hub.watch(topics, fallback), (watch) => ({
        next: Effect.andThen(Queue.offer(looking, undefined), watch.next),
      })),
  };
  const services = Layer.mergeAll(
    Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
    Layer.succeed(Database, yield* Database),
    Layer.succeed(Clock.Clock, clock),
    Layer.succeed(Sync, announcing),
  );
  // SAFETY: the read yields the database, the clock, and the hub alone, which is all a test provides of the web runtime's services.
  const context = (yield* Effect.context<SqlClient.SqlClient>().pipe(
    Effect.provide(services),
  )) as Context.Context<WebServices>;
  const handle = hostedFetch({
    planComments: planCommentsProcedures({
      resolveUserId: (asked) =>
        Effect.succeed(
          Option.fromNullishOr(asked.headers.get("authorization")?.replace("Bearer ", "")),
        ),
      eveOrigin: () => undefined,
    }),
  });
  /** The plan's comments read as the account, past the cursor where one is named. */
  const read = (userId: string, taskId: string, after?: string) =>
    Effect.gen(function* () {
      const url = new URL(`/api/plans/${taskId}/comments`, ORIGIN);
      if (after !== undefined) url.searchParams.set("after", after);
      const response = yield* Effect.promise(() =>
        handle(new Request(url, { headers: { authorization: `Bearer ${userId}` } }), context),
      );
      return { status: response.status, body: yield* Effect.promise(() => response.text()) };
    });
  return { read, asleep, looking: Queue.asDequeue(looking) };
});

/** What a read answered, failing the test where it does not read. */
function readIn(answered: { readonly body: string }) {
  const read = readEither(planCommentsAnswerSchema)(unparsedWire(JSON.parse(answered.body)));
  if (Result.isFailure(read)) return assert.fail(answered.body);
  return read.success;
}

/** The ids of the threads a read answered. */
function threadIdsIn(answered: { readonly body: string }): readonly string[] {
  return readIn(answered).threads.map((thread) => thread.id);
}

/**
 * Holds the reader's read at the cursor they read last, makes the write
 * once its first look found nothing moved, and answers what the write and
 * the read answered, failing unless the read answered within a coalesce
 * window of the write.
 */
const heldThrough = <A, E, R>(
  hub: Effect.Success<typeof onHub>,
  reader: string,
  taskId: string,
  write: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const { cursor: after } = readIn(yield* hub.read(reader, taskId));
    const fiber = yield* Effect.forkChild(hub.read(reader, taskId, after), {
      startImmediately: true,
    });
    yield* Queue.take(hub.looking);
    // Note that the waits announced while the read was held count for nothing now.
    yield* Queue.clear(hub.asleep);
    const from = yield* Clock.currentTimeMillis;
    const value = yield* write;
    const answered = yield* driven({ fiber, asleep: hub.asleep }, COALESCE);
    assert.ok(
      (yield* Clock.currentTimeMillis) - from <= Duration.toMillis(COALESCE),
      "the read answered within a coalesce window of the write",
    );
    return { value, answered };
  });

it.layer(getTestDB())("a plan's comments read held on Luke Sync", (it) => {
  it.effect(
    "a teammate's thread started, answered, and deleted each wake a member's held read at once",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* onHub;
          const { owner, teammate, taskId } = yield* openSharedPlan;
          const writer = { actor: PLAN_COMMENT_ACTOR.MEMBER, userId: teammate } as const;

          const start = yield* heldThrough(hub, owner, taskId, started(teammate, taskId));
          assert.deepEqual(threadIdsIn(start.answered), [start.value]);
          const reply = yield* heldThrough(
            hub,
            owner,
            taskId,
            actOnPlanCommentThread(writer, taskId, start.value, {
              action: PLAN_COMMENT_ACTION.REPLY,
              clientKey: randomUUID(),
              words: "Yes, withdrawing ships first.",
            }),
          );
          assert.equal(reply.answered.status, HOSTED_HTTP_STATUS.OK);
          const deleted = yield* heldThrough(
            hub,
            owner,
            taskId,
            actOnPlanCommentThread(writer, taskId, start.value, {
              action: PLAN_COMMENT_ACTION.DELETE_THREAD,
            }),
          );
          assert.deepEqual(threadIdsIn(deleted.answered), []);
        }),
      ),
  );

  it.effect(
    "a member who leaves the workspace has their held read answered not found at once",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* onHub;
          const { owner, teammate, workspace, taskId } = yield* openSharedPlan;
          yield* started(owner, taskId);

          const left = yield* heldThrough(
            hub,
            teammate,
            taskId,
            leaveWorkspace(workspace, teammate),
          );

          assert.equal(left.answered.status, HOSTED_HTTP_STATUS.NOT_FOUND);
        }),
      ),
  );
});
