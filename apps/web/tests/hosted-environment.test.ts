import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { type Config, ConfigProvider, Effect, Layer, Redacted } from "effect";

import { VAULT_ENCRYPTION_ENVIRONMENT } from "../server/hosted/encryption";
import {
  HostedEnvironment,
  type HostedEnvironmentValues,
  hostedEnvironment,
} from "../server/hosted/environment";
import { OBSERVATION_ENVIRONMENT } from "../server/hosted/observation-bounds";
import { HOSTED_OPENAI_ENVIRONMENT } from "../server/hosted/openai";

/**
 * The environment layer read over a record of this test's own, in place of
 * `process.env`: the layer names `fromEnv` itself, so the record is put in the
 * process environment for the read and taken back out after it.
 */
function environmentOver(
  variables: Record<string, string | undefined>,
): Effect.Effect<HostedEnvironmentValues, Config.ConfigError> {
  const previous = new Map(Object.keys(variables).map((name) => [name, process.env[name]]));
  const assign = (entries: Iterable<readonly [string, string | undefined]>) => {
    for (const [name, value] of entries) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  // The record is the process environment only for the read, restored however the read ended.
  return Effect.acquireUseRelease(
    Effect.sync(() => assign(Object.entries(variables))),
    () =>
      Effect.provide(HostedEnvironment, hostedEnvironment).pipe(
        Effect.provide(Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv())),
      ),
    () => Effect.sync(() => assign(previous)),
  );
}

it.effect(
  "a secret that is set to the empty string, or to whitespace, is absent, the same as one never set",
  () =>
    Effect.map(
      environmentOver({
        [HOSTED_OPENAI_ENVIRONMENT.API_KEY]: "",
        [VAULT_ENCRYPTION_ENVIRONMENT.SECRET]: "   ",
        [OBSERVATION_ENVIRONMENT.CRON_SECRET]: undefined,
      }),
      (environment) => {
        assert.equal(environment.openAiKey, undefined);
        assert.equal(environment.providerKeyEncryptionSecret, undefined);
        assert.equal(environment.cronSecret, undefined);
      },
    ),
);

it.effect(
  "a secret that is set travels sealed and trimmed, and its value is the one the environment holds",
  () =>
    Effect.map(
      environmentOver({
        [HOSTED_OPENAI_ENVIRONMENT.API_KEY]: "sk-test-not-a-real-key",
        [VAULT_ENCRYPTION_ENVIRONMENT.SECRET]: `  ${"a".repeat(64)}\n`,
        [OBSERVATION_ENVIRONMENT.CRON_SECRET]: " cron-secret-1 ",
      }),
      (environment) => {
        assert.ok(environment.openAiKey && Redacted.isRedacted(environment.openAiKey));
        assert.equal(Redacted.value(environment.openAiKey), "sk-test-not-a-real-key");
        assert.equal(String(environment.openAiKey), "<redacted>");
        assert.ok(environment.providerKeyEncryptionSecret);
        assert.equal(Redacted.value(environment.providerKeyEncryptionSecret), "a".repeat(64));
        assert.ok(environment.cronSecret);
        assert.equal(Redacted.value(environment.cronSecret), "cron-secret-1");
      },
    ),
);
