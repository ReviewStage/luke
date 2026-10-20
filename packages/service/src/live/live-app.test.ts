import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { accountInboxLiveAnswerSchema } from "@luke/features/live-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { Effect, Layer, Option, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { liveApp } from "./live-app.js";
import { type LiveSealer, LiveSealing, SealRefused } from "./realtime.js";

/**
 * The reads the desktop follows over Neon Realtime, sealed by the route:
 * refused without a bearer, unavailable where the deployment has no
 * Realtime, and otherwise every part of the account inbox sealed for the
 * bearer's own account, with the address to subscribe at.
 *
 * Synthetic accounts and bearers throughout; the secret is a script that
 * seals a statement as the values it was bound to, so a test can read whose
 * rows each sealed statement reads.
 */

const ORIGIN = "https://luke.test";
const LIVE_INBOX = "/api/live/inbox";
const REALTIME_URL = "wss://realtime.example/v1";

/** A sealer that seals a statement as its values, so whose read it is shows. */
const SCRIPTED: LiveSealer = {
  url: REALTIME_URL,
  seal: (statement: LiveStatement) =>
    Effect.succeed({
      capability: JSON.stringify(statement.params),
      queryFingerprint: statement.sql,
      expiresAt: 1_800_000_060_000,
    }),
};

/** The group answering one request as `bearer`, over the deployment's Realtime where it has one. */
const ask = (options: {
  readonly bearer?: string;
  readonly method?: string;
  readonly sealing: Option.Option<LiveSealer>;
}) =>
  Effect.gen(function* () {
    const { handler, dispose } = HttpRouter.toWebHandler(
      liveApp({
        resolveUserId: (incoming) => {
          const bearer = incoming.headers.get("authorization") ?? "";
          return Effect.succeed(
            bearer.startsWith("Bearer ") ? Option.some(bearer.slice(7)) : Option.none(),
          );
        },
      }).pipe(HttpRouter.provideRequest(Layer.succeed(LiveSealing, options.sealing))),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() =>
      handler(
        new Request(new URL(LIVE_INBOX, ORIGIN), {
          method: options.method ?? "GET",
          headers:
            options.bearer === undefined ? {} : { authorization: `Bearer ${options.bearer}` },
        }),
      ),
    );
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    return { status: response.status, body };
  });

it.effect("a request without a bearer is refused, and one by another method is not taken", () =>
  Effect.gen(function* () {
    assert.deepEqual(yield* ask({ sealing: Option.some(SCRIPTED) }), {
      status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
      body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
    });
    assert.deepEqual(
      yield* ask({ bearer: "user-dana", method: "POST", sealing: Option.some(SCRIPTED) }),
      {
        status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
        body: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
      },
    );
  }),
);

it.effect("a deployment whose Realtime is misconfigured answers unavailable", () =>
  Effect.gen(function* () {
    assert.deepEqual(yield* ask({ bearer: "user-dana", sealing: Option.none() }), {
      status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
      body: { error: HOSTED_API_ERROR.UNAVAILABLE },
    });
  }),
);

it.effect(
  "every part of the account inbox is sealed for the bearer's own account, with the address to subscribe at, and a seal refused answers unavailable",
  () =>
    Effect.gen(function* () {
      const dana = yield* ask({ bearer: "user-dana", sealing: Option.some(SCRIPTED) });
      const eli = yield* ask({ bearer: "user-eli", sealing: Option.some(SCRIPTED) });

      assert.equal(dana.status, HOSTED_HTTP_STATUS.OK);
      const answer = Schema.decodeUnknownSync(accountInboxLiveAnswerSchema)(dana.body);
      assert.equal(answer.url, REALTIME_URL);
      const parts = Object.entries(answer.queries);
      assert.deepEqual(parts.map(([part]) => part).toSorted(), [
        "automations",
        "chatAsks",
        "chatNotices",
        "failedRuns",
        "items",
        "planless",
        "plans",
      ]);
      for (const [part, sealed] of parts) {
        assert.ok(sealed.capability.includes('"user-dana"'), `${part} is read for the bearer`);
        assert.ok(!sealed.capability.includes("user-eli"), `${part} is read for no one else`);
      }
      const theirs = Schema.decodeUnknownSync(accountInboxLiveAnswerSchema)(eli.body);
      assert.ok(
        Object.values(theirs.queries).every((sealed) => sealed.capability.includes('"user-eli"')),
      );

      const refusing: LiveSealer = {
        url: REALTIME_URL,
        seal: () => Effect.fail(new SealRefused({ reason: "refused" })),
      };
      assert.deepEqual(yield* ask({ bearer: "user-dana", sealing: Option.some(refusing) }), {
        status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
        body: { error: HOSTED_API_ERROR.UNAVAILABLE },
      });
    }),
);
