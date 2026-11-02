// stop.test.ts -- a hosted route's cookie reaches no agent where the deployment cannot prove itself.
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB } from "@luke/database/testing";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Layer, Redacted, Result } from "effect";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { HOSTED_REFUSAL } from "../../http/http-effect.js";
import { type EveReach, eveFor } from "./stop.js";

/**
 * A request that carries only a browser's session cookie reaches a coding
 * agent's session as the deployment acting for the account the route
 * resolved, so a deployment that holds no secret of its own (the cron's is
 * not one), keeps no environment, or names no origin reaches it for no
 * cookie at all, and sends nothing. Synthetic accounts and secrets
 * throughout.
 */

const ORIGIN = "https://luke.test";
/** The deployment's own secret, the one a cookie's request is carried under. */
const SECRET = "eve-deployment-secret-1";
/** The cron's bearer, which the deployment holds beside it and which carries nothing. */
const CRON_SECRET = "cron-secret-1";
const ACCOUNT = "user-a";
const COOKIE = "better-auth.session_token=user-a";

/** The deployment's environment with no key of its own, which a test gives the secret it reads. */
const NO_KEYS: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  eveDeploymentSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

const WITH_SECRET = Layer.succeed(HostedEnvironment, {
  ...NO_KEYS,
  cronSecret: Redacted.make(CRON_SECRET),
  eveDeploymentSecret: Redacted.make(SECRET),
});

const REACH: EveReach = { eveOrigin: () => ORIGIN };

it.layer(getTestDB())("a route's cookie at a coding agent's session", (it) => {
  it.effect(
    "a cookie's request reaches no account where the deployment holds no secret, holds the cron's alone, keeps no environment, or names no origin, and sends nothing",
    () =>
      Effect.gen(function* () {
        const sent: string[] = [];
        const network = fakeHttpClientLayer(async (url) => {
          sent.push(url);
          return Response.json({});
        });
        const cookieRequest = new Request(new URL("/api/agents/stop", ORIGIN), {
          method: "POST",
          headers: { cookie: COOKIE },
        });
        const refused = (reach: EveReach) =>
          Effect.map(Effect.result(eveFor(reach, cookieRequest, ACCOUNT)), (result) =>
            Result.isFailure(result) ? result.failure : "reached",
          );

        const noSecret = yield* refused(REACH).pipe(
          Effect.provide(Layer.merge(network, Layer.succeed(HostedEnvironment, NO_KEYS))),
        );
        // The cron's bearer is never the deployment's, so holding it alone reaches nothing.
        const cronOnly = yield* refused(REACH).pipe(
          Effect.provide(
            Layer.merge(
              network,
              Layer.succeed(HostedEnvironment, {
                ...NO_KEYS,
                cronSecret: Redacted.make(CRON_SECRET),
              }),
            ),
          ),
        );
        const noEnvironment = yield* refused(REACH).pipe(Effect.provide(network));
        const noOrigin = yield* refused({ eveOrigin: () => undefined }).pipe(
          Effect.provide(Layer.merge(network, WITH_SECRET)),
        );

        assert.deepEqual(
          [noSecret, cronOnly, noEnvironment, noOrigin],
          [
            HOSTED_REFUSAL.UNAVAILABLE,
            HOSTED_REFUSAL.UNAVAILABLE,
            HOSTED_REFUSAL.UNAVAILABLE,
            HOSTED_REFUSAL.UNAVAILABLE,
          ],
        );
        assert.deepEqual(sent, []);
      }),
  );
});
