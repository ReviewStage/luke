import assert from "node:assert/strict";
import { ConfigProvider, Effect, Layer, Redacted } from "effect";
import { test } from "vitest";
import { BRAIN_HOST_ENVIRONMENT } from "./agents/brain-host/bounds.js";
import {
  HostedEnvironment,
  type HostedEnvironmentValues,
  hostedEnvironment,
} from "./environment.js";
import { CRON_ENVIRONMENT } from "./maintenance/maintenance-bounds.js";
import { HOSTED_OPENAI_ENVIRONMENT } from "./providers/openai.js";
import { POSTHOG_ENVIRONMENT } from "./providers/posthog.js";

/**
 * The environment layer read over a record of this test's own, in place of
 * `process.env`: the layer names `fromEnv` itself, so the record is put in the
 * process environment for the read and taken back out after it.
 */
async function environmentOver(
  variables: Record<string, string | undefined>,
): Promise<HostedEnvironmentValues> {
  const previous = new Map(Object.keys(variables).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(variables)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await Effect.runPromise(
      Effect.provide(HostedEnvironment, hostedEnvironment).pipe(
        Effect.provide(Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv())),
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
    [HOSTED_OPENAI_ENVIRONMENT.API_KEY]: "sk-test-not-a-real-key",
    [POSTHOG_ENVIRONMENT.PERSONAL_API_KEY]: "  phx-personal-key\n",
    [CRON_ENVIRONMENT.CRON_SECRET]: " cron-secret-1 ",
  });
  assert.ok(environment.openAiKey && Redacted.isRedacted(environment.openAiKey));
  assert.equal(Redacted.value(environment.openAiKey), "sk-test-not-a-real-key");
  assert.equal(String(environment.openAiKey), "<redacted>");
  assert.ok(environment.posthogPersonalApiKey);
  assert.equal(Redacted.value(environment.posthogPersonalApiKey), "phx-personal-key");
  assert.ok(environment.cronSecret);
  assert.equal(Redacted.value(environment.cronSecret), "cron-secret-1");
});

test("the deployment's secret at eve's door is read from its own variable and never from the cron's", async () => {
  const cronAlone = await environmentOver({
    [CRON_ENVIRONMENT.CRON_SECRET]: "cron-secret-1",
    [BRAIN_HOST_ENVIRONMENT.DEPLOYMENT_SECRET]: undefined,
  });
  assert.equal(cronAlone.eveDeploymentSecret, undefined);
  const both = await environmentOver({
    [CRON_ENVIRONMENT.CRON_SECRET]: "cron-secret-1",
    [BRAIN_HOST_ENVIRONMENT.DEPLOYMENT_SECRET]: " eve-deployment-secret-1 ",
  });
  assert.ok(both.cronSecret && both.eveDeploymentSecret);
  assert.equal(Redacted.value(both.cronSecret), "cron-secret-1");
  assert.equal(Redacted.value(both.eveDeploymentSecret), "eve-deployment-secret-1");
});
