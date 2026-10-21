/**
 * chatgpt-sign-in.ts -- OpenAI's open-source Sign in with ChatGPT for Luke's hosted runtime, as the desktop runs it: one consent trip whose exchange hands the credentials straight to the service and answers only what the service said.
 *
 * The flow is the one OpenAI documents for an open-source client
 * (developers.openai.com/siwc/token-sharing-open-source/sign-in) and the one
 * `tools/codex-probe` proved: a first registration names
 * `client_id=dynamic_agent_client`, the app's `agent_name_hint`, and the
 * host's `ext_agent_host_id`; the browser comes back to an HTTP loopback on
 * `127.0.0.1` (OpenAI's example port where it is free, any free port
 * otherwise) carrying the code and the issued `client_id`; the code is
 * exchanged under that client with the PKCE verifier; and the ID token is
 * checked against OpenAI's published keys, its issuer, audience, nonce and
 * expiry, before anything is kept. The host here is Luke's hosted runtime,
 * not this Mac (OpenAI's self-hosted VM recipe), so its id is the account's
 * own, which the service minted and serves.
 *
 * Every token stays inside the exchange: it is posted to the service once,
 * in the save the caller hands in, and the trip's grant is the service's
 * answer, which names no token. A refusal is a fixed sentence and never
 * quotes OpenAI's answer, a code, or a claim.
 */
import type { ChatGptCredentialsSaveRequest } from "@luke/features/provider-key-wire";
import {
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  valueFromJsonText,
  type WireRecord,
} from "@luke/wire";
import { Clock, Duration, Effect, type Layer, Option, Result, type Scope } from "effect";
import { Base64Url } from "effect/encoding";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import {
  LOOPBACK_CONSENT_CANCELLED,
  type LoopbackConsent,
  type LoopbackConsentOutcome,
  type LoopbackExchange,
  type OpenConsent,
} from "./consent.js";

/** OpenAI's endpoints and the fixed values of the open-source flow, as its guides publish them. */
export const CHATGPT_SIGN_IN = {
  DISCOVERY_URL: "https://auth.openai.com/.well-known/openid-configuration",
  ISSUER: "https://auth.openai.com",
  RESOURCE: "https://api.openai.com/v1",
  /** The first-registration entrypoint, never the client a sign-in is kept under. */
  REGISTRATION_CLIENT_ID: "dynamic_agent_client",
  AGENT_NAME_HINT: "Luke",
  CALLBACK_PATH: "/auth/callback",
  /** OpenAI's example port; any free one serves, since only the port may vary. */
  PREFERRED_PORT: 1455,
  /** The scope without which a sign-in may not use the ChatGPT plan. */
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

/** What a ChatGPT sign-in says where it kept nothing, in a sentence for the row. */
export const CHATGPT_SIGN_IN_REASON = {
  REFUSED: "ChatGPT sign-in was not completed.",
  TIMED_OUT: "ChatGPT sign-in timed out.",
  UNREACHABLE: "Luke couldn't reach ChatGPT. Try again.",
  NOT_REGISTERED: "ChatGPT didn't finish connecting Luke. Try again.",
  USAGE_NOT_ENABLED:
    "ChatGPT plan use wasn't enabled for Luke. Try again and allow it in the browser.",
  NOT_VERIFIED: "Luke couldn't verify the ChatGPT sign-in. Try again.",
} as const;

/** The landing cards the browser is left on. */
const PAGES = {
  granted: {
    badge: "Connected",
    title: "Luke is connected to ChatGPT",
    body: "You can close this tab and return to Luke.",
  },
  notGranted: {
    badge: "Not connected",
    title: "Luke isn't connected to ChatGPT",
    body: "Return to Luke to see why and try again.",
  },
} as const;

/** Long enough to sign in, name the agent and review its permissions; not an open door all afternoon. */
const WAIT = Duration.minutes(10);

/** How long OpenAI is given to answer one call. */
const CALL_TIMEOUT = Duration.seconds(10);

/** RS256 as Web Crypto names it. */
const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/** OpenAI's endpoints, as its discovery document publishes them. */
interface Endpoints {
  readonly authorize: string;
  readonly token: string;
  readonly jwks: string;
}

/** What one attempt holds between its authorization page and its exchange. */
interface Attempt<Saved extends object> {
  readonly nonce: string;
  readonly extAgentHostId: string;
  readonly endpoints: Endpoints;
  readonly save: ChatGptSave<Saved>;
}

/**
 * Hands the validated credentials to the service, answering what it kept or
 * why not. The one place a token leaves the exchange. Never fails.
 */
type ChatGptSave<Saved extends object> = (
  credentials: ChatGptCredentialsSaveRequest,
) => Effect.Effect<LoopbackConsentOutcome<Saved>>;

/** One sign-in as a press asks it: the host it names, and where what it validates is kept. */
interface ChatGptSignInRequest<Saved extends object> {
  readonly extAgentHostId: string;
  /** Bound to the press, so what is validated is kept for the account that pressed and no other. */
  readonly save: ChatGptSave<Saved>;
}

export interface ChatGptSignInOptions {
  /** Stands a consent trip up: the desktop's loopback. */
  readonly openConsent: OpenConsent;
  /** Opens the authorization page in the user's own browser. */
  readonly openExternal: (url: string) => void | Promise<void>;
  /** The `HttpClient` OpenAI is reached over. */
  readonly http: Layer.Layer<HttpClient.HttpClient>;
}

export interface ChatGptSignIn<Saved extends object> {
  /** One sign-in, press to the service's answer, for the host the account's id names. */
  signIn(request: ChatGptSignInRequest<Saved>): Effect.Effect<LoopbackConsentOutcome<Saved>>;
  /** Ends the sign-in now under way, if any: one still reading OpenAI's endpoints opens no browser. */
  cancel(): void;
  /** Opens the waiting sign-in's page again. */
  reopen(): void;
}

/** A fresh random value for a nonce: 24 bytes, base64url. */
function randomValue(): string {
  return Base64Url.encode(crypto.getRandomValues(new Uint8Array(24)));
}

/** A field of a record that must be a non-empty string. */
function requiredString(record: WireRecord, key: string): string | undefined {
  const value = record[key];
  return isWireString(value) && value.length > 0 ? value : undefined;
}

/** One GET of a JSON document from OpenAI, or none where it could not be read. */
const getJson = (
  url: string,
): Effect.Effect<Option.Option<UnparsedWireValue>, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return yield* client.execute(HttpClientRequest.get(url, { acceptJson: true })).pipe(
      Effect.flatMap((response) => response.text),
      Effect.map((body) => valueFromJsonText(body)),
      Effect.scoped,
      Effect.timeout(CALL_TIMEOUT),
      Effect.option,
    );
  });

/** The discovery document read into endpoints, none where it is another issuer's. */
function readDiscovery(document: UnparsedWireValue): Option.Option<Endpoints> {
  if (!isRecord(document) || document.issuer !== CHATGPT_SIGN_IN.ISSUER) return Option.none();
  const authorize = requiredString(document, "authorization_endpoint");
  const token = requiredString(document, "token_endpoint");
  const jwks = requiredString(document, "jwks_uri");
  // Note that every endpoint must be on OpenAI's own server, because the code, the verifier and the keys the ID token is checked against all come from them.
  const onIssuer = (url: string | undefined): url is string =>
    url !== undefined && URL.canParse(url) && new URL(url).origin === CHATGPT_SIGN_IN.ISSUER;
  return onIssuer(authorize) && onIssuer(token) && onIssuer(jwks)
    ? Option.some({ authorize, token, jwks })
    : Option.none();
}

/** The tokens the code exchange answered, read; none where the answer lacks one. */
interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken: string;
  readonly expiresInSeconds: number;
  readonly scopes: readonly string[];
}

function readTokens(body: UnparsedWireValue): Option.Option<IssuedTokens> {
  if (!isRecord(body)) return Option.none();
  const accessToken = requiredString(body, "access_token");
  const refreshToken = requiredString(body, "refresh_token");
  const idToken = requiredString(body, "id_token");
  const expiresIn = body.expires_in;
  if (
    accessToken === undefined ||
    refreshToken === undefined ||
    idToken === undefined ||
    !isWireNumber(expiresIn) ||
    !Number.isInteger(expiresIn) ||
    expiresIn <= 0
  ) {
    return Option.none();
  }
  const scopes = (requiredString(body, "scope") ?? "").split(" ").filter((one) => one.length > 0);
  return Option.some({ accessToken, refreshToken, idToken, expiresInSeconds: expiresIn, scopes });
}

/** The code exchanged under the issued client: its answer, or none where OpenAI refused or did not answer. */
const exchangeCode = (
  endpoints: Endpoints,
  input: LoopbackExchange,
  clientId: string,
): Effect.Effect<Option.Option<UnparsedWireValue>, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.post(endpoints.token).pipe(
      HttpClientRequest.setHeader("accept", "application/json"),
      HttpClientRequest.bodyUrlParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: input.code,
        code_verifier: input.codeVerifier,
        redirect_uri: input.redirectUri,
        resource: CHATGPT_SIGN_IN.RESOURCE,
      }),
    );
    // A refusal is no answer, and its body is dropped unread, since nothing in it is the row's to show.
    return yield* client.execute(request).pipe(
      Effect.flatMap((response) =>
        response.status === 200
          ? Effect.map(response.text, (body) => Option.some(valueFromJsonText(body)))
          : Effect.succeed(Option.none()),
      ),
      Effect.scoped,
      Effect.timeout(CALL_TIMEOUT),
      Effect.orElseSucceed(() => Option.none()),
    );
  });

/** A JWT's three parts decoded, none where it is not one. */
function decodeJwt(token: string): Option.Option<{
  header: WireRecord;
  payload: WireRecord;
  signed: string;
  signature: Uint8Array;
}> {
  const [header, payload, signature, ...rest] = token.split(".");
  if (header === undefined || payload === undefined || signature === undefined || rest.length > 0) {
    return Option.none();
  }
  const part = (encoded: string): WireRecord | undefined => {
    const decoded = Base64Url.decodeString(encoded);
    if (Result.isFailure(decoded)) return undefined;
    const value = valueFromJsonText(decoded.success);
    return isRecord(value) ? value : undefined;
  };
  const bytes = Base64Url.decode(signature);
  const [readHeader, readPayload] = [part(header), part(payload)];
  if (readHeader === undefined || readPayload === undefined || Result.isFailure(bytes)) {
    return Option.none();
  }
  return Option.some({
    header: readHeader,
    payload: readPayload,
    signed: `${header}.${payload}`,
    signature: bytes.success,
  });
}

/**
 * The ID token checked as the guide asks: its RS256 signature against the
 * published key it names, the issuer, the audience as the issued client,
 * this attempt's nonce, and its expiry. Answers its subject, the ChatGPT
 * account's identity, or none where any check fails.
 */
const verifiedSubject = (input: {
  readonly idToken: string;
  readonly jwks: UnparsedWireValue;
  readonly clientId: string;
  readonly nonce: string;
}): Effect.Effect<Option.Option<string>> =>
  Effect.gen(function* () {
    const decoded = decodeJwt(input.idToken);
    if (Option.isNone(decoded)) return Option.none();
    const { header, payload, signed, signature } = decoded.value;
    const keys = isRecord(input.jwks) && Array.isArray(input.jwks.keys) ? input.jwks.keys : [];
    const key = keys.find((one) => isRecord(one) && one.kid === header.kid);
    if (header.alg !== "RS256" || !isRecord(key)) return Option.none();
    const verified = yield* Effect.tryPromise(async () => {
      // SAFETY: a published key is a JWK object; Web Crypto refuses one that is not an RSA key.
      const publicKey = await crypto.subtle.importKey("jwk", key as JsonWebKey, RS256, false, [
        "verify",
      ]);
      return crypto.subtle.verify(
        RS256,
        publicKey,
        new Uint8Array(signature),
        new TextEncoder().encode(signed),
      );
    }).pipe(Effect.orElseSucceed(() => false));
    if (!verified) return Option.none();
    const nowSeconds = Math.floor((yield* Clock.currentTimeMillis) / 1000);
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const subject = requiredString(payload, "sub");
    const holds =
      payload.iss === CHATGPT_SIGN_IN.ISSUER &&
      audiences.includes(input.clientId) &&
      payload.nonce === input.nonce &&
      isWireNumber(payload.exp) &&
      payload.exp > nowSeconds;
    return holds && subject !== undefined ? Option.some(subject) : Option.none();
  });

/** The authorization page's URL for a first registration, every value URL-encoded. */
function authorizationUrl(
  attempt: Attempt<object>,
  input: { state: string; redirectUri: string; codeChallenge: string },
): string {
  const query = new URLSearchParams({
    client_id: CHATGPT_SIGN_IN.REGISTRATION_CLIENT_ID,
    agent_name_hint: CHATGPT_SIGN_IN.AGENT_NAME_HINT,
    ext_agent_host_id: attempt.extAgentHostId,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: CHATGPT_SIGN_IN.SCOPES.join(" "),
    resource: CHATGPT_SIGN_IN.RESOURCE,
    state: input.state,
    nonce: attempt.nonce,
    code_challenge_method: "S256",
    code_challenge: input.codeChallenge,
  });
  return `${attempt.endpoints.authorize}?${query.toString()}`;
}

/**
 * Stands the ChatGPT sign-in up over the consent it is handed. One sign-in
 * waits at a time, as the consent's own: a second press while one waits is
 * answered with why. The attempt's nonce and host are held for the trip that
 * is waiting alone, and dropped as it ends.
 */
export function chatGptSignIn<Saved extends object>(
  options: ChatGptSignInOptions,
): ChatGptSignIn<Saved> {
  // Note that the attempt is read by the consent's own callbacks, which it
  // calls with no context of ours; it is set before the trip opens the page
  // and read only while that trip stands.
  let attempt: Attempt<Saved> | undefined;
  // Every Cancel pressed, so a sign-in still reading OpenAI's endpoints, before
  // any consent stands to withdraw, sees it was withdrawn and opens no browser.
  let cancels = 0;

  const exchange = (input: LoopbackExchange): Effect.Effect<LoopbackConsentOutcome<Saved>> =>
    Effect.gen(function* () {
      const standing = attempt;
      if (standing === undefined) return { reason: CHATGPT_SIGN_IN_REASON.REFUSED };
      // A first registration names the client it issued; without one, or with the entrypoint itself, it is incomplete.
      const clientId = input.clientId;
      if (clientId === undefined || clientId === CHATGPT_SIGN_IN.REGISTRATION_CLIENT_ID) {
        return { reason: CHATGPT_SIGN_IN_REASON.NOT_REGISTERED };
      }
      const answered = yield* exchangeCode(standing.endpoints, input, clientId);
      if (Option.isNone(answered)) return { reason: CHATGPT_SIGN_IN_REASON.UNREACHABLE };
      const tokens = readTokens(answered.value);
      if (Option.isNone(tokens)) return { reason: CHATGPT_SIGN_IN_REASON.NOT_VERIFIED };
      // A valid sign-in without the plan's scope is one that may not use the plan.
      if (!tokens.value.scopes.includes(CHATGPT_SIGN_IN.USAGE_SCOPE)) {
        return { reason: CHATGPT_SIGN_IN_REASON.USAGE_NOT_ENABLED };
      }
      const jwks = yield* getJson(standing.endpoints.jwks);
      if (Option.isNone(jwks)) return { reason: CHATGPT_SIGN_IN_REASON.UNREACHABLE };
      const subject = yield* verifiedSubject({
        idToken: tokens.value.idToken,
        jwks: jwks.value,
        clientId,
        nonce: standing.nonce,
      });
      if (Option.isNone(subject)) return { reason: CHATGPT_SIGN_IN_REASON.NOT_VERIFIED };
      return yield* standing.save({
        clientId,
        accountId: subject.value,
        accessToken: tokens.value.accessToken,
        refreshToken: tokens.value.refreshToken,
        idToken: tokens.value.idToken,
        expiresInSeconds: tokens.value.expiresInSeconds,
        scopes: tokens.value.scopes,
      });
    }).pipe(Effect.provide(options.http));

  const consent: LoopbackConsent<Saved> = options.openConsent<Saved>({
    ports: [CHATGPT_SIGN_IN.PREFERRED_PORT, 0],
    callbackPath: CHATGPT_SIGN_IN.CALLBACK_PATH,
    pages: PAGES,
    reasons: {
      refused: CHATGPT_SIGN_IN_REASON.REFUSED,
      timedOut: CHATGPT_SIGN_IN_REASON.TIMED_OUT,
    },
    authorizationUrl: (input) => {
      // SAFETY: the trip opens its page only after `signIn` set the attempt it runs under.
      return authorizationUrl(attempt as Attempt<Saved>, input);
    },
    exchange,
    openExternal: options.openExternal,
    timeoutMs: Duration.toMillis(WAIT),
  });

  return {
    signIn: ({ extAgentHostId, save }) =>
      Effect.gen(function* () {
        const asked = cancels;
        const document = yield* Effect.provide(
          getJson(CHATGPT_SIGN_IN.DISCOVERY_URL),
          options.http,
        );
        if (cancels !== asked) return { reason: LOOPBACK_CONSENT_CANCELLED };
        const endpoints = Option.flatMap(document, readDiscovery);
        if (Option.isNone(endpoints)) return { reason: CHATGPT_SIGN_IN_REASON.UNREACHABLE };
        const trip: Effect.Effect<
          LoopbackConsentOutcome<Saved>,
          never,
          Scope.Scope
        > = consent.signInEffect();
        // A press while a sign-in waits leaves that one's attempt standing, and the consent answers it with why.
        if (attempt !== undefined) return yield* Effect.scoped(trip);
        attempt = { nonce: randomValue(), extAgentHostId, endpoints: endpoints.value, save };
        return yield* Effect.scoped(trip).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              attempt = undefined;
            }),
          ),
        );
      }),
    cancel: () => {
      cancels += 1;
      consent.cancel();
    },
    reopen: () => consent.reopen(),
  };
}
