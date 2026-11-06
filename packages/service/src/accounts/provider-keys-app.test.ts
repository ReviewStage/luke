// provider-keys-app.test.ts -- the rotation's rewrap route under the bearer a maintainer asks it with.
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { noDatabase } from "@repo/database/testing/no-database";
import { Effect, Layer, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { MAINTENANCE_PROVIDER_KEYS_REWRAP_PATH } from "../maintenance/maintenance-bounds.js";
import { providerKeyRewrapApp } from "./provider-keys-app.js";

/**
 * The rewrap's group as `scripts/rewrap-provider-keys.sh` reaches it: asked
 * under the deployment's `CRON_SECRET`, and never under any other bearer. A refusal answers before the store is
 * asked anything, so no database stands behind the group; what a rewrap
 * that runs does is `provider-key-rewrap.test.ts`'s. Synthetic secrets, and
 * a key-encryption key of fixed bytes written for this file.
 */

const CRON_SECRET = "cron-secret-1";
/** A bearer that is not the cron's secret. */
const OTHER_BEARER = "other-bearer-1";
/** A ring of one key, held by every deployment here, so no refusal is the ring's absence. */
const KEYS = `1:${Buffer.alloc(32, 1).toString("base64")}`;

/** A deployment holding the cron secret given and a ring. */
function environment(cronSecret: string | undefined): HostedEnvironmentValues {
  return {
    posthogPersonalApiKey: undefined,
    posthogProjectId: undefined,
    posthogApiHost: undefined,
    posthogProjectApiKey: undefined,
    posthogIngestHost: undefined,
    cronSecret: cronSecret === undefined ? undefined : Redacted.make(cronSecret),
    githubWebhookSecret: undefined,
    providerKeyEncryptionKeys: Redacted.make(KEYS),
    titleAnthropicApiKey: undefined,
  };
}

/** A maintainer's POST under `bearer`, answered by the group on a deployment whose cron secret is `cronSecret`. */
const rewrap = (cronSecret: string | undefined, bearer: string) =>
  Effect.gen(function* () {
    const services = Layer.merge(
      noDatabase,
      Layer.succeed(HostedEnvironment, environment(cronSecret)),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      providerKeyRewrapApp().pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const request = new Request(`https://app.test${MAINTENANCE_PROVIDER_KEYS_REWRAP_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}` },
    });
    const response = yield* Effect.promise(() => handler(request));
    yield* Effect.promise(() => dispose());
    return response.status;
  });

it.effect(
  "a rewrap asked under a bearer that is not the cron's secret rewraps nothing, beside the cron's secret or without it",
  () =>
    Effect.gen(function* () {
      const beside = yield* rewrap(CRON_SECRET, OTHER_BEARER);
      const without = yield* rewrap(undefined, OTHER_BEARER);
      assert.deepEqual([beside, without], [401, 503]);
    }),
);
