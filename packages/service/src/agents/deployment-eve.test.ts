// deployment-eve.test.ts -- eve as the deployment reaches it for an account: under its own secret, never the cron's.
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Layer, Redacted, Result } from "effect";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_REFUSAL } from "../http/http-effect.js";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "./brain-host/bounds.js";
import { EVE_MOUNT, type EveTypedTurn } from "./brain-host/eve-sessions.js";
import { deploymentEve, deploymentEveForAccounts } from "./deployment-eve.js";

/**
 * The one place a web function composes the deployment's caller at eve's
 * door, which a cookie request's `eveFor`, a chat notice, a GitHub wake, and
 * an automation's run all reach eve through: a request eve receives from it
 * carries the deployment's own secret as its bearer and the account beside
 * it, never the cron's secret the same environment holds; a deployment
 * holding the cron's alone, or no environment, or no origin for eve, sends
 * eve nothing. eve answers at a fake HTTP boundary that writes down every
 * request. Synthetic accounts, sessions, and secrets throughout.
 */

const ORIGIN = "https://luke.test";
const EVE_DEPLOYMENT_SECRET = "eve-deployment-secret-1";
const CRON_SECRET = "cron-secret-1";
const CONVERSATION = "2b000000-0000-4000-8000-000000000001";
const SESSION = "wrun_01M0000000000000000000001";
const MESSAGE = { conversationId: CONVERSATION, turn: BRAIN_HOST_TURN.TYPED, message: "hello" };

/** A deployment's environment holding the secrets given and no key of its own. */
function environment(secrets: {
  readonly cron: string | undefined;
  readonly eve: string | undefined;
}): Layer.Layer<HostedEnvironment> {
  const values: HostedEnvironmentValues = {
    openAiKey: undefined,
    anthropicKey: undefined,
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

/** eve behind the deployment's rewrites, answering every opening with its session and writing down who asked. */
function eveOverHttp() {
  const received: { readonly url: string; readonly headers: Headers }[] = [];
  const layer = fakeHttpClientLayer(async (url, init) => {
    received.push({ url, headers: new Headers(init.headers) });
    return Response.json({ ok: true, sessionId: SESSION, status: "accepted" }, { status: 202 });
  });
  return { received, layer };
}

/** Who eve was asked by: the route, the bearer, and the account named beside it. */
const askedBy = (received: ReturnType<typeof eveOverHttp>["received"]) =>
  received.map(({ url, headers }) => ({
    url,
    authorization: headers.get("authorization"),
    account: headers.get(BRAIN_HOST_HEADER.ACCOUNT),
  }));

it.effect(
  "eve is asked under the deployment's own secret with the account beside it, never the cron's secret the environment holds too",
  () =>
    Effect.gen(function* () {
      const eve = eveOverHttp();
      yield* Effect.gen(function* () {
        const eveAs = yield* deploymentEve<EveTypedTurn>(ORIGIN, EVE_MOUNT.CODER);
        yield* eveAs("user-a").open(MESSAGE);
        const each = yield* deploymentEveForAccounts<EveTypedTurn>(ORIGIN, EVE_MOUNT.TASKS);
        yield* Effect.flatMap(each("user-b"), (sessions) => sessions.open(MESSAGE));
      }).pipe(
        Effect.provide(
          Layer.merge(eve.layer, environment({ cron: CRON_SECRET, eve: EVE_DEPLOYMENT_SECRET })),
        ),
      );
      assert.deepEqual(askedBy(eve.received), [
        {
          url: `${ORIGIN}/eve/coder/v1/session`,
          authorization: `Bearer ${EVE_DEPLOYMENT_SECRET}`,
          account: "user-a",
        },
        {
          url: `${ORIGIN}/eve/v1/session`,
          authorization: `Bearer ${EVE_DEPLOYMENT_SECRET}`,
          account: "user-b",
        },
      ]);
    }),
);

it.effect(
  "a deployment holding the cron's secret alone, no environment, or no origin for eve reaches eve for nobody: refused up front, or account by account for a pass over many, and eve is asked nothing",
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
        Effect.provide(Layer.merge(eve.layer, environment({ cron: CRON_SECRET, eve: undefined }))),
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
