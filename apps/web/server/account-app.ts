import { type HttpApp, HttpRouter, HttpServerRequest } from "@effect/platform";
import { accountPreferencesFromWire, RETIRED_ACCOUNT_PREFERENCE_FIELD } from "@sidecar/settings";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { Effect } from "effect";
import {
  type AccountPreferencesRow,
  type HostedAccountPreferences,
  phoneVoiceSpeed,
} from "./hosted/account-preferences.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedRefusalResponse,
} from "./hosted/http-effect.js";

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
  resolveUserId: (request: Request) => Promise<string | undefined>;
  /** Deletes the user row; every dependent row cascades with it. */
  deleteUser: (userId: string) => Promise<void>;
  /** Erases the analytics person for this account, where a deployment can. */
  forgetAnalytics?: ((userId: string) => Promise<void>) | undefined;
  readPreferences: (userId: string) => Promise<AccountPreferencesRow | undefined>;
  writePreferences: (userId: string, preferences: HostedAccountPreferences) => Promise<Date>;
}

/** The bearer resolved against the deployment's own account store, or the invalid-token refusal. */
function resolvedUserId(
  seams: AccountAppSeams,
): Effect.Effect<string, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  return Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const userId = yield* Effect.promise(() => seams.resolveUserId(request));
    if (!userId) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    return userId;
  });
}

/**
 * POST: erases the signed-in desktop's account. The bearer token is the
 * whole authority, so nothing a caller sends can choose a different account
 * to erase. Where the deployment can, the analytics person is asked to be
 * erased first, because nothing after the delete would still name it; a
 * refusal or an outage there must not hold up the delete, so it is logged as
 * a status and the delete proceeds.
 */
function accountDeleteEndpoint(seams: AccountAppSeams): HttpApp.Default<HostedRefusal> {
  return Effect.gen(function* () {
    yield* hostedMethod(HTTP_METHOD.POST);
    const userId = yield* resolvedUserId(seams);
    const forgetAnalytics = seams.forgetAnalytics;
    if (forgetAnalytics) {
      yield* Effect.promise(async () => {
        try {
          await forgetAnalytics(userId);
        } catch (error) {
          process.stderr.write(
            `Analytics erasure did not complete: ${error instanceof Error ? error.message : "unknown error"}\n`,
          );
        }
      });
    }
    yield* Effect.promise(() => seams.deleteUser(userId));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { deleted: true });
  });
}

/** GET: the caller's own stored preferences, or an empty snapshot for a user with none stored. */
function preferencesReadEndpoint(
  seams: AccountAppSeams,
): Effect.Effect<
  ReturnType<typeof hostedJsonResponse>,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest
> {
  return Effect.gen(function* () {
    const userId = yield* resolvedUserId(seams);
    const row = yield* Effect.promise(() => seams.readPreferences(userId));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      preferences: row?.preferences ?? {},
      ...(row ? { updatedAt: row.updatedAt.getTime() } : undefined),
    });
  });
}

/** PUT: replaces the caller's stored preferences with a validated snapshot. */
function preferencesWriteEndpoint(
  seams: AccountAppSeams,
): Effect.Effect<
  ReturnType<typeof hostedJsonResponse>,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest
> {
  return Effect.gen(function* () {
    const userId = yield* resolvedUserId(seams);
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    const parsed = yield* incoming.json.pipe(Effect.mapError(() => HOSTED_REFUSAL.INVALID_REQUEST));
    // SAFETY: Request JSON is untrusted boundary data; accountPreferencesFromWire validates it before use.
    const body = parsed as UnparsedWireValue;
    if (!isRecord(body)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);

    const shared = accountPreferencesFromWire(body.preferences);
    const pace = phoneVoiceSpeed(body.preferences);
    if (shared === undefined || !pace.valid) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }
    const preferences: HostedAccountPreferences = {
      ...shared,
      ...(pace.value !== undefined
        ? { [RETIRED_ACCOUNT_PREFERENCE_FIELD.VOICE_SPEED]: pace.value }
        : undefined),
    };

    const updatedAt = yield* Effect.promise(() => seams.writePreferences(userId, preferences));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      preferences,
      updatedAt: updatedAt.getTime(),
    });
  });
}

/** GET or PUT on the same path; any other method is the same refusal the two branches would answer separately. */
function accountPreferencesEndpoint(seams: AccountAppSeams): HttpApp.Default<HostedRefusal> {
  return Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method === HTTP_METHOD.GET) return yield* preferencesReadEndpoint(seams);
    if (incoming.method === HTTP_METHOD.PUT) return yield* preferencesWriteEndpoint(seams);
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  });
}

/**
 * The group: the two account endpoints on their own paths, and the hosted
 * vocabulary's own refusal for a method the matched path does not answer or a
 * path the group declares no route for.
 */
export function accountApp(seams: AccountAppSeams): HttpApp.Default {
  return HttpRouter.empty.pipe(
    HttpRouter.all(ACCOUNT_PATH.DELETE, accountDeleteEndpoint(seams)),
    HttpRouter.all(ACCOUNT_PATH.PREFERENCES, accountPreferencesEndpoint(seams)),
    Effect.catchTag("RouteNotFound", () =>
      Effect.succeed(hostedRefusalResponse(HOSTED_REFUSAL.NOT_FOUND)),
    ),
    Effect.catchAll((refusal) => Effect.succeed(hostedRefusalResponse(refusal))),
  );
}
