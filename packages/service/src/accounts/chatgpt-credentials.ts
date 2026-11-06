import { createPublicKey, verify } from "node:crypto";
import {
  type KeyRing,
  openProviderKey,
  sealProviderKey,
} from "@repo/database/models/provider-key-seal";
import {
  type ProviderKeyRow,
  removeProviderKey,
  resealProviderKey,
  setProviderKeyStatus,
  withProviderKeyLocked,
} from "@repo/database/models/provider-key-store";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  planLimitResetsAt,
} from "@repo/features/provider-key-wire";
import { DateTime, Duration, Effect, Option, Redacted, Result, Schedule, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

const CHATGPT_FLOW = {
  CODEX_DEVICE: "codex_device",
  RETIRED_THIRD_PARTY: "third_party",
} as const;

export const CHATGPT_OAUTH = {
  ISSUER: "https://auth.openai.com",
  DISCOVERY_URL: "https://auth.openai.com/.well-known/openid-configuration",
} as const;

export const CODEX_DEVICE_OAUTH = {
  CLIENT_ID: "app_EMoamEEZ73f0CkXaXp7hrann",
  USER_CODE_URL: "https://auth.openai.com/api/accounts/deviceauth/usercode",
  CODE_POLL_URL: "https://auth.openai.com/api/accounts/deviceauth/token",
  VERIFICATION_URL: "https://auth.openai.com/codex/device",
  REDIRECT_URI: "https://auth.openai.com/deviceauth/callback",
  TOKEN_URL: "https://auth.openai.com/oauth/token",
  AUTH_CLAIM: "https://api.openai.com/auth",
} as const;

const REFRESH_MARGIN = Duration.minutes(10);

const CALL_TIMEOUT = Duration.seconds(10);

const REVOKE_RETRY = { WAIT: Duration.seconds(1), TIMES: 2 } as const;

const REVOKE_OUTCOME = {
  CONFIRMED: "confirmed",
  REFUSED: "refused",
  RETRY: "retry",
} as const;

type RevokeOutcome = (typeof REVOKE_OUTCOME)[keyof typeof REVOKE_OUTCOME];

const CHATGPT_HINT = "ChatGPT";

const UNUSABLE_REFRESH_ERRORS: ReadonlySet<string> = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
  "invalid_client",
]);

const HTTP_STATUS = { OK: 200, BAD_REQUEST: 400, SERVER_ERROR: 500 } as const;

const SealedCredentialsSchema = Schema.Struct({
  flow: Schema.Literal(CHATGPT_FLOW.CODEX_DEVICE),
  clientId: Schema.String,
  accountId: Schema.String,
  accessToken: Schema.String,
  refreshToken: Schema.String,
  idToken: Schema.String,
  scopes: Schema.Array(Schema.String),
  chatgptAccountId: Schema.optionalKey(Schema.String),
});

type SealedCredentials = typeof SealedCredentialsSchema.Type;

const SealedCredentialsJson = Schema.fromJsonString(SealedCredentialsSchema);

const RetiredSealJson = Schema.fromJsonString(
  Schema.Struct({ flow: Schema.optionalKey(Schema.Literal(CHATGPT_FLOW.RETIRED_THIRD_PARTY)) }),
);

const CodexRefreshAnswerSchema = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.optionalKey(Schema.NonEmptyString),
  id_token: Schema.optionalKey(Schema.NonEmptyString),
  expires_in: Schema.optionalKey(Schema.Number.check(Schema.isGreaterThan(0))),
});

const OAuthErrorSchema = Schema.Struct({ error: Schema.String });

const DiscoverySchema = Schema.Struct({ revocation_endpoint: Schema.String });

const KeysDiscoverySchema = Schema.Struct({ jwks_uri: Schema.String });

const SigningKeySchema = Schema.Struct({
  kid: Schema.String,
  kty: Schema.Literal("RSA"),
  n: Schema.String,
  e: Schema.String,
});

type SigningKey = typeof SigningKeySchema.Type;

const JwksSchema = Schema.Struct({ keys: Schema.Array(Schema.Unknown) });

const IdTokenHeaderJson = Schema.fromJsonString(
  Schema.Struct({ alg: Schema.String, kid: Schema.String }),
);

const AuthClaimSchema = Schema.Struct({
  chatgpt_account_id: Schema.optionalKey(Schema.NonEmptyString),
  chatgpt_plan_type: Schema.optionalKey(Schema.String),
});

const IdTokenClaimsJson = Schema.fromJsonString(
  Schema.Struct({
    iss: Schema.String,
    aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
    exp: Schema.Number,
    sub: Schema.NonEmptyString,
    [CODEX_DEVICE_OAUTH.AUTH_CLAIM]: Schema.optionalKey(AuthClaimSchema),
  }),
);

const AuthClaimJson = Schema.fromJsonString(
  Schema.Struct({ [CODEX_DEVICE_OAUTH.AUTH_CLAIM]: Schema.optionalKey(AuthClaimSchema) }),
);

const SIGNING_KEYS_CACHE_FOR = Duration.hours(1);

const ID_TOKEN_LEEWAY = Duration.minutes(5);

const AccessClaimsJson = Schema.fromJsonString(Schema.Struct({ exp: Schema.Number }));

function accessExpiryOf(accessToken: string, now: Date, expiresInSeconds: number): Date {
  const answered = now.getTime() + Duration.toMillis(Duration.seconds(expiresInSeconds));
  const payload = accessToken.split(".")[1];
  const claimed =
    payload === undefined
      ? Option.none()
      : Schema.decodeUnknownOption(AccessClaimsJson)(
          Buffer.from(payload, "base64url").toString("utf8"),
        );
  return new Date(
    Option.match(claimed, {
      onNone: () => answered,
      onSome: ({ exp }) => Math.min(answered, Duration.toMillis(Duration.seconds(exp))),
    }),
  );
}

export function codexAccessExpiryOf(
  accessToken: string,
  now: Date,
  expiresInSeconds: number | undefined,
): Date | undefined {
  if (expiresInSeconds !== undefined) return accessExpiryOf(accessToken, now, expiresInSeconds);
  const claimed = Schema.decodeUnknownOption(AccessClaimsJson)(jwtPart(accessToken, 1));
  return Option.getOrUndefined(
    Option.map(claimed, ({ exp }) => new Date(Duration.toMillis(Duration.seconds(exp)))),
  );
}

function chatgptAccountIdOf(idToken: string): string | undefined {
  const read = Schema.decodeUnknownOption(AuthClaimJson)(jwtPart(idToken, 1));
  return Option.getOrUndefined(read)?.[CODEX_DEVICE_OAUTH.AUTH_CLAIM]?.chatgpt_account_id;
}

function onIssuer(url: string): boolean {
  return URL.canParse(url) && new URL(url).origin === CHATGPT_OAUTH.ISSUER;
}

export const CHATGPT_ACCESS = {
  READY: "ready",
  NONE: "none",
  UNREADABLE: "unreadable",
  SIGNED_OUT: "signed_out",
  UNREACHABLE: "unreachable",
  LIMIT_REACHED: "limit_reached",
  INELIGIBLE: "ineligible",
} as const;

export interface ChatGptPlanIdentity {
  readonly chatgptAccountId: string | undefined;
}

export type ChatGptAccess =
  | {
      readonly outcome: typeof CHATGPT_ACCESS.READY;
      readonly accessToken: Redacted.Redacted<string>;
      readonly expiresAt: Date;
      readonly plan: ChatGptPlanIdentity;
    }
  | {
      readonly outcome: typeof CHATGPT_ACCESS.LIMIT_REACHED;
      readonly limitResetsAt: number;
    }
  | {
      readonly outcome: Exclude<
        (typeof CHATGPT_ACCESS)[keyof typeof CHATGPT_ACCESS],
        typeof CHATGPT_ACCESS.READY | typeof CHATGPT_ACCESS.LIMIT_REACHED
      >;
    };

export function chatGptPlanOf(access: ChatGptAccess): ChatGptPlanIdentity | undefined {
  return access.outcome === CHATGPT_ACCESS.READY ? access.plan : undefined;
}

function planOf(credentials: SealedCredentials): ChatGptPlanIdentity {
  return { chatgptAccountId: credentials.chatgptAccountId };
}

const OWNER_KIND = {
  provider: PROVIDER_KEY_PROVIDER.OPENAI,
  kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
} as const;

function sealCredentials(ring: KeyRing, userId: string, credentials: SealedCredentials) {
  const json = Schema.encodeSync(SealedCredentialsJson)(credentials);
  return sealProviderKey(ring, { userId, ...OWNER_KIND }, Redacted.make(json));
}

const RETIRED = "retired";

function openCredentials(
  ring: KeyRing,
  userId: string,
  row: ProviderKeyRow,
): SealedCredentials | typeof RETIRED | undefined {
  const opened = openProviderKey(ring, { userId, ...OWNER_KIND }, row);
  if (Result.isFailure(opened)) return undefined;
  const json = Redacted.value(opened.success);
  const credentials = Schema.decodeUnknownOption(SealedCredentialsJson)(json);
  if (Option.isSome(credentials)) return credentials.value;
  return Option.isSome(Schema.decodeUnknownOption(RetiredSealJson)(json)) ? RETIRED : undefined;
}

export function retiredChatGptRow(ring: KeyRing, userId: string, row: ProviderKeyRow): boolean {
  return openCredentials(ring, userId, row) === RETIRED;
}

export const dropRetiredChatGptCredentials = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
) {
  return yield* withProviderKeyLocked(
    userId,
    OWNER_KIND.provider,
    OWNER_KIND.kind,
    Effect.fnUntraced(function* (locked) {
      if (Option.isNone(locked) || !retiredChatGptRow(ring, userId, locked.value)) return false;
      yield* removeProviderKey(userId, OWNER_KIND.provider, OWNER_KIND.kind);
      return true;
    }),
  );
});

export interface CodexDeviceTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken: string;
  readonly accountId: string;
  readonly chatgptAccountId: string | undefined;
  readonly accessExpiresAt: Date;
}

export function sealCodexDeviceCredentials(
  ring: KeyRing,
  userId: string,
  tokens: CodexDeviceTokens,
) {
  const sealed = sealCredentials(ring, userId, {
    flow: CHATGPT_FLOW.CODEX_DEVICE,
    clientId: CODEX_DEVICE_OAUTH.CLIENT_ID,
    accountId: tokens.accountId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    scopes: [],
    ...(tokens.chatgptAccountId === undefined
      ? undefined
      : { chatgptAccountId: tokens.chatgptAccountId }),
  });
  return { sealed, hint: CHATGPT_HINT };
}

export const CHATGPT_ID_TOKEN = {
  VERIFIED: "verified",
  UNVERIFIED: "unverified",
  UNREACHABLE: "unreachable",
} as const;

export interface ChatGptSigningKeys {
  held: { readonly keys: readonly SigningKey[]; readonly readAt: number } | undefined;
}

export function chatGptSigningKeys(): ChatGptSigningKeys {
  return { held: undefined };
}

const readSigningKeys = /* @__PURE__ */ Effect.fnUntraced(function* () {
  const client = yield* HttpClient.HttpClient;
  const readJson = (url: string) =>
    client.get(url).pipe(
      Effect.flatMap((response) => response.json),
      Effect.scoped,
      Effect.timeout(CALL_TIMEOUT),
      Effect.option,
    );
  const discovered = Option.flatMap(
    yield* readJson(CHATGPT_OAUTH.DISCOVERY_URL),
    Schema.decodeUnknownOption(KeysDiscoverySchema),
  );
  if (Option.isNone(discovered) || !onIssuer(discovered.value.jwks_uri)) return Option.none();
  const published = Option.flatMap(
    yield* readJson(discovered.value.jwks_uri),
    Schema.decodeUnknownOption(JwksSchema),
  );
  return Option.map(published, ({ keys }) =>
    keys.flatMap((key) => Option.toArray(Schema.decodeUnknownOption(SigningKeySchema)(key))),
  );
});

function signedBy(token: string, key: SigningKey): boolean {
  const [header, payload, signature] = token.split(".");
  if (header === undefined || payload === undefined || signature === undefined) return false;
  try {
    const publicKey = createPublicKey({
      key: { kty: key.kty, n: key.n, e: key.e },
      format: "jwk",
    });
    return verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

function jwtPart(token: string, index: number): string | undefined {
  const part = token.split(".")[index];
  return part === undefined ? undefined : Buffer.from(part, "base64url").toString("utf8");
}

type IdTokenClaims = typeof IdTokenClaimsJson.Type;

type IdTokenCheck =
  | { readonly verdict: typeof CHATGPT_ID_TOKEN.VERIFIED; readonly claims: IdTokenClaims }
  | {
      readonly verdict: typeof CHATGPT_ID_TOKEN.UNVERIFIED | typeof CHATGPT_ID_TOKEN.UNREACHABLE;
    };

const checkIdToken = /* @__PURE__ */ Effect.fnUntraced(function* (
  idToken: string,
  clientId: string,
  cache: ChatGptSigningKeys,
) {
  const unverified: IdTokenCheck = { verdict: CHATGPT_ID_TOKEN.UNVERIFIED };
  const header = Schema.decodeUnknownOption(IdTokenHeaderJson)(jwtPart(idToken, 0));
  const claims = Schema.decodeUnknownOption(IdTokenClaimsJson)(jwtPart(idToken, 1));
  if (Option.isNone(header) || Option.isNone(claims) || header.value.alg !== "RS256") {
    return unverified;
  }
  const { kid } = header.value;
  const now = (yield* DateTime.nowAsDate).getTime();
  const held = cache.held;
  const fresh =
    held !== undefined &&
    now - held.readAt < Duration.toMillis(SIGNING_KEYS_CACHE_FOR) &&
    held.keys.some((key) => key.kid === kid);
  let keys = fresh ? held.keys : undefined;
  if (keys === undefined) {
    const read = yield* readSigningKeys();
    if (Option.isNone(read)) {
      const unreachable: IdTokenCheck = { verdict: CHATGPT_ID_TOKEN.UNREACHABLE };
      return unreachable;
    }
    cache.held = { keys: read.value, readAt: now };
    keys = read.value;
  }
  const key = keys.find((one) => one.kid === kid);
  if (key === undefined || !signedBy(idToken, key)) return unverified;
  const { iss, aud, exp } = claims.value;
  const unexpired =
    Duration.toMillis(Duration.seconds(exp)) + Duration.toMillis(ID_TOKEN_LEEWAY) > now;
  if (iss !== CHATGPT_OAUTH.ISSUER || ![aud].flat().includes(clientId) || !unexpired) {
    return unverified;
  }
  const verified: IdTokenCheck = { verdict: CHATGPT_ID_TOKEN.VERIFIED, claims: claims.value };
  return verified;
});

export const verifyCodexDeviceIdToken = /* @__PURE__ */ Effect.fnUntraced(function* (
  idToken: string,
  cache: ChatGptSigningKeys,
) {
  const checked = yield* checkIdToken(idToken, CODEX_DEVICE_OAUTH.CLIENT_ID, cache);
  if (checked.verdict !== CHATGPT_ID_TOKEN.VERIFIED) return checked;
  const auth = checked.claims[CODEX_DEVICE_OAUTH.AUTH_CLAIM];
  return {
    verdict: checked.verdict,
    accountId: checked.claims.sub,
    chatgptAccountId: auth?.chatgpt_account_id,
  };
});

export type OpenAiBody =
  | { readonly form: Record<string, string> }
  | { readonly json: Record<string, string> };

export const postToOpenAi = /* @__PURE__ */ Effect.fnUntraced(function* (
  url: string,
  body: OpenAiBody,
) {
  const client = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.post(url).pipe(
    HttpClientRequest.setHeader("accept", "application/json"),
    "form" in body
      ? HttpClientRequest.bodyUrlParams(body.form)
      : HttpClientRequest.bodyJsonUnsafe(body.json),
  );
  return yield* client.execute(request).pipe(
    Effect.flatMap((response) =>
      Effect.map(
        Effect.orElseSucceed(response.json, () => undefined),
        (body) => ({ status: response.status, body }),
      ),
    ),
    Effect.scoped,
    Effect.timeout(CALL_TIMEOUT),
    Effect.option,
  );
});

function renewedFrom(
  credentials: SealedCredentials,
  body: unknown,
  now: Date,
): { readonly credentials: SealedCredentials; readonly expiresAt: Date } | undefined {
  const renewed = Schema.decodeUnknownOption(CodexRefreshAnswerSchema)(body);
  if (Option.isNone(renewed)) return undefined;
  const tokens = renewed.value;
  const expiresAt = codexAccessExpiryOf(tokens.access_token, now, tokens.expires_in);
  if (expiresAt === undefined) return undefined;
  const chatgptAccountId =
    (tokens.id_token === undefined ? undefined : chatgptAccountIdOf(tokens.id_token)) ??
    credentials.chatgptAccountId;
  return {
    credentials: {
      ...credentials,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? credentials.refreshToken,
      idToken: tokens.id_token ?? credentials.idToken,
      ...(chatgptAccountId === undefined ? undefined : { chatgptAccountId }),
    },
    expiresAt,
  };
}

export const refreshChatGptAccess = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  margin: Duration.Duration = REFRESH_MARGIN,
) {
  const access: ChatGptAccess = yield* withProviderKeyLocked(
    userId,
    OWNER_KIND.provider,
    OWNER_KIND.kind,
    Effect.fnUntraced(function* (locked) {
      if (Option.isNone(locked)) return { outcome: CHATGPT_ACCESS.NONE };
      const row = locked.value;
      if (row.status === PROVIDER_KEY_STATUS.INVALID) return { outcome: CHATGPT_ACCESS.SIGNED_OUT };
      if (row.status === PROVIDER_KEY_STATUS.INELIGIBLE)
        return { outcome: CHATGPT_ACCESS.INELIGIBLE };
      const credentials = openCredentials(ring, userId, row);
      if (credentials === undefined) return { outcome: CHATGPT_ACCESS.UNREADABLE };
      if (credentials === RETIRED) {
        yield* removeProviderKey(userId, OWNER_KIND.provider, OWNER_KIND.kind);
        return { outcome: CHATGPT_ACCESS.NONE };
      }
      const now = yield* DateTime.nowAsDate;
      const limitResetsAt = planLimitResetsAt(row, now.getTime());
      if (limitResetsAt !== undefined)
        return { outcome: CHATGPT_ACCESS.LIMIT_REACHED, limitResetsAt };
      const dueAt = now.getTime() + Duration.toMillis(Duration.max(margin, REFRESH_MARGIN));
      if (row.accessExpiresAt !== null && row.accessExpiresAt.getTime() > dueAt) {
        return {
          outcome: CHATGPT_ACCESS.READY,
          accessToken: Redacted.make(credentials.accessToken),
          expiresAt: row.accessExpiresAt,
          plan: planOf(credentials),
        };
      }
      const answered = yield* postToOpenAi(CODEX_DEVICE_OAUTH.TOKEN_URL, {
        json: {
          grant_type: "refresh_token",
          client_id: credentials.clientId,
          refresh_token: credentials.refreshToken,
        },
      });
      if (Option.isNone(answered)) return { outcome: CHATGPT_ACCESS.UNREACHABLE };
      const { status, body } = answered.value;
      if (status !== HTTP_STATUS.OK) {
        const error = Option.getOrUndefined(
          Option.map(Schema.decodeUnknownOption(OAuthErrorSchema)(body), (read) => read.error),
        );
        if (
          status >= HTTP_STATUS.BAD_REQUEST &&
          status < HTTP_STATUS.SERVER_ERROR &&
          error !== undefined &&
          UNUSABLE_REFRESH_ERRORS.has(error)
        ) {
          yield* setProviderKeyStatus(
            userId,
            OWNER_KIND.provider,
            row.sealedKey,
            PROVIDER_KEY_STATUS.INVALID,
            now,
          );
          return { outcome: CHATGPT_ACCESS.SIGNED_OUT };
        }
        return { outcome: CHATGPT_ACCESS.UNREACHABLE };
      }
      const renewed = renewedFrom(credentials, body, now);
      if (renewed === undefined) return { outcome: CHATGPT_ACCESS.UNREACHABLE };
      const { expiresAt } = renewed;
      const sealed = sealCredentials(ring, userId, renewed.credentials);
      yield* resealProviderKey(
        userId,
        OWNER_KIND.provider,
        OWNER_KIND.kind,
        row.sealedKey,
        sealed,
        expiresAt,
      );
      return {
        outcome: CHATGPT_ACCESS.READY,
        accessToken: Redacted.make(renewed.credentials.accessToken),
        expiresAt,
        plan: planOf(renewed.credentials),
      };
    }),
  );
  return access;
});

const revokeOnce = /* @__PURE__ */ Effect.fnUntraced(function* (
  credentials: SealedCredentials,
): Effect.fn.Return<RevokeOutcome, never, HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;
  const discovered = yield* client.get(CHATGPT_OAUTH.DISCOVERY_URL).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(DiscoverySchema)),
    Effect.scoped,
    Effect.timeout(CALL_TIMEOUT),
    Effect.option,
  );
  if (Option.isNone(discovered)) return REVOKE_OUTCOME.RETRY;
  if (!onIssuer(discovered.value.revocation_endpoint)) return REVOKE_OUTCOME.REFUSED;
  const answered = yield* postToOpenAi(discovered.value.revocation_endpoint, {
    form: {
      token: credentials.refreshToken,
      token_type_hint: "refresh_token",
      client_id: credentials.clientId,
    },
  });
  if (Option.isNone(answered)) return REVOKE_OUTCOME.RETRY;
  if (answered.value.status === HTTP_STATUS.OK) return REVOKE_OUTCOME.CONFIRMED;
  return answered.value.status >= HTTP_STATUS.SERVER_ERROR
    ? REVOKE_OUTCOME.RETRY
    : REVOKE_OUTCOME.REFUSED;
});

const revokeSession = (credentials: SealedCredentials) =>
  revokeOnce(credentials).pipe(
    Effect.repeat({
      schedule: Schedule.exponential(REVOKE_RETRY.WAIT),
      times: REVOKE_RETRY.TIMES,
      until: (tried) => tried !== REVOKE_OUTCOME.RETRY,
    }),
    Effect.map((tried) => tried === REVOKE_OUTCOME.CONFIRMED),
  );

export const removeChatGptCredentials = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
) {
  return yield* withProviderKeyLocked(
    userId,
    OWNER_KIND.provider,
    OWNER_KIND.kind,
    Effect.fnUntraced(function* (locked) {
      if (Option.isNone(locked)) return true;
      const credentials = openCredentials(ring, userId, locked.value);
      const confirmed =
        credentials === undefined
          ? false
          : credentials === RETIRED || (yield* revokeSession(credentials));
      yield* removeProviderKey(userId, OWNER_KIND.provider, OWNER_KIND.kind);
      return confirmed;
    }),
  );
});
