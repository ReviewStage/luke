import type { ModelChoice } from "@sidecar/hosted/models-wire";
import { accountPreferencesFromWire } from "@sidecar/settings";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import type {
  AccountPreferencesRow,
  AccountPreferencesWrite,
  AccountSeamEffect,
} from "./hosted/account-store.js";
import { HostedEnvironment } from "./hosted/environment.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedNotFoundRoute,
  hostedRefusalResponse,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import {
  acceptedModelChoice,
  CODING_AGENT_DEFAULT_CHOICE,
  type ModelCatalog,
} from "./hosted/model-catalog.js";
import { forgetPosthogPersonEffect } from "./hosted/posthog.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * The account group: the signed-in desktop's own delete and preferences
 * endpoints. Both endpoints resolve the same bearer against the deployment's
 * own account store before touching anything, and answer nothing about any
 * account but the one the bearer names — root AGENTS.md pins that no
 * credential or account secret ever travels in an answer, so what each
 * endpoint answers is a boolean or the caller's own stored snapshot, never a
 * token or a session id.
 *
 * The preferences snapshot is two parts: the settings preferences the
 * desktop syncs, and the coding agents' default model and effort beside
 * them, which Settings and the Start menu both write. A write carries either
 * part or both, and a coding-agent choice is accepted only as the catalog
 * accepts it (`hosted/model-catalog.ts`), so what is stored is always a
 * choice a Start could run.
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
  resolveUserId: UserIdResolver;
  /** Deletes the user row; every dependent row cascades with it. */
  deleteUser: (userId: string) => AccountSeamEffect<void>;
  readPreferences: (userId: string) => AccountSeamEffect<AccountPreferencesRow | undefined>;
  /** Writes each part the write carries and answers the snapshot as it then stands. */
  writePreferences: (
    userId: string,
    write: AccountPreferencesWrite,
  ) => AccountSeamEffect<AccountPreferencesRow>;
}

/** A coding-agent choice as a write names it; the catalog decides whether it is one. */
const ModelChoiceSchema = Schema.Struct({
  model: Schema.String,
  effort: Schema.String,
});

const readModelChoice = readEither(ModelChoiceSchema);

/** The snapshot as the group answers it, the preferences' instant beside it where the preferences were ever written. */
function snapshotAnswer(row: AccountPreferencesRow | undefined) {
  const updatedAt = row?.updatedAt;
  return {
    preferences: row?.preferences ?? {},
    codingAgent: row?.codingAgent ?? CODING_AGENT_DEFAULT_CHOICE,
    ...(updatedAt === undefined ? undefined : { updatedAt: updatedAt.getTime() }),
  };
}

/** The bearer resolved against the deployment's own account store, or the invalid-token refusal. */
const resolvedUserId = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: AccountAppSeams,
): Effect.fn.Return<string, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/**
 * Without both halves of the analytics configuration there is no person to
 * erase and nothing to erase it with, so the erasure is simply skipped.
 */
const forgetAnalytics = /* @__PURE__ */ Effect.fn("web/forgetAnalytics")(function* (
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
const accountDeleteEndpoint = /* @__PURE__ */ Effect.fn("web/accountDeleteEndpoint")(function* (
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
  yield* hostedStoreOrUnavailable(seams.deleteUser(userId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { deleted: true });
});

/** GET: the caller's own stored snapshot, or the defaults for a user with none stored. */
const preferencesReadEndpoint = /* @__PURE__ */ Effect.fn("web/preferencesReadEndpoint")(function* (
  seams: AccountAppSeams,
): Effect.fn.Return<
  ReturnType<typeof hostedJsonResponse>,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | SqlClient.SqlClient
> {
  const userId = yield* resolvedUserId(seams);
  const row = yield* hostedStoreOrUnavailable(seams.readPreferences(userId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, snapshotAnswer(row));
});

/**
 * The write's coding-agent part, as the catalog accepts it: a choice the
 * catalog does not offer is a bad request, and a catalog the instance
 * cannot read is an outage the caller may retry.
 */
const acceptedCodingAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  value: UnparsedWireValue,
): Effect.fn.Return<ModelChoice, HostedRefusal, ModelCatalog> {
  const read = readModelChoice(value);
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return yield* acceptedModelChoice(read.success).pipe(
    Effect.catchTag("ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)),
    Effect.catchTag("ModelCatalogUnavailable", (unavailable) =>
      Effect.logWarning("the model catalog could not be read", unavailable.cause).pipe(
        Effect.andThen(Effect.fail(HOSTED_REFUSAL.UNAVAILABLE)),
      ),
    ),
  );
});

/**
 * PUT: writes each part the body carries — `preferences`, a validated
 * settings snapshot that replaces the stored one whole, and `codingAgent`, a
 * choice the catalog accepts — and answers the snapshot as it then stands.
 * A body carrying neither asks for nothing and is refused.
 */
const preferencesWriteEndpoint = /* @__PURE__ */ Effect.fn("web/preferencesWriteEndpoint")(
  function* (
    seams: AccountAppSeams,
  ): Effect.fn.Return<
    ReturnType<typeof hostedJsonResponse>,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest | SqlClient.SqlClient | ModelCatalog
  > {
    const userId = yield* resolvedUserId(seams);
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    const parsed = yield* incoming.json.pipe(Effect.mapError(() => HOSTED_REFUSAL.INVALID_REQUEST));
    // SAFETY: Request JSON is untrusted boundary data; each part's reader validates it before use.
    const body = parsed as UnparsedWireValue;
    if (!isRecord(body)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    if (body.preferences === undefined && body.codingAgent === undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }

    const write: AccountPreferencesWrite = {};
    if (body.preferences !== undefined) {
      const preferences = accountPreferencesFromWire(body.preferences);
      if (preferences === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      write.preferences = preferences;
    }
    if (body.codingAgent !== undefined) {
      write.codingAgent = yield* acceptedCodingAgent(body.codingAgent);
    }

    const row = yield* hostedStoreOrUnavailable(seams.writePreferences(userId, write));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, snapshotAnswer(row));
  },
);

/** GET or PUT on the same path; any other method is the same refusal the two branches would answer separately. */
const accountPreferencesEndpoint = /* @__PURE__ */ Effect.fn("web/accountPreferencesEndpoint")(
  function* (
    seams: AccountAppSeams,
  ): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    SqlClient.SqlClient | HttpServerRequest.HttpServerRequest | ModelCatalog
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
): WebRoutes<HostedEnvironment | HttpClient.HttpClient | SqlClient.SqlClient | ModelCatalog> {
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
