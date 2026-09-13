import { type HttpApp, HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Option, type ParseResult, Redacted, Schema } from "effect";
import { auth } from "./auth.js";
import { CLOUD_AGENT_PROVIDER_ID } from "./core.js";
import { executeConversationRead } from "./hosted/action-execute.js";
import { ApnsSender } from "./hosted/apns.js";
import { hostedUserId } from "./hosted/bearer.js";
import { eveOrigin as eveOriginFor } from "./hosted/brain-host/eve-origin.js";
import { EVE_CALLER, eveSessions } from "./hosted/brain-host/eve-sessions.js";
import {
  NOTHING_OPENED,
  openAccountTurns,
  type ScheduledTurn,
} from "./hosted/brain-host/opener.js";
import { readHostedRoster } from "./hosted/brain-host/roster.js";
import { hostedTranscriptReads } from "./hosted/brain-host/transcript.js";
import { CATALOG_TOOL_SET } from "./hosted/brain-tool-set.js";
import { cloudSessionPluginFor } from "./hosted/cloud-adapters.js";
import { handleConversationRead } from "./hosted/conversation-read.js";
import { deviceSeams } from "./hosted/device-store.js";
import { payloadKeyRing } from "./hosted/encryption.js";
import { HostedEnvironment } from "./hosted/environment.js";
import { type EventsOptions, handleEvents } from "./hosted/events.js";
import { HOSTED_REFUSAL, hostedRefusalResponse } from "./hosted/http-effect.js";
import { observeAndSnapshot } from "./hosted/observation-pass.js";
import { handleObservationTick, type ObservationTickOptions } from "./hosted/observation-tick.js";
import { handleObserve } from "./hosted/observe.js";
import type { PosthogPerson } from "./hosted/posthog.js";
import { handleProjects } from "./hosted/projects.js";
import { pushSpeech, type SpeechPushOutcome } from "./hosted/speech-push.js";
import {
  hostedStore,
  type SpeechSweepOutcome,
  storeWriter,
  sweepSpeech,
} from "./hosted/store/index.js";
import { readStoredVaultKeys } from "./hosted/vault-key-store.js";
import { readApiKeyFor } from "./hosted/vault-keys.js";
import { hostedEncryptionSecretEffect, hostedVaultSeams } from "./hosted/vault-route.js";

/**
 * The observation group: the routes that read and are read from the roster
 * an account's cloud providers stand behind. Each is its own Vercel function
 * on its own path, and every one of them mounts this same group, which is
 * organization rather than dispatch — Vercel already sent each function only
 * the requests for its own path. What differs across them is each handler's
 * own logic, kept exactly as it stood; the group is the `HttpRouter` that
 * carries each handler's answer to an `HttpApp`, and the hosted vocabulary's
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

/** How a statement below fails: the driver's own refusal, or a row this build cannot decode. */
type ObservationAppFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const PersonRowSchema = Schema.Struct({ name: Schema.String, email: Schema.String });

const findPerson = SqlSchema.findOne({
  Request: Schema.String,
  Result: PersonRowSchema,
  execute: (userId) =>
    statement((sql) => sql`select name, email from "user" where id = ${userId} limit 1`),
});

/** Reads the signed-in user's own name and email, for the events endpoint's PostHog person fields. */
export function readPerson(
  userId: string,
): Effect.Effect<PosthogPerson | undefined, ObservationAppFailure, SqlClient.SqlClient> {
  return Effect.map(findPerson(userId), Option.getOrUndefined);
}

const EligibleAccountRequestSchema = Schema.Struct({
  limit: Schema.Number,
  seenAfter: Schema.DateFromSelf,
});

const EligibleAccountRowSchema = Schema.Struct({
  userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
});

const findEligibleAccounts = SqlSchema.findAll({
  Request: EligibleAccountRequestSchema,
  Result: EligibleAccountRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select provider_key.user_id as user_id
        from provider_key
        inner join devices on devices.user_id = provider_key.user_id
        left join observation_pass on observation_pass.user_id = provider_key.user_id
        where ${sql.in("provider_id", CLOUD_PROVIDER_IDS)}
          and devices.last_seen_at >= ${request.seenAfter}
        group by provider_key.user_id, observation_pass.attempted_at
        order by observation_pass.attempted_at asc nulls first
        limit ${request.limit}
      `,
    ),
});

/**
 * Accounts holding a cloud provider key, seen since the instant, least
 * recently attempted first and never attempted first of all — the tick's own
 * ordering, carried by the left join's null landing before every attempted
 * instant in `nulls first`.
 */
export function listEligibleAccounts(
  limit: number,
  seenAfter: number,
): Effect.Effect<{ userId: string }[], ObservationAppFailure, SqlClient.SqlClient> {
  return Effect.map(findEligibleAccounts({ limit, seenAfter: new Date(seenAfter) }), (rows) => [
    ...rows,
  ]);
}

const PATH = {
  SESSIONS_MESSAGES: "/api/sessions/messages",
  PROJECTS: "/api/projects",
  EVENTS: "/api/events",
  OBSERVE: "/api/observe",
  OBSERVATION_TICK: "/api/observation/tick",
} as const;

const HTTP_METHOD = { HEAD: "HEAD" } as const;

/**
 * A HEAD answer's status and headers, carried on the `HttpServerResponse`
 * because the platform's web handler builds a HEAD response from those alone
 * rather than from the raw answer beneath them — the same reason
 * `auth-app.ts`'s passthrough carries a HEAD this way.
 */
function bodylessAnswer(answer: Response): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.empty({
    status: answer.status,
    statusText: answer.statusText,
    headers: [...answer.headers],
  });
}

/**
 * A handler's answer, carried to the `HttpApp` the group composes: the
 * handler already answers the hosted vocabulary's own bytes, so nothing here
 * reads or rewrites the response beside forwarding it, except a HEAD, whose
 * status and headers the web handler reads off the `HttpServerResponse`
 * rather than the raw answer it wraps. The handler runs on the group's own
 * fiber rather than through a runner of its own, so a failed statement it
 * reads is a defect here.
 */
function effectPassthrough<R>(
  handle: (request: Request) => Effect.Effect<Response, unknown, R>,
): HttpApp.Default<never, R> {
  return Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const answer = yield* Effect.orDie(handle(request));
    return incoming.method === HTTP_METHOD.HEAD
      ? bodylessAnswer(answer)
      : HttpServerResponse.raw(answer);
  });
}

/** Reads one observed session's conversation for the caller who opened its screen. */
function sessionsMessagesEffect(
  request: Request,
): Effect.Effect<
  Response,
  SqlError | ParseResult.ParseError,
  SqlClient.SqlClient | HostedEnvironment
> {
  return Effect.gen(function* () {
    const encryptionSecret = yield* hostedEncryptionSecretEffect;
    return yield* handleConversationRead({
      ...hostedVaultSeams,
      encryptionSecret,
      request,
      execute: executeConversationRead,
    });
  });
}

/** Lists where the signed-in user's keys can create a workspace. */
function projectsEffect(
  request: Request,
): Effect.Effect<
  Response,
  SqlError | ParseResult.ParseError,
  SqlClient.SqlClient | HostedEnvironment
> {
  return Effect.flatMap(hostedEncryptionSecretEffect, (encryptionSecret) =>
    handleProjects({ ...hostedVaultSeams, encryptionSecret, request }),
  );
}

/** Observes the signed-in user's cloud sessions on demand. */
function observeEffect(
  request: Request,
): Effect.Effect<
  Response,
  SqlError | ParseResult.ParseError,
  SqlClient.SqlClient | HostedEnvironment
> {
  return Effect.flatMap(hostedEncryptionSecretEffect, (encryptionSecret) =>
    handleObserve({ ...hostedVaultSeams, encryptionSecret, request }),
  );
}

/**
 * Records what the signed-in desktop counted about its own use. The logic
 * lives in `server/hosted/events.ts`; this hands it the deployment's real
 * seams — the project token the desktop never holds, and the same
 * in-process token resolution every other hosted endpoint trusts. The
 * userinfo call is better-auth's own foreign promise, so it is wrapped here,
 * at the seam's implementation, rather than inside the handler.
 */
function eventsEffect(
  request: Request,
): Effect.Effect<Response, never, SqlClient.SqlClient | HostedEnvironment> {
  return Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    const options: EventsOptions = {
      request,
      projectApiKey:
        environment.posthogProjectApiKey === undefined
          ? undefined
          : Redacted.value(environment.posthogProjectApiKey),
      resolveUserId: (incoming) =>
        hostedUserId(incoming, (input) => Effect.tryPromise(() => auth.api.oauth2UserInfo(input))),
      // Read from the service's own user row rather than from the request, so
      // the desktop still sends nothing that names anybody.
      readPerson,
    };
    if (environment.posthogIngestHost) options.host = environment.posthogIngestHost;
    return yield* handleEvents(options);
  });
}

/**
 * The scheduled observation's one entry, called by Vercel's cron on the
 * cadence `vercel.json` fixes. The logic lives in
 * `server/hosted/observation-tick.ts`; this hands it the deployment's real
 * seams and the database queries behind them, each read answering an Effect
 * over the group's own `SqlClient.SqlClient` rather than a promise, so the
 * tick runs on the same fiber the group's other routes do instead of a
 * runtime built anew per read. An account was seen when one of its devices
 * last registered or sent a heartbeat: the `devices` row's `last_seen_at`,
 * which every platform moves along while the app is open. A deployment
 * without the Apple push credential pushes nothing and reads nothing for it;
 * one with it opens a sender for the tick and closes it with the tick, so the
 * notifications share one connection to Apple. The opener reaches eve as the
 * deployment acting for the one account the tick is passing over, under the
 * tick's own secret, so the account named to eve is only ever one this tick
 * enumerated.
 */
function observationTickEffect(
  request: Request,
): Effect.Effect<Response, unknown, SqlClient.SqlClient | HostedEnvironment> {
  return Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    const encryptionSecret = environment.providerKeyEncryptionSecret
      ? Redacted.value(environment.providerKeyEncryptionSecret)
      : undefined;
    const store = encryptionSecret
      ? hostedStore({ keys: payloadKeyRing(encryptionSecret) })
      : undefined;
    const sender = environment.apnsCredentials
      ? new ApnsSender({ credentials: environment.apnsCredentials })
      : undefined;
    const cronSecret =
      environment.cronSecret === undefined ? undefined : Redacted.value(environment.cronSecret);
    const eveOrigin = eveOriginFor(new URL(request.url).origin);

    const options: ObservationTickOptions = {
      request,
      cronSecret,
      encryptionSecret,
      listAccounts: (limit, seenAfter) => listEligibleAccounts(limit, seenAfter),
      forgetIneligible: (seenAfter) =>
        store
          ? store.roster.forgetIneligible({ providerIds: CLOUD_PROVIDER_IDS, seenAfter })
          : Effect.void,
      purgeCleared: (now) =>
        store ? store.retention.purgeCleared(new Date(now)) : Effect.succeed(0),
      sweepSpeech: (now) =>
        store === undefined
          ? Effect.succeed(NOTHING_SWEPT)
          : Effect.flatMap(storeWriter({ tools: CATALOG_TOOL_SET }), (writer) =>
              sweepSpeech({ writer }, { now }),
            ),
      pushSpeech: (now) =>
        store === undefined || sender === undefined
          ? Effect.succeed(NOTHING_PUSHED)
          : Effect.flatMap(storeWriter({ tools: CATALOG_TOOL_SET }), (writer) =>
              pushSpeech(
                {
                  store: { writer },
                  tools: CATALOG_TOOL_SET,
                  send: (notification) => sender.send(notification),
                  forgetDevice: deviceSeams().forgetDevice,
                },
                { now },
              ),
            ),
      observe: (userId) => {
        if (!store || !encryptionSecret) return Effect.succeed({ complete: false, changed: false });
        return Effect.gen(function* () {
          const rows = yield* readStoredVaultKeys(userId);
          const outcome = yield* observeAndSnapshot({
            userId,
            rows,
            secret: encryptionSecret,
            store,
            seams: {},
            now: Date.now(),
          });
          return { complete: outcome.complete, changed: outcome.changed };
        });
      },
      openTurns: (userId) => {
        if (!store || !encryptionSecret || !cronSecret) return Effect.succeed(NOTHING_OPENED);
        return Effect.gen(function* () {
          const rows = yield* readStoredVaultKeys(userId);
          const readApiKey = readApiKeyFor(rows, encryptionSecret);
          const roster = yield* readHostedRoster(store, userId, rows, encryptionSecret);
          return yield* openAccountTurns(
            {
              store,
              writer: yield* storeWriter({ tools: CATALOG_TOOL_SET }),
              eve: eveSessions<ScheduledTurn>({
                origin: eveOrigin,
                caller: { kind: EVE_CALLER.DEPLOYMENT, secret: cronSecret, account: userId },
              }),
              roster,
              transcripts: hostedTranscriptReads({
                client: yield* SqlClient.SqlClient,
                userId,
                roster: () => Effect.succeed(roster),
                pluginFor: (providerId) =>
                  cloudSessionPluginFor(providerId, {
                    readApiKey: readApiKey(providerId),
                    reported: () => roster.observations.get(providerId) ?? [],
                  }),
                now: Date.now,
              }),
              now: Date.now,
              report: (message) => console.warn(message),
            },
            userId,
          );
        });
      },
    };

    return yield* Effect.ensuring(
      handleObservationTick(options),
      sender ? Effect.promise(() => sender.close()) : Effect.void,
    );
  });
}

/**
 * The group: each path's handler carried to an `HttpApp`, and
 * the hosted vocabulary's own refusal for a path none of them declares —
 * unreachable in production, since `vercel.json` sends each function only
 * its own path, but the same shape `auth-app.ts` answers with.
 */
export function observationApp(): HttpApp.Default<never, SqlClient.SqlClient | HostedEnvironment> {
  return HttpRouter.empty.pipe(
    // `all`, not `get`/`post`: each handler decides its own method refusal,
    // as it did before conversion, so a request to the right path on the
    // wrong method still answers 405 rather than falling through to the
    // group's own 404.
    HttpRouter.all(PATH.SESSIONS_MESSAGES, effectPassthrough(sessionsMessagesEffect)),
    HttpRouter.all(PATH.PROJECTS, effectPassthrough(projectsEffect)),
    HttpRouter.all(PATH.EVENTS, effectPassthrough(eventsEffect)),
    HttpRouter.all(PATH.OBSERVE, effectPassthrough(observeEffect)),
    HttpRouter.all(PATH.OBSERVATION_TICK, effectPassthrough(observationTickEffect)),
    Effect.catchTag("RouteNotFound", () =>
      Effect.succeed(hostedRefusalResponse(HOSTED_REFUSAL.NOT_FOUND)),
    ),
  );
}
