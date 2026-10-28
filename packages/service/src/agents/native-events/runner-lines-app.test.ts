import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { RUNNER_LINES } from "@luke/agent-runner/protocol";
import { Database } from "@luke/database/core/query";
import {
  createCodingAgent,
  recordCodingAgentRunnerToken,
} from "@luke/database/models/coding-agent-store";
import { queueRunnerLine } from "@luke/database/models/runner-line-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask } from "@luke/database/testing";
import { Clock, Effect, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import { runnerTokenDigest } from "../luke-mcp/bearer.js";
import { RUNNER_LINES_PATH, runnerLinesApp } from "./runner-lines-app.js";

/**
 * The lines route, answered by its group the way a function answers it, over
 * a real store: a runner's bearer is answered its own agent's lines past the
 * place it names, and a bearer its agent no longer holds is refused, its
 * agent's lines read by nothing. Synthetic accounts and bearers throughout.
 */

const ORIGIN = "https://luke.test";
const LAUNCH = 3;

/** The route's group over the test's store, as a fetch. */
const standing = Effect.gen(function* () {
  const services = Layer.mergeAll(
    Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
    Layer.succeed(Database, yield* Database),
    Layer.succeed(Clock.Clock, yield* Clock.Clock),
  );
  const web = HttpRouter.toWebHandler(runnerLinesApp().pipe(HttpRouter.provideRequest(services)), {
    disableLogger: true,
  });
  yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
  return (bearer: string, after: number) =>
    Effect.promise(async () => {
      const url = new URL(`${ORIGIN}${RUNNER_LINES_PATH}`);
      url.searchParams.set(RUNNER_LINES.QUERY.LAUNCH, String(LAUNCH));
      url.searchParams.set(RUNNER_LINES.QUERY.AFTER, String(after));
      const response = await web.handler(
        new Request(url, { headers: { authorization: `Bearer ${bearer}` } }),
      );
      return { status: response.status, body: await response.json() };
    });
});

/** An agent whose runner's bearer is recorded, and two lines queued for its launch. */
const agentWithLines = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const task = yield* startTask(userId, { name: "Invitations" });
  const started = yield* createCodingAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
  });
  const agentId = Option.getOrThrow(started).agent.id;
  const bearer = randomBytes(32).toString("base64url");
  yield* recordCodingAgentRunnerToken(userId, agentId, runnerTokenDigest(bearer));
  const first = yield* queueRunnerLine(userId, { agentId, launch: LAUNCH, text: "one" });
  yield* queueRunnerLine(userId, { agentId, launch: LAUNCH, text: "two" });
  return { userId, agentId, bearer, first: Option.getOrThrow(first) };
});

it.layer(getTestDB())("the runner lines route", (it) => {
  it.effect("a runner's bearer is answered its own agent's lines past its place", () =>
    Effect.gen(function* () {
      const ask = yield* standing;
      const theirs = yield* agentWithLines;
      yield* agentWithLines;
      const read = yield* ask(theirs.bearer, theirs.first);
      assert.equal(read.status, HOSTED_HTTP_STATUS.OK);
      assert.deepEqual(
        read.body.lines.map((line: { text: string }) => line.text),
        ["two"],
      );
    }),
  );

  it.effect("a bearer its agent no longer holds is refused", () =>
    Effect.gen(function* () {
      const ask = yield* standing;
      const retired = yield* agentWithLines;
      yield* recordCodingAgentRunnerToken(retired.userId, retired.agentId, null);
      const read = yield* ask(retired.bearer, 0);
      assert.equal(read.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
    }),
  );
});
