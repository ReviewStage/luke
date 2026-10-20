import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { ownFailedRunsLiveStatement } from "@luke/database/models/automation-store";
import { getTestDB, mutableFunctionsOf } from "@luke/database/testing";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import {
  accountInboxLiveStatements,
  memberAgentInboxLiveStatements,
  taskInboxLiveStatements,
} from "../inbox/inbox-store.js";
import { LiveSealing, liveSealingFromEnvironment, REALTIME_ENVIRONMENT } from "./realtime.js";

/**
 * Every statement the live endpoints seal calls only functions Postgres
 * marks immutable, since Neon Realtime refuses any other ("scalar expression
 * uses a mutable function") where Postgres runs it without a word.
 */

const USER_ID = "user-live-statements";

/** A deployment's Realtime over a synthetic secret in the shape its SDK reads, so no credential is written down. */
const SEALING_ENVIRONMENT = {
  DATABASE_URL: "postgresql://luke:synthetic@db.example/neondb?sslmode=require",
  [REALTIME_ENVIRONMENT.URL]: "wss://realtime.example/v1",
  [REALTIME_ENVIRONMENT.SECRET]: `nrt_live_1${Buffer.alloc(32).toString("base64url")}`,
};

/** Every live statement the endpoints seal, by the part it answers. */
function liveStatements() {
  const account = Option.getOrThrow(accountInboxLiveStatements(USER_ID));
  const task = Option.getOrThrow(taskInboxLiveStatements(USER_ID, randomUUID()));
  const agent = Option.getOrThrow(memberAgentInboxLiveStatements(USER_ID, randomUUID()));
  return {
    ...Object.fromEntries(
      Object.entries(account).map(([part, query]) => [`account.${part}`, query]),
    ),
    "account.failedRuns": Option.getOrThrow(ownFailedRunsLiveStatement(USER_ID)),
    ...Object.fromEntries(Object.entries(task).map(([part, query]) => [`task.${part}`, query])),
    ...Object.fromEntries(Object.entries(agent).map(([part, query]) => [`agent.${part}`, query])),
  };
}

it.layer(getTestDB())("the live statements", (it) => {
  it.effect(
    "every statement a live endpoint seals calls only immutable functions, as Realtime requires",
    () =>
      Effect.gen(function* () {
        const mutable = yield* Effect.forEach(
          Object.entries(liveStatements()),
          ([part, statement]) =>
            Effect.map(mutableFunctionsOf(statement), (called) => [part, called] as const),
        );
        assert.deepEqual(
          mutable.filter(([, called]) => called.length > 0),
          [],
        );
      }),
  );

  it.effect(
    "every statement a live endpoint seals is a Drizzle select Realtime's Drizzle adapter seals, each key the name Postgres answers it under",
    () =>
      Effect.gen(function* () {
        const sealing = yield* Effect.gen(function* () {
          return yield* LiveSealing;
        }).pipe(
          Effect.provide(
            liveSealingFromEnvironment.pipe(
              Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(SEALING_ENVIRONMENT))),
            ),
          ),
        );
        assert.ok(Option.isSome(sealing));
        const { seal } = sealing.value;
        const refused = yield* Effect.forEach(
          Object.entries(liveStatements()),
          ([part, statement]): Effect.Effect<string | undefined> =>
            statement.query === undefined
              ? Effect.succeed(`${part}: no Drizzle select`)
              : Effect.match(seal(statement), {
                  onFailure: () => `${part}: refused`,
                  onSuccess: () => undefined,
                }),
        );
        assert.deepEqual(
          refused.filter((entry) => entry !== undefined),
          [],
        );
      }),
  );
});
