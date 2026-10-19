// stop.test.ts -- a hosted route's caller at eve's door: the bearer as it came, or the deployment acting for the account a cookie named.
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Layer, Redacted, Result } from "effect";
import { routeAuth } from "eve/channels/auth";
import type { EveChannelInput } from "eve/channels/eve";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { HOSTED_REFUSAL } from "../../http/http-effect.js";
import { actedForAccount, DEPLOYMENT_PRESENCE } from "../brain-host/auth.js";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import { brainHostChannelInput, DEPLOYMENT_TURNS } from "../brain-host/channel.js";
import type { SessionOwnership } from "../brain-host/door.js";
import {
  EVE_CANCEL_OUTCOME,
  EVE_MOUNT,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMount,
} from "../brain-host/eve-sessions.js";
import { CODER_DEPLOYMENT_TURNS, coderChannelInput } from "./channel.js";
import { type EveReach, eveFor } from "./stop.js";

/**
 * eve as a hosted route reaches it for the request it answers, over the
 * HTTP its client sends and through the channels' own doors as eve runs
 * them: a request that carries a bearer reaches eve over that bearer as it
 * came, and one that carries only a browser's session cookie reaches eve as
 * the deployment acting for the account the route resolved, which each door
 * admits only on that account's own sessions and conversations. Nothing the
 * request itself names, its cookie or an account header, reaches eve; a
 * deployment that holds no secret, or names no eve, reaches it for no
 * cookie at all.
 *
 * eve answers at a fake HTTP boundary that hands each request to the
 * channel's door over a store in which each account reaches its own session
 * and conversation alone. Synthetic accounts, bearers, secrets, and sessions
 * throughout.
 */

const ORIGIN = "https://luke.test";
const SECRET = "cron-secret-1";
const ACCOUNT = "user-a";
const OTHER = "user-b";
const BEARER = "Bearer token-a";
const COOKIE = "better-auth.session_token=user-a";
const OWN_SESSION = "wrun_01SESSIONOFACCOUNTA0000000";
const OTHER_SESSION = "wrun_01SESSIONOFACCOUNTB0000000";
const OWN_CONVERSATION = "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f";
const OTHER_CONVERSATION = "0d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f4a";

/** The deployment's environment with no key of its own, which a test gives the secret it reads. */
const NO_KEYS: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

const WITH_SECRET = Layer.succeed(HostedEnvironment, {
  ...NO_KEYS,
  cronSecret: Redacted.make(SECRET),
});

/** A store in which each account reaches its own session and conversation alone. */
const OWNERSHIP: SessionOwnership = {
  reachesSession: async (userId, sessionId) =>
    (userId === ACCOUNT && sessionId === OWN_SESSION) ||
    (userId === OTHER && sessionId === OTHER_SESSION),
  reachesConversation: async (userId, conversationId) =>
    (userId === ACCOUNT && conversationId === OWN_CONVERSATION) ||
    (userId === OTHER && conversationId === OTHER_CONVERSATION),
};

/** The account behind the one bearer the auth service signed. */
const bearerAccount = async (request: Request) =>
  request.headers.get("authorization") === BEARER ? ACCOUNT : undefined;

/** Each eve service's door as its channel is configured, under the deployment's secret. */
const DOORS = {
  [EVE_MOUNT.CODER]: coderChannelInput(
    bearerAccount,
    OWNERSHIP,
    {
      secret: Redacted.make(SECRET),
      admits: CODER_DEPLOYMENT_TURNS,
      presents: DEPLOYMENT_PRESENCE.ACCOUNT,
    },
    async () => undefined,
  ).auth,
  [EVE_MOUNT.TASKS]: brainHostChannelInput(bearerAccount, OWNERSHIP, {
    secret: Redacted.make(SECRET),
    admits: DEPLOYMENT_TURNS,
    presents: DEPLOYMENT_PRESENCE.DEPLOYMENT,
  }).auth,
} as const satisfies Readonly<Record<EveMount, EveChannelInput["auth"]>>;

/** One request eve received: the route as its door reads it, the headers naming its caller, and the account the door admitted it for, or nothing for a refusal. */
interface Received {
  readonly route: string;
  readonly authorization: string | null;
  readonly account: string | null;
  readonly cookie: string | null;
  readonly admittedFor: string | undefined;
}

/** What eve answers an admitted request on each session route, as its own routes document it. */
function answerOf(route: string): Response {
  if (route === "/eve/v1/session")
    return Response.json({ sessionId: OWN_SESSION }, { status: 202 });
  if (route.endsWith("/cancel")) {
    return Response.json({ ok: true, sessionId: OWN_SESSION, status: "accepted" }, { status: 202 });
  }
  if (route.endsWith("/reset")) {
    return Response.json({ ok: true, previousSessionId: OWN_SESSION, status: "reset" });
  }
  return Response.json({ sessionId: OWN_SESSION, deliveryId: "delivery-1" }, { status: 202 });
}

/**
 * eve behind the deployment's rewrites: the coding agents' service under
 * `/eve/coder`, whose route transform hands its door `/eve/v1/*`, and the
 * brain's under `/eve`; every request written down with its door's verdict.
 */
function eveOverHttp() {
  const received: Received[] = [];
  const layer = fakeHttpClientLayer(async (url, init) => {
    const { pathname } = new URL(url);
    const coder = pathname.startsWith(`${EVE_MOUNT.CODER}/`);
    const route = coder ? `${EVE_MOUNT.TASKS}${pathname.slice(EVE_MOUNT.CODER.length)}` : pathname;
    const headers = new Headers(init.headers);
    const door = DOORS[coder ? EVE_MOUNT.CODER : EVE_MOUNT.TASKS];
    const caller = await routeAuth(
      new Request(new URL(route, ORIGIN), { method: init.method ?? "GET", headers }),
      door,
    );
    const admitted = caller instanceof Response ? undefined : caller;
    received.push({
      route,
      authorization: headers.get("authorization"),
      account: headers.get(BRAIN_HOST_HEADER.ACCOUNT),
      cookie: headers.get("cookie"),
      admittedFor: actedForAccount(admitted ?? null),
    });
    return caller instanceof Response ? caller : answerOf(route);
  });
  return { received, layer };
}

/** A hosted route's request: a bearer's, a cookie's, or one carrying both an account header it has no say over and its cookie. */
function routeRequest(headers: Readonly<Record<string, string>>): Request {
  return new Request(new URL("/api/agents/stop", ORIGIN), { method: "POST", headers });
}

const REACH: EveReach = { eveOrigin: () => ORIGIN };

it.effect(
  "a request that carries a bearer reaches eve over that bearer as it came, which the door admits as the bearer's account",
  () =>
    Effect.gen(function* () {
      const eve = eveOverHttp();
      const reached = yield* Effect.gen(function* () {
        const coder = yield* eveFor(REACH, routeRequest({ authorization: BEARER }), ACCOUNT);
        return [
          (yield* coder.cancel(OWN_SESSION, "turn_0")).outcome,
          (yield* coder.reset(OWN_SESSION)).outcome,
        ];
      }).pipe(Effect.provide(Layer.merge(eve.layer, WITH_SECRET)));

      assert.deepEqual(reached, [EVE_CANCEL_OUTCOME.ACCEPTED, EVE_RESET_OUTCOME.RESET]);
      assert.deepEqual(
        eve.received.map(({ authorization, account, admittedFor }) => ({
          authorization,
          account,
          admittedFor,
        })),
        [
          { authorization: BEARER, account: null, admittedFor: ACCOUNT },
          { authorization: BEARER, account: null, admittedFor: ACCOUNT },
        ],
      );
    }),
);

it.effect(
  "a request that carries only a browser's cookie reaches eve as the deployment acting for the account the route resolved, admitted on that account's own sessions and conversations on both channels and refused on another's, whatever account the request names itself",
  () =>
    Effect.gen(function* () {
      const eve = eveOverHttp();
      // The browser's request names another account in the header the door reads, which it has no say over.
      const cookieRequest = routeRequest({ cookie: COOKIE, [BRAIN_HOST_HEADER.ACCOUNT]: OTHER });
      const typed = (conversationId: string) => ({
        conversationId,
        turn: BRAIN_HOST_TURN.TYPED,
        message: "Expire invitations after a week.",
      });
      const outcomes = yield* Effect.gen(function* () {
        const coder = yield* eveFor(REACH, cookieRequest, ACCOUNT);
        const brain = yield* eveFor(REACH, cookieRequest, ACCOUNT, EVE_MOUNT.TASKS);
        return {
          coder: [
            (yield* coder.open(typed(OWN_CONVERSATION))).outcome,
            (yield* coder.send(OWN_SESSION, typed(OWN_CONVERSATION))).outcome,
            (yield* coder.cancel(OWN_SESSION, "turn_0")).outcome,
            (yield* coder.reset(OWN_SESSION)).outcome,
            (yield* coder.open(typed(OTHER_CONVERSATION))).outcome,
            (yield* coder.reset(OTHER_SESSION)).outcome,
          ],
          brain: [
            (yield* brain.cancel(OWN_SESSION, "turn_0")).outcome,
            (yield* brain.reset(OWN_SESSION)).outcome,
            (yield* brain.reset(OTHER_SESSION)).outcome,
            // A typed ask of Luke is the developer's own under their bearer alone, which a cookie carries none of.
            (yield* brain.open(typed(OWN_CONVERSATION))).outcome,
          ],
        };
      }).pipe(Effect.provide(Layer.merge(eve.layer, WITH_SECRET)));

      assert.deepEqual(outcomes, {
        coder: [
          EVE_SEND_OUTCOME.ACCEPTED,
          EVE_SEND_OUTCOME.ACCEPTED,
          EVE_CANCEL_OUTCOME.ACCEPTED,
          EVE_RESET_OUTCOME.RESET,
          EVE_SEND_OUTCOME.FAILED,
          EVE_RESET_OUTCOME.FAILED,
        ],
        brain: [
          EVE_CANCEL_OUTCOME.ACCEPTED,
          EVE_RESET_OUTCOME.RESET,
          EVE_RESET_OUTCOME.FAILED,
          EVE_SEND_OUTCOME.FAILED,
        ],
      });
      assert.equal(eve.received.length, 10);
      for (const each of eve.received) {
        assert.deepEqual(
          [each.authorization, each.account, each.cookie],
          [`Bearer ${SECRET}`, ACCOUNT, null],
          each.route,
        );
      }
      assert.deepEqual(
        eve.received.map(({ admittedFor }) => admittedFor),
        [
          ACCOUNT,
          ACCOUNT,
          ACCOUNT,
          ACCOUNT,
          undefined,
          undefined,
          ACCOUNT,
          ACCOUNT,
          undefined,
          undefined,
        ],
      );
    }),
);

it.effect(
  "a cookie's request reaches eve for no account where the deployment holds no secret, keeps no environment, or names no eve, and asks eve nothing",
  () =>
    Effect.gen(function* () {
      const eve = eveOverHttp();
      const cookieRequest = routeRequest({ cookie: COOKIE });
      const refused = (reach: EveReach) =>
        Effect.map(Effect.result(eveFor(reach, cookieRequest, ACCOUNT)), (result) =>
          Result.isFailure(result) ? result.failure : "reached",
        );

      const noSecret = yield* refused(REACH).pipe(
        Effect.provide(Layer.merge(eve.layer, Layer.succeed(HostedEnvironment, NO_KEYS))),
      );
      const noEnvironment = yield* refused(REACH).pipe(Effect.provide(eve.layer));
      const noEve = yield* refused({ eveOrigin: () => undefined }).pipe(
        Effect.provide(Layer.merge(eve.layer, WITH_SECRET)),
      );

      assert.deepEqual(
        [noSecret, noEnvironment, noEve],
        [HOSTED_REFUSAL.UNAVAILABLE, HOSTED_REFUSAL.UNAVAILABLE, HOSTED_REFUSAL.UNAVAILABLE],
      );
      assert.deepEqual(eve.received, []);
    }),
);
