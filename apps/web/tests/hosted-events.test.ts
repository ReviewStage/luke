import assert from "node:assert/strict";
import { atInstant, fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect, Option } from "effect";
import { test } from "vitest";
import { PRODUCT_EVENT, type WireValue } from "../server/core";
import { type EventsOptions, handleEvents } from "../server/hosted/events";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import type { PosthogBatch } from "../server/hosted/posthog";
import { runWithoutDatabase } from "./support/no-database";

const NOW = Date.parse("2026-08-19T12:00:00.000Z");
const PROJECT_KEY = "phc_project";

const LAUNCH = {
  name: PRODUCT_EVENT.APP_LAUNCH,
  at: NOW - 30_000,
  properties: { app_version: "0.2.0" },
};

interface Forwarded {
  url: string;
  body: PosthogBatch;
}

function upstream(status = 200) {
  const forwarded: Forwarded[] = [];
  const layer = fakeHttpClientLayer((url, init) => {
    // SAFETY: the body is the batch document this endpoint just serialized.
    const body = JSON.parse(String(init.body)) as PosthogBatch;
    forwarded.push({ url, body });
    return new Response("{}", { status });
  });
  return { layer, forwarded };
}

/** A request carrying an already-serialized body, for the malformed cases. */
function rawEventsRequest(body: string): Request {
  return new Request("https://luke.test/api/events", {
    method: "POST",
    headers: { authorization: "Bearer token-1" },
    body,
  });
}

function eventsRequest(body: WireValue): Request {
  return rawEventsRequest(JSON.stringify(body));
}

function options(overrides: Partial<EventsOptions> = {}): EventsOptions {
  const resolveUserId: EventsOptions["resolveUserId"] = () => Effect.succeedSome("user-1");
  return {
    request: eventsRequest({ events: [LAUNCH] }),
    projectApiKey: PROJECT_KEY,
    resolveUserId,
    ...overrides,
  };
}

/** The handler run at the test's one instant, which the batch's timestamps are clamped against. */
function events(options: EventsOptions) {
  return atInstant(NOW)(handleEvents(options));
}

test("only POST is answered, and nothing is forwarded without a key or a token", async () => {
  const wrongMethod = upstream();
  const rejectedMethod = await runWithoutDatabase(
    events(
      options({
        request: new Request("https://luke.test/api/events"),
        httpClient: wrongMethod.layer,
      }),
    ),
  );
  assert.equal(rejectedMethod.status, 405);
  assert.equal((await rejectedMethod.json()).error, HOSTED_API_ERROR.METHOD_NOT_ALLOWED);
  assert.equal(wrongMethod.forwarded.length, 0);

  const keyless = upstream();
  let resolved = 0;
  const unconfigured = await runWithoutDatabase(
    events(
      options({
        projectApiKey: "   ",
        httpClient: keyless.layer,
        resolveUserId: () =>
          Effect.sync(() => {
            resolved += 1;
            return Option.some("user-1");
          }),
      }),
    ),
  );
  assert.equal(unconfigured.status, 503);
  assert.equal((await unconfigured.json()).error, HOSTED_API_ERROR.UNAVAILABLE);
  assert.equal(keyless.forwarded.length, 0);
  // The kill switch is read before the token, so an unconfigured deployment
  // does no work at all.
  assert.equal(resolved, 0);

  const anonymous = upstream();
  const refused = await runWithoutDatabase(
    events(options({ resolveUserId: () => Effect.succeedNone, httpClient: anonymous.layer })),
  );
  assert.equal(refused.status, 401);
  assert.equal((await refused.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);
  assert.equal(anonymous.forwarded.length, 0);
});
