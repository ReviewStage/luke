import { dropChatGptDeviceLogin } from "@repo/database/models/chatgpt-device-login-store";
import {
  type KeyRing,
  openProviderKey,
  sealProviderKey,
} from "@repo/database/models/provider-key-seal";
import {
  listProviderKeyRows,
  removeProviderKey,
  saveProviderKey,
  setProviderKeyForAgents,
} from "@repo/database/models/provider-key-store";
import {
  CHATGPT_DEVICE_FAILURE_MESSAGE,
  CHATGPT_DEVICE_LOGIN,
  type ChatGptDeviceLoginOutcome,
  type ChatGptDevicePollAnswer,
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeyKind,
  type ProviderKeyProvider,
  type ProviderKeyRejection,
  type ProviderKeySummary,
  planStanding,
  SUBSCRIPTION_KIND_PROVIDER,
  type SubscriptionKeySummary,
} from "@repo/features/provider-key-wire";
import { Clock, DateTime, Duration, Effect, Option, Redacted, Result } from "effect";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { makeRateBrake } from "../http/rate-brake.js";
import { accountMiddleware, hosted, keyRingMiddleware } from "../orpc/base.js";
import {
  checkFastAccess,
  checkProviderKey,
  PROVIDER_KEY_CHECK,
  providerKeyHint,
} from "../providers/provider-key-check.js";
import {
  chatGptSigningKeys,
  dropRetiredChatGptCredentials,
  removeChatGptCredentials,
  retiredChatGptRow,
} from "./chatgpt-credentials.js";
import { pollChatGptDeviceLogin, startChatGptDeviceLogin } from "./chatgpt-device-login.js";

const SAVE_BRAKE = {
  windowMs: Duration.toMillis(Duration.hours(1)),
  maxRequestsPerWindow: 10,
  maxTrackedUsers: 10_000,
} as const;

const DEVICE_POLL_BRAKE = {
  windowMs: Duration.toMillis(Duration.minutes(1)),
  maxRequestsPerWindow: 30,
  maxTrackedUsers: 10_000,
} as const;

export interface ProviderKeysProcedureSeams {
  resolveUserId: UserIdResolver;
}

const SUBSCRIPTION_KINDS = Object.values(PROVIDER_KEY_KIND).filter(
  (kind) => kind !== PROVIDER_KEY_KIND.API_KEY,
);

const CLAUDE_SETUP_TOKEN_PREFIX = "sk-ant-oat";

const summariesOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  kind: ProviderKeyKind,
  ring: KeyRing,
) {
  const listed = yield* hostedStoreOrUnavailable(listProviderKeyRows(userId, kind));
  const retired =
    kind === PROVIDER_KEY_KIND.CHATGPT_OAUTH &&
    listed.some((row) => retiredChatGptRow(ring, userId, row));
  if (retired) yield* hostedStoreOrUnavailable(dropRetiredChatGptCredentials(userId, ring));
  const rows = retired ? [] : listed;
  const now = yield* Clock.currentTimeMillis;
  return rows.map((row) => {
    const readable = Result.isSuccess(
      openProviderKey(ring, { userId, provider: row.provider, kind }, row),
    );
    const status = readable ? planStanding(row, now) : PROVIDER_KEY_STATUS.UNREADABLE;
    const summary: ProviderKeySummary = {
      provider: row.provider,
      hint: row.hint,
      addedAt: row.createdAt.getTime(),
      status,
      statusAt: row.statusAt.getTime(),
      ...(status === PROVIDER_KEY_STATUS.LIMIT_REACHED && row.limitResetsAt !== null
        ? { limitResetsAt: row.limitResetsAt.getTime() }
        : undefined),
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

function deviceAnswerOf(outcome: ChatGptDeviceLoginOutcome): ChatGptDevicePollAnswer {
  switch (outcome) {
    case CHATGPT_DEVICE_LOGIN.PENDING:
    case CHATGPT_DEVICE_LOGIN.CONNECTED:
      return { outcome };
    default:
      return { outcome, message: CHATGPT_DEVICE_FAILURE_MESSAGE[outcome] };
  }
}

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
      return PROVIDER_KEY_REJECTION.INVALID;
  }
}

export function providerKeysProcedures(seams: ProviderKeysProcedureSeams) {
  const brake = makeRateBrake(SAVE_BRAKE);
  const pollBrake = makeRateBrake(DEVICE_POLL_BRAKE);
  const signingKeys = chatGptSigningKeys();
  const keyed = hosted.account.use(accountMiddleware(seams.resolveUserId)).use(keyRingMiddleware);
  return {
    providerKeys: keyed.providerKeys.effect(function* ({ context }) {
      return yield* keysAnswer(context.userId, context.ring);
    }),

    saveProviderKey: keyed.saveProviderKey.effect(function* ({ context, input }) {
      const { userId, ring } = context;
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
        yield* recordServerEvent(SERVER_EVENT.PROVIDER_KEY_CREATE, { userId }, { provider });
        return yield* keysAnswer(userId, ring);
      }
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
      yield* recordServerEvent(SERVER_EVENT.PROVIDER_KEY_CREATE, { userId }, { provider });
      return yield* keysAnswer(userId, ring);
    }),

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

    setProviderKeyForAgents: keyed.setProviderKeyForAgents.effect(function* ({ context, input }) {
      const { userId, ring } = context;
      yield* hostedStoreOrUnavailable(
        setProviderKeyForAgents(userId, input.provider, input.kind, input.forAgents),
      );
      return yield* keysAnswer(userId, ring);
    }),

    startChatGptDeviceLogin: keyed.startChatGptDeviceLogin.effect(function* ({ context }) {
      const { userId, ring } = context;
      if (!(yield* brake.check(userId))) return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);
      const started = yield* hostedStoreOrUnavailable(startChatGptDeviceLogin(userId, ring));
      if (Option.isNone(started)) return yield* Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR);
      return started.value;
    }),

    pollChatGptDeviceLogin: keyed.pollChatGptDeviceLogin.effect(function* ({ context, input }) {
      const { userId, ring } = context;
      if (!(yield* pollBrake.check(userId))) {
        return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);
      }
      const polled = yield* hostedStoreOrUnavailable(
        pollChatGptDeviceLogin({ userId, loginId: input.loginId }, ring, signingKeys),
      );
      if (polled.connectedNow) {
        yield* recordServerEvent(
          SERVER_EVENT.PROVIDER_KEY_CREATE,
          { userId },
          { provider: PROVIDER_KEY_PROVIDER.OPENAI },
        );
      }
      const answered = deviceAnswerOf(polled.outcome);
      if (polled.outcome !== CHATGPT_DEVICE_LOGIN.CONNECTED) return answered;
      return { ...answered, keys: yield* keysAnswer(userId, ring) };
    }),

    cancelChatGptDeviceLogin: keyed.cancelChatGptDeviceLogin.effect(function* ({ context, input }) {
      const { userId } = context;
      if (!(yield* pollBrake.check(userId))) {
        return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);
      }
      yield* hostedStoreOrUnavailable(dropChatGptDeviceLogin({ userId, loginId: input.loginId }));
      return deviceAnswerOf(CHATGPT_DEVICE_LOGIN.CANCELED);
    }),
  };
}
