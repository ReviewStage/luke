// deployment-eve.test.ts -- the deployment's caller for an account: composed under its own secret, never the cron's.
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB } from "@luke/database/testing";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Layer, Redacted, Result } from "effect";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_REFUSAL } from "../http/http-effect.js";
import { deploymentEve, deploymentEveForAccounts } from "./deployment-eve.js";
import { EVE_MOUNT } from "./eve-host/eve-sessions.js";

/**
 * The one place a web function composes the deployment's caller for an
 * account, which a cookie request's `eveFor`, a GitHub wake, and an
 * automation's run all reach a coding agent's session through: a deployment
 * holding the cron's secret alone, or no environment, or no origin, reaches
 * no one and sends nothing. A fake HTTP boundary writes down every request.
 * Synthetic accounts, sessions, and secrets throughout.
 */

const ORIGIN = "https://luke.test";
const EVE_DEPLOYMENT_SECRET = "eve-deployment-secret-1";
const CRON_SECRET = "cron-secret-1";

/** A deployment's environment holding the secrets given and no key of its own. */
function environment(secrets: {
  readonly cron: string | undefined;
  readonly eve: string | undefined;
}): Layer.Layer<HostedEnvironment> {
  const values: HostedEnvironmentValues = {
    posthogPersonalApiKey: undefined,
    posthogProjectId: undefined,
    posthogApiHost: undefined,
    posthogProjectApiKey: undefined,
    posthogIngestHost: undefined,
    cronSecret: secrets.cron === undefined ? undefined : Redacted.make(secrets.cron),
    eveDeploymentSecret: secrets.eve === undefined ? undefined : Redacted.make(secrets.eve),
    githubWebhookSecret: undefined,
    providerKeyEncryptionKeys: undefined,
  };
  return Layer.succeed(HostedEnvironment, values);
}

/** The network, writing down every request sent over it. */
function eveOverHttp() {
  const received: string[] = [];
  const layer = fakeHttpClientLayer(async (url) => {
    received.push(url);
    return Response.json({});
  });
  return { received, layer };
}

it.layer(getTestDB())("the deployment's caller", (it) => {
  it.effect(
    "a deployment holding the cron's secret alone, no environment, or no origin reaches nobody: refused up front, or account by account for a pass over many, and nothing is sent",
    () =>
      Effect.gen(function* () {
        const eve = eveOverHttp();
        const refusals = (origin: string | undefined) =>
          Effect.gen(function* () {
            const upFront = yield* Effect.result(deploymentEve(origin, EVE_MOUNT.CODER));
            const each = yield* deploymentEveForAccounts(origin, EVE_MOUNT.CODER);
            const perAccount = yield* Effect.result(each("user-a"));
            return [
              Result.isFailure(upFront) ? upFront.failure : "reached",
              Result.isFailure(perAccount) ? perAccount.failure : "reached",
            ];
          });

        const cronAlone = yield* refusals(ORIGIN).pipe(
          Effect.provide(
            Layer.merge(eve.layer, environment({ cron: CRON_SECRET, eve: undefined })),
          ),
        );
        const noEnvironment = yield* refusals(ORIGIN).pipe(Effect.provide(eve.layer));
        const noOrigin = yield* refusals(undefined).pipe(
          Effect.provide(
            Layer.merge(eve.layer, environment({ cron: CRON_SECRET, eve: EVE_DEPLOYMENT_SECRET })),
          ),
        );

        const unavailable = [HOSTED_REFUSAL.UNAVAILABLE, HOSTED_REFUSAL.UNAVAILABLE];
        assert.deepEqual(
          [cronAlone, noEnvironment, noOrigin],
          [unavailable, unavailable, unavailable],
        );
        assert.deepEqual(eve.received, []);
      }),
  );
});
