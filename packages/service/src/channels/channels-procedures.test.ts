import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createChannel, listChannelLooks } from "@luke/database/models/channel-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import type { WireBoundaryInput } from "@luke/wire";
import { type Context, Effect, Option, Result } from "effect";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { channelsProcedures } from "./channels-procedures.js";

/**
 * A workspace's channels, answered by the hosted oRPC router the way the web
 * route answers them, over a real dialect: a channel is reached only within
 * a workspace the bearer is a member of, so a look never lands on a channel
 * of another workspace than the one named, and another workspace's channel
 * is not found rather than read as empty.
 *
 * Synthetic accounts, bearers, workspaces, and channels throughout.
 */

const ORIGIN = "https://luke.test";

/** An account behind a bearer of its own name. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** The resource's answer to one request by the account the bearer names: its status and its JSON. */
const ask = (userId: string, path: string, body?: WireBoundaryInput) =>
  Effect.gen(function* () {
    // SAFETY: the procedures yield the database and the clock alone, which the test's own context holds.
    const services = (yield* Effect.context<never>()) as Context.Context<WebServices>;
    const handle = hostedFetch({
      channels: channelsProcedures({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
          ),
      }),
    });
    const request = new Request(new URL(path, ORIGIN), {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${userId}` },
      ...(body === undefined ? undefined : { body: JSON.stringify(body) }),
    });
    const response = yield* Effect.promise(() => handle(request, services));
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const answered = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    return { status: response.status, body: answered };
  });

const NOT_FOUND = {
  status: HOSTED_HTTP_STATUS.NOT_FOUND,
  body: { error: HOSTED_API_ERROR.NOT_FOUND },
};

it.layer(getTestDB())("the channels route", (it) => {
  it.effect(
    "a channel outside the workspace named, or the bearer's, is not found, its look stamped nowhere",
    () =>
      Effect.gen(function* () {
        const [dean, outsider] = [yield* openAccount, yield* openAccount];
        const acme = yield* openWorkspace(dean);
        const beta = yield* openWorkspace(dean);
        const draft = { name: "app", purpose: "Desktop and panel.", project: false };
        const betaApp = Result.getOrThrow(yield* createChannel(dean, beta, draft, new Date(1)));

        const crossed = yield* ask(dean, "/api/channels/look", {
          workspaceId: acme,
          channelId: betaApp.id,
        });
        const foreign = yield* ask(outsider, `/api/channels/threads?channelId=${betaApp.id}`);
        const unknown = yield* ask(dean, `/api/channels/threads?channelId=${randomUUID()}`);
        const own = yield* ask(dean, `/api/channels/threads?channelId=${betaApp.id}`);

        assert.deepEqual([crossed, foreign, unknown], [NOT_FOUND, NOT_FOUND, NOT_FOUND]);
        assert.deepEqual(yield* listChannelLooks(dean, beta), []);
        assert.deepEqual(own, { status: HOSTED_HTTP_STATUS.OK, body: { threads: [] } });
      }),
  );
});
