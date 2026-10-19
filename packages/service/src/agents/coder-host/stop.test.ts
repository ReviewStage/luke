// stop.test.ts -- a hosted route's caller at eve's door: the bearer as it came, or the deployment acting for the account a cookie named.
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Layer, Redacted, Result } from "effect";
import { routeAuth } from "eve/channels/auth";
import type { EveChannelInput } from "eve/channels/eve";
import type { SessionAuthContext } from "eve/context";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { HOSTED_REFUSAL } from "../../http/http-effect.js";
import { actedForAccount, DEPLOYMENT_PRESENCE } from "../brain-host/auth.js";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_AUTHENTICATOR,
  BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_PRINCIPAL_TYPE,
  BRAIN_HOST_TURN,
  type BrainHostTurn,
} from "../brain-host/bounds.js";
import { brainHostChannelInput, DEPLOYMENT_TURNS } from "../brain-host/channel.js";
import type { SessionOwnership } from "../brain-host/door.js";
import {
  EVE_CANCEL_OUTCOME,
  EVE_MOUNT,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMount,
  eveSessions,
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
 * cookie at all. A typed ask of Luke, which a comment mentioning him hands
 * over, is admitted at the brain's door either way, as the account's own
 * principal, so eve steers and folds it the same whichever carried it.
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

/** One request eve received: the route as its door reads it, the headers naming its caller, and the principal the door admitted it as and the account that acts for, or nothing for a refusal. */
interface Received {
  readonly route: string;
  readonly authorization: string | null;
  readonly account: string | null;
  readonly cookie: string | null;
  readonly admitted: SessionAuthContext | undefined;
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
      admitted,
      admittedFor: actedForAccount(admitted ?? null),
    });
    return caller instanceof Response ? caller : answerOf(route);
  });
  return { received, layer };
}

/**
 * eve's identity of a principal, what it steers a running turn by and folds
 * messages that waited into one turn by: its authenticator, issuer, type,
 * and id, its attributes aside.
 */
function identityOf(principal: SessionAuthContext | undefined) {
  if (principal === undefined) return undefined;
  const { authenticator, issuer, principalType, principalId } = principal;
  return [authenticator, issuer ?? null, principalType, principalId];
}

/** The deployment's own identity, which the voice's spoken asks run under. */
const DEPLOYMENT_IDENTITY = [
  BRAIN_HOST_AUTHENTICATOR.DEPLOYMENT,
  null,
  BRAIN_HOST_PRINCIPAL_TYPE.DEPLOYMENT,
  BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
];

/** A message of the kind given on one of the accounts' conversations. */
function messageOn<Turn extends BrainHostTurn>(conversationId: string, turn: Turn) {
  return { conversationId, turn, message: "Expire invitations after a week." };
}

/** A hosted route's request: a bearer's, a cookie's, or one carrying both an account header it has no say over and its cookie. */
function routeRequest(headers: Readonly<Record<string, string>>): Request {
  return new Request(new URL("/api/agents/stop", ORIGIN), { method: "POST", headers });
}

const REACH: EveReach = { eveOrigin: () => ORIGIN };

it.effect(
  "a request that carries a bearer reaches eve over that bearer as it came, which the door admits as the bearer's own account, a typed ask of Luke as before",
  () =>
    Effect.gen(function* () {
      const eve = eveOverHttp();
      const reached = yield* Effect.gen(function* () {
        const coder = yield* eveFor(REACH, routeRequest({ authorization: BEARER }), ACCOUNT);
        const brain = yield* eveFor(
          REACH,
          routeRequest({ authorization: BEARER }),
          ACCOUNT,
          EVE_MOUNT.TASKS,
        );
        return [
          (yield* coder.cancel(OWN_SESSION, "turn_0")).outcome,
          (yield* coder.reset(OWN_SESSION)).outcome,
          (yield* brain.open(messageOn(OWN_CONVERSATION, BRAIN_HOST_TURN.TYPED))).outcome,
          (yield* brain.send(OWN_SESSION, messageOn(OWN_CONVERSATION, BRAIN_HOST_TURN.TYPED)))
            .outcome,
        ];
      }).pipe(Effect.provide(Layer.merge(eve.layer, WITH_SECRET)));

      assert.deepEqual(reached, [
        EVE_CANCEL_OUTCOME.ACCEPTED,
        EVE_RESET_OUTCOME.RESET,
        EVE_SEND_OUTCOME.ACCEPTED,
        EVE_SEND_OUTCOME.ACCEPTED,
      ]);
      const own = [
        BRAIN_HOST_AUTHENTICATOR.ACCOUNT,
        null,
        BRAIN_HOST_PRINCIPAL_TYPE.ACCOUNT,
        ACCOUNT,
      ];
      assert.deepEqual(
        eve.received.map(({ authorization, account, admitted }) => ({
          authorization,
          account,
          identity: identityOf(admitted),
          carrier: admitted?.attributes[BRAIN_HOST_ATTRIBUTE.CARRIER],
        })),
        Array.from({ length: 4 }, () => ({
          authorization: BEARER,
          account: null,
          identity: own,
          carrier: undefined,
        })),
      );
    }),
);

it.effect(
  "a request that carries only a browser's cookie reaches eve as the deployment acting for the account the route resolved, admitted on that account's own sessions and conversations on both channels, a typed ask of Luke among them, and refused on another's, whatever account the request names itself",
  () =>
    Effect.gen(function* () {
      const eve = eveOverHttp();
      // The browser's request names another account in the header the door reads, which it has no say over.
      const cookieRequest = routeRequest({ cookie: COOKIE, [BRAIN_HOST_HEADER.ACCOUNT]: OTHER });
      const typed = (conversationId: string) => messageOn(conversationId, BRAIN_HOST_TURN.TYPED);
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
            // A typed ask of Luke, which a comment mentioning him hands over, on the account's own
            // conversation and session, and never on the account's the request named.
            (yield* brain.open(typed(OWN_CONVERSATION))).outcome,
            (yield* brain.send(OWN_SESSION, typed(OWN_CONVERSATION))).outcome,
            (yield* brain.open(typed(OTHER_CONVERSATION))).outcome,
            (yield* brain.send(OTHER_SESSION, typed(OTHER_CONVERSATION))).outcome,
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
          EVE_SEND_OUTCOME.ACCEPTED,
          EVE_SEND_OUTCOME.ACCEPTED,
          EVE_SEND_OUTCOME.FAILED,
          EVE_SEND_OUTCOME.FAILED,
        ],
      });
      assert.equal(eve.received.length, 13);
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
          ACCOUNT,
          ACCOUNT,
          undefined,
          undefined,
        ],
      );
      assert.ok(
        eve.received.every(({ admitted }) => admitted?.principalId !== OTHER),
        "nothing was admitted as the account the request named",
      );
    }),
);

it.effect(
  "a cookie's typed ask of Luke is admitted at the brain's door as the account's own principal, the identity its bearer's ask is admitted as, with the deployment named only as its carrier, so eve steers and folds it as the bearer's and never with the voice's spoken asks, which, like the cookie's Stop and retire, still present the deployment",
  () =>
    Effect.gen(function* () {
      const eve = eveOverHttp();
      yield* Effect.gen(function* () {
        const overBearer = yield* eveFor(
          REACH,
          routeRequest({ authorization: BEARER }),
          ACCOUNT,
          EVE_MOUNT.TASKS,
        );
        const overCookie = yield* eveFor(
          REACH,
          routeRequest({ cookie: COOKIE }),
          ACCOUNT,
          EVE_MOUNT.TASKS,
        );
        // The voice function's client, composed as its exchange composes it (`voice/deployment-exchange.ts`).
        const voice = yield* eveSessions({
          origin: ORIGIN,
          caller: { secret: Redacted.make(SECRET), account: ACCOUNT },
        });
        yield* overBearer.open(messageOn(OWN_CONVERSATION, BRAIN_HOST_TURN.TYPED));
        yield* overCookie.open(messageOn(OWN_CONVERSATION, BRAIN_HOST_TURN.TYPED));
        yield* overCookie.send(OWN_SESSION, messageOn(OWN_CONVERSATION, BRAIN_HOST_TURN.TYPED));
        yield* voice.open(messageOn(OWN_CONVERSATION, BRAIN_HOST_TURN.SPOKEN));
        yield* voice.send(OWN_SESSION, messageOn(OWN_CONVERSATION, BRAIN_HOST_TURN.SPOKEN));
        yield* overCookie.cancel(OWN_SESSION, "turn_0");
        yield* overCookie.reset(OWN_SESSION);
      }).pipe(Effect.provide(Layer.merge(eve.layer, WITH_SECRET)));

      const [bearer, opened, followed, spoken, spokenAgain, cancelled, retired] = eve.received.map(
        ({ admitted }) => admitted,
      );
      assert.equal(eve.received.length, 7);
      assert.deepEqual(identityOf(bearer), [
        BRAIN_HOST_AUTHENTICATOR.ACCOUNT,
        null,
        BRAIN_HOST_PRINCIPAL_TYPE.ACCOUNT,
        ACCOUNT,
      ]);
      assert.deepEqual(identityOf(opened), identityOf(bearer));
      assert.deepEqual(identityOf(followed), identityOf(bearer));
      assert.deepEqual(
        [bearer, opened, followed].map(
          (principal) => principal?.attributes[BRAIN_HOST_ATTRIBUTE.CARRIER],
        ),
        [undefined, BRAIN_HOST_DEPLOYMENT_PRINCIPAL, BRAIN_HOST_DEPLOYMENT_PRINCIPAL],
      );
      assert.deepEqual(
        [spoken, spokenAgain, cancelled, retired].map(identityOf),
        Array.from({ length: 4 }, () => DEPLOYMENT_IDENTITY),
      );
      assert.deepEqual(
        [spoken, spokenAgain, cancelled, retired].map(
          (principal) => principal?.attributes[BRAIN_HOST_ATTRIBUTE.ACCOUNT],
        ),
        [ACCOUNT, ACCOUNT, ACCOUNT, ACCOUNT],
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
