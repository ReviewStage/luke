import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Redacted, Result } from "effect";
import {
  SENTRY_APP_ENVIRONMENT,
  SentryApp,
  sentryAppFromEnvironment,
} from "./sentry-app-config.js";

const settingsOver = (variables: Record<string, string>) =>
  Effect.flatMap(SentryApp, (app) => Effect.result(app.settings)).pipe(
    Effect.provide(sentryAppFromEnvironment),
    Effect.provide(
      Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(variables)),
    ),
  );

it.effect(
  "a deployment holding every variable answers the settings, trimmed, the secret sealed",
  () =>
    Effect.gen(function* () {
      const read = yield* settingsOver({
        [SENTRY_APP_ENVIRONMENT.SLUG]: " vespin ",
        [SENTRY_APP_ENVIRONMENT.CLIENT_ID]: "client-id",
        [SENTRY_APP_ENVIRONMENT.CLIENT_SECRET]: "not-a-real-secret\n",
      });

      assert.ok(Result.isSuccess(read));
      assert.equal(read.success.slug, "vespin");
      assert.equal(read.success.clientId, "client-id");
      assert.equal(Redacted.value(read.success.clientSecret), "not-a-real-secret");
    }),
);

it.effect(
  "a deployment missing variables still builds, and its read names each one missing or blank",
  () =>
    Effect.gen(function* () {
      const read = yield* settingsOver({
        [SENTRY_APP_ENVIRONMENT.SLUG]: "luke",
        [SENTRY_APP_ENVIRONMENT.CLIENT_ID]: "  ",
      });

      assert.ok(Result.isFailure(read));
      assert.deepEqual(read.failure.missing, [
        SENTRY_APP_ENVIRONMENT.CLIENT_ID,
        SENTRY_APP_ENVIRONMENT.CLIENT_SECRET,
      ]);
    }),
);
