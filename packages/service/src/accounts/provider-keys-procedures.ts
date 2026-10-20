/**
 * provider-keys-procedures.ts -- the account's own Anthropic and OpenAI API keys: read what they are, save one, remove one.
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
 * request unavailable, before it reads anything the request carries, and
 * its agents run on Luke's own keys.
 *
 * The rotation's rewrap (`accounts/provider-key-rewrap.ts`) is a group of its
 * own (`provider-keys-app.ts`), asked by hand under the deployment's
 * `CRON_SECRET` rather than any account's bearer.
 *
 * A save is braked per account, ten an hour, because a check is an
 * authenticated call to the provider and an endpoint that answers whether a
 * key is good is worth hammering with keys that are not the caller's.
 */

import {
  type KeyRing,
  openProviderKey,
  parseKeyRing,
  sealProviderKey,
} from "@luke/database/models/provider-key-seal";
import {
  listProviderKeyRows,
  removeProviderKey,
  saveProviderKey,
} from "@luke/database/models/provider-key-store";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeyRejection,
  type ProviderKeySummary,
} from "@luke/features/provider-key-wire";
import { middlewareGen } from "@orpc/experimental-effect";
import { DateTime, Duration, Effect, Redacted, Result } from "effect";
import { HostedEnvironment } from "../environment.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { makeRateBrake } from "../http/rate-brake.js";
import { accountMiddleware, type HostedContext, hosted } from "../orpc/base.js";
import {
  checkFastAccess,
  checkProviderKey,
  PROVIDER_KEY_CHECK,
  providerKeyHint,
} from "../providers/provider-key-check.js";

const SAVE_BRAKE = {
  windowMs: Duration.toMillis(Duration.hours(1)),
  maxRequestsPerWindow: 10,
  maxTrackedUsers: 10_000,
} as const;

export interface ProviderKeysProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The deployment's ring, handed on as the procedure's, or the request refused as unavailable where it holds none it can parse. */
const keyRingMiddleware = middlewareGen<HostedContext, { readonly ring: KeyRing }>(function* ({
  next,
}) {
  const environment = yield* HostedEnvironment;
  const configured = environment.providerKeyEncryptionKeys;
  if (configured === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const ring = parseKeyRing(configured);
  if (Result.isFailure(ring)) {
    // The fault names the shape that is wrong and never a value.
    yield* Effect.logError(`The provider key encryption keys cannot be read: ${ring.failure}`);
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  return yield* next({ context: { ring: ring.success } });
});

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

const keysAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  rejected?: ProviderKeyRejection,
) {
  const keys = yield* summariesOf(userId, ring);
  return { keys, ...(rejected === undefined ? undefined : { rejected }) };
});

/** The provider keys' three procedures, braked per instance, each to a signed-in caller on a deployment that holds a ring. */
export function providerKeysProcedures(seams: ProviderKeysProcedureSeams) {
  const brake = makeRateBrake(SAVE_BRAKE);
  const keyed = hosted.account.use(accountMiddleware(seams.resolveUserId)).use(keyRingMiddleware);
  return {
    providerKeys: keyed.providerKeys.effect(function* ({ context }) {
      return yield* keysAnswer(context.userId, context.ring);
    }),

    /** A save: braked, checked with the provider, and kept sealed only where the provider accepts it. */
    saveProviderKey: keyed.saveProviderKey.effect(function* ({ context, input }) {
      const { userId, ring } = context;
      // Note that a refusal's wording is never logged or answered, because it may quote the key.
      const { provider } = input;
      const key = Redacted.make(input.key);
      if (!(yield* brake.check(userId))) {
        return yield* keysAnswer(userId, ring, PROVIDER_KEY_REJECTION.TOO_MANY_TRIES);
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
      if (checked !== PROVIDER_KEY_CHECK.ACCEPTED) return yield* keysAnswer(userId, ring, checked);
      const sealed = sealProviderKey(ring, { userId, provider }, key);
      const now = yield* DateTime.nowAsDate;
      yield* hostedStoreOrUnavailable(
        saveProviderKey(userId, provider, sealed, providerKeyHint(key), fastAccess ?? null, now),
      );
      return yield* keysAnswer(userId, ring);
    }),

    /** One provider's key removed, by the provider the query names. */
    removeProviderKey: keyed.removeProviderKey.effect(function* ({ context, input }) {
      yield* hostedStoreOrUnavailable(removeProviderKey(context.userId, input.query.provider));
      return yield* keysAnswer(context.userId, context.ring);
    }),
  };
}
