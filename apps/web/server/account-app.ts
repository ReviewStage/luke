import { type AccountPreferences, accountPreferencesFromWire } from "@sidecar/settings";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { Effect, Layer, Redacted } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import type { AccountPreferencesRow, AccountSeamEffect } from "./hosted/account-store.js";
import { HostedEnvironment } from "./hosted/environment.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedNotFoundRoute,
  hostedRefusalResponse,
} from "./hosted/http-effect.js";
import { forgetPosthogPersonEffect } from "./hosted/posthog.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * The account group: the signed-in desktop's own delete and preferences
 * endpoints, over the seams `server/hosted/account-delete.ts` and
 * `server/hosted/account-preferences.ts` already declare. Both endpoints
 * resolve the same bearer against the deployment's own account store before
 * touching anything, and answer nothing about any account but the one the
 * bearer names — root AGENTS.md pins that no credential or account secret
 * ever travels in an answer, so what each endpoint answers is a boolean or
 * the caller's own stored snapshot, never a token or a session id.
 */

const ACCOUNT_PATH = {
  DELETE: "/api/account/delete",
  PREFERENCES: "/api/account/preferences",
} as const;

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
} as const;

export interface AccountAppSeams {
  resolveUserId: (request: Request) => Effect.Effect<string | undefined>;
  /** Deletes the user row; every dependent row cascades with it. */
  deleteUser: (userId: string) => AccountSeamEffect<void>;
  readPreferences: (userId: string) => AccountSeamEffect<AccountPreferencesRow | undefined>;
  writePreferences: (userId: string, preferences: AccountPreferences) => AccountSeamEffect<Date>;
}

/** The bearer resolved against the deployment's own account store, or the invalid-token refusal. */
const resolvedUserId = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: AccountAppSeams,
): Effect.fn.Return<string, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const userId = yield* seams.resolveUserId(request);
  if (!userId) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return userId;
});

/**
 * Without both halves of the analytics configuration there is no person to
 * erase and nothing to erase it with, so the erasure is simply skipped.
 */
const forgetAnalytics = /* @__PURE__ */ Effect.fn("forgetAnalytics")(function* (
  userId: string,
): Effect.fn.Return<void, never, HostedEnvironment | HttpClient.HttpClient> {
  const environment = yield* HostedEnvironment;
  if (!environment.posthogPersonalApiKey || !environment.posthogProjectId) return;
  const personalApiKey = Redacted.value(environment.posthogPersonalApiKey);
  const projectId = environment.posthogProjectId;
  const host = environment.posthogApiHost;
  yield* forgetPosthogPersonEffect(userId, {
    personalApiKey,
    projectId,
    ...(host ? { host } : undefined),
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() =>
        process.stderr.write(`Analytics erasure did not complete: ${error.message}\n`),
      ),
    ),
  );
});

/**
 * POST: erases the signed-in desktop's account. The bearer token is the
 * whole authority, so nothing a caller sends can choose a different account
 * to erase. Where the deployment can, the analytics person is asked to be
 * erased first, because nothing after the delete would still name it; a
 * refusal or an outage there must not hold up the delete, so it is logged as
 * a status and the delete proceeds.
 */
const accountDeleteEndpoint = /* @__PURE__ */ Effect.fn("accountDeleteEndpoint")(function* (
  seams: AccountAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  | HostedEnvironment
  | HttpClient.HttpClient
  | SqlClient.SqlClient
  | HttpServerRequest.HttpServerRequest
> {
  yield* hostedMethod(HTTP_METHOD.POST);
  const userId = yield* resolvedUserId(seams);
  yield* forgetAnalytics(userId);
  yield* Effect.orDie(seams.deleteUser(userId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { deleted: true });
});

/** GET: the caller's own stored preferences, or an empty snapshot for a user with none stored. */
const preferencesReadEndpoint = /* @__PURE__ */ Effect.fn("preferencesReadEndpoint")(function* (
  seams: AccountAppSeams,
): Effect.fn.Return<
  ReturnType<typeof hostedJsonResponse>,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | SqlClient.SqlClient
> {
  const userId = yield* resolvedUserId(seams);
  const row = yield* Effect.orDie(seams.readPreferences(userId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    preferences: row?.preferences ?? {},
    ...(row ? { updatedAt: row.updatedAt.getTime() } : undefined),
  });
});

/** PUT: replaces the caller's stored preferences with a validated snapshot. */
const preferencesWriteEndpoint = /* @__PURE__ */ Effect.fn("preferencesWriteEndpoint")(function* (
  seams: AccountAppSeams,
): Effect.fn.Return<
  ReturnType<typeof hostedJsonResponse>,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | SqlClient.SqlClient
> {
  const userId = yield* resolvedUserId(seams);
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const parsed = yield* incoming.json.pipe(Effect.mapError(() => HOSTED_REFUSAL.INVALID_REQUEST));
  // SAFETY: Request JSON is untrusted boundary data; accountPreferencesFromWire validates it before use.
  const body = parsed as UnparsedWireValue;
  if (!isRecord(body)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);

  const preferences = accountPreferencesFromWire(body.preferences);
  if (preferences === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);

  const updatedAt = yield* Effect.orDie(seams.writePreferences(userId, preferences));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    preferences,
    updatedAt: updatedAt.getTime(),
  });
});

/** GET or PUT on the same path; any other method is the same refusal the two branches would answer separately. */
const accountPreferencesEndpoint = /* @__PURE__ */ Effect.fn("accountPreferencesEndpoint")(
  function* (
    seams: AccountAppSeams,
  ): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    SqlClient.SqlClient | HttpServerRequest.HttpServerRequest
  > {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method === HTTP_METHOD.GET) return yield* preferencesReadEndpoint(seams);
    if (incoming.method === HTTP_METHOD.PUT) return yield* preferencesWriteEndpoint(seams);
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  },
);

/**
 * An endpoint's refusal carried back onto the answer channel. A refusal is
 * failed with rather than returned, so an endpoint's steps read as the early
 * returns they are; a route answers on one channel, so the group makes the
 * two one before it registers the path.
 */
function refusing<R>(
  endpoint: Effect.Effect<HttpServerResponse.HttpServerResponse, HostedRefusal, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> {
  return Effect.catch(endpoint, (refusal) => Effect.succeed(hostedRefusalResponse(refusal)));
}

/**
 * The group: the two account endpoints on their own paths, and the hosted
 * vocabulary's own refusal for a method the matched path does not answer or a
 * path the group declares no route for.
 */
export function accountApp(
  seams: AccountAppSeams,
): WebRoutes<HostedEnvironment | HttpClient.HttpClient | SqlClient.SqlClient> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, ACCOUNT_PATH.DELETE, refusing(accountDeleteEndpoint(seams))),
    HttpRouter.add(
      ANY_METHOD,
      ACCOUNT_PATH.PREFERENCES,
      refusing(accountPreferencesEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
