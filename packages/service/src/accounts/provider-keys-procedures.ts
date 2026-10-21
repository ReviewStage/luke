/**
 * provider-keys-procedures.ts -- the account's own Anthropic and OpenAI API keys and subscription credentials: read what they are, save one, remove one.
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
 * A request may name a kind (`provider-key-wire.ts`'s `PROVIDER_KEY_KIND`);
 * one that names none is an API key's, as every desktop before kinds sends.
 * A subscription credential, a Claude setup-token, is braked and sealed as
 * a key is but never sent to its provider: it is kept unverified, and a
 * credential spelled as no credential of its kind is refused as invalid.
 * Until a provider's API key and subscription may stand side by side, a
 * save of one kind where the provider holds the other is refused and
 * replaces nothing. The answer's `keys` are API keys alone, and the
 * subscriptions stand apart beside them.
 *
 * A ChatGPT sign-in (`chatgpt_oauth`) is the one credential that is not a
 * pasted key: the desktop hands it over on its own route, after signing in
 * under the account's host id, which a route of its own mints once and
 * serves. It is braked and sealed as a key is and never sent to OpenAI on
 * its save, though its ID token is checked against OpenAI's published keys
 * and must name the issued client and the account handed over; removing it revokes its renewable session at OpenAI first
 * (`chatgpt-credentials.ts`), and the answer says where OpenAI did not
 * confirm that.
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
  setProviderKeyForAgents,
} from "@luke/database/models/provider-key-store";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeyKind,
  type ProviderKeyProvider,
  type ProviderKeyRejection,
  type ProviderKeySummary,
  SUBSCRIPTION_KIND_PROVIDER,
  type SubscriptionKeySummary,
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
import {
  CHATGPT_ID_TOKEN,
  chatGptCredentialsRefusal,
  chatGptHostId,
  chatGptSigningKeys,
  removeChatGptCredentials,
  sealChatGptCredentials,
  verifyChatGptIdToken,
} from "./chatgpt-credentials.js";

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

/** The kinds a subscription credential is, every kind but the API key. */
const SUBSCRIPTION_KINDS = Object.values(PROVIDER_KEY_KIND).filter(
  (kind) => kind !== PROVIDER_KEY_KIND.API_KEY,
);

/** Every Claude setup-token's own prefix, an OAuth token's, which no API key carries. */
const CLAUDE_SETUP_TOKEN_PREFIX = "sk-ant-oat";

/** The account's credentials of one kind as it is shown them, each one the ring cannot open answered unreadable. */
const summariesOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  kind: ProviderKeyKind,
  ring: KeyRing,
) {
  const rows = yield* hostedStoreOrUnavailable(listProviderKeyRows(userId, kind));
  return rows.map((row) => {
    const readable = Result.isSuccess(
      openProviderKey(ring, { userId, provider: row.provider, kind }, row),
    );
    const summary: ProviderKeySummary = {
      provider: row.provider,
      hint: row.hint,
      addedAt: row.createdAt.getTime(),
      status: readable ? row.status : PROVIDER_KEY_STATUS.UNREADABLE,
      statusAt: row.statusAt.getTime(),
    };
    return { summary, forAgents: row.forAgents };
  });
});

const keysAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  rejected?: ProviderKeyRejection,
  revocationUnconfirmed = false,
) {
  const keys = (yield* summariesOf(userId, PROVIDER_KEY_KIND.API_KEY, ring)).map(
    (read) => read.summary,
  );
  const subscriptions: SubscriptionKeySummary[] = [];
  for (const kind of SUBSCRIPTION_KINDS) {
    for (const { summary, forAgents } of yield* summariesOf(userId, kind, ring)) {
      subscriptions.push({ ...summary, kind, forAgents });
    }
  }
  return {
    keys,
    ...(subscriptions.length === 0 ? undefined : { subscriptions }),
    ...(rejected === undefined ? undefined : { rejected }),
    ...(revocationUnconfirmed ? { revocationUnconfirmed: true as const } : undefined),
  };
});

/** Whether a subscription credential is saved for the provider its kind belongs to and spelled as one of its kind; nothing is asked of the provider. */
function subscriptionShapeOf(
  provider: ProviderKeyProvider,
  kind: Exclude<ProviderKeyKind, typeof PROVIDER_KEY_KIND.API_KEY>,
  key: Redacted.Redacted<string>,
): ProviderKeyRejection | undefined {
  if (SUBSCRIPTION_KIND_PROVIDER[kind] !== provider) return PROVIDER_KEY_REJECTION.WRONG_PROVIDER;
  switch (kind) {
    case PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN:
      return Redacted.value(key).startsWith(CLAUDE_SETUP_TOKEN_PREFIX)
        ? undefined
        : PROVIDER_KEY_REJECTION.INVALID;
    case PROVIDER_KEY_KIND.CHATGPT_OAUTH:
      // A ChatGPT sign-in is handed over whole on its own route, never pasted as a key.
      return PROVIDER_KEY_REJECTION.INVALID;
  }
}

/** The provider keys' procedures, braked per instance, each to a signed-in caller on a deployment that holds a ring. */
export function providerKeysProcedures(seams: ProviderKeysProcedureSeams) {
  const brake = makeRateBrake(SAVE_BRAKE);
  const signingKeys = chatGptSigningKeys();
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
      const kind = input.kind ?? PROVIDER_KEY_KIND.API_KEY;
      const key = Redacted.make(input.key);
      if (!(yield* brake.check(userId))) {
        return yield* keysAnswer(userId, ring, PROVIDER_KEY_REJECTION.TOO_MANY_TRIES);
      }
      if (kind !== PROVIDER_KEY_KIND.API_KEY) {
        const refused = subscriptionShapeOf(provider, kind, key);
        if (refused !== undefined) return yield* keysAnswer(userId, ring, refused);
        const now = yield* DateTime.nowAsDate;
        const sealed = sealProviderKey(ring, { userId, provider, kind }, key);
        yield* hostedStoreOrUnavailable(
          saveProviderKey(userId, provider, kind, sealed, providerKeyHint(key), null, now),
        );
        return yield* keysAnswer(userId, ring);
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
      const sealed = sealProviderKey(ring, { userId, provider, kind }, key);
      const now = yield* DateTime.nowAsDate;
      yield* hostedStoreOrUnavailable(
        saveProviderKey(
          userId,
          provider,
          kind,
          sealed,
          providerKeyHint(key),
          fastAccess ?? null,
          now,
        ),
      );
      return yield* keysAnswer(userId, ring);
    }),

    /** One provider's credential removed, by the provider and the kind the query names; an API key where it names none. A ChatGPT sign-in is revoked at OpenAI first. */
    removeProviderKey: keyed.removeProviderKey.effect(function* ({ context, input }) {
      const { userId, ring } = context;
      const kind = input.query.kind ?? PROVIDER_KEY_KIND.API_KEY;
      if (
        kind === PROVIDER_KEY_KIND.CHATGPT_OAUTH &&
        input.query.provider === SUBSCRIPTION_KIND_PROVIDER[kind]
      ) {
        const confirmed = yield* hostedStoreOrUnavailable(removeChatGptCredentials(userId, ring));
        return yield* keysAnswer(userId, ring, undefined, !confirmed);
      }
      yield* hostedStoreOrUnavailable(removeProviderKey(userId, input.query.provider, kind));
      return yield* keysAnswer(userId, ring);
    }),

    /** A connected plan's default for the account's coding agents turned on or off; a plan the account does not hold changes nothing. */
    setProviderKeyForAgents: keyed.setProviderKeyForAgents.effect(function* ({ context, input }) {
      const { userId, ring } = context;
      yield* hostedStoreOrUnavailable(
        setProviderKeyForAgents(userId, input.provider, input.kind, input.forAgents),
      );
      return yield* keysAnswer(userId, ring);
    }),

    /** The account's ChatGPT host id, minted on its first read and the same on every read after it. */
    chatGptHost: keyed.chatGptHost.effect(function* ({ context }) {
      const extAgentHostId = yield* hostedStoreOrUnavailable(chatGptHostId(context.userId));
      return { extAgentHostId };
    }),

    /** A ChatGPT sign-in the desktop completed, braked, its ID token checked against OpenAI's published keys, and kept sealed, replacing the one the account held; no credential is sent to OpenAI. */
    saveChatGptCredentials: keyed.saveChatGptCredentials.effect(function* ({ context, input }) {
      const { userId, ring } = context;
      // Note that nothing of the body is ever logged or answered, because every field but the scopes is a credential or names one.
      if (!(yield* brake.check(userId))) {
        return yield* keysAnswer(userId, ring, PROVIDER_KEY_REJECTION.TOO_MANY_TRIES);
      }
      const refused = chatGptCredentialsRefusal(input);
      if (refused !== undefined) return yield* keysAnswer(userId, ring, refused);
      const checked = yield* verifyChatGptIdToken(input, signingKeys);
      if (checked === CHATGPT_ID_TOKEN.UNVERIFIED) {
        return yield* keysAnswer(userId, ring, PROVIDER_KEY_REJECTION.UNVERIFIED_SIGN_IN);
      }
      if (checked === CHATGPT_ID_TOKEN.UNREACHABLE) {
        return yield* keysAnswer(userId, ring, PROVIDER_KEY_REJECTION.UNREACHABLE);
      }
      const now = yield* DateTime.nowAsDate;
      const { sealed, accessExpiresAt, hint } = sealChatGptCredentials(ring, userId, input, now);
      yield* hostedStoreOrUnavailable(
        saveProviderKey(
          userId,
          PROVIDER_KEY_PROVIDER.OPENAI,
          PROVIDER_KEY_KIND.CHATGPT_OAUTH,
          sealed,
          hint,
          null,
          now,
          accessExpiresAt,
        ),
      );
      return yield* keysAnswer(userId, ring);
    }),
  };
}
