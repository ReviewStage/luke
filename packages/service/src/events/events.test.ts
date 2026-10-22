/**
 * events.test.ts -- one batch recorded for an account: read through the allowlist, braked, stamped, and forwarded.
 *
 * The caller, the kill switch, and the body's size are the route's
 * (`events-procedures.test.ts`); this is what happens to a batch once
 * they are settled. Synthetic accounts and events throughout.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { noDatabase } from "@luke/database/testing/no-database";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { PRODUCT_EVENT, type WireValue } from "../core.js";
import { HOSTED_REFUSAL, upstreamRefused } from "../http/http-effect.js";
import type { PosthogBatch } from "../providers/posthog.js";
import { type EventsOptions, recordEvents } from "./events.js";

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

function options(overrides: Partial<EventsOptions> = {}): EventsOptions {
  return { projectApiKey: PROJECT_KEY, ...overrides };
}

/**
 * One batch recorded for the account named, at the test's instant, over a
 * database that refuses every statement and the upstream handed in.
 */
function post(
  userId: string,
  batch: WireValue,
  posthog: ReturnType<typeof upstream>,
  overrides: Partial<EventsOptions> = {},
) {
  return Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    return yield* Effect.provide(
      recordEvents(userId, batch, options(overrides)),
      Layer.merge(noDatabase, posthog.layer),
    );
  });
}

it.effect("each forwarded event names the account at its top level, as the capture docs ask", () =>
  Effect.gen(function* () {
    const processor = upstream();
    assert.deepEqual(yield* post("user-1", { events: [LAUNCH] }, processor), { accepted: 1 });
    const [item] = processor.forwarded[0]?.body.batch ?? [];
    assert.equal(item?.distinct_id, "user-1");
    assert.equal(item?.properties.distinct_id, undefined);
    assert.equal(item?.properties.$geoip_disable, true);
  }),
);

it.effect("an accepted batch posts every event under the account with geolocation off", () =>
  Effect.gen(function* () {
    const posthog = upstream();
    const answer = yield* post("user-document", { events: [LAUNCH, LAUNCH] }, posthog);

    assert.deepEqual(answer, { accepted: 2 });
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
        "user-person",
        {
          events: [
            { ...LAUNCH, at: NOW - 30 * 24 * 60 * 60 * 1000 },
            { ...LAUNCH, at: NOW + 60 * 60 * 1000 },
            LAUNCH,
          ],
        },
        posthog,
        { readPerson: () => Effect.succeed(person) },
      );

      assert.deepEqual(answer, { accepted: 3 });
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

it.effect("a user past the brake is refused as over quota and nothing more is forwarded", () =>
  Effect.gen(function* () {
    const posthog = upstream();
    const full = { events: Array.from({ length: 50 }, () => LAUNCH) };
    const send = () => post("user-braked", full, posthog);

    assert.deepEqual(yield* send(), { accepted: 50 });
    assert.deepEqual(yield* send(), { accepted: 50 });
    // A third full batch puts this account at 150 events in the minute, past 120.
    assert.deepEqual(yield* Effect.flip(send()), HOSTED_REFUSAL.QUOTA_EXHAUSTED);
    assert.equal(posthog.forwarded.length, 2);
  }),
);

it.effect("an upstream refusal is refused with its status and none of its body", () =>
  Effect.gen(function* () {
    const posthog = upstream(503);

    assert.deepEqual(
      yield* Effect.flip(post("user-upstream", { events: [LAUNCH] }, posthog)),
      upstreamRefused(503),
    );
    assert.equal(posthog.forwarded.length, 1);
  }),
);

it.effect("an older build's retired event names are skipped and its live events still land", () =>
  Effect.gen(function* () {
    // `session:observe` left the vocabulary, but a 0.7.x build still sends it.
    const retired = { name: "session:observe", at: NOW - 30_000, properties: { session_count: 1 } };
    const posthog = upstream();
    assert.deepEqual(yield* post("user-retired", { events: [retired, LAUNCH] }, posthog), {
      accepted: 1,
    });
    assert.deepEqual(
      posthog.forwarded.flatMap((sent) => sent.body.batch.map((item) => item.event)),
      [PRODUCT_EVENT.APP_LAUNCH],
    );

    assert.deepEqual(yield* post("user-retired", { events: [retired] }, posthog), {
      accepted: 0,
    });
    assert.equal(posthog.forwarded.length, 1);

    // A name that was never in the vocabulary still refuses the batch.
    assert.deepEqual(
      yield* Effect.flip(
        post("user-retired", { events: [{ ...LAUNCH, name: "app:lunch" }, LAUNCH] }, posthog),
      ),
      HOSTED_REFUSAL.INVALID_REQUEST,
    );
    assert.equal(posthog.forwarded.length, 1);
  }),
);

it.effect(
  "every forwarded event names the deployment and the build its batch came from, and an older build's batch still lands",
  () =>
    Effect.gen(function* () {
      const signIn = { name: PRODUCT_EVENT.ACCOUNT_SIGN_IN, at: NOW - 10_000, properties: {} };

      const current = upstream();
      yield* post(
        "user-stamp",
        { events: [signIn], build: { app_version: "0.18.0", packaged: false } },
        current,
        { deployment: "preview" },
      );
      const [currentEvent] = current.forwarded[0]?.body.batch ?? [];
      assert.equal(currentEvent?.properties.environment, "preview");
      assert.equal(currentEvent?.properties.app_version, "0.18.0");
      assert.equal(currentEvent?.properties.packaged, false);

      // Builds 0.7 to 0.17 send no `build`; their counts land with the
      // deployment alone, and a service Vercel names no environment for is
      // not production.
      const older = upstream();
      assert.deepEqual(yield* post("user-stamp", { events: [signIn] }, older), { accepted: 1 });
      const [olderEvent] = older.forwarded[0]?.body.batch ?? [];
      assert.equal(olderEvent?.properties.environment, "development");
      assert.equal(olderEvent?.properties.app_version, undefined);
      assert.equal(olderEvent?.properties.packaged, undefined);
    }),
);
