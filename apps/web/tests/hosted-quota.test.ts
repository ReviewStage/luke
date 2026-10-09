import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { test } from "vitest";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { hostedUsage } from "../server/db/usage-schema";
import { spendHostedMeter, utcDayKey } from "../server/hosted/quota";
import { testSqlClient } from "./support/sql-client";

const NOON_UTC = Date.parse("2026-08-17T12:00:00.000Z");

/** The ceiling the service used to refuse past; the count is what remains, and it stops nowhere. */
const FORMER_DAILY_LIMIT = 5_000;

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

test("a day key is the UTC date", () => {
  assert.equal(utcDayKey(NOON_UTC), "2026-08-17");
});

it.layer(testSqlClient)("the usage meter over effect/unstable/sql", (it) => {
  it.effect("a hosted use counts one on the day's one counter", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      assert.equal(yield* spendHostedMeter({ userId, now: NOON_UTC }), 1);
    }),
  );

  it.effect("every hosted operation counts on the same counter", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* spendHostedMeter({ userId, now: NOON_UTC });
      yield* spendHostedMeter({ userId, now: NOON_UTC });
      assert.equal(yield* spendHostedMeter({ userId, now: NOON_UTC }), 3);
    }),
  );

  it.effect("a day past the former ceiling is still counted, and refused nothing", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const day = utcDayKey(NOON_UTC);
      yield* db.insert(hostedUsage).values({ userId, day, calls: FORMER_DAILY_LIMIT });

      assert.equal(yield* spendHostedMeter({ userId, now: NOON_UTC }), FORMER_DAILY_LIMIT + 1);
      assert.equal(yield* spendHostedMeter({ userId, now: NOON_UTC }), FORMER_DAILY_LIMIT + 2);
      const rows = yield* db
        .select({ calls: hostedUsage.calls })
        .from(hostedUsage)
        .where(eq(hostedUsage.userId, userId));
      assert.deepEqual(rows, [{ calls: FORMER_DAILY_LIMIT + 2 }]);
    }),
  );
});
