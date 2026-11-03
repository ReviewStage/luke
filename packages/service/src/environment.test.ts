import assert from "node:assert/strict";
import { ConfigProvider, Effect, Layer, Logger, Redacted } from "effect";
import { test } from "vitest";
import {
  HostedEnvironment,
  type HostedEnvironmentValues,
  hostedEnvironment,
} from "./environment.js";
import { CRON_ENVIRONMENT } from "./maintenance/maintenance-bounds.js";
import { POSTHOG_ENVIRONMENT } from "./providers/posthog.js";

/**
 * The environment layer read over a record of this test's own, in place of
 * `process.env`: the layer names `fromEnv` itself, so the record is put in the
 * process environment for the read and taken back out after it. Every line
 * the build logs is kept in `logged`.
 */
async function environmentOver(
  variables: Record<string, string | undefined>,
  logged: string[] = [],
): Promise<HostedEnvironmentValues> {
  const previous = new Map(Object.keys(variables).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(variables)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  const recorder = Logger.make(({ message }) => {
    logged.push(JSON.stringify(message));
  });
  try {
    return await Effect.runPromise(
      Effect.provide(HostedEnvironment, hostedEnvironment).pipe(
        Effect.provide(Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv())),
        Effect.provide(Logger.layer([recorder])),
      ),
    );
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("a secret that is set travels sealed and trimmed, and its value is the one the environment holds", async () => {
  const environment = await environmentOver({
    [POSTHOG_ENVIRONMENT.PERSONAL_API_KEY]: "  phx-personal-key\n",
    [CRON_ENVIRONMENT.CRON_SECRET]: " cron-secret-1 ",
  });
  assert.ok(
    environment.posthogPersonalApiKey && Redacted.isRedacted(environment.posthogPersonalApiKey),
  );
  assert.equal(Redacted.value(environment.posthogPersonalApiKey), "phx-personal-key");
  assert.ok(environment.cronSecret);
  assert.equal(Redacted.value(environment.cronSecret), "cron-secret-1");
});

test("a blank secret, empty or spaces alone, reads as unset", async () => {
  for (const blank of ["", "   ", "\n\t "]) {
    const environment = await environmentOver({ [CRON_ENVIRONMENT.CRON_SECRET]: blank });
    assert.equal(environment.cronSecret, undefined, JSON.stringify(blank));
  }
});
