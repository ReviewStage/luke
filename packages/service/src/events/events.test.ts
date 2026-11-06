import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { personalWorkspace } from "@repo/database/schemas/personal-workspace";
import { getTestDB, joinWorkspace, openWorkspace } from "@repo/database/testing";
import { noDatabase } from "@repo/database/testing/no-database";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { DateTime, Effect } from "effect";
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
    const body = JSON.parse(String(init.body)) as PosthogBatch;
    forwarded.push({ url, body });
    return new Response("{}", { status });
  });
  return { layer, forwarded };
}

function options(overrides: Partial<EventsOptions> = {}): EventsOptions {
  return { projectApiKey: PROJECT_KEY, ...overrides };
}

function post(
  userId: string,
  batch: WireValue,
  posthog: ReturnType<typeof upstream>,
  overrides: Partial<EventsOptions> = {},
) {
  return Effect.provide(postOverDatabase(userId, batch, posthog, overrides), noDatabase);
}

function postOverDatabase(
  userId: string,
  batch: WireValue,
  posthog: ReturnType<typeof upstream>,
  overrides: Partial<EventsOptions> = {},
) {
  return Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    return yield* Effect.provide(recordEvents(userId, batch, options(overrides)), posthog.layer);
  });
}

const openAccount = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  const personal = yield* openWorkspace(userId);
  const now = yield* DateTime.nowAsDate;
  yield* Database.use((db) =>
    db.insert(personalWorkspace).values({ userId, organizationId: personal, createdAt: now }),
  );
  return { userId, personal };
});

const groupsOfBatchFrom = (userId: string) =>
  Effect.gen(function* () {
    const posthog = upstream();
    yield* postOverDatabase(userId, { events: [LAUNCH, LAUNCH] }, posthog);
    return (posthog.forwarded[0]?.body.batch ?? []).map((item) => item.properties.$groups);
  });

it.effect(
  "an accepted batch posts every event under the account at its top level, as the capture docs ask, with geolocation off",
  () =>
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
        assert.equal(item.properties.distinct_id, undefined);
        assert.equal(item.properties.$geoip_disable, true);
        assert.equal(item.properties.app_version, "0.2.0");
      }
    }),
);

it.effect("a web batch is stamped web, and one that names no platform is stamped desktop", () =>
  Effect.gen(function* () {
    const web = upstream();
    yield* post("user-web", { events: [LAUNCH], build: { platform: "web" } }, web);
    const older = upstream();
    yield* post("user-older", { events: [LAUNCH], build: { app_version: "0.17.0" } }, older);

    const [webItem] = web.forwarded[0]?.body.batch ?? [];
    assert.equal(webItem?.properties.platform, "web");
    assert.equal(webItem?.properties.$lib, "vespin-web");
    const [olderItem] = older.forwarded[0]?.body.batch ?? [];
    assert.equal(olderItem?.properties.platform, "desktop");
    assert.equal(olderItem?.properties.$lib, "vespin-desktop");
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
        ["2026-08-12T12:00:00.000Z", "2026-08-19T12:00:00.000Z", "2026-08-19T11:59:30.000Z"],
      );
    }),
);

it.effect(
  "a batch whose account was deleted after its caller was resolved is refused and nothing is forwarded",
  () =>
    Effect.gen(function* () {
      const posthog = upstream();
      const refusal = yield* Effect.flip(
        post("user-deleted", { events: [LAUNCH] }, posthog, {
          readPerson: () => Effect.succeed(undefined),
        }),
      );

      assert.equal(refusal, HOSTED_REFUSAL.INVALID_TOKEN);
      assert.deepEqual(posthog.forwarded, []);
    }),
);

it.effect("a user past the brake is refused as over quota and nothing more is forwarded", () =>
  Effect.gen(function* () {
    const posthog = upstream();
    const full = { events: Array.from({ length: 50 }, () => LAUNCH) };
    const send = () => post("user-braked", full, posthog);

    assert.deepEqual(yield* send(), { accepted: 50 });
    assert.deepEqual(yield* send(), { accepted: 50 });
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

      const older = upstream();
      assert.deepEqual(yield* post("user-stamp", { events: [signIn] }, older), { accepted: 1 });
      const [olderEvent] = older.forwarded[0]?.body.batch ?? [];
      assert.equal(olderEvent?.properties.environment, "development");
      assert.equal(olderEvent?.properties.app_version, undefined);
      assert.equal(olderEvent?.properties.packaged, undefined);
    }),
);

it.layer(getTestDB())("the workspace a batch is filed under", (it) => {
  it.effect(
    "a member of one shared workspace is filed under it, a solo account under its personal one, and a member of two under none, whatever the batch names",
    () =>
      Effect.gen(function* () {
        const solo = yield* openAccount;
        assert.deepEqual(yield* groupsOfBatchFrom(solo.userId), [
          { workspace: solo.personal },
          { workspace: solo.personal },
        ]);

        const owner = yield* openAccount;
        const team = yield* openWorkspace(owner.userId);
        const member = yield* openAccount;
        yield* joinWorkspace(team, member.userId);
        assert.deepEqual(yield* groupsOfBatchFrom(member.userId), [
          { workspace: team },
          { workspace: team },
        ]);

        const otherTeam = yield* openWorkspace(owner.userId);
        yield* joinWorkspace(otherTeam, member.userId);
        const posthog = upstream();
        yield* postOverDatabase(
          member.userId,
          { events: [LAUNCH], build: { workspace: solo.personal } },
          posthog,
        );
        assert.deepEqual(
          (posthog.forwarded[0]?.body.batch ?? []).map((item) => item.properties.$groups),
          [undefined],
        );
      }),
  );
});
