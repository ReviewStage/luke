/**
 * events-procedures.test.ts -- the desktop's analytics batch, byte for byte through the route.
 *
 * An unconfigured deployment does no work at all, not even resolving the
 * caller; an unsigned caller is refused before its batch is read; a batch
 * taken is answered 202 with the count recorded; and an upstream that
 * refused is answered with its status. Three answers moved with the route
 * onto oRPC, and are pinned here as they now stand: a body that is not
 * JSON is refused as invalid before the caller is read, a body past the
 * cap is refused as too large, and a batch taken carries `private,
 * no-store`. Every sender drops the answer whichever it is.
 *
 * Synthetic accounts, bearers, and events throughout.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { noDatabase } from "@luke/database/testing/no-database";
import { PRODUCT_EVENT } from "@luke/features/analytics";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { type Context, Effect, Layer, Option, Redacted } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { EVENTS_MAXIMUM_BODY_BYTES } from "./events.js";
import { eventsProcedures } from "./events-procedures.js";

const EVENTS = "https://luke.test/api/events";
const JSON_TYPE = "application/json";

const NO_ENVIRONMENT: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

const RECORDING: HostedEnvironmentValues = {
  ...NO_ENVIRONMENT,
  posthogProjectApiKey: Redacted.make("phc_project"),
};

/** One launch, at a fixed instant the service clamps into its window. */
const BATCH = JSON.stringify({
  events: [
    {
      name: PRODUCT_EVENT.APP_LAUNCH,
      at: Date.parse("2026-08-19T12:00:00.000Z"),
      properties: { app_version: "0.2.0" },
    },
  ],
});

interface Bytes {
  readonly status: number;
  readonly contentType: string | null;
  readonly cacheControl: string | null;
  readonly text: string;
}

/** A refusal's bytes, which carry no cache-control: its slug, and an upstream's status where it has one. */
function refused(status: number, error: string, upstreamStatus?: number): Bytes {
  const body = upstreamStatus === undefined ? { error } : { error, upstreamStatus };
  return { status, contentType: JSON_TYPE, cacheControl: null, text: JSON.stringify(body) };
}

function request(
  init: { method?: string; userId?: string; body?: string; length?: number } = {},
): Request {
  const headers = new Headers({ "content-type": JSON_TYPE });
  if (init.userId !== undefined) headers.set("authorization", `Bearer ${init.userId}`);
  if (init.length !== undefined) headers.set("content-length", String(init.length));
  const method = init.method ?? "POST";
  return new Request(EVENTS, {
    method,
    headers,
    ...(method === "GET" ? undefined : { body: init.body ?? BATCH }),
  });
}

/** The analytics processor, answering every batch with the status given, and what it was sent. */
function upstream(status = 200) {
  const forwarded: string[] = [];
  const layer = fakeHttpClientLayer((_url, init) => {
    forwarded.push(String(init.body));
    return new Response("{}", { status });
  });
  return { layer, forwarded };
}

/**
 * The route answering one request, over the environment and processor
 * handed in and a database that refuses every statement; the resolver
 * names any `user-…` bearer, and counts every time it is asked.
 */
function bytes(
  incoming: Request,
  environment: HostedEnvironmentValues,
  processor: Layer.Layer<HttpClient.HttpClient>,
  resolved: { count: number } = { count: 0 },
) {
  return Effect.gen(function* () {
    const context = yield* Effect.context<HostedEnvironment>().pipe(
      Effect.provide(
        Layer.mergeAll(Layer.succeed(HostedEnvironment, environment), processor, noDatabase),
      ),
    );
    const handle = hostedFetch({
      events: eventsProcedures({
        resolveUserId: (asked) =>
          Effect.sync(() => {
            resolved.count += 1;
            return Option.fromNullishOr(
              asked.headers.get("authorization")?.match(/^Bearer (user-.+)$/u)?.[1],
            );
          }),
      }),
    });
    // SAFETY: the procedure yields the environment, the processor's client, and the database alone, which is all a test provides of the web runtime's services.
    const webServices = context as Context.Context<WebServices>;
    const response = yield* Effect.promise(() => handle(incoming, webServices));
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      text: yield* Effect.promise(() => response.text()),
    } satisfies Bytes;
  });
}

it.effect("a batch taken is answered 202 with the count recorded", () =>
  Effect.gen(function* () {
    const posthog = upstream();

    assert.deepEqual(yield* bytes(request({ userId: "user-taken" }), RECORDING, posthog.layer), {
      status: HOSTED_HTTP_STATUS.ACCEPTED,
      contentType: JSON_TYPE,
      cacheControl: "private, no-store",
      text: '{"accepted":1}',
    });
    assert.equal(posthog.forwarded.length, 1);
  }),
);

it.effect("only POST is answered", () =>
  Effect.gen(function* () {
    const posthog = upstream();

    assert.deepEqual(
      yield* bytes(request({ method: "GET", userId: "user-get" }), RECORDING, posthog.layer),
      refused(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, "method-not-allowed"),
    );
    assert.equal(posthog.forwarded.length, 0);
  }),
);

it.effect("an unconfigured deployment is unavailable before any caller is resolved", () =>
  Effect.gen(function* () {
    const posthog = upstream();
    const resolved = { count: 0 };
    const blank = { ...NO_ENVIRONMENT, posthogProjectApiKey: Redacted.make("   ") };

    for (const environment of [NO_ENVIRONMENT, blank]) {
      assert.deepEqual(
        yield* bytes(request({ userId: "user-off" }), environment, posthog.layer, resolved),
        refused(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, "unavailable"),
      );
    }
    assert.equal(resolved.count, 0);
    assert.equal(posthog.forwarded.length, 0);
  }),
);

it.effect("an unsigned caller is refused before its batch is read", () =>
  Effect.gen(function* () {
    const posthog = upstream();
    const invalidToken = refused(HOSTED_HTTP_STATUS.UNAUTHORIZED, "invalid-token");

    assert.deepEqual(yield* bytes(request(), RECORDING, posthog.layer), invalidToken);
    assert.deepEqual(
      yield* bytes(request({ body: '{"events":"none"}' }), RECORDING, posthog.layer),
      invalidToken,
    );
    assert.equal(posthog.forwarded.length, 0);
  }),
);

it.effect("a body that is not JSON is refused as invalid, before the caller is read", () =>
  Effect.gen(function* () {
    const posthog = upstream();
    const invalid = refused(HOSTED_HTTP_STATUS.BAD_REQUEST, "invalid-request");

    assert.deepEqual(yield* bytes(request({ body: "{" }), RECORDING, posthog.layer), invalid);
    assert.deepEqual(
      yield* bytes(request({ userId: "user-garbled", body: "{" }), RECORDING, posthog.layer),
      invalid,
    );
    assert.equal(posthog.forwarded.length, 0);
  }),
);

it.effect("a body past the cap is refused as too large, and nothing is forwarded", () =>
  Effect.gen(function* () {
    const posthog = upstream();

    assert.deepEqual(
      yield* bytes(
        request({ userId: "user-oversized", length: EVENTS_MAXIMUM_BODY_BYTES + 1 }),
        RECORDING,
        posthog.layer,
      ),
      refused(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, "request-too-large"),
    );
    assert.equal(posthog.forwarded.length, 0);
  }),
);

it.effect("an upstream refusal is answered 502 with its status beside the slug", () =>
  Effect.gen(function* () {
    const posthog = upstream(503);

    assert.deepEqual(
      yield* bytes(request({ userId: "user-upstream" }), RECORDING, posthog.layer),
      refused(HOSTED_HTTP_STATUS.BAD_GATEWAY, "upstream-error", 503),
    );
    assert.equal(posthog.forwarded.length, 1);
  }),
);
