import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { liveSelection, liveStatementOf } from "@luke/database/core/live-statement";
import { queryBuilder } from "@luke/database/core/query";
import { inboxItem } from "@luke/database/schemas/inbox";
import { getTestDB } from "@luke/database/testing";
import { LIVE_POLL_URL } from "@luke/features/live-wire";
import { eq } from "drizzle-orm";
import { ConfigProvider, Effect, Layer, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import { LiveSealing, liveSealingFromEnvironment, REALTIME_ENVIRONMENT } from "./realtime.js";

/**
 * The deployment's Neon Realtime as its environment configures it: polled
 * without both of its variables, off with a secret Realtime refuses, and on
 * otherwise, sealing a statement locally under Realtime's own SDK for the
 * database the connection string names, with the address the desktop
 * subscribes at.
 *
 * The secret is synthetic, built here in the shape Realtime's SDK reads one,
 * so no credential is written down.
 */

/** A secret in the shape Realtime's SDK reads: its prefix and thirty-two bytes, all zero. */
const SYNTHETIC_SECRET = `nrt_live_1${Buffer.alloc(32).toString("base64url")}`;
const REALTIME_URL = "wss://realtime.example/v1";
const DATABASE_URL = "postgresql://luke:synthetic@db.example/neondb?sslmode=require";

/** The sealing the layer builds over an environment holding just these variables, on the test's database. */
const sealingOver = (environment: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* Effect.provide(
      Effect.gen(function* () {
        return yield* LiveSealing;
      }),
      liveSealingFromEnvironment.pipe(
        Layer.provide(
          Layer.merge(
            ConfigProvider.layer(ConfigProvider.fromUnknown(environment)),
            Layer.succeed(SqlClient.SqlClient, sql),
          ),
        ),
      ),
    );
  });

it.layer(getTestDB())("the deployment's Realtime", (it) => {
  it.effect(
    "without both of its variables Realtime is polled, each statement read and its rows answered; with a secret Realtime refuses it is off",
    () =>
      Effect.gen(function* () {
        for (const environment of [
          { DATABASE_URL },
          { DATABASE_URL, [REALTIME_ENVIRONMENT.URL]: REALTIME_URL },
          {
            DATABASE_URL,
            [REALTIME_ENVIRONMENT.URL]: REALTIME_URL,
            [REALTIME_ENVIRONMENT.SECRET]: "  ",
          },
        ]) {
          const sealing = yield* sealingOver(environment);
          assert.ok(Option.isSome(sealing));
          assert.equal(sealing.value.url, LIVE_POLL_URL);
          const sealed = yield* sealing.value.seal({
            sql: 'select $1::text as "who", 2::int as "count"',
            params: ["user-dana"],
          });
          assert.deepEqual(sealed.rows, [{ who: "user-dana", count: 2 }]);
        }
        assert.ok(
          Option.isNone(
            yield* sealingOver({
              DATABASE_URL,
              [REALTIME_ENVIRONMENT.URL]: REALTIME_URL,
              [REALTIME_ENVIRONMENT.SECRET]: "not a secret",
            }),
          ),
        );
      }),
  );

  it.effect(
    "with both, a statement is sealed locally, its words unreadable in the seal, with the address the desktop subscribes at",
    () =>
      Effect.gen(function* () {
        const sealing = yield* sealingOver({
          DATABASE_URL,
          [REALTIME_ENVIRONMENT.URL]: ` ${REALTIME_URL} `,
          [REALTIME_ENVIRONMENT.SECRET]: SYNTHETIC_SECRET,
        });
        assert.ok(Option.isSome(sealing));
        assert.equal(sealing.value.url, REALTIME_URL);
        const statement = {
          sql: 'select "inbox_item"."id" as "id" from "inbox_item" where "inbox_item"."user_id" = $1',
          params: ["user-dana"],
        };
        const sealed = yield* sealing.value.seal(statement);
        const again = yield* sealing.value.seal(statement);
        assert.ok(!sealed.capability.includes("user-dana"));
        assert.ok(!sealed.capability.includes("inbox_item"));
        assert.equal(sealed.queryFingerprint, again.queryFingerprint);
        const other = yield* sealing.value.seal({ ...statement, params: ["user-eli"] });
        assert.notEqual(other.queryFingerprint, sealed.queryFingerprint);
      }),
  );

  it.effect(
    "a Drizzle select is sealed through Realtime's Drizzle adapter, which refuses one whose key is not the name Postgres answers it under",
    () =>
      Effect.gen(function* () {
        const sealing = yield* sealingOver({
          DATABASE_URL,
          [REALTIME_ENVIRONMENT.URL]: REALTIME_URL,
          [REALTIME_ENVIRONMENT.SECRET]: SYNTHETIC_SECRET,
        });
        assert.ok(Option.isSome(sealing));
        const select = (columns: Parameters<typeof queryBuilder.select>[0]) =>
          Option.getOrThrow(
            liveStatementOf(
              queryBuilder.select(columns).from(inboxItem).where(eq(inboxItem.userId, "user-dana")),
            ),
          );
        const aliased = yield* Effect.result(
          sealing.value.seal(select(liveSelection({ itemId: inboxItem.id }))),
        );
        assert.ok(Result.isSuccess(aliased));
        const renamed = yield* Effect.result(sealing.value.seal(select({ itemId: inboxItem.id })));
        assert.ok(Result.isFailure(renamed));
      }),
  );
});
