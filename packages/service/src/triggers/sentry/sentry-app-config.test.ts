import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Redacted, Result } from "effect";
import {
  SENTRY_APP_ENVIRONMENT,
  SentryApp,
  sentryAppFromEnvironment,
} from "./sentry-app-config.js";

/**
 * The Sentry integration read from a deployment's environment: whole, it
 * answers its settings with the secret sealed; partial or absent, the layer
 * still builds and every read names what is missing.
 */

/** The integration's settings read over a record of this test's own in place of the environment. */
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
        [SENTRY_APP_ENVIRONMENT.SLUG]: " luke ",
        [SENTRY_APP_ENVIRONMENT.CLIENT_ID]: "client-id",
        [SENTRY_APP_ENVIRONMENT.CLIENT_SECRET]: "not-a-real-secret\n",
      });

      assert.ok(Result.isSuccess(read));
      assert.equal(read.success.slug, "luke");
      assert.equal(read.success.clientId, "client-id");
      assert.equal(Redacted.value(read.success.clientSecret), "not-a-real-secret");
      assert.equal(String(read.success.clientSecret), "<redacted>");
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
