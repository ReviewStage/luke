/**
 * chatgpt-device-login.ts -- connecting an account's ChatGPT plan through Codex's own device-code login, run by the service one step at a time as the panel asks.
 *
 * Codex's device-code login works on every plan that has Codex, Business
 * included. The service runs it as Codex runs it: a start asks
 * OpenAI for a user code under Codex's client, and the account enters it
 * at OpenAI's verification page; each poll asks OpenAI once whether the
 * code was entered (a 403 or a 404 is still pending), and once it was,
 * exchanges the authorization code OpenAI answered, with the PKCE verifier
 * it answered beside it, for the account's tokens. A Vercel function lives
 * too briefly to wait out the fifteen minutes a code stands, so the panel
 * drives the polling.
 *
 * The device authorization and its user code, which together claim the
 * sign-in, stay on the service, sealed on the account's one pending login
 * (`@repo/database/models/chatgpt-device-login-store`), and the panel holds
 * only the login's opaque id. A poll runs under the login's row lock, so two
 * polls at once never exchange one authorization code twice, and a settled
 * login answers how it settled to every poll after.
 *
 * A login is kept only once its ID token checks out against OpenAI's
 * published keys under Codex's client (`verifyCodexDeviceIdToken`), and it
 * is kept on the account's `chatgpt_oauth` row, replacing whichever ChatGPT
 * sign-in it held, so payer choice, statuses, limits, and the sweep read it
 * as they read any. An exchange is never retried: a lost answer may have
 * spent the code, so it settles the login refused, and the account starts
 * again.
 *
 * A failure is answered as one of a fixed set, and no token, code, or
 * OpenAI's words are ever logged or answered.
 */

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

/** How long OpenAI takes a user code, as Codex gives up after it. */
const DEVICE_CODE_LIFETIME = Duration.minutes(15);

/** How often the panel polls where OpenAI named no interval, and the least it is told to wait between polls. */
const POLL_INTERVAL_SECONDS = { DEFAULT: 5, MIN: 1 } as const;

/** The statuses a code poll answers that say the code is not entered yet, as Codex reads them. */
const PENDING_STATUSES: ReadonlySet<number> = new Set([
  HTTP_STATUS.FORBIDDEN,
  HTTP_STATUS.NOT_FOUND,
]);

/** The bounds of a success, and where a server's own failure begins. */
const STATUS_RANGE = { OK_MIN: 200, OK_MAX: 299, SERVER_ERROR: 500 } as const;

/** OpenAI's answer to a user-code request, as Codex reads it: its interval a string of seconds. */
const UserCodeAnswerSchema = Schema.Struct({
  device_auth_id: Schema.NonEmptyString,
  user_code: Schema.optionalKey(Schema.NonEmptyString),
  usercode: Schema.optionalKey(Schema.NonEmptyString),
  interval: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
});

/** OpenAI's answer once the code was entered: the authorization code and the PKCE pair it was issued for. */
const CodeAnswerSchema = Schema.Struct({
  authorization_code: Schema.NonEmptyString,
  code_challenge: Schema.String,
  code_verifier: Schema.NonEmptyString,
});

/** The token endpoint's answer to the exchange, as far as it is read. */
const ExchangeAnswerSchema = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.NonEmptyString,
  id_token: Schema.NonEmptyString,
  expires_in: Schema.optionalKey(Schema.Number.check(Schema.isGreaterThan(0))),
});

/** What a pending login's seal holds, as JSON: the two values that together claim the sign-in. */
const DeviceCodesJson = Schema.fromJsonString(
  Schema.Struct({ deviceAuthId: Schema.String, userCode: Schema.String }),
);

/** What a start answers: the login to poll and the code to enter, or nothing where OpenAI issued none. */
export interface ChatGptDeviceStart {
  readonly loginId: string;
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly intervalSeconds: number;
  readonly expiresAt: number;
}

/** What a poll answers: how the login stands, and whether this poll is the one that connected it. */
export interface ChatGptDevicePoll {
  readonly outcome: ChatGptDeviceLoginOutcome;
  readonly connectedNow: boolean;
}

/** The seconds OpenAI named between polls, or the default where it named none that reads as a count. */
function intervalOf(interval: string | number | undefined): number {
  const seconds = typeof interval === "string" ? Number(interval.trim()) : interval;
  if (seconds === undefined || !Number.isInteger(seconds) || seconds <= 0) {
    return POLL_INTERVAL_SECONDS.DEFAULT;
  }
  return Math.max(seconds, POLL_INTERVAL_SECONDS.MIN);
}

/** Whether a status is a success. */
const succeeded = (status: number) =>
  status >= STATUS_RANGE.OK_MIN && status <= STATUS_RANGE.OK_MAX;

/**
 * Begins a device-code connection for the account: asks OpenAI for a user
 * code under Codex's client and keeps what claims the sign-in sealed on
 * the account's pending login, replacing any it held. None where OpenAI
 * could not be asked or answered no code.
 */
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

/**
 * The account's tokens for an entered code: the authorization code
 * exchanged under Codex's client with the verifier OpenAI answered beside
 * it, in the form Codex sends, and its ID token checked. Settles where it
 * cannot, since an exchange is never sent twice.
 */
const exchangeCode = /* @__PURE__ */ Effect.fnUntraced(function* (
  code: typeof CodeAnswerSchema.Type,
  cache: ChatGptSigningKeys,
) {
  // The authorization code and its verifier are revealed here alone, into the one form OpenAI reads them from.
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

/**
 * One check of the account's device-code login, under its row's lock: how
 * it settled, where it did; expired once its code lapsed; still pending
 * while OpenAI says the code is not entered, or could not answer; and
 * otherwise connected, its credentials kept on the account's ChatGPT row,
 * or refused. A login that is not the account's, or no longer stands, reads
 * as canceled.
 */
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
      // The device authorization and its code are revealed here alone, into the one body OpenAI reads them from.
      const polled = yield* postToOpenAi(CODEX_DEVICE_OAUTH.CODE_POLL_URL, {
        json: { device_auth_id: codes.value.deviceAuthId, user_code: codes.value.userCode },
      });
      if (Option.isNone(polled)) return answer(CHATGPT_DEVICE_LOGIN.PENDING);
      const { status, body } = polled.value;
      // Note that a throttle or a server error is asked again at the next poll, as a code not entered yet is.
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
