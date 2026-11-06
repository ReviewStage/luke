import { randomUUID } from "node:crypto";
import {
  beginChatGptDeviceLogin,
  settleChatGptDeviceLogin,
  withChatGptDeviceLoginLocked,
} from "@repo/database/models/chatgpt-device-login-store";
import {
  type DeviceLoginOwner,
  type KeyRing,
  openChatGptDeviceCodes,
  sealChatGptDeviceCodes,
} from "@repo/database/models/provider-key-seal";
import { saveProviderKey } from "@repo/database/models/provider-key-store";
import {
  CHATGPT_DEVICE_LOGIN,
  type ChatGptDeviceLoginOutcome,
  type ChatGptDeviceSettled,
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
} from "@repo/features/provider-key-wire";
import { HTTP_STATUS } from "@repo/wire";
import { DateTime, Duration, Effect, Option, Redacted, Result, Schema } from "effect";
import {
  CHATGPT_ID_TOKEN,
  type ChatGptSigningKeys,
  CODEX_DEVICE_OAUTH,
  codexAccessExpiryOf,
  postToOpenAi,
  sealCodexDeviceCredentials,
  verifyCodexDeviceIdToken,
} from "./chatgpt-credentials.js";

const DEVICE_CODE_LIFETIME = Duration.minutes(15);

const POLL_INTERVAL_SECONDS = { DEFAULT: 5, MIN: 1 } as const;

const PENDING_STATUSES: ReadonlySet<number> = new Set([
  HTTP_STATUS.FORBIDDEN,
  HTTP_STATUS.NOT_FOUND,
]);

const STATUS_RANGE = { OK_MIN: 200, OK_MAX: 299, SERVER_ERROR: 500 } as const;

const UserCodeAnswerSchema = Schema.Struct({
  device_auth_id: Schema.NonEmptyString,
  user_code: Schema.optionalKey(Schema.NonEmptyString),
  usercode: Schema.optionalKey(Schema.NonEmptyString),
  interval: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
});

const CodeAnswerSchema = Schema.Struct({
  authorization_code: Schema.NonEmptyString,
  code_challenge: Schema.String,
  code_verifier: Schema.NonEmptyString,
});

const ExchangeAnswerSchema = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.NonEmptyString,
  id_token: Schema.NonEmptyString,
  expires_in: Schema.optionalKey(Schema.Number.check(Schema.isGreaterThan(0))),
});

const DeviceCodesJson = Schema.fromJsonString(
  Schema.Struct({ deviceAuthId: Schema.String, userCode: Schema.String }),
);

export interface ChatGptDeviceStart {
  readonly loginId: string;
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly intervalSeconds: number;
  readonly expiresAt: number;
}

export interface ChatGptDevicePoll {
  readonly outcome: ChatGptDeviceLoginOutcome;
  readonly connectedNow: boolean;
}

function intervalOf(interval: string | number | undefined): number {
  const seconds = typeof interval === "string" ? Number(interval.trim()) : interval;
  if (seconds === undefined || !Number.isInteger(seconds) || seconds <= 0) {
    return POLL_INTERVAL_SECONDS.DEFAULT;
  }
  return Math.max(seconds, POLL_INTERVAL_SECONDS.MIN);
}

const succeeded = (status: number) =>
  status >= STATUS_RANGE.OK_MIN && status <= STATUS_RANGE.OK_MAX;

export const startChatGptDeviceLogin = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
) {
  const answered = yield* postToOpenAi(CODEX_DEVICE_OAUTH.USER_CODE_URL, {
    json: { client_id: CODEX_DEVICE_OAUTH.CLIENT_ID },
  });
  if (Option.isNone(answered) || !succeeded(answered.value.status)) return Option.none();
  const issued = Schema.decodeUnknownOption(UserCodeAnswerSchema)(answered.value.body);
  if (Option.isNone(issued)) return Option.none();
  const userCode = issued.value.user_code ?? issued.value.usercode;
  if (userCode === undefined) return Option.none();
  const owner: DeviceLoginOwner = { userId, loginId: randomUUID() };
  const codes = Schema.encodeSync(DeviceCodesJson)({
    deviceAuthId: issued.value.device_auth_id,
    userCode,
  });
  const sealed = sealChatGptDeviceCodes(ring, owner, Redacted.make(codes));
  const now = yield* DateTime.nowAsDate;
  const expiresAt = new Date(now.getTime() + Duration.toMillis(DEVICE_CODE_LIFETIME));
  yield* beginChatGptDeviceLogin(owner, sealed, expiresAt, now);
  const start: ChatGptDeviceStart = {
    loginId: owner.loginId,
    userCode,
    verificationUrl: CODEX_DEVICE_OAUTH.VERIFICATION_URL,
    intervalSeconds: intervalOf(issued.value.interval),
    expiresAt: expiresAt.getTime(),
  };
  return Option.some(start);
});

const exchangeCode = /* @__PURE__ */ Effect.fnUntraced(function* (
  code: typeof CodeAnswerSchema.Type,
  cache: ChatGptSigningKeys,
) {
  const answered = yield* postToOpenAi(CODEX_DEVICE_OAUTH.TOKEN_URL, {
    form: {
      grant_type: "authorization_code",
      client_id: CODEX_DEVICE_OAUTH.CLIENT_ID,
      code: code.authorization_code,
      redirect_uri: CODEX_DEVICE_OAUTH.REDIRECT_URI,
      code_verifier: code.code_verifier,
    },
  });
  if (Option.isNone(answered) || !succeeded(answered.value.status)) return undefined;
  const tokens = Schema.decodeUnknownOption(ExchangeAnswerSchema)(answered.value.body);
  if (Option.isNone(tokens)) return undefined;
  const checked = yield* verifyCodexDeviceIdToken(tokens.value.id_token, cache);
  if (checked.verdict !== CHATGPT_ID_TOKEN.VERIFIED) return undefined;
  const now = yield* DateTime.nowAsDate;
  const accessExpiresAt = codexAccessExpiryOf(
    tokens.value.access_token,
    now,
    tokens.value.expires_in,
  );
  if (accessExpiresAt === undefined) return undefined;
  return {
    accessToken: tokens.value.access_token,
    refreshToken: tokens.value.refresh_token,
    idToken: tokens.value.id_token,
    accountId: checked.accountId,
    chatgptAccountId: checked.chatgptAccountId,
    accessExpiresAt,
  };
});

export const pollChatGptDeviceLogin = /* @__PURE__ */ Effect.fnUntraced(function* (
  owner: DeviceLoginOwner,
  ring: KeyRing,
  cache: ChatGptSigningKeys,
) {
  return yield* withChatGptDeviceLoginLocked(
    owner,
    Effect.fnUntraced(function* (locked) {
      const answer = (outcome: ChatGptDeviceLoginOutcome, connectedNow = false) =>
        ({ outcome, connectedNow }) satisfies ChatGptDevicePoll;
      const settle = (outcome: ChatGptDeviceSettled) =>
        Effect.as(settleChatGptDeviceLogin(owner, outcome), answer(outcome));
      if (Option.isNone(locked)) return answer(CHATGPT_DEVICE_LOGIN.CANCELED);
      const row = locked.value;
      if (row.outcome !== null) return answer(row.outcome);
      const now = yield* DateTime.nowAsDate;
      if (now.getTime() >= row.expiresAt.getTime()) {
        return yield* settle(CHATGPT_DEVICE_LOGIN.EXPIRED);
      }
      const opened =
        row.sealedCodes === null ? undefined : openChatGptDeviceCodes(ring, owner, row.sealedCodes);
      const codes =
        opened === undefined || Result.isFailure(opened)
          ? Option.none()
          : Schema.decodeUnknownOption(DeviceCodesJson)(Redacted.value(opened.success));
      if (Option.isNone(codes)) return yield* settle(CHATGPT_DEVICE_LOGIN.REFUSED);
      const polled = yield* postToOpenAi(CODEX_DEVICE_OAUTH.CODE_POLL_URL, {
        json: { device_auth_id: codes.value.deviceAuthId, user_code: codes.value.userCode },
      });
      if (Option.isNone(polled)) return answer(CHATGPT_DEVICE_LOGIN.PENDING);
      const { status, body } = polled.value;
      if (
        PENDING_STATUSES.has(status) ||
        status === HTTP_STATUS.TOO_MANY_REQUESTS ||
        status >= STATUS_RANGE.SERVER_ERROR
      ) {
        return answer(CHATGPT_DEVICE_LOGIN.PENDING);
      }
      const code = succeeded(status)
        ? Schema.decodeUnknownOption(CodeAnswerSchema)(body)
        : Option.none();
      if (Option.isNone(code)) return yield* settle(CHATGPT_DEVICE_LOGIN.REFUSED);
      const tokens = yield* exchangeCode(code.value, cache);
      if (tokens === undefined) return yield* settle(CHATGPT_DEVICE_LOGIN.REFUSED);
      const { sealed, hint } = sealCodexDeviceCredentials(ring, owner.userId, tokens);
      yield* saveProviderKey(
        owner.userId,
        PROVIDER_KEY_PROVIDER.OPENAI,
        PROVIDER_KEY_KIND.CHATGPT_OAUTH,
        sealed,
        hint,
        null,
        now,
        tokens.accessExpiresAt,
      );
      yield* settleChatGptDeviceLogin(owner, CHATGPT_DEVICE_LOGIN.CONNECTED);
      return answer(CHATGPT_DEVICE_LOGIN.CONNECTED, true);
    }),
  );
});
