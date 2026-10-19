import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { noDatabase, runWithoutDatabase } from "@luke/database/testing/no-database";
import { atInstant, fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { test } from "vitest";
import { PRODUCT_EVENT, type WireValue } from "../core.js";
import { HOSTED_API_ERROR } from "../http/http.js";
import type { PosthogBatch } from "../providers/posthog.js";
import { type EventsOptions, handleEvents } from "./events.js";

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

test("each forwarded event names the account at its top level, as the capture docs ask", async () => {
  const processor = upstream();
  const accepted = await runWithoutDatabase(events(options({ httpClient: processor.layer })));
  assert.equal(accepted.status, 202);
  const [item] = processor.forwarded[0]?.body.batch ?? [];
  assert.equal(item?.distinct_id, "user-1");
  assert.equal(item?.properties.distinct_id, undefined);
  assert.equal(item?.properties.$geoip_disable, true);
});

/** Options for one account of its own, so no test spends another's brake window. */
function forUser(userId: string, overrides: Partial<EventsOptions> = {}): EventsOptions {
  return options({ resolveUserId: () => Effect.succeedSome(userId), ...overrides });
}

/** The handler as an `it.effect` body runs it: at the test's instant, over a database that refuses every statement. */
function post(eventsOptions: EventsOptions) {
  return Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    return yield* Effect.provide(handleEvents(eventsOptions), noDatabase);
  });
}

function bodyOf(response: Response) {
  return Effect.promise(() => response.json());
}

it.effect("an accepted batch posts every event under the account with geolocation off", () =>
  Effect.gen(function* () {
    const posthog = upstream();
    const answer = yield* post(
      forUser("user-document", {
        request: eventsRequest({ events: [LAUNCH, LAUNCH] }),
        httpClient: posthog.layer,
      }),
    );

    assert.equal(answer.status, 202);
    assert.deepEqual(yield* bodyOf(answer), { accepted: 2 });
    assert.equal(posthog.forwarded.length, 1);
    const [sent] = posthog.forwarded;
    assert.equal(sent?.url, "https://us.i.posthog.com/batch/");
    assert.equal(sent?.body.api_key, PROJECT_KEY);
    assert.equal(sent?.body.historical_migration, false);
    assert.equal(sent?.body.batch.length, 2);
    for (const item of sent?.body.batch ?? []) {
      assert.equal(item.event, PRODUCT_EVENT.APP_LAUNCH);
      assert.equal(item.distinct_id, "user-document");
      assert.equal(item.properties.$geoip_disable, true);
      assert.equal(item.properties.app_version, "0.2.0");
    }
  }),
);

it.effect(
  "the person is set on the first item alone, and each timestamp is clamped into the window",
  () =>
    Effect.gen(function* () {
      const posthog = upstream();
      const person = { name: "Ada Lovelace", email: "ada@example.test" };
      const answer = yield* post(
        forUser("user-person", {
          request: eventsRequest({
            events: [
              { ...LAUNCH, at: NOW - 30 * 24 * 60 * 60 * 1000 },
              { ...LAUNCH, at: NOW + 60 * 60 * 1000 },
              LAUNCH,
            ],
          }),
          readPerson: () => Effect.succeed(person),
          httpClient: posthog.layer,
        }),
      );

      assert.equal(answer.status, 202);
      const batch = posthog.forwarded[0]?.body.batch ?? [];
      assert.deepEqual(
        batch.map((item) => item.properties.$set),
        [person, undefined, undefined],
      );
      assert.deepEqual(
        batch.map((item) => item.timestamp),
        [
          // A month back is pulled up to the oldest instant the window keeps.
          "2026-08-12T12:00:00.000Z",
          // An hour ahead of the service's clock is pulled back to it.
          "2026-08-19T12:00:00.000Z",
          // Inside the window, the desktop's own instant stands.
          "2026-08-19T11:59:30.000Z",
        ],
      );
    }),
);

it.effect("a user past the brake is answered 429 and nothing more is forwarded", () =>
  Effect.gen(function* () {
    const posthog = upstream();
    const full = { events: Array.from({ length: 50 }, () => LAUNCH) };
    const send = () =>
      post(forUser("user-braked", { request: eventsRequest(full), httpClient: posthog.layer }));

    assert.equal((yield* send()).status, 202);
    assert.equal((yield* send()).status, 202);
    // A third full batch puts this account at 150 events in the minute, past 120.
    const braked = yield* send();
    assert.equal(braked.status, 429);
    assert.equal((yield* bodyOf(braked)).error, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
    assert.equal(posthog.forwarded.length, 2);
  }),
);

it.effect("an oversized body is refused before it is read, even around a valid batch", () =>
  Effect.gen(function* () {
    const posthog = upstream();
    const answer = yield* post(
      forUser("user-oversized", {
        request: eventsRequest({ events: [LAUNCH], padding: "x".repeat(16_384) }),
        httpClient: posthog.layer,
      }),
    );

    assert.equal(answer.status, 400);
    assert.equal((yield* bodyOf(answer)).error, HOSTED_API_ERROR.INVALID_REQUEST);
    assert.equal(posthog.forwarded.length, 0);
  }),
);

it.effect("an upstream refusal is answered 502 with its status and none of its body", () =>
  Effect.gen(function* () {
    const posthog = upstream(503);
    const answer = yield* post(forUser("user-upstream", { httpClient: posthog.layer }));

    assert.equal(answer.status, 502);
    assert.deepEqual(yield* bodyOf(answer), {
      error: HOSTED_API_ERROR.UPSTREAM_ERROR,
      upstreamStatus: 503,
    });
    assert.equal(posthog.forwarded.length, 1);
  }),
);

it.effect("an older build's retired event names are skipped and its live events still land", () =>
  Effect.gen(function* () {
    // `session:observe` left the vocabulary, but a 0.7.x build still sends it.
    const retired = { name: "session:observe", at: NOW - 30_000, properties: { session_count: 1 } };
    const posthog = upstream();
    const mixed = yield* post(
      forUser("user-retired", {
        request: eventsRequest({ events: [retired, LAUNCH] }),
        httpClient: posthog.layer,
      }),
    );
    assert.equal(mixed.status, 202);
    assert.deepEqual(yield* bodyOf(mixed), { accepted: 1 });
    assert.deepEqual(
      posthog.forwarded.flatMap((sent) => sent.body.batch.map((item) => item.event)),
      [PRODUCT_EVENT.APP_LAUNCH],
    );

    const onlyRetired = yield* post(
      forUser("user-retired", {
        request: eventsRequest({ events: [retired] }),
        httpClient: posthog.layer,
      }),
    );
    assert.equal(onlyRetired.status, 202);
    assert.deepEqual(yield* bodyOf(onlyRetired), { accepted: 0 });
    assert.equal(posthog.forwarded.length, 1);

    // A name that was never in the vocabulary still refuses the batch.
    const typo = yield* post(
      forUser("user-retired", {
        request: eventsRequest({ events: [{ ...LAUNCH, name: "app:lunch" }, LAUNCH] }),
        httpClient: posthog.layer,
      }),
    );
    assert.equal(typo.status, 400);
    assert.equal((yield* bodyOf(typo)).error, HOSTED_API_ERROR.INVALID_REQUEST);
    assert.equal(posthog.forwarded.length, 1);
  }),
);
