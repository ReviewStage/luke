/**
 * app-server.test.ts -- one `codex app-server` process as the runner speaks to it: a request made once the process has ended is refused, not left waiting on an answer no one will write.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Deferred, Effect } from "effect";
import { AppServerError, spawnAppServer } from "./app-server.js";
import { fakeAppServer } from "./testing/fake-app-server.js";

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
