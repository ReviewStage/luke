/**
 * mac-commands-procedures.test.ts -- the Mac's held read and its posted results, byte for byte through the route, over a real dialect.
 *
 * The Mac's held read is answered with the command queued for its account
 * as soon as one waits, and with none once the hold ends; the result it
 * posts is kept for the agent's call. An older Mac's read, naming no kinds,
 * is handed shell commands alone; a browser call no listening Mac can run
 * is answered not run at once, and one the Mac refuses is answered not run
 * with the Mac's reason. Only the Mac's bearer is read, never a cookie,
 * and before anything the body says. Each refusal answers what the old
 * group answered.
 *
 * Synthetic accounts, bearers, and commands throughout.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  macCommandResult,
  macCommandsWaiting,
  queueMacCommand,
} from "@luke/database/models/mac-command-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import {
  MAC_COMMAND_KIND,
  type MacCommand,
  type MacCommandResult,
} from "@luke/features/mac-command-wire";
import { Clock, type Context, Effect, Fiber, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { askMac, MAC_COMMAND_STATUS } from "./mac-command.js";
import { macCommandsProcedures } from "./mac-commands-procedures.js";

const ORIGIN = "https://luke.test";
const MAC_COMMANDS = "/api/mac-commands";
const JSON_TYPE = "application/json";

const COMMAND: MacCommand = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: MAC_COMMAND_KIND.SHELL,
  command: "git status",
  timeoutSeconds: 60,
};

const BROWSER_PARAMS = { act: "open", address: "http://localhost:3000" };

const BROWSER_COMMAND: MacCommand = {
  id: "33333333-3333-4333-8333-333333333333",
  kind: MAC_COMMAND_KIND.BROWSER,
  params: BROWSER_PARAMS,
  timeoutSeconds: 30,
};

/** What a newer Mac's read names in its query: shell, and the browser. */
const NEWER_KINDS = "shell,browser";

const RESULT: MacCommandResult = {
  exitCode: 0,
  stdout: "nothing to commit\n",
  stderr: "",
  truncated: false,
  timedOut: false,
};

/** The answer as it left the handler: its status, the two headers a caller reads, and its bytes. */
interface Bytes {
  readonly status: number;
  readonly contentType: string | null;
  readonly cacheControl: string | null;
  readonly text: string;
}

/** A refusal's bytes, which carry no cache-control. */
function refused(status: number, error: string): Bytes {
  return {
    status,
    contentType: JSON_TYPE,
    cacheControl: null,
    text: JSON.stringify({ error }),
  };
}

function request(
  init: {
    method?: string;
    userId?: string;
    cookie?: boolean;
    body?: string;
    length?: number;
    kinds?: string;
  } = {},
): Request {
  const headers: Record<string, string> = {};
  if (init.userId !== undefined) headers.authorization = `Bearer ${init.userId}`;
  if (init.cookie === true) headers.cookie = "session=s1";
  if (init.body !== undefined) headers["content-type"] = JSON_TYPE;
  if (init.length !== undefined) headers["content-length"] = String(init.length);
  const url = new URL(MAC_COMMANDS, ORIGIN);
  if (init.kinds !== undefined) url.searchParams.set("kinds", init.kinds);
  return new Request(url, {
    method: init.method ?? "GET",
    headers,
    ...(init.body === undefined ? undefined : { body: init.body }),
  });
}

/**
 * The route answering one request over the test's database, on the
 * fiber's own clock, so a held read waits on the test's. The resolver
 * names any `user-…` bearer, and would name a cookie's caller too, so a
 * refused cookie is the route's own doing.
 */
const bytes = (incoming: Request) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );
    const context = yield* Effect.context<SqlClient.SqlClient>().pipe(Effect.provide(services));
    const handle = hostedFetch({
      macCommands: macCommandsProcedures({
        resolveUserId: (asked) =>
          Effect.succeed(
            Option.fromNullishOr(
              asked.headers.get("authorization")?.match(/^Bearer (user-.+)$/u)?.[1] ??
                (asked.headers.has("cookie") ? "user-cookie" : undefined),
            ),
          ),
      }),
    });
    // SAFETY: the procedures yield the database and the clock alone, which is all a test provides of the web runtime's services.
    const webServices = context as Context.Context<WebServices>;
    const response = yield* Effect.promise(() => handle(incoming, webServices));
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      text: yield* Effect.promise(() => response.text()),
    } satisfies Bytes;
  });

const account = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  });

/** The commands a read was answered with, as the Mac reads its bytes. */
const commandsOf = (answer: Bytes): readonly MacCommand[] => JSON.parse(answer.text).commands;

/** A held read that finds nothing waiting, answered once its hold of twenty seconds ends on the test's clock. */
const emptyRead = (incoming: Request) =>
  Effect.gen(function* () {
    const read = yield* Effect.forkChild(bytes(incoming));
    yield* TestClock.adjust("20 seconds");
    return yield* Fiber.join(read);
  });

/** Lets a forked call's statements run until a command of any kind waits for the account. */
const untilQueued = (userId: string) =>
  Effect.gen(function* () {
    const since = new Date(yield* Clock.currentTimeMillis);
    const kinds = [MAC_COMMAND_KIND.SHELL, MAC_COMMAND_KIND.BROWSER];
    while (!(yield* macCommandsWaiting(userId, since, kinds))) yield* Effect.yieldNow;
  });

it.layer(getTestDB())("a command run on the developer's Mac", (it) => {
  it.effect("the held read answers the queued command, and the result posted is kept", () =>
    Effect.gen(function* () {
      yield* account("user-mac");
      yield* queueMacCommand("user-mac", COMMAND);

      assert.deepEqual(yield* bytes(request({ userId: "user-mac" })), {
        status: HOSTED_HTTP_STATUS.OK,
        contentType: JSON_TYPE,
        cacheControl: "private, no-store",
        text: JSON.stringify({ commands: [COMMAND] }),
      });
      const posted = JSON.stringify({ id: COMMAND.id, result: RESULT });
      assert.deepEqual(
        yield* bytes(request({ method: "POST", userId: "user-mac", body: posted })),
        {
          status: HOSTED_HTTP_STATUS.OK,
          contentType: JSON_TYPE,
          cacheControl: "private, no-store",
          text: '{"settled":true}',
        },
      );
      assert.deepEqual(yield* macCommandResult("user-mac", COMMAND.id), Option.some(RESULT));
    }),
  );

  it.effect(
    "an older Mac's read, naming no kinds, is handed shell commands alone, and a browser command waits for a Mac that names it",
    () =>
      Effect.gen(function* () {
        yield* account("user-older");
        const shell = { ...COMMAND, id: "44444444-4444-4444-8444-444444444444" };
        yield* queueMacCommand("user-older", BROWSER_COMMAND);
        yield* queueMacCommand("user-older", shell);

        const older = yield* bytes(request({ userId: "user-older" }));
        const newer = yield* bytes(request({ userId: "user-older", kinds: NEWER_KINDS }));

        assert.deepEqual(commandsOf(older), [shell]);
        assert.deepEqual(commandsOf(newer), [BROWSER_COMMAND]);
      }),
  );

  it.effect("a browser call no listening Mac can run is answered not run at once", () =>
    Effect.gen(function* () {
      yield* account("user-no-browser");
      yield* emptyRead(request({ userId: "user-no-browser" }));

      const answer = yield* askMac("user-no-browser", {
        kind: MAC_COMMAND_KIND.BROWSER,
        params: BROWSER_PARAMS,
      });
      const newer = yield* emptyRead(request({ userId: "user-no-browser", kinds: NEWER_KINDS }));

      assert.equal(answer.status, MAC_COMMAND_STATUS.NOT_RUN);
      assert.match("reason" in answer ? answer.reason : "", /Browser tabs/u);
      assert.deepEqual(commandsOf(newer), [], "nothing was left queued");
    }),
  );

  it.effect("a browser command the Mac refuses is answered not run, with the Mac's reason", () =>
    Effect.gen(function* () {
      yield* account("user-refuses");
      yield* emptyRead(request({ userId: "user-refuses", kinds: NEWER_KINDS }));

      const call = yield* Effect.forkChild(
        askMac("user-refuses", { kind: MAC_COMMAND_KIND.BROWSER, params: BROWSER_PARAMS }),
      );
      yield* untilQueued("user-refuses");
      const [taken] = commandsOf(
        yield* bytes(request({ userId: "user-refuses", kinds: NEWER_KINDS })),
      );
      const refused = "Not run: this Mac cannot drive a Browser tab yet.";
      const posted = JSON.stringify({ id: taken?.id, result: { refused } });
      yield* bytes(request({ method: "POST", userId: "user-refuses", body: posted }));
      yield* TestClock.adjust("1 second");

      assert.equal(taken?.kind, MAC_COMMAND_KIND.BROWSER);
      assert.deepEqual(yield* Fiber.join(call), {
        status: MAC_COMMAND_STATUS.NOT_RUN,
        reason: refused,
      });
    }),
  );

  it.effect(
    "only the Mac's bearer is read, never a cookie, and before anything the body says",
    () =>
      Effect.gen(function* () {
        const invalidToken = refused(HOSTED_HTTP_STATUS.UNAUTHORIZED, "invalid-token");
        assert.deepEqual(yield* bytes(request()), invalidToken);
        assert.deepEqual(yield* bytes(request({ cookie: true })), invalidToken);
        assert.deepEqual(
          yield* bytes(request({ method: "POST", body: '{"id":"not-a-command"}' })),
          invalidToken,
        );
      }),
  );

  it.effect("a result is refused as the old group refused it", () =>
    Effect.gen(function* () {
      yield* account("user-refused");
      const post = (body: string, length?: number) =>
        bytes(
          request({
            method: "POST",
            userId: "user-refused",
            body,
            ...(length === undefined ? undefined : { length }),
          }),
        );
      const settle = { id: COMMAND.id, result: RESULT };

      assert.deepEqual(
        yield* post(JSON.stringify(settle)),
        refused(HOSTED_HTTP_STATUS.NOT_FOUND, "not-found"),
      );
      assert.deepEqual(
        yield* post(JSON.stringify({ ...settle, extra: true })),
        refused(HOSTED_HTTP_STATUS.BAD_REQUEST, "invalid-request"),
      );
      assert.deepEqual(
        yield* post(JSON.stringify(settle), 256 * 1_024 + 1),
        refused(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, "request-too-large"),
      );
      assert.deepEqual(
        yield* bytes(request({ method: "PUT", userId: "user-refused" })),
        refused(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, "method-not-allowed"),
      );
    }),
  );
});
