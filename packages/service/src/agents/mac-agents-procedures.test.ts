/**
 * mac-agents-procedures.test.ts -- a local agent's Mac through its routes, over a real dialect: an account with the experiment off is answered nothing, and no account follows, claims, or beats another account's Mac.
 *
 * Synthetic accounts, bearers, and Macs throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import { macDevicesSeenSince } from "@luke/database/models/mac-device-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, MAC_DEVICE_LAYOUT } from "@luke/database/testing";
import { EXPERIMENT } from "@luke/settings";
import { Clock, type Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { macAgentsProcedures } from "./mac-agents-procedures.js";

const ORIGIN = "https://luke.test";
const PATH = {
  DEVICES: "/api/mac-agents/devices",
  PRESENCE: "/api/mac-agents/presence",
  LINES: "/api/mac-agents/lines",
  LINE_CLAIM: "/api/mac-agents/lines/claim",
} as const;

/** One request of the Mac's, on the bearer of the account given, its body as JSON or its device in the query. */
function request(
  userId: string,
  path: string,
  init: { readonly body?: object; readonly deviceId?: string } = {},
): Request {
  const url = new URL(path, ORIGIN);
  if (init.deviceId !== undefined) url.searchParams.set("deviceId", init.deviceId);
  return new Request(url, {
    method: init.body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${userId}`,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

/** The status the route answered one request with, over the test's database and clock. */
const statusOf = (incoming: Request) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );
    const context = yield* Effect.context<SqlClient.SqlClient>().pipe(Effect.provide(services));
    const handle = hostedFetch({
      macAgents: macAgentsProcedures({
        resolveUserId: (asked) =>
          Effect.succeed(
            Option.fromNullishOr(
              asked.headers.get("authorization")?.match(/^Bearer (user-.+)$/u)?.[1],
            ),
          ),
      }),
    });
    // SAFETY: the procedures yield the database and the clock alone, which is all a test provides of the web runtime's services.
    const response = yield* Effect.promise(() =>
      handle(incoming, context as Context.Context<WebServices>),
    );
    return response.status;
  });

/** An account, with the `local-agents` experiment on where asked. */
const account = (on: boolean) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    if (on)
      yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.LOCAL_AGENTS]: true } });
    return userId;
  });

/** A register of a Mac under the id given. */
function registered(deviceId: string) {
  return { deviceId, name: "Studio", ...MAC_DEVICE_LAYOUT };
}

it.layer(getTestDB())("a local agent's Mac", (it) => {
  it.effect("an account with the experiment off is answered nothing, and nothing is written", () =>
    Effect.gen(function* () {
      const off = yield* account(false);
      const deviceId = randomUUID();

      const register = yield* statusOf(request(off, PATH.DEVICES, { body: registered(deviceId) }));
      const lines = yield* statusOf(request(off, PATH.LINES, { deviceId }));

      assert.equal(register, HOSTED_HTTP_STATUS.NOT_FOUND);
      assert.equal(lines, HOSTED_HTTP_STATUS.NOT_FOUND);
      assert.deepEqual(yield* macDevicesSeenSince(off, new Date(0)), []);
    }),
  );

  it.effect("no account follows, claims, beats, or takes over another account's Mac", () =>
    Effect.gen(function* () {
      const owner = yield* account(true);
      const other = yield* account(true);
      const deviceId = randomUUID();
      const owned = yield* statusOf(request(owner, PATH.DEVICES, { body: registered(deviceId) }));

      const takenOver = yield* statusOf(
        request(other, PATH.DEVICES, { body: registered(deviceId) }),
      );
      const followed = yield* statusOf(request(other, PATH.LINES, { deviceId }));
      const claimed = yield* statusOf(
        request(other, PATH.LINE_CLAIM, { body: { deviceId, id: randomUUID() } }),
      );
      const beaten = yield* statusOf(request(other, PATH.PRESENCE, { body: { deviceId } }));
      const ownBeat = yield* statusOf(request(owner, PATH.PRESENCE, { body: { deviceId } }));

      assert.equal(owned, HOSTED_HTTP_STATUS.OK);
      assert.deepEqual(
        [takenOver, followed, claimed, beaten],
        [
          HOSTED_HTTP_STATUS.NOT_FOUND,
          HOSTED_HTTP_STATUS.NOT_FOUND,
          HOSTED_HTTP_STATUS.NOT_FOUND,
          HOSTED_HTTP_STATUS.NOT_FOUND,
        ],
      );
      assert.equal(ownBeat, HOSTED_HTTP_STATUS.OK, "the owner's Mac still beats");
    }),
  );
});
