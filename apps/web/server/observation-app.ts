import { type HttpApp, HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { auth } from "./auth.js";
import { CLOUD_AGENT_PROVIDER_ID } from "./core.js";
import { getDatabase } from "./db/index.js";
import { devices, observationPass, providerKey, user } from "./db/schema.js";
import { executeConversationRead } from "./hosted/action-execute.js";
import { ApnsSender, apnsCredentialsFromEnvironment } from "./hosted/apns.js";
import { hostedUserId } from "./hosted/bearer.js";
import { CATALOG_TOOL_SET } from "./hosted/brain-tool-set.js";
import { handleConversationRead } from "./hosted/conversation-read.js";
import { deviceSeams } from "./hosted/device-store.js";
import { payloadKeyRing, VAULT_ENCRYPTION_ENVIRONMENT } from "./hosted/encryption.js";
import { type EventsOptions, handleEvents } from "./hosted/events.js";
import { HOSTED_REFUSAL, hostedRefusalResponse } from "./hosted/http-effect.js";
import { observeAndSnapshot } from "./hosted/observation-pass.js";
import {
  handleObservationTick,
  OBSERVATION_ENVIRONMENT,
  type ObservationTickOptions,
} from "./hosted/observation-tick.js";
import { handleObserve } from "./hosted/observe.js";
import { POSTHOG_ENVIRONMENT } from "./hosted/posthog.js";
import { handleProjects } from "./hosted/projects.js";
import { pushSpeech, type SpeechPushOutcome } from "./hosted/speech-push.js";
import {
  hostedStore,
  type SpeechSweepOutcome,
  storeWriter,
  sweepSpeech,
} from "./hosted/store/index.js";
import { hostedVaultSeams } from "./hosted/vault-route.js";
import { runWeb } from "./runtime.js";

/**
 * The observation group: the routes that read and are read from the roster
 * an account's cloud providers stand behind. Each is its own Vercel function
 * on its own path, and every one of them mounts this same group, which is
 * organization rather than dispatch — Vercel already sent each function only
 * the requests for its own path. What differs across them is each handler's
 * own logic, kept exactly as it stood; the group is the `HttpRouter` that
 * carries a promise-shaped answer to an `HttpApp`, and the hosted vocabulary's
 * own `not-found` on any path none of them declares.
 */

const CLOUD_PROVIDER_IDS = Object.values(CLOUD_AGENT_PROVIDER_ID);

const NOTHING_SWEPT: SpeechSweepOutcome = { held: 0, released: 0, expired: 0, turns: 0 };

const NOTHING_PUSHED: SpeechPushOutcome = {
  pushed: 0,
  undelivered: 0,
  unaddressed: 0,
  unreadable: 0,
  waiting: 0,
};

const PATH = {
  SESSIONS_MESSAGES: "/api/sessions/messages",
  PROJECTS: "/api/projects",
  EVENTS: "/api/events",
  OBSERVE: "/api/observe",
  OBSERVATION_TICK: "/api/observation/tick",
} as const;

/**
 * A promise-shaped handler's answer, carried to the `HttpApp` the group
 * composes: the handler already answers the hosted vocabulary's own bytes, so
 * nothing here reads or rewrites the response beside forwarding it.
 */
function promisePassthrough(handle: (request: Request) => Promise<Response>): HttpApp.Default {
  return Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const answer = yield* Effect.promise(() => handle(request));
    return HttpServerResponse.raw(answer);
  });
}

/** Reads one observed session's conversation for the caller who opened its screen. */
function sessionsMessagesHandler(request: Request): Promise<Response> {
  return handleConversationRead({
    ...hostedVaultSeams,
    request,
    execute: executeConversationRead,
  });
}

/** Lists where the signed-in user's keys can create a workspace. */
function projectsHandler(request: Request): Promise<Response> {
  return handleProjects({ ...hostedVaultSeams, request });
}

/** Observes the signed-in user's cloud sessions on demand. */
function observeHandler(request: Request): Promise<Response> {
  return handleObserve({ ...hostedVaultSeams, request });
}

/**
 * Records what the signed-in desktop counted about its own use. The logic
 * lives in `server/hosted/events.ts`; this hands it the deployment's real
 * seams — the project token the desktop never holds, and the same
 * in-process token resolution every other hosted endpoint trusts.
 */
function eventsHandler(request: Request): Promise<Response> {
  const options: EventsOptions = {
    request,
    projectApiKey: process.env[POSTHOG_ENVIRONMENT.PROJECT_API_KEY],
    resolveUserId: (incoming) => hostedUserId(incoming, (input) => auth.api.oauth2UserInfo(input)),
    // Read from the service's own user row rather than from the request, so
    // the desktop still sends nothing that names anybody.
    readPerson: async (userId) => {
      const rows = await getDatabase()
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      return rows[0];
    },
  };
  const host = process.env[POSTHOG_ENVIRONMENT.HOST];
  if (host) options.host = host;
  return handleEvents(options);
}

/**
 * The scheduled observation's one entry, called by Vercel's cron on the
 * cadence `vercel.json` fixes. The logic lives in
 * `server/hosted/observation-tick.ts`; this hands it the deployment's real
 * seams and the database queries behind them. An account was seen when one
 * of its devices last registered or sent a heartbeat: the `devices` row's
 * `last_seen_at`, which every platform moves along while the app is open. A
 * deployment without the Apple push credential pushes nothing and reads
 * nothing for it; one with it opens a sender for the tick and closes it with
 * the tick, so the notifications share one connection to Apple.
 */
async function observationTickHandler(request: Request): Promise<Response> {
  const database = getDatabase();
  const encryptionSecret = process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET]?.trim() || undefined;
  const store = encryptionSecret
    ? hostedStore({ db: database, keys: payloadKeyRing(encryptionSecret), run: runWeb })
    : undefined;
  const apnsCredentials = apnsCredentialsFromEnvironment(process.env);
  const sender = apnsCredentials ? new ApnsSender({ credentials: apnsCredentials }) : undefined;

  const options: ObservationTickOptions = {
    request,
    cronSecret: process.env[OBSERVATION_ENVIRONMENT.CRON_SECRET],
    encryptionSecret,
    listAccounts: async (limit, seenAfter) => {
      const rows = await database
        .select({ userId: providerKey.userId })
        .from(providerKey)
        .innerJoin(devices, eq(devices.userId, providerKey.userId))
        .leftJoin(observationPass, eq(observationPass.userId, providerKey.userId))
        .where(
          and(
            inArray(providerKey.providerId, CLOUD_PROVIDER_IDS),
            gte(devices.lastSeenAt, new Date(seenAfter)),
          ),
        )
        .groupBy(providerKey.userId, observationPass.attemptedAt)
        .orderBy(sql`${observationPass.attemptedAt} asc nulls first`)
        .limit(limit);
      return rows.map((row) => ({ userId: row.userId }));
    },
    forgetIneligible: async (seenAfter) => {
      await store?.roster.forgetIneligible({ providerIds: CLOUD_PROVIDER_IDS, seenAfter });
    },
    purgeCleared: async (now) => (store ? store.retention.purgeCleared(new Date(now)) : 0),
    sweepSpeech: async (now) => {
      if (!store) return NOTHING_SWEPT;
      const writer = await storeWriter({ db: database, tools: CATALOG_TOOL_SET });
      return sweepSpeech({ db: database, writer }, { now });
    },
    pushSpeech: async (now) => {
      if (!store || !sender) return NOTHING_PUSHED;
      const writer = await storeWriter({ db: database, tools: CATALOG_TOOL_SET });
      return pushSpeech(
        {
          store: { db: database, writer },
          tools: CATALOG_TOOL_SET,
          send: (notification) => sender.send(notification),
          forgetDevice: deviceSeams(database).forgetDevice,
        },
        { now },
      );
    },
    observe: async (userId) => {
      if (!store || !encryptionSecret) return { complete: false, changed: false };
      const rows = await database
        .select({ providerId: providerKey.providerId, ciphertext: providerKey.ciphertext })
        .from(providerKey)
        .where(eq(providerKey.userId, userId));
      const outcome = await observeAndSnapshot({
        userId,
        rows,
        secret: encryptionSecret,
        store,
        seams: {},
        now: Date.now(),
      });
      return { complete: outcome.complete, changed: outcome.changed };
    },
  };

  try {
    return await handleObservationTick(options);
  } finally {
    await sender?.close();
  }
}

/**
 * The group: each path's promise-shaped handler carried to an `HttpApp`, and
 * the hosted vocabulary's own refusal for a path none of them declares —
 * unreachable in production, since `vercel.json` sends each function only
 * its own path, but the same shape `auth-app.ts` answers with.
 */
export function observationApp(): HttpApp.Default {
  return HttpRouter.empty.pipe(
    // `all`, not `get`/`post`: each handler decides its own method refusal,
    // as it did before conversion, so a request to the right path on the
    // wrong method still answers 405 rather than falling through to the
    // group's own 404.
    HttpRouter.all(PATH.SESSIONS_MESSAGES, promisePassthrough(sessionsMessagesHandler)),
    HttpRouter.all(PATH.PROJECTS, promisePassthrough(projectsHandler)),
    HttpRouter.all(PATH.EVENTS, promisePassthrough(eventsHandler)),
    HttpRouter.all(PATH.OBSERVE, promisePassthrough(observeHandler)),
    HttpRouter.all(PATH.OBSERVATION_TICK, promisePassthrough(observationTickHandler)),
    Effect.catchTag("RouteNotFound", () =>
      Effect.succeed(hostedRefusalResponse(HOSTED_REFUSAL.NOT_FOUND)),
    ),
  );
}
