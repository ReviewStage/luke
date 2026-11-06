/**
 * chatgpt-credentials.ts -- an account's ChatGPT sign-in for our hosted runtime: kept sealed, its access renewed under the row's lock, and its renewable session revoked before it is removed.
 *
 * The desktop completes OpenAI's open-source Sign in with ChatGPT for the
 * service (OpenAI's self-hosted VM recipe) under the account's host id, and
 * hands over what the token endpoint answered. The service then owns the
 * sign-in, as the recipe asks: the tokens, the issued client and the
 * account's subject are sealed together as one `chatgpt_oauth` row's
 * credential (`provider-key-seal.ts`, bound to the kind), and the access
 * token's expiry stands beside the seal so a renewal is due without it
 * being opened.
 *
 * A renewal (`refreshChatGptAccess`) holds the row's lock across OpenAI's
 * token endpoint, as OpenAI's sessions guide asks renewals of one session
 * to be serialized, because each one rotates the refresh token: a second
 * caller waits, then reads the access token the first one stored and calls
 * nothing. A renewal replaces the access token, its expiry, the granted
 * scopes, and the refresh token together, and the ID token where one is
 * answered. A refusal that names the refresh token unusable marks the row
 * invalid and keeps it, so the account is asked to sign in again; any other
 * failure changes nothing and may be tried again.
 *
 * A renewal whose grant no longer carries the plan's scope is kept, since
 * it rotated the refresh token, and marks the row invalid as well. An access
 * token's expiry is the earlier of its lifetime and its own `exp` claim.
 *
 * A sign-in is kept only once its ID token checks out against OpenAI's
 * published keys (`verifyChatGptIdToken`): signed by OpenAI for the issued
 * client, unexpired, and naming the account handed over; and only where
 * its access token's own claims name the same issued client, OpenAI's API
 * as its audience, and OpenAI as its issuer. Those claims are read unsigned,
 * as a consistency check: OpenAI does not document which key signs the
 * access token, so its signature is left to be settled by a live run, and the
 * refresh token, which is opaque, is bound to the client by OpenAI itself at
 * the first renewal. The nonce is the desktop's to check, since only the
 * desktop that began the sign-in holds it.
 *
 * Removing the sign-in revokes its renewable session at OpenAI's revocation
 * endpoint, which must be on OpenAI's own authorization server, first, under the same lock, retrying a failure to connect or a
 * server error a few times, and removes the row whether or not OpenAI
 * confirmed it, answering which, so the account can be told to disconnect
 * the app in ChatGPT's settings.
 *
 * No token, code, or OpenAI's words of a refusal are ever logged or
 * answered: a refusal is read for its OAuth error code alone.
 */

import { createPublicKey, randomUUID, verify } from "node:crypto";
import {
  type KeyRing,
  openProviderKey,
  sealProviderKey,
} from "@repo/database/models/provider-key-seal";
import {
  ensureChatGptHostId,
  type ProviderKeyRow,
  removeProviderKey,
  resealProviderKey,
  setProviderKeyStatus,
  withProviderKeyLocked,
} from "@repo/database/models/provider-key-store";
import {
  type ChatGptCredentialsSaveRequest,
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  planLimitResetsAt,
} from "@repo/features/provider-key-wire";
import { DateTime, Duration, Effect, Option, Redacted, Result, Schedule, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

/**
 * How a ChatGPT plan was connected: through OpenAI's third-party Sign in
 * with ChatGPT, which the desktop completes and hands over, or through
 * Codex's own device-code login, which the service runs itself
 * (`chatgpt-device-login.ts`). A seal from before the flows were told
 * apart is the third party's.
 */
export const CHATGPT_FLOW = {
  THIRD_PARTY: "third_party",
  CODEX_DEVICE: "codex_device",
} as const;

export type ChatGptFlow = (typeof CHATGPT_FLOW)[keyof typeof CHATGPT_FLOW];

/** OpenAI's endpoints and the fixed values of the open-source flow, as its guides publish them. */
export const CHATGPT_OAUTH = {
  /** OpenAI's authorization server: no call that carries a credential goes anywhere else. */
  ISSUER: "https://auth.openai.com",
  TOKEN_URL: "https://auth.openai.com/api/accounts/oauth/token",
  /** Where the revocation endpoint is read from, as the sessions guide asks. */
  DISCOVERY_URL: "https://auth.openai.com/.well-known/openid-configuration",
  RESOURCE: "https://api.openai.com/v1",
  /** The first-registration client, which no saved sign-in may name as its own. */
  REGISTRATION_CLIENT_ID: "dynamic_agent_client",
  /** The scope without which a sign-in may not use the ChatGPT plan. */
  USAGE_SCOPE: "chatgpt.tokens.use.direct",
} as const;

/** OpenAI's endpoints and the fixed values of Codex's device-code login, as Codex itself runs it. */
export const CODEX_DEVICE_OAUTH = {
  /** Codex's own client, which every credential of the flow is issued to and renewed under. */
  CLIENT_ID: "app_EMoamEEZ73f0CkXaXp7hrann",
  USER_CODE_URL: "https://auth.openai.com/api/accounts/deviceauth/usercode",
  CODE_POLL_URL: "https://auth.openai.com/api/accounts/deviceauth/token",
  /** Where the account enters its code. */
  VERIFICATION_URL: "https://auth.openai.com/codex/device",
  /** The redirect the authorization code was issued for, named again at its exchange. */
  REDIRECT_URI: "https://auth.openai.com/deviceauth/callback",
  TOKEN_URL: "https://auth.openai.com/oauth/token",
  /** The ID token's claim that names the ChatGPT workspace and plan. */
  AUTH_CLAIM: "https://api.openai.com/auth",
} as const;

/** How long before its expiry an access token is renewed rather than handed out, unless a caller asks for longer. */
const REFRESH_MARGIN = Duration.minutes(10);

/** How long OpenAI is given to answer one call. */
const CALL_TIMEOUT = Duration.seconds(10);

/** The waits between revocation tries, after a failure to connect or a server error: a second, then two. */
const REVOKE_RETRY = { WAIT: Duration.seconds(1), TIMES: 2 } as const;

/** How one try at revoking ended: OpenAI confirmed it, refused it for good, or it is worth another try. */
const REVOKE_OUTCOME = {
  CONFIRMED: "confirmed",
  REFUSED: "refused",
  RETRY: "retry",
} as const;

type RevokeOutcome = (typeof REVOKE_OUTCOME)[keyof typeof REVOKE_OUTCOME];

/** The hint a ChatGPT sign-in is shown by: it has no key to show the end of. */
const CHATGPT_HINT = "ChatGPT";

/**
 * The OAuth error codes on a renewal that say the refresh token can never be
 * used again, or the client is not one OpenAI knows, per OpenAI's errors
 * guide: the sign-in must be done again.
 */
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

/**
 * What the seal of a `chatgpt_oauth` row holds, as JSON: the flow it was
 * connected through, a seal from before flows reading as the third
 * party's, and the ChatGPT workspace its ID token named, where it named one.
 */
const SealedCredentialsSchema = Schema.Struct({
  flow: Schema.Literals(Object.values(CHATGPT_FLOW)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(CHATGPT_FLOW.THIRD_PARTY)),
  ),
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

/**
 * The token endpoint's answer to a renewal of a Codex device-code
 * credential, as Codex reads it: every token optional, a token not
 * answered kept as it stands, but for the access token, without which a
 * renewal renews nothing.
 */
const CodexRefreshAnswerSchema = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.optionalKey(Schema.NonEmptyString),
  id_token: Schema.optionalKey(Schema.NonEmptyString),
  expires_in: Schema.optionalKey(Schema.Number.check(Schema.isGreaterThan(0))),
});

/** The token endpoint's answer to a renewal, as far as it is read. */
const RefreshAnswerSchema = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.NonEmptyString,
  expires_in: Schema.Number.check(Schema.isGreaterThan(0)),
  scope: Schema.optionalKey(Schema.String),
  id_token: Schema.optionalKey(Schema.NonEmptyString),
});

/** An OAuth refusal, read for its code alone. */
const OAuthErrorSchema = Schema.Struct({ error: Schema.String });

const DiscoverySchema = Schema.Struct({ revocation_endpoint: Schema.String });

const KeysDiscoverySchema = Schema.Struct({ jwks_uri: Schema.String });

/** One of OpenAI's published signing keys, as far as an RS256 check reads it. */
const SigningKeySchema = Schema.Struct({
  kid: Schema.String,
  kty: Schema.Literal("RSA"),
  n: Schema.String,
  e: Schema.String,
});

type SigningKey = typeof SigningKeySchema.Type;

/** OpenAI's JWKS: the keys of another type it may publish are passed over. */
const JwksSchema = Schema.Struct({ keys: Schema.Array(Schema.Unknown) });

const IdTokenHeaderJson = Schema.fromJsonString(
  Schema.Struct({ alg: Schema.String, kid: Schema.String }),
);

/** The ID token's ChatGPT claim, as far as it is read: the workspace and the plan. */
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

/** An ID token's ChatGPT claim alone, read unsigned from a token OpenAI's token endpoint answered the service itself. */
const AuthClaimJson = Schema.fromJsonString(
  Schema.Struct({ [CODEX_DEVICE_OAUTH.AUTH_CLAIM]: Schema.optionalKey(AuthClaimSchema) }),
);

/**
 * The access token's claims a save compares with the sign-in, unsigned:
 * OpenAI documents them but not which key signs the access token, so they
 * are checked for consistency and not trusted as proof.
 */
const AccessTokenClaimsJson = Schema.fromJsonString(
  Schema.Struct({
    iss: Schema.String,
    aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
    client_id: Schema.String,
  }),
);

/** How long OpenAI's published keys are reused before they are read again; a key they do not name is read again at once. */
const SIGNING_KEYS_CACHE_FOR = Duration.hours(1);

/** How far past its expiry an ID token is still taken, for the two clocks' difference. */
const ID_TOKEN_LEEWAY = Duration.minutes(5);

/** The one claim of an access token read: when it expires, in Unix seconds. */
const AccessClaimsJson = Schema.fromJsonString(Schema.Struct({ exp: Schema.Number }));

/**
 * When an access token expires: the earlier of the lifetime the token
 * endpoint answered, counted from `now`, and the token's own `exp` claim
 * where it carries one. The claim is read for scheduling alone, never
 * trusted for anything else, so a sign-in handed over late is never served
 * past the instant OpenAI set.
 */
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

/**
 * When a Codex device-code credential's access token expires: as
 * `accessExpiryOf` where the token endpoint answered a lifetime, else the
 * token's own `exp` claim, and none where it carries neither, which is no
 * token we can schedule a renewal of.
 */
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

/** The ChatGPT workspace an ID token's claim names, read unsigned, or none where it names none. */
function chatgptAccountIdOf(idToken: string): string | undefined {
  const read = Schema.decodeUnknownOption(AuthClaimJson)(jwtPart(idToken, 1));
  return Option.getOrUndefined(read)?.[CODEX_DEVICE_OAUTH.AUTH_CLAIM]?.chatgpt_account_id;
}

/** Whether a URL is on OpenAI's authorization server, over HTTPS. */
function onIssuer(url: string): boolean {
  return URL.canParse(url) && new URL(url).origin === CHATGPT_OAUTH.ISSUER;
}

/** What a renewal answers. */
export const CHATGPT_ACCESS = {
  /** An access token good for at least the renewal margin. */
  READY: "ready",
  /** The account holds no ChatGPT sign-in. */
  NONE: "none",
  /** The deployment's ring cannot open the sign-in it holds. */
  UNREADABLE: "unreadable",
  /** OpenAI refused the refresh token for good: the account must sign in again. */
  SIGNED_OUT: "signed_out",
  /** OpenAI could not be asked, or answered nothing usable; nothing changed and it may be tried again. */
  UNREACHABLE: "unreachable",
  /** An agent's turn found the plan's usage limit reached, and the reset it named, where it named one, has not passed. */
  LIMIT_REACHED: "limit_reached",
  /** OpenAI answered an agent's turn that the account is not eligible to run Codex on its plan. */
  INELIGIBLE: "ineligible",
} as const;

/** Which plan an access token pays from: the flow it was connected through, and the ChatGPT workspace its ID token named, where it named one. */
export interface ChatGptPlanIdentity {
  readonly flow: ChatGptFlow;
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
      /** When the reached limit resets, in epoch milliseconds, as the provider named it. */
      readonly limitResetsAt: number;
    }
  | {
      readonly outcome: Exclude<
        (typeof CHATGPT_ACCESS)[keyof typeof CHATGPT_ACCESS],
        typeof CHATGPT_ACCESS.READY | typeof CHATGPT_ACCESS.LIMIT_REACHED
      >;
    };

/** The plan a renewal's access token pays from, or none where the renewal answered no token. */
export function chatGptPlanOf(access: ChatGptAccess): ChatGptPlanIdentity | undefined {
  return access.outcome === CHATGPT_ACCESS.READY ? access.plan : undefined;
}

/** The plan opened credentials pay from. */
function planOf(credentials: SealedCredentials): ChatGptPlanIdentity {
  return { flow: credentials.flow, chatgptAccountId: credentials.chatgptAccountId };
}

const OWNER_KIND = {
  provider: PROVIDER_KEY_PROVIDER.OPENAI,
  kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
} as const;

function sealCredentials(ring: KeyRing, userId: string, credentials: SealedCredentials) {
  const json = Schema.encodeSync(SealedCredentialsJson)(credentials);
  return sealProviderKey(ring, { userId, ...OWNER_KIND }, Redacted.make(json));
}

/** The credentials a row seals, or nothing where the ring cannot open them or they are not a sign-in's. */
function openCredentials(
  ring: KeyRing,
  userId: string,
  row: ProviderKeyRow,
): SealedCredentials | undefined {
  const opened = openProviderKey(ring, { userId, ...OWNER_KIND }, row);
  if (Result.isFailure(opened)) return undefined;
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(SealedCredentialsJson)(Redacted.value(opened.success)),
  );
}

/** Why a third-party sign-in handed over is not kept, before anything is sealed; a Codex device-code login is never handed over, so never asked. */
export function chatGptCredentialsRefusal(
  request: ChatGptCredentialsSaveRequest,
): "invalid" | undefined {
  if (request.clientId === CHATGPT_OAUTH.REGISTRATION_CLIENT_ID) return "invalid";
  if (!request.scopes.includes(CHATGPT_OAUTH.USAGE_SCOPE)) return "invalid";
  return undefined;
}

/** The sign-in sealed for the account's row, with when its access token lapses and the hint it is shown by. */
export function sealChatGptCredentials(
  ring: KeyRing,
  userId: string,
  request: ChatGptCredentialsSaveRequest,
  now: Date,
) {
  const sealed = sealCredentials(ring, userId, {
    flow: CHATGPT_FLOW.THIRD_PARTY,
    clientId: request.clientId,
    accountId: request.accountId,
    accessToken: request.accessToken,
    refreshToken: request.refreshToken,
    idToken: request.idToken,
    scopes: request.scopes,
  });
  const accessExpiresAt = accessExpiryOf(request.accessToken, now, request.expiresInSeconds);
  return { sealed, accessExpiresAt, hint: CHATGPT_HINT };
}

/** The tokens Codex's device-code login answered the service, once its ID token checked out. */
export interface CodexDeviceTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken: string;
  /** The ID token's subject. */
  readonly accountId: string;
  readonly chatgptAccountId: string | undefined;
  readonly accessExpiresAt: Date;
}

/** A Codex device-code login's credentials sealed for the account's row, under Codex's client, with the hint it is shown by. */
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

/** What a sign-in's ID token check answers. */
export const CHATGPT_ID_TOKEN = {
  VERIFIED: "verified",
  /** Not signed by OpenAI for the issued client, expired, or another account's than the one handed over. */
  UNVERIFIED: "unverified",
  /** OpenAI's published keys could not be read; the same sign-in may be tried again. */
  UNREACHABLE: "unreachable",
} as const;

/** OpenAI's published signing keys as last read, kept per instance. */
export interface ChatGptSigningKeys {
  held: { readonly keys: readonly SigningKey[]; readonly readAt: number } | undefined;
}

/** An empty cache of OpenAI's signing keys, for one instance of the routes. */
export function chatGptSigningKeys(): ChatGptSigningKeys {
  return { held: undefined };
}

/** OpenAI's published signing keys, read through its discovery document; nothing where either cannot be read or the keys are off OpenAI's own server. */
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

/** Whether a JWT's RS256 signature verifies under a published key. */
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
    // Note that a key that is no RSA key, or a signature of the wrong size, is the one answer: not signed by it.
    return false;
  }
}

/** A JWT part decoded from base64url text, or nothing where it is none. */
function jwtPart(token: string, index: number): string | undefined {
  const part = token.split(".")[index];
  return part === undefined ? undefined : Buffer.from(part, "base64url").toString("utf8");
}

type IdTokenClaims = typeof IdTokenClaimsJson.Type;

/** An ID token's check: its claims where it checks out, or why it does not. */
type IdTokenCheck =
  | { readonly verdict: typeof CHATGPT_ID_TOKEN.VERIFIED; readonly claims: IdTokenClaims }
  | {
      readonly verdict: typeof CHATGPT_ID_TOKEN.UNVERIFIED | typeof CHATGPT_ID_TOKEN.UNREACHABLE;
    };

/**
 * An ID token checked as OpenAI's guide asks, all but its nonce: its RS256
 * signature against OpenAI's published keys, its issuer, its audience as the
 * client given, and its expiry. The keys are reused for an hour and read
 * again at once for a key they do not name.
 */
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

/**
 * The third-party sign-in checked before it is kept. Its access token's
 * unsigned claims must name the issued client, OpenAI's API and OpenAI; its
 * ID token is checked as `checkIdToken` checks one, under the issued client,
 * and its subject must be the account handed over. The nonce is the
 * desktop's, which only the desktop that began the sign-in holds.
 */
export const verifyChatGptIdToken = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: ChatGptCredentialsSaveRequest,
  cache: ChatGptSigningKeys,
) {
  const access = Schema.decodeUnknownOption(AccessTokenClaimsJson)(jwtPart(request.accessToken, 1));
  if (
    Option.isNone(access) ||
    access.value.iss !== CHATGPT_OAUTH.ISSUER ||
    access.value.client_id !== request.clientId ||
    ![access.value.aud].flat().includes(CHATGPT_OAUTH.RESOURCE)
  ) {
    return CHATGPT_ID_TOKEN.UNVERIFIED;
  }
  const checked = yield* checkIdToken(request.idToken, request.clientId, cache);
  if (checked.verdict !== CHATGPT_ID_TOKEN.VERIFIED) return checked.verdict;
  return checked.claims.sub === request.accountId
    ? CHATGPT_ID_TOKEN.VERIFIED
    : CHATGPT_ID_TOKEN.UNVERIFIED;
});

/**
 * A Codex device-code login's ID token checked before its credentials are
 * kept, as `checkIdToken` checks one, under Codex's client, answering the
 * account it names and the ChatGPT workspace its claim names. Note that its
 * access token's audience is not asked, because the service received it
 * from OpenAI's token endpoint itself rather than from a client.
 */
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

/** The account's ChatGPT host id, minted the first time it is asked for and the same ever after. */
export const chatGptHostId = /* @__PURE__ */ Effect.fnUntraced(function* (userId: string) {
  const now = yield* DateTime.nowAsDate;
  return yield* ensureChatGptHostId(userId, `urn:uuid:${randomUUID()}`, now);
});

/** What a POST to OpenAI carries: a form, as the OAuth endpoints read one, or JSON, as Codex sends its device-code calls and its renewals. */
export type OpenAiBody =
  | { readonly form: Record<string, string> }
  | { readonly json: Record<string, string> };

/** One POST to OpenAI, its status and its body read as JSON where it is JSON; nothing where no answer came. */
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
  // A request that failed or timed out is no answer, and its cause is dropped unread, since it may quote the form.
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

/**
 * The renewal OpenAI is asked for, by the flow the credentials were
 * connected through: the third party's form, naming OpenAI's API as its
 * resource, or Codex's JSON body under Codex's client, as Codex sends it.
 */
function renewalRequestOf(credentials: SealedCredentials): { url: string; body: OpenAiBody } {
  switch (credentials.flow) {
    case CHATGPT_FLOW.THIRD_PARTY:
      return {
        url: CHATGPT_OAUTH.TOKEN_URL,
        body: {
          form: {
            grant_type: "refresh_token",
            client_id: credentials.clientId,
            refresh_token: credentials.refreshToken,
            resource: CHATGPT_OAUTH.RESOURCE,
          },
        },
      };
    case CHATGPT_FLOW.CODEX_DEVICE:
      return {
        url: CODEX_DEVICE_OAUTH.TOKEN_URL,
        body: {
          json: {
            grant_type: "refresh_token",
            client_id: credentials.clientId,
            refresh_token: credentials.refreshToken,
          },
        },
      };
  }
}

/**
 * The credentials a renewal's answer replaces the ones it renewed with, and
 * when its access token expires; none where the answer is no renewal of
 * their flow. A third-party renewal replaces the refresh token and the
 * granted scopes; a Codex one keeps whichever token it did not answer, and
 * reads the ChatGPT workspace again from an ID token it answered.
 */
function renewedFrom(
  credentials: SealedCredentials,
  body: unknown,
  now: Date,
): { readonly credentials: SealedCredentials; readonly expiresAt: Date } | undefined {
  if (credentials.flow === CHATGPT_FLOW.THIRD_PARTY) {
    const renewed = Schema.decodeUnknownOption(RefreshAnswerSchema)(body);
    if (Option.isNone(renewed)) return undefined;
    const tokens = renewed.value;
    const scopes =
      tokens.scope === undefined
        ? credentials.scopes
        : tokens.scope.split(" ").filter((scope) => scope.length > 0);
    return {
      credentials: {
        ...credentials,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token ?? credentials.idToken,
        scopes,
      },
      expiresAt: accessExpiryOf(tokens.access_token, now, tokens.expires_in),
    };
  }
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

/**
 * An access token for the account's ChatGPT sign-in, good for at least the
 * renewal margin, or the longer one a caller names (a launch of Codex asks
 * for a token that outlasts its first turn's start): the one it holds where
 * it is, a renewed one otherwise. Runs under the row's lock, OpenAI's token
 * endpoint included, so two renewals of one sign-in never race its rotating
 * refresh token.
 */
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
      // The issued client and the refresh token are revealed here alone, into the one body OpenAI reads them from.
      const renewal = renewalRequestOf(credentials);
      const answered = yield* postToOpenAi(renewal.url, renewal.body);
      if (Option.isNone(answered)) return { outcome: CHATGPT_ACCESS.UNREACHABLE };
      const { status, body } = answered.value;
      if (status !== HTTP_STATUS.OK) {
        // A refusal is read for its OAuth error code alone.
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
      // The renewal is kept even so, since it rotated the refresh token; a third-party grant without the plan's scope may not use the plan.
      if (
        credentials.flow === CHATGPT_FLOW.THIRD_PARTY &&
        !renewed.credentials.scopes.includes(CHATGPT_OAUTH.USAGE_SCOPE)
      ) {
        yield* setProviderKeyStatus(
          userId,
          OWNER_KIND.provider,
          sealed.sealedKey,
          PROVIDER_KEY_STATUS.INVALID,
          now,
        );
        return { outcome: CHATGPT_ACCESS.SIGNED_OUT };
      }
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

/** One try at revoking a refresh token: confirmed, refused for good, or worth another try. */
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
  // A revocation endpoint off OpenAI's own server is sent no refresh token.
  if (!onIssuer(discovered.value.revocation_endpoint)) return REVOKE_OUTCOME.REFUSED;
  // The issued client and the refresh token are revealed here alone, into the one form OpenAI reads them from.
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

/** Revokes the sign-in's renewable session, trying again after a failure to connect or a server error; answers whether OpenAI confirmed it. */
const revokeSession = (credentials: SealedCredentials) =>
  revokeOnce(credentials).pipe(
    Effect.repeat({
      schedule: Schedule.exponential(REVOKE_RETRY.WAIT),
      times: REVOKE_RETRY.TIMES,
      until: (tried) => tried !== REVOKE_OUTCOME.RETRY,
    }),
    Effect.map((tried) => tried === REVOKE_OUTCOME.CONFIRMED),
  );

/**
 * Removes the account's ChatGPT sign-in, revoking its renewable session at
 * OpenAI first, under the row's lock so no renewal rotates the token being
 * revoked. The row goes whether or not OpenAI confirmed it; answers whether
 * it did, and true where there was nothing to revoke.
 */
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
      const confirmed = credentials === undefined ? false : yield* revokeSession(credentials);
      yield* removeProviderKey(userId, OWNER_KIND.provider, OWNER_KIND.kind);
      return confirmed;
    }),
  );
});
