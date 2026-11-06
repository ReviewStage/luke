import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { fakeWorkspaceSeams, getTestDB, startTask } from "@repo/database/testing";
import {
  LIVE_USER_QUERY,
  type LiveSocketAnswer,
  type LiveSocketAsk,
  liveSocketAnswerSchema,
} from "@repo/features/live-wire";
import { taskListLiveAnswerSchema, taskListLiveRowsSchema } from "@repo/features/task-list-live";
import { type Cause, type Context, Effect, Option, Queue, Schema, Stream } from "effect";
import type { SqlClient } from "effect/sql";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import type { VoiceFrame, VoiceSocket } from "../http/socket.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { liveProcedures } from "./live-procedures.js";
import { answerLiveSocket } from "./live-socket.js";

const ORIGIN = "https://app.test";

const bearerUserId = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  return Effect.succeed(
    authorization.startsWith("Bearer ") ? Option.some(authorization.slice(7)) : Option.none(),
  );
};

function readOf(path: string, forUser: string, query: Record<string, string> = {}): string {
  return `${path}?${new URLSearchParams({ ...query, [LIVE_USER_QUERY]: forUser })}`;
}

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  return userId;
});

const hostSocket = Effect.gen(function* () {
  const inbound = yield* Queue.make<VoiceFrame, Cause.Done>();
  const sent = yield* Queue.make<string>();
  const socket: VoiceSocket = {
    next: Queue.take(inbound).pipe(
      Effect.map((frame): Option.Option<VoiceFrame> => Option.some(frame)),
      Effect.catchTag("Done", () => Effect.succeed(Option.none<VoiceFrame>())),
    ),
    frames: Stream.fromQueue(inbound),
    send: (frame) => ("text" in frame ? Effect.asVoid(Queue.offer(sent, frame.text)) : Effect.void),
    close: () => Queue.end(inbound),
    isOpen: Effect.succeed(true),
  };
  return {
    socket,
    ask: (ask: LiveSocketAsk) => Queue.offer(inbound, { text: JSON.stringify(ask) }),
    answer: Effect.map(
      Queue.take(sent),
      (text): LiveSocketAnswer =>
        Schema.decodeUnknownSync(liveSocketAnswerSchema)(JSON.parse(text)),
    ),
  };
});

function listedTasks(answer: LiveSocketAnswer): readonly string[] {
  const listed = Schema.decodeUnknownSync(taskListLiveAnswerSchema)(JSON.parse(answer.body));
  const rows = Schema.decodeUnknownSync(taskListLiveRowsSchema)({
    plans: listed.queries.plans.rows,
    agents: listed.queries.agents.rows,
    issues: listed.queries.issues.rows,
  });
  return rows.plans.map((plan) => plan.id);
}

it.layer(getTestDB())("the live socket", (it) => {
  it.effect(
    "each socket's asks are answered under their ids as the polls of the account its upgrade named",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const dana = yield* openUser;
          const eli = yield* openUser;
          const danaTask = yield* startTask(dana, { name: "Teammate invitations" });
          const eliTask = yield* startTask(eli, { name: "Billing export" });
          const context = yield* Effect.context<SqlClient.SqlClient | Database>();
          const answerer = {
            fetch: hostedFetch({
              live: liveProcedures({
                resolveUserId: bearerUserId,
                workspaces: yield* fakeWorkspaceSeams,
              }),
            }),
            services: context as Context.Context<WebServices>,
            origin: ORIGIN,
          };
          const danaHost = yield* hostSocket;
          const eliHost = yield* hostSocket;
          yield* Effect.forkScoped(
            answerLiveSocket(danaHost.socket, { bearer: `Bearer ${dana}` }, answerer),
          );
          yield* Effect.forkScoped(
            answerLiveSocket(eliHost.socket, { bearer: `Bearer ${eli}` }, answerer),
          );

          yield* danaHost.ask({ id: 1, path: readOf("/api/live/tasks", dana) });
          yield* eliHost.ask({ id: 1, path: readOf("/api/live/tasks", eli) });
          const [danaTasks, eliTasks] = yield* Effect.all([danaHost.answer, eliHost.answer], {
            concurrency: "unbounded",
          });
          assert.deepEqual(
            [danaTasks.id, danaTasks.status, listedTasks(danaTasks)],
            [1, HOSTED_HTTP_STATUS.OK, [danaTask.id]],
          );
          assert.deepEqual(
            [eliTasks.id, eliTasks.status, listedTasks(eliTasks)],
            [1, HOSTED_HTTP_STATUS.OK, [eliTask.id]],
          );

          yield* danaHost.ask({ id: 2, path: readOf("/api/live/tasks", eli) });
          assert.deepEqual(
            yield* danaHost.answer,
            {
              id: 2,
              status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
              body: JSON.stringify({ error: HOSTED_API_ERROR.INVALID_TOKEN }),
            },
            "a read naming another account is signed out",
          );
          yield* danaHost.ask({
            id: 3,
            path: readOf("/api/live/task-record", dana, { id: eliTask.id }),
          });
          const record = yield* danaHost.answer;
          assert.deepEqual(
            [record.id, record.status],
            [3, HOSTED_HTTP_STATUS.NOT_FOUND],
            "another account's task is not found",
          );
        }),
      ),
  );
});
