import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  actOnDescriptionCommentThread,
  DESCRIPTION_COMMENT_OUTCOME,
  startDescriptionCommentThread,
} from "@repo/database/models/description-comments";
import { createTask, saveDescriptionText } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, joinWorkspace, leaveWorkspace, openWorkspace } from "@repo/database/testing";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_SCOPE,
  descriptionCommentsAnswerSchema,
} from "@repo/features/description-comment-wire";
import { unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Clock, Context, Duration, Effect, Layer, Option, Queue, Result } from "effect";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { syncHub } from "../sync/hub.js";
import { Sync, type SyncShape } from "../sync/watch.js";
import { announcingClock, driven } from "../testing/clock-driven.js";
import { descriptionCommentsProcedures } from "./description-comments-procedures.js";

const ORIGIN = "https://app.test";

const COALESCE = Duration.millis(100);

const DESCRIPTION_TEXT = "## Goal\n\nAn admin invites a teammate by email.\n";

const WORDS = "An admin invites a teammate by email.";

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

const openSharedDescription = Effect.gen(function* () {
  const owner = yield* openAccount;
  const teammate = yield* openAccount;
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const { id: taskId } = yield* createTask(owner, { organizationId: workspace, name: "Invites" });
  yield* saveDescriptionText(owner, taskId, DESCRIPTION_TEXT);
  return { owner, teammate, workspace, taskId };
});

const started = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const from = DESCRIPTION_TEXT.indexOf(WORDS);
    const outcome = yield* startDescriptionCommentThread(
      { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, userId },
      taskId,
      {
        clientKey: randomUUID(),
        scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
        quote: WORDS,
        anchor: { from, to: from + WORDS.length },
        text: DESCRIPTION_TEXT,
        words: "Is this in v1?",
      },
    );
    if (outcome.status !== DESCRIPTION_COMMENT_OUTCOME.DONE || !("thread" in outcome.answer)) {
      return assert.fail("the thread was not started");
    }
    return outcome.answer.thread.id;
  });

const onHub = Effect.gen(function* () {
  const { clock, asleep } = yield* announcingClock;
  const looking = yield* Queue.unbounded<void>();
  const hub = Context.get(yield* Layer.build(syncHub), Sync);
  const announcing: SyncShape = {
    watch: (topics, fallback) =>
      Effect.map(hub.watch(topics, fallback), (watch) => ({
        ...watch,
        next: Effect.andThen(Queue.offer(looking, undefined), watch.next),
      })),
  };
  const services = Layer.mergeAll(
    Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
    Layer.succeed(Database, yield* Database),
    Layer.succeed(Clock.Clock, clock),
    Layer.succeed(Sync, announcing),
  );
  const context = (yield* Effect.context<SqlClient.SqlClient>().pipe(
    Effect.provide(services),
  )) as Context.Context<WebServices>;
  const handle = hostedFetch({
    descriptionComments: descriptionCommentsProcedures({
      resolveUserId: (asked) =>
        Effect.succeed(
          Option.fromNullishOr(asked.headers.get("authorization")?.replace("Bearer ", "")),
        ),
    }),
  });
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

function readIn(answered: { readonly body: string }) {
  const read = readEither(descriptionCommentsAnswerSchema)(unparsedWire(JSON.parse(answered.body)));
  if (Result.isFailure(read)) return assert.fail(answered.body);
  return read.success;
}

function threadIdsIn(answered: { readonly body: string }): readonly string[] {
  return readIn(answered).threads.map((thread) => thread.id);
}

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

it.layer(getTestDB())("a description's comments read held on Vespin Sync", (it) => {
  it.effect(
    "a teammate's thread started, answered, and deleted each wake a member's held read at once",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const hub = yield* onHub;
          const { owner, teammate, taskId } = yield* openSharedDescription;
          const writer = { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, userId: teammate } as const;

          const start = yield* heldThrough(hub, owner, taskId, started(teammate, taskId));
          assert.deepEqual(threadIdsIn(start.answered), [start.value]);
          const reply = yield* heldThrough(
            hub,
            owner,
            taskId,
            actOnDescriptionCommentThread(writer, taskId, start.value, {
              action: DESCRIPTION_COMMENT_ACTION.REPLY,
              clientKey: randomUUID(),
              words: "Yes, withdrawing ships first.",
            }),
          );
          assert.equal(reply.answered.status, HOSTED_HTTP_STATUS.OK);
          const deleted = yield* heldThrough(
            hub,
            owner,
            taskId,
            actOnDescriptionCommentThread(writer, taskId, start.value, {
              action: DESCRIPTION_COMMENT_ACTION.DELETE_THREAD,
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
          const { owner, teammate, workspace, taskId } = yield* openSharedDescription;
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
