// eve-deployment-secret.test.ts -- both eve doors, as the deployment composes them, admit its own secret and never the cron's.
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { routeAuth } from "eve/channels/auth";
import type { EveChannelInput } from "eve/channels/eve";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import type { WebStoreRun } from "../run.js";
import { actedForAccount, DEPLOYMENT_PRESENCE } from "./brain-host/auth.js";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN, type BrainHostTurn } from "./brain-host/bounds.js";
import { brainHostChannelInput, DEPLOYMENT_TURNS } from "./brain-host/channel.js";
import type { SessionOwnership } from "./brain-host/door.js";
import { productionBrainHostSeams } from "./brain-host/production.js";
import { CODER_DEPLOYMENT_TURNS, coderChannelInput } from "./coder-host/channel.js";
import { productionCoderHostSeams } from "./coder-host/production.js";

/**
 * The secret each eve service's door admits the deployment acting for an
 * account under is the one the deployment's own seams hand its channel file
 * (`apps/luke/channels/eve.ts`, `apps/dev/channels/eve.ts`), read from
 * `EVE_DEPLOYMENT_SECRET`. The cron's `CRON_SECRET`, which Vercel's scheduler
 * sends as its bearer, opens nothing there: not a typed turn minted as the
 * account's own principal, not a spoken one, and no cancel, retire, or
 * stream read. The doors here are composed exactly as those files compose
 * them, over the seams the deployment builds from its environment, with an
 * ownership that gives the one account its one conversation and session.
 * Synthetic accounts, sessions, and secrets throughout.
 */

const ORIGIN = "https://luke.test";
const ACCOUNT = "user-a";
const CONVERSATION = "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f";
const SESSION = "wrun_01SESSIONOFACCOUNTA0000000";
const EVE_DEPLOYMENT_SECRET = "eve-deployment-secret-1";
const CRON_SECRET = "cron-secret-1";

/** A deployment's environment holding the two secrets given and no key of its own. */
function environment(secrets: {
  readonly cron?: string;
  readonly eve?: string;
}): HostedEnvironmentValues {
  return {
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
}

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

/** The brain's door as `apps/luke/channels/eve.ts` composes it, over the seams the environment given builds. */
const brainDoor = (values: HostedEnvironmentValues) =>
  Effect.map(
    productionBrainHostSeams(noStore).pipe(Effect.provideService(HostedEnvironment, values)),
    (seams) =>
      brainHostChannelInput(noAccount, OWNERSHIP, {
        secret: seams.deploymentSecret(),
        admits: DEPLOYMENT_TURNS,
        presents: DEPLOYMENT_PRESENCE.DEPLOYMENT,
      }).auth,
  );

/** The coding agents' door as `apps/dev/channels/eve.ts` composes it, over the seams the environment given builds. */
const coderDoor = (values: HostedEnvironmentValues) =>
  Effect.map(
    productionCoderHostSeams(noStore).pipe(Effect.provideService(HostedEnvironment, values)),
    (seams) =>
      coderChannelInput(
        noAccount,
        OWNERSHIP,
        {
          secret: seams.deploymentSecret(),
          admits: CODER_DEPLOYMENT_TURNS,
          presents: DEPLOYMENT_PRESENCE.ACCOUNT,
        },
        async () => undefined,
      ).auth,
  );

/** A request to eve under the bearer given, naming the account, and the kind of turn where it is a message. */
function underBearer(bearer: string, route: string, method: string, turn?: BrainHostTurn): Request {
  return new Request(new URL(route, ORIGIN), {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      [BRAIN_HOST_HEADER.ACCOUNT]: ACCOUNT,
      [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION,
      ...(turn === undefined ? undefined : { [BRAIN_HOST_HEADER.TURN]: turn }),
    },
  });
}

/** Everything the deployment asks of the brain under a bearer: each kind of turn opened and followed up, a cancel, a retire, and a stream read. */
function brainAsks(bearer: string): readonly Request[] {
  return [
    underBearer(bearer, "/eve/v1/session", "POST", BRAIN_HOST_TURN.TYPED),
    underBearer(bearer, `/eve/v1/session/${SESSION}`, "POST", BRAIN_HOST_TURN.TYPED),
    underBearer(bearer, "/eve/v1/session", "POST", BRAIN_HOST_TURN.SPOKEN),
    underBearer(bearer, `/eve/v1/session/${SESSION}`, "POST", BRAIN_HOST_TURN.SPOKEN),
    underBearer(bearer, `/eve/v1/session/${SESSION}/cancel`, "POST"),
    underBearer(bearer, `/eve/v1/session/${SESSION}/reset`, "POST"),
    underBearer(bearer, `/eve/v1/session/${SESSION}/stream`, "GET"),
  ];
}

/** Everything the deployment asks of a coding agent under a bearer: a typed opening and follow-up, a cancel, and a retire. */
function coderAsks(bearer: string): readonly Request[] {
  return [
    underBearer(bearer, "/eve/v1/session", "POST", BRAIN_HOST_TURN.TYPED),
    underBearer(bearer, `/eve/v1/session/${SESSION}`, "POST", BRAIN_HOST_TURN.TYPED),
    underBearer(bearer, `/eve/v1/session/${SESSION}/cancel`, "POST"),
    underBearer(bearer, `/eve/v1/session/${SESSION}/reset`, "POST"),
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

it.effect(
  "the brain's door admits the deployment acting for the account under EVE_DEPLOYMENT_SECRET, and under the cron's CRON_SECRET admits nobody: no typed turn as the account, no spoken turn, no cancel, no retire, and no stream read",
  () =>
    Effect.gen(function* () {
      const door = yield* brainDoor(environment({ cron: CRON_SECRET, eve: EVE_DEPLOYMENT_SECRET }));
      const own = yield* verdicts(door, brainAsks(EVE_DEPLOYMENT_SECRET));
      const cron = yield* verdicts(door, brainAsks(CRON_SECRET));
      assert.deepEqual(
        own,
        Array.from({ length: 7 }, () => ACCOUNT),
      );
      assert.deepEqual(
        cron,
        Array.from({ length: 7 }, () => 401),
      );
    }),
);

it.effect(
  "the coding agents' door admits the deployment acting for the account under EVE_DEPLOYMENT_SECRET, and under the cron's CRON_SECRET admits nobody",
  () =>
    Effect.gen(function* () {
      const door = yield* coderDoor(environment({ cron: CRON_SECRET, eve: EVE_DEPLOYMENT_SECRET }));
      const own = yield* verdicts(door, coderAsks(EVE_DEPLOYMENT_SECRET));
      const cron = yield* verdicts(door, coderAsks(CRON_SECRET));
      assert.deepEqual(
        own,
        Array.from({ length: 4 }, () => ACCOUNT),
      );
      assert.deepEqual(
        cron,
        Array.from({ length: 4 }, () => 401),
      );
    }),
);

it.effect(
  "a deployment that holds the cron's secret and no secret of its own for eve admits the deployment at neither door, whatever it is asked",
  () =>
    Effect.gen(function* () {
      const cronAlone = environment({ cron: CRON_SECRET });
      const brain = yield* verdicts(yield* brainDoor(cronAlone), brainAsks(CRON_SECRET));
      const coder = yield* verdicts(yield* coderDoor(cronAlone), coderAsks(CRON_SECRET));
      assert.deepEqual(
        brain,
        Array.from({ length: 7 }, () => 401),
      );
      assert.deepEqual(
        coder,
        Array.from({ length: 4 }, () => 401),
      );
    }),
);
