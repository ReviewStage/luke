/**
 * app-server.test.ts -- one `codex app-server` process as the runner speaks to it: a request made once the process has ended is refused, not left waiting on an answer no one will write; one it never answers fails in time; and a refusal keeps its JSON-RPC code and data.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Deferred, Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { AppServerError, spawnAppServer } from "./app-server.js";
import { fakeAppServer, type Script } from "./testing/fake-app-server.js";

it.effect("refuses a request made after app-server has exited", () =>
  Effect.gen(function* () {
    const server = fakeAppServer([{ exchanges: [], exitWith: "gone" }]);
    const exited = yield* Deferred.make<string>();
    const appServer = yield* spawnAppServer(
      { executable: "/opt/luke-codex/bin/codex", args: [], cwd: "/srv/repo", env: {} },
      {
        onNotification: () => Effect.void,
        onExit: (stderrTail) => Deferred.succeed(exited, stderrTail).pipe(Effect.asVoid),
      },
    ).pipe(Effect.provide(server.layer));
    assert.equal(yield* Deferred.await(exited), "gone");

    const failure = yield* appServer
      .request("thread/start", { cwd: "/srv/repo" })
      .pipe(Effect.flip);
    assert.ok(failure instanceof AppServerError);
  }),
);

/** A running app-server playing one script, with a listener that hears nothing. */
const running = (exchanges: Script["exchanges"]) =>
  spawnAppServer(
    { executable: "/opt/luke-codex/bin/codex", args: [], cwd: "/srv/repo", env: {} },
    { onNotification: () => Effect.void, onExit: () => Effect.void },
  ).pipe(Effect.provide(fakeAppServer([{ exchanges }]).layer));

it.effect("fails a request app-server never answers once its bound has passed", () =>
  Effect.gen(function* () {
    const appServer = yield* running([{ method: "turn/interrupt", reply: [] }]);
    const asked = yield* appServer
      .request("turn/interrupt", { threadId: "thread", turnId: "turn" })
      .pipe(Effect.flip, Effect.forkScoped);
    yield* Effect.yieldNow.pipe(Effect.repeat({ times: 20 }));
    yield* TestClock.adjust(Duration.minutes(1));

    const failure = yield* Fiber.join(asked);
    assert.equal(failure.method, "turn/interrupt");
    assert.equal(failure.detail, "app-server did not answer in time");
  }),
);

it.effect("keeps the JSON-RPC code and data of a request app-server refused", () =>
  Effect.gen(function* () {
    const data = {
      message: "cannot steer a review turn",
      codexErrorInfo: { activeTurnNotSteerable: { turnKind: "review" } },
      additionalDetails: null,
    };
    const appServer = yield* running([
      {
        method: "turn/steer",
        reply: [{ id: 1, error: { code: -32600, message: "cannot steer a review turn", data } }],
      },
    ]);
    const failure = yield* appServer
      .request("turn/steer", {
        threadId: "thread",
        expectedTurnId: "turn",
        clientUserMessageId: null,
        input: [],
      })
      .pipe(Effect.flip);

    assert.equal(failure.method, "turn/steer");
    assert.equal(failure.code, -32600);
    assert.deepEqual(failure.data, data);
  }),
);
