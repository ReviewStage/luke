/**
 * oauth.ts -- OpenAI's open-source Sign in with ChatGPT, as the probe runs it once on the developer's Mac: PKCE, the authorize URL, the loopback callback, the code exchange, the refresh, and the ID token's checks.
 *
 * The flow is the one OpenAI documents for an open-source client
 * (developers.openai.com/siwc/token-sharing-open-source/sign-in): a first
 * registration sends `client_id=dynamic_agent_client` with the app's
 * `agent_name_hint` and the host's `ext_agent_host_id`; the browser comes back
 * to an HTTP loopback callback on `127.0.0.1` carrying the issued
 * `client_id`, which is the one the code is exchanged under and every later
 * refresh names. No client secret exists. Every request here is a pure value
 * a test can read, and every network call takes the `fetch` it is handed.
 *
 * Note that OpenAI's devkit (`@siwc/local`) is not used, because it ships
 * under a noncommercial licence and is not published to npm; the flow is
 * small enough to write against the documentation directly.
 */

import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import {
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  valueFromJsonText,
  type WireRecord,
} from "@luke/wire";

/** OpenAI's endpoints and the fixed values of the open-source flow. */
export const SIGN_IN = {
  DISCOVERY_URL: "https://auth.openai.com/.well-known/openid-configuration",
  ISSUER: "https://auth.openai.com",
  RESOURCE: "https://api.openai.com/v1",
  REGISTRATION_CLIENT_ID: "dynamic_agent_client",
  AGENT_NAME_HINT: "Luke",
  CALLBACK_PATH: "/auth/callback",
  USAGE_SCOPE: "chatgpt.tokens.use.direct",
  SCOPES: [
    "openid",
    "profile",
    "email",
    "offline_access",
    "resource.invoke",
    "chatgpt.tokens.use.direct",
  ],
} as const;

/** Why a step of the sign-in refused to go on. */
export const SIGN_IN_REFUSAL = {
  STATE_MISMATCH: "state_mismatch",
  ACCESS_DENIED: "access_denied",
  OAUTH_ERROR: "oauth_error",
  NO_CODE: "no_code",
  NO_ISSUED_CLIENT: "no_issued_client",
  TOKEN_RESPONSE: "token_response",
  USAGE_NOT_GRANTED: "usage_not_granted",
  ID_TOKEN: "id_token",
} as const;

export type SignInRefusalKind = (typeof SIGN_IN_REFUSAL)[keyof typeof SIGN_IN_REFUSAL];

/** A step of the sign-in refused, with words safe to print: never a code, a token, or a claim's value. */
export class SignInRefused extends Error {
  readonly kind: SignInRefusalKind;
  constructor(kind: SignInRefusalKind, detail: string) {
    super(`${kind}: ${detail}`);
    this.kind = kind;
  }
}

/** What one authorization attempt holds until its callback completes. */
export interface PendingAuthorization {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly extAgentHostId: string;
}

/** What the browser's return to the loopback callback carried, once checked. */
export interface AuthorizationGrant {
  readonly code: string;
  readonly issuedClientId: string;
}

/** The token endpoint's answer, as the probe keeps it. */
export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken: string | undefined;
  readonly expiresInSeconds: number;
  readonly scopes: readonly string[];
}

/** The credentials the probe signs in for and hands the sandbox's one process. */
export interface ChatGptCredentials {
  readonly issuedClientId: string;
  readonly extAgentHostId: string;
  readonly tokens: TokenSet;
  /** Epoch milliseconds the token set was received. */
  readonly receivedAt: number;
}

/** The `fetch` the network calls take, so a test hands a fake one. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** OpenAI's endpoints, as its OpenID discovery document publishes them. */
export interface Endpoints {
  readonly authorize: string;
  readonly token: string;
  readonly jwks: string;
}

/** Base64url without padding, as PKCE and JWTs write it. */
function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

/** A field of a record that must be a non-empty string. */
function requiredString(record: WireRecord, key: string): string | undefined {
  const value = record[key];
  return isWireString(value) && value.length > 0 ? value : undefined;
}

/** A JWT's parts, decoded but not yet trusted. */
interface DecodedJwt {
  readonly header: WireRecord;
  readonly payload: WireRecord;
  readonly signed: string;
  readonly signature: Buffer;
}

/** The payload and header of a JWT, decoded but not yet trusted. */
function decodeJwt(token: string): DecodedJwt {
  const [header, payload, signature] = token.split(".");
  if (header === undefined || payload === undefined || signature === undefined) {
    throw new SignInRefused(SIGN_IN_REFUSAL.ID_TOKEN, "the ID token is not a JWT");
  }
  const read = (part: string): WireRecord => {
    const value = valueFromJsonText(Buffer.from(part, "base64url").toString("utf8"));
    if (!isRecord(value))
      throw new SignInRefused(SIGN_IN_REFUSAL.ID_TOKEN, "a JWT part is not JSON");
    return value;
  };
  return {
    header: read(header),
    payload: read(payload),
    signed: `${header}.${payload}`,
    signature: Buffer.from(signature, "base64url"),
  };
}

/** A fresh PKCE verifier: 32 random bytes, base64url, 43 characters (RFC 7636 §4.1). */
function createCodeVerifier(): string {
  return base64Url(randomBytes(32));
}

/** The S256 challenge of a verifier: base64url SHA-256, without padding (RFC 7636 §4.2). */
export function codeChallengeOf(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier, "ascii").digest());
}

/** A fresh host identifier, as OpenAI's own example writes one: a URN of a random UUID. */
export function createExtAgentHostId(): string {
  return `urn:uuid:${randomUUID()}`;
}

/** The exact callback URI for a loopback port; only the port may vary between attempts. */
function loopbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}${SIGN_IN.CALLBACK_PATH}`;
}

/** A fresh attempt: random state, nonce and verifier, bound to one callback URI and one host. */
export function beginAuthorization(port: number, extAgentHostId: string): PendingAuthorization {
  return {
    state: base64Url(randomBytes(24)),
    nonce: base64Url(randomBytes(24)),
    codeVerifier: createCodeVerifier(),
    redirectUri: loopbackRedirectUri(port),
    extAgentHostId,
  };
}

/** The discovery document read into endpoints, refused where it is another issuer's. */
export function readDiscovery(document: UnparsedWireValue): Endpoints {
  const issuer = isRecord(document) ? document.issuer : undefined;
  const field = (key: string) => (isRecord(document) ? requiredString(document, key) : undefined);
  const authorize = field("authorization_endpoint");
  const token = field("token_endpoint");
  const jwks = field("jwks_uri");
  if (
    issuer !== SIGN_IN.ISSUER ||
    authorize === undefined ||
    token === undefined ||
    jwks === undefined
  ) {
    throw new SignInRefused(
      SIGN_IN_REFUSAL.TOKEN_RESPONSE,
      "OpenAI's discovery document is not the one expected",
    );
  }
  return { authorize, token, jwks };
}

/** OpenAI's endpoints, read from its discovery document. */
export async function discoverEndpoints(fetcher: Fetch): Promise<Endpoints> {
  const response = await fetcher(SIGN_IN.DISCOVERY_URL, {
    headers: { accept: "application/json" },
  });
  return readDiscovery(valueFromJsonText(await response.text()));
}

/** The URL the system browser opens for a first registration, every value URL-encoded. */
export function authorizeUrl(endpoints: Endpoints, pending: PendingAuthorization): string {
  const query = new URLSearchParams({
    client_id: SIGN_IN.REGISTRATION_CLIENT_ID,
    agent_name_hint: SIGN_IN.AGENT_NAME_HINT,
    ext_agent_host_id: pending.extAgentHostId,
    response_type: "code",
    redirect_uri: pending.redirectUri,
    scope: SIGN_IN.SCOPES.join(" "),
    resource: SIGN_IN.RESOURCE,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge_method: "S256",
    code_challenge: codeChallengeOf(pending.codeVerifier),
  });
  return `${endpoints.authorize}?${query.toString()}`;
}

/**
 * The callback's query read against the pending attempt. The state is
 * checked before anything else, an OAuth error stops the attempt without an
 * exchange, and a first registration must name its issued client, which is
 * never `dynamic_agent_client` itself.
 */
export function readCallback(
  query: URLSearchParams,
  pending: PendingAuthorization,
): AuthorizationGrant {
  if (query.get("state") !== pending.state) {
    throw new SignInRefused(
      SIGN_IN_REFUSAL.STATE_MISMATCH,
      "the callback's state is not this attempt's",
    );
  }
  const error = query.get("error");
  if (error === "access_denied") {
    throw new SignInRefused(SIGN_IN_REFUSAL.ACCESS_DENIED, "the user declined in the browser");
  }
  if (error !== null) throw new SignInRefused(SIGN_IN_REFUSAL.OAUTH_ERROR, error);
  const code = query.get("code");
  if (code === null || code.length === 0) {
    throw new SignInRefused(SIGN_IN_REFUSAL.NO_CODE, "the callback carried no code");
  }
  const issuedClientId = query.get("client_id");
  if (
    issuedClientId === null ||
    issuedClientId.length === 0 ||
    issuedClientId === SIGN_IN.REGISTRATION_CLIENT_ID
  ) {
    throw new SignInRefused(
      SIGN_IN_REFUSAL.NO_ISSUED_CLIENT,
      "a first registration's callback named no issued client_id",
    );
  }
  return { code, issuedClientId };
}

/** The form body of the authorization-code exchange: the issued client, the same redirect and resource. */
function codeExchangeBody(
  grant: AuthorizationGrant,
  pending: PendingAuthorization,
): URLSearchParams {
  return new URLSearchParams({
    grant_type: "authorization_code",
    client_id: grant.issuedClientId,
    code: grant.code,
    code_verifier: pending.codeVerifier,
    redirect_uri: pending.redirectUri,
    resource: SIGN_IN.RESOURCE,
  });
}

/** The form body of a refresh: the issued client, the saved refresh token, the resource, and no scope. */
function refreshBody(credentials: ChatGptCredentials): URLSearchParams {
  return new URLSearchParams({
    grant_type: "refresh_token",
    client_id: credentials.issuedClientId,
    refresh_token: credentials.tokens.refreshToken,
    resource: SIGN_IN.RESOURCE,
  });
}

/**
 * The token endpoint's answer read into a token set. A refresh answer that
 * omits the ID token keeps the one before it. The plan's scope must be among
 * those granted: a valid sign-in without it is one that may not use the plan.
 */
export function readTokenResponse(body: UnparsedWireValue, previousIdToken?: string): TokenSet {
  if (!isRecord(body))
    throw new SignInRefused(SIGN_IN_REFUSAL.TOKEN_RESPONSE, "the answer is not JSON");
  const accessToken = requiredString(body, "access_token");
  const refreshToken = requiredString(body, "refresh_token");
  const expiresIn = body.expires_in;
  if (accessToken === undefined || refreshToken === undefined || !isWireNumber(expiresIn)) {
    throw new SignInRefused(
      SIGN_IN_REFUSAL.TOKEN_RESPONSE,
      "the answer lacks access_token, refresh_token or expires_in",
    );
  }
  const scopes = (requiredString(body, "scope") ?? "").split(" ").filter((one) => one.length > 0);
  if (!scopes.includes(SIGN_IN.USAGE_SCOPE)) {
    throw new SignInRefused(
      SIGN_IN_REFUSAL.USAGE_NOT_GRANTED,
      `the grant lacks ${SIGN_IN.USAGE_SCOPE}, so ChatGPT plan usage is not enabled`,
    );
  }
  return {
    accessToken,
    refreshToken,
    idToken: requiredString(body, "id_token") ?? previousIdToken,
    expiresInSeconds: expiresIn,
    scopes,
  };
}

/** One form POST to the token endpoint, its answer read; the error names only the OAuth error code. */
async function postToken(
  fetcher: Fetch,
  endpoints: Endpoints,
  body: URLSearchParams,
  previousIdToken?: string,
): Promise<TokenSet> {
  const response = await fetcher(endpoints.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString(),
  });
  const answer = valueFromJsonText(await response.text());
  if (!response.ok) {
    const code = isRecord(answer) ? requiredString(answer, "error") : undefined;
    throw new SignInRefused(
      SIGN_IN_REFUSAL.TOKEN_RESPONSE,
      `the token endpoint answered ${response.status}${code === undefined ? "" : ` (${code})`}`,
    );
  }
  return readTokenResponse(answer, previousIdToken);
}

/** The code exchanged for the first token set. */
export function exchangeCode(
  fetcher: Fetch,
  endpoints: Endpoints,
  grant: AuthorizationGrant,
  pending: PendingAuthorization,
): Promise<TokenSet> {
  return postToken(fetcher, endpoints, codeExchangeBody(grant, pending));
}

/** A replacement token set, the access token, expiry, scopes and refresh token replaced together. */
export async function refreshCredentials(
  fetcher: Fetch,
  endpoints: Endpoints,
  credentials: ChatGptCredentials,
  now: number,
): Promise<ChatGptCredentials> {
  const tokens = await postToken(
    fetcher,
    endpoints,
    refreshBody(credentials),
    credentials.tokens.idToken,
  );
  return { ...credentials, tokens, receivedAt: now };
}

/**
 * The ID token checked as the guide asks: its RS256 signature against the
 * published key it names, the issuer, the audience as the issued client, the
 * nonce of this attempt, and its expiry. Answers its subject, which is the
 * account's identity and never printed.
 */
export function verifyIdToken(input: {
  readonly idToken: string;
  readonly jwks: UnparsedWireValue;
  readonly issuedClientId: string;
  readonly nonce: string;
  readonly nowSeconds: number;
}): string {
  const { header, payload, signed, signature } = decodeJwt(input.idToken);
  const keys = isRecord(input.jwks) && Array.isArray(input.jwks.keys) ? input.jwks.keys : [];
  const key = keys.find((one) => isRecord(one) && one.kid === header.kid);
  if (header.alg !== "RS256" || key === undefined || !isRecord(key)) {
    throw new SignInRefused(
      SIGN_IN_REFUSAL.ID_TOKEN,
      "no published RS256 key matches the ID token",
    );
  }
  const publicKey = createPublicKey({ key: { ...key }, format: "jwk" });
  if (!verify("RSA-SHA256", Buffer.from(signed), publicKey, signature)) {
    throw new SignInRefused(SIGN_IN_REFUSAL.ID_TOKEN, "the ID token's signature does not verify");
  }
  const audience = payload.aud;
  const audiences = Array.isArray(audience) ? audience : [audience];
  const failed = [
    payload.iss === SIGN_IN.ISSUER ? null : "issuer",
    audiences.includes(input.issuedClientId) ? null : "audience",
    payload.nonce === input.nonce ? null : "nonce",
    isWireNumber(payload.exp) && payload.exp > input.nowSeconds ? null : "expiry",
  ].filter((one) => one !== null);
  const subject = requiredString(payload, "sub");
  if (failed.length > 0 || subject === undefined) {
    throw new SignInRefused(
      SIGN_IN_REFUSAL.ID_TOKEN,
      `the ID token fails its ${failed.length > 0 ? failed.join(", ") : "subject"} check`,
    );
  }
  return subject;
}
