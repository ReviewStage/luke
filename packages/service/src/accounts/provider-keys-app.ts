import type { DatabaseServices } from "@luke/database/core/query";
import {
  type KeyRing,
  openProviderKey,
  sealProviderKey,
} from "@luke/database/models/provider-key-seal";
import {
  listProviderKeyRows,
  removeProviderKey,
  saveProviderKey,
} from "@luke/database/models/provider-key-store";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_QUERY,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeyRejection,
  type ProviderKeySummary,
  providerKeySaveRequestSchema,
} from "@luke/features/provider-key-wire";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { DateTime, Duration, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { HostedEnvironment } from "../environment.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  effectPassthrough,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "../http/http-effect.js";
import { makeRateBrake, type RateBrake } from "../http/rate-brake.js";
import { MAINTENANCE_PROVIDER_KEYS_REWRAP_PATH } from "../maintenance/maintenance-bounds.js";
import {
  checkFastAccess,
  checkProviderKey,
  PROVIDER_KEY_CHECK,
  providerKeyHint,
} from "../providers/provider-key-check.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { keyRingOrUnavailable } from "./key-ring.js";
import { handleProviderKeyRewrap } from "./provider-key-rewrap.js";

/**
 * provider-keys-app.ts -- the account's own Anthropic and OpenAI API keys: read what they are, save one, remove one.
 *
 * `GET /api/account/provider-keys` answers the account's keys as hints and
 * statuses; `PUT` saves one, first asking the provider whether it accepts
 * it (`packages/service/src/providers/provider-key-check.ts`), and keeps it sealed
 * (`@luke/database/models/provider-key-seal`) only where it does; `DELETE` with the
 * provider in the query removes one. Every answer is the keys as they then
 * stand and none carries a key: the one body that holds a key is the
 * `PUT`'s own, it is sealed the moment it is read, and neither it nor what
 * the provider said of it is logged.
 *
 * A key that the deployment's ring can no longer open answers unreadable
 * rather than as its stored status, so the account is told to replace it.
 * A deployment holding no ring, or one it cannot parse, answers every
 * request unavailable, and its agents run on Luke's own keys.
 *
 * The rotation's rewrap (`accounts/provider-key-rewrap.ts`) is a group of its
 * own beside this one, asked by hand under the deployment's `CRON_SECRET`
 * rather than any account's bearer, and kept out of the maintenance group so
 * its function carries none of the voice socket the sweep reaches.
 *
 * A save is braked per account, ten an hour, because a check is an
 * authenticated call to the provider and an endpoint that answers whether a
 * key is good is worth hammering with keys that are not the caller's.
 */

const PROVIDER_KEYS_PATH = "/api/account/provider-keys";

const HTTP_METHOD = { GET: "GET", PUT: "PUT", DELETE: "DELETE" } as const;

/** A save is a provider and a key bounded at 512 characters, so a body past this is not one. */
const MAXIMUM_SAVE_BODY_BYTES = 2_048;

const SAVE_BRAKE = {
  windowMs: Duration.toMillis(Duration.hours(1)),
  maxRequestsPerWindow: 10,
  maxTrackedUsers: 10_000,
} as const;

const ProviderQuerySchema = Schema.Literals(Object.values(PROVIDER_KEY_PROVIDER));

export interface ProviderKeysAppSeams {
  resolveUserId: UserIdResolver;
}

type ProviderKeysRequirements =
  | HttpServerRequest.HttpServerRequest
  | DatabaseServices
  | HostedEnvironment
  | HttpClient.HttpClient;

/** The account's keys as it is shown them, each one the ring cannot open answered unreadable. */
const summariesOf = /* @__PURE__ */ Effect.fnUntraced(function* (userId: string, ring: KeyRing) {
  const rows = yield* hostedStoreOrUnavailable(listProviderKeyRows(userId));
  return rows.map((row): ProviderKeySummary => {
    const readable = Result.isSuccess(
      openProviderKey(ring, { userId, provider: row.provider }, row),
    );
    return {
      provider: row.provider,
      hint: row.hint,
      addedAt: row.createdAt.getTime(),
      status: readable ? row.status : PROVIDER_KEY_STATUS.UNREADABLE,
      statusAt: row.statusAt.getTime(),
    };
  });
});

const keysResponse = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  rejected?: ProviderKeyRejection,
) {
  const keys = yield* summariesOf(userId, ring);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    keys,
    ...(rejected === undefined ? undefined : { rejected }),
  });
});

/** A save: braked, checked with the provider, and kept sealed only where the provider accepts it. */
const saveEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  brake: RateBrake,
) {
  const body = yield* readJsonBodyEffect(MAXIMUM_SAVE_BODY_BYTES);
  // Note that a refusal's wording is never logged or answered, because it may quote the key.
  const asked = readEither(providerKeySaveRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { provider } = asked.success;
  const key = Redacted.make(asked.success.key);
  if (!(yield* brake.check(userId))) {
    return yield* keysResponse(userId, ring, PROVIDER_KEY_REJECTION.TOO_MANY_TRIES);
  }
  // An Anthropic key is asked about fast mode beside the check, which the catalog offers by; OpenAI has none Luke runs.
  const [checked, fastAccess] = yield* Effect.all(
    [
      checkProviderKey(provider, key),
      provider === PROVIDER_KEY_PROVIDER.ANTHROPIC
        ? checkFastAccess(key)
        : Effect.succeed(undefined),
    ],
    { concurrency: "unbounded" },
  );
  if (checked !== PROVIDER_KEY_CHECK.ACCEPTED) return yield* keysResponse(userId, ring, checked);
  const sealed = sealProviderKey(ring, { userId, provider }, key);
  const now = yield* DateTime.nowAsDate;
  yield* hostedStoreOrUnavailable(
    saveProviderKey(userId, provider, sealed, providerKeyHint(key), fastAccess ?? null, now),
  );
  return yield* keysResponse(userId, ring);
});

const removeEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  url: string,
) {
  const named = new URL(url).searchParams.get(PROVIDER_KEY_QUERY.PROVIDER);
  const provider = readEither(ProviderQuerySchema)(unparsedWire(named));
  if (Result.isFailure(provider)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  yield* hostedStoreOrUnavailable(removeProviderKey(userId, provider.success));
  return yield* keysResponse(userId, ring);
});

const providerKeysEndpoint = /* @__PURE__ */ Effect.fn("web/providerKeysEndpoint")(function* (
  seams: ProviderKeysAppSeams,
  brake: RateBrake,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  ProviderKeysRequirements
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (!Object.values(HTTP_METHOD).some((method) => method === incoming.method)) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const userId = account.value;
  const ring = yield* keyRingOrUnavailable;
  switch (incoming.method) {
    case HTTP_METHOD.PUT:
      return yield* saveEndpoint(userId, ring, brake);
    case HTTP_METHOD.DELETE:
      return yield* removeEndpoint(userId, ring, request.url);
    default:
      return yield* keysResponse(userId, ring);
  }
});

/** The group: the one keys path, braked per instance, and the hosted vocabulary's own refusal for any other. */
export function providerKeysApp(
  seams: ProviderKeysAppSeams,
): WebRoutes<DatabaseServices | HostedEnvironment | HttpClient.HttpClient> {
  const brake = makeRateBrake(SAVE_BRAKE);
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      PROVIDER_KEYS_PATH,
      hostedRefusing(providerKeysEndpoint(seams, brake)),
    ),
    hostedNotFoundRoute,
  );
}

/** The rotation's rewrap, asked by hand under the deployment's secret, over the ring the deployment holds. */
const providerKeyRewrapEffect = /* @__PURE__ */ Effect.fn("web/providerKeyRewrapEffect")(function* (
  request: Request,
): Effect.fn.Return<Response, unknown, DatabaseServices | HostedEnvironment> {
  const environment = yield* HostedEnvironment;
  return yield* handleProviderKeyRewrap({
    request,
    cronSecret: environment.cronSecret,
    keys: environment.providerKeyEncryptionKeys,
  });
});

/** The rewrap's group: its one path, and the hosted vocabulary's own refusal for any other. */
export function providerKeyRewrapApp(): WebRoutes<DatabaseServices | HostedEnvironment> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      MAINTENANCE_PROVIDER_KEYS_REWRAP_PATH,
      effectPassthrough(providerKeyRewrapEffect),
    ),
    hostedNotFoundRoute,
  );
}
