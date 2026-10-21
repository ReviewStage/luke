// eve-deployment-secret.test.ts -- the eve door, as the deployment composes it, admits its own secret and never the cron's.
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Logger } from "effect";
import { routeAuth } from "eve/channels/auth";
import type { EveChannelInput } from "eve/channels/eve";
import { afterEach, vi } from "vitest";
import { hostedEnvironment } from "../environment.js";
import { CRON_ENVIRONMENT } from "../maintenance/maintenance-bounds.js";
import type { WebStoreRun } from "../run.js";
import { actedForAccount } from "./brain-host/auth.js";
import {
  BRAIN_HOST_ENVIRONMENT,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_TURN,
  type BrainHostTurn,
} from "./brain-host/bounds.js";
import type { SessionOwnership } from "./brain-host/door.js";
import {
  CODER_DEPLOYMENT_PRESENCE,
  CODER_DEPLOYMENT_STREAMS,
  CODER_DEPLOYMENT_TURNS,
  coderChannelInput,
} from "./coder-host/channel.js";
import { productionCoderHostSeams } from "./coder-host/production.js";

/**
 * The secret the eve service's door admits the deployment acting for an
 * account under is the one the deployment's own seams hand its channel file
 * (`apps/dev/channels/eve.ts`), read from
 * `EVE_DEPLOYMENT_SECRET`. The cron's `CRON_SECRET`, which Vercel's scheduler
 * sends as its bearer, opens nothing there: not a typed turn minted as the
 * account's own principal, not a spoken one, and no cancel, retire, or
 * stream read. Nor does an eve secret that is blank, which reads as unset,
 * or one that is the cron's own value, which would hand the scheduler's
 * bearer eve's door again; and a bare `Bearer` opens nothing whatever the
 * deployment holds. The door here is composed exactly as that file
 * composes it, over the seams its `host.ts` builds from the process
 * environment, with an ownership that gives the one account its one
 * conversation and session. Synthetic accounts, sessions, and secrets
 * throughout.
 */

const ORIGIN = "https://luke.test";
const ACCOUNT = "user-a";
const CONVERSATION = "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f";
const SESSION = "wrun_01SESSIONOFACCOUNTA0000000";
const EVE_DEPLOYMENT_SECRET = "eve-deployment-secret-1";
const CRON_SECRET = "cron-secret-1";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The one account reaches its own conversation and the session recorded for it, and nothing else. */
const OWNERSHIP: SessionOwnership = {
  reachesSession: async (userId, sessionId) => userId === ACCOUNT && sessionId === SESSION,
  reachesConversation: async (userId, conversationId) =>
    userId === ACCOUNT && conversationId === CONVERSATION,
};

/** No store stands behind the seams: the doors read the ownership above, and nothing here runs a query. */
const noStore: WebStoreRun = () => Promise.reject(new Error("no store stands in this test"));

/** No bearer here is an account's, so the walk's account authenticator admits none of them. */
const noAccount = async () => undefined;

/** The build's own lines, the warning a shared secret is read as unset with among them, which `environment.test.ts` reads. */
const quiet = Logger.layer([Logger.make(() => undefined)]);

/**
 * The door over a deployment whose environment holds the two values given:
 * the seams built over `hostedEnvironment` as the eve app's `host.ts` builds
 * them, and the channel's door composed over its seams' own secret as its
 * channel file composes it.
 */
const doorFrom = (variables: {
  readonly cron: string | undefined;
  readonly eve: string | undefined;
}) =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      vi.stubEnv(CRON_ENVIRONMENT.CRON_SECRET, variables.cron);
      vi.stubEnv(BRAIN_HOST_ENVIRONMENT.DEPLOYMENT_SECRET, variables.eve);
    });
    const coder = yield* Effect.provide(productionCoderHostSeams(noStore), hostedEnvironment);
    return coderChannelInput(
      noAccount,
      OWNERSHIP,
      {
        secret: coder.deploymentSecret(),
        admits: CODER_DEPLOYMENT_TURNS,
        presents: CODER_DEPLOYMENT_PRESENCE,
        streams: CODER_DEPLOYMENT_STREAMS,
      },
      async () => undefined,
    ).auth;
  }).pipe(Effect.provide(quiet));

/** A request to eve under the authorization given, naming the account, and the kind of turn where it is a message. */
function underAuthorization(
  authorization: string,
  route: string,
  method: string,
  turn?: BrainHostTurn,
): Request {
  return new Request(new URL(route, ORIGIN), {
    method,
    headers: {
      authorization,
      [BRAIN_HOST_HEADER.ACCOUNT]: ACCOUNT,
      [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION,
      ...(turn === undefined ? undefined : { [BRAIN_HOST_HEADER.TURN]: turn }),
    },
  });
}

/**
 * Everything the deployment asks of the eve service under an authorization:
 * each kind of turn opened and followed up, a call speaking into a coding
 * agent among them, a cancel, a retire, and a stream read.
 */
function deploymentAsks(authorization: string): readonly Request[] {
  return [
    underAuthorization(authorization, "/eve/v1/session", "POST", BRAIN_HOST_TURN.TYPED),
    underAuthorization(authorization, `/eve/v1/session/${SESSION}`, "POST", BRAIN_HOST_TURN.TYPED),
    underAuthorization(authorization, "/eve/v1/session", "POST", BRAIN_HOST_TURN.SPOKEN),
    underAuthorization(authorization, `/eve/v1/session/${SESSION}`, "POST", BRAIN_HOST_TURN.SPOKEN),
    underAuthorization(authorization, `/eve/v1/session/${SESSION}/cancel`, "POST"),
    underAuthorization(authorization, `/eve/v1/session/${SESSION}/reset`, "POST"),
    underAuthorization(authorization, `/eve/v1/session/${SESSION}/stream`, "GET"),
  ];
}

/** The door's verdict on each request: the account it admitted the caller to act for, or the status it refused it with. */
const verdicts = (door: EveChannelInput["auth"], requests: readonly Request[]) =>
  Effect.promise(() =>
    Promise.all(
      requests.map(async (request) => {
        const caller = await routeAuth(request, door);
        return caller instanceof Response ? caller.status : actedForAccount(caller);
      }),
    ),
  );

/** The door's verdicts on everything the deployment asks of it under the authorization given. */
const verdictsUnder = (door: EveChannelInput["auth"], authorization: string) =>
  verdicts(door, deploymentAsks(authorization));

/** Every ask refused at the door as nobody signed in. */
const REFUSED_EVERYWHERE = Array.from({ length: 7 }, () => 401);

it.effect(
  "the door admits the deployment acting for the account under EVE_DEPLOYMENT_SECRET, and under the cron's CRON_SECRET admits nobody: no typed turn as the account, no spoken turn, no cancel, no retire, and no stream read",
  () =>
    Effect.gen(function* () {
      const door = yield* doorFrom({ cron: CRON_SECRET, eve: EVE_DEPLOYMENT_SECRET });
      const own = yield* verdictsUnder(door, `Bearer ${EVE_DEPLOYMENT_SECRET}`);
      const cron = yield* verdictsUnder(door, `Bearer ${CRON_SECRET}`);
      assert.deepEqual(
        own,
        Array.from({ length: 7 }, () => ACCOUNT),
      );
      assert.deepEqual(cron, REFUSED_EVERYWHERE);
    }),
);

it.effect(
  "a deployment that holds the cron's secret and no secret of its own for eve, or a blank one, admits the deployment at no door, whatever it is asked",
  () =>
    Effect.gen(function* () {
      for (const eve of [undefined, "", "   "]) {
        const door = yield* doorFrom({ cron: CRON_SECRET, eve });
        assert.deepEqual(yield* verdictsUnder(door, `Bearer ${CRON_SECRET}`), REFUSED_EVERYWHERE);
      }
    }),
);

it.effect(
  "a bare Bearer opens no door, whether the deployment's eve secret is set or blank",
  () =>
    Effect.gen(function* () {
      for (const eve of [EVE_DEPLOYMENT_SECRET, "", "   "]) {
        const door = yield* doorFrom({ cron: CRON_SECRET, eve });
        for (const bare of ["Bearer ", "Bearer", "Bearer    "]) {
          assert.deepEqual(yield* verdictsUnder(door, bare), REFUSED_EVERYWHERE);
        }
      }
    }),
);

it.effect(
  "an eve secret that is the cron's own value is read as unset, so the scheduler's bearer still opens no door",
  () =>
    Effect.gen(function* () {
      const door = yield* doorFrom({ cron: CRON_SECRET, eve: ` ${CRON_SECRET} ` });
      assert.deepEqual(yield* verdictsUnder(door, `Bearer ${CRON_SECRET}`), REFUSED_EVERYWHERE);
    }),
);
