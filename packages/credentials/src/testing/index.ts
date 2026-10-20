/**
 * testing/index.ts -- OpenAI's authorization server as a ChatGPT sign-in reaches it, and the browser's return to the loopback, for the tests that run the sign-in whole.
 */
import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import http from "node:http";
import {
  HTTP_STATUS,
  type JsonValue,
  jsonResponse,
  type RecordedRequest,
  type RecordingHttpClient,
  recordingHttpClient,
} from "@luke/wire/testing";
import { CHATGPT_SIGN_IN } from "../chatgpt-sign-in.js";

/** What the fake issues and where it answers, synthetic throughout. */
export const CHATGPT_FAKE = {
  /** Where the fake publishes its endpoints, as its discovery document names them. */
  AUTHORIZE_URL: "https://auth.openai.com/oauth/authorize",
  TOKEN_URL: "https://auth.openai.com/oauth/token",
  JWKS_URL: "https://auth.openai.com/.well-known/jwks.json",
  ISSUED_CLIENT: "oaiapp_test_client",
  SUBJECT: "user-chatgpt-subject",
  ACCESS_TOKEN: "access-token-from-openai",
  REFRESH_TOKEN: "refresh-token-from-openai",
  GRANTED: CHATGPT_SIGN_IN.SCOPES.join(" "),
} as const;

/** An instant no test clock reaches, in Unix seconds (2100-01-01). */
const FAR_FUTURE_SECONDS = 4_102_444_800;

const signingKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = signingKey.publicKey.export({ format: "jwk" });
const PUBLISHED_KEY: JsonValue = {
  kty: publicJwk.kty ?? "RSA",
  n: publicJwk.n ?? "",
  e: publicJwk.e ?? "",
  kid: "key-1",
  alg: "RS256",
  use: "sig",
};

/** An RS256 ID token signed by the fake's published key, its claims as given. */
function idToken(claims: Record<string, JsonValue>): string {
  const part = (value: JsonValue) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signed = `${part({ alg: "RS256", kid: "key-1", typ: "JWT" })}.${part(claims)}`;
  const signature = createSign("RSA-SHA256").update(signed).sign(signingKey.privateKey);
  return `${signed}.${signature.toString("base64url")}`;
}

export interface FakeChatGptAnswers {
  /** The scope the token endpoint grants; the whole plan's where unset. */
  readonly scope?: string;
  /** The nonce the ID token carries, where a test sets one apart from the attempt's. */
  readonly nonce?: string;
  /** The audience the ID token names, where a test sets one apart from the issued client. */
  readonly audience?: string;
  /** When the ID token expires, in Unix seconds, where a test sets it. */
  readonly expiresAt?: number;
  /** What answers a request that is not OpenAI's, as a test routes it: the service, say. */
  readonly elsewhere?: (request: RecordedRequest) => Response | Promise<Response>;
}

export interface FakeChatGptAuthorizationServer {
  readonly http: RecordingHttpClient["layer"];
  readonly requests: RecordingHttpClient["requests"];
  /** The authorization page the browser was sent to, read as OpenAI reads it. */
  readonly authorize: (url: string) => URL;
}

/**
 * OpenAI's authorization server as far as the sign-in reaches it: the
 * discovery document, the published keys, and the token endpoint, which
 * answers only a code exchanged under the issued client with the verifier and
 * the redirect of the attempt the browser was last sent on.
 */
export function fakeChatGptAuthorizationServer(
  answers: FakeChatGptAnswers = {},
): FakeChatGptAuthorizationServer {
  let pending: { nonce: string; challenge: string; redirectUri: string } | undefined;
  const server = recordingHttpClient(async (request) => {
    if (!request.url.startsWith(CHATGPT_SIGN_IN.ISSUER)) {
      assert.ok(answers.elsewhere, `the fake was asked ${request.url}, which nothing answers`);
      return answers.elsewhere(request);
    }
    if (request.url === CHATGPT_SIGN_IN.DISCOVERY_URL) {
      return jsonResponse({
        issuer: CHATGPT_SIGN_IN.ISSUER,
        authorization_endpoint: CHATGPT_FAKE.AUTHORIZE_URL,
        token_endpoint: CHATGPT_FAKE.TOKEN_URL,
        jwks_uri: CHATGPT_FAKE.JWKS_URL,
      });
    }
    if (request.url === CHATGPT_FAKE.JWKS_URL) return jsonResponse({ keys: [PUBLISHED_KEY] });
    assert.equal(request.url, CHATGPT_FAKE.TOKEN_URL);
    const form = new URLSearchParams(await new Response(request.init.body).text());
    const verifier = form.get("code_verifier") ?? "";
    const exchangedAsIssued =
      pending !== undefined &&
      form.get("grant_type") === "authorization_code" &&
      form.get("client_id") === CHATGPT_FAKE.ISSUED_CLIENT &&
      form.get("code") === "auth-code" &&
      form.get("redirect_uri") === pending.redirectUri &&
      form.get("resource") === CHATGPT_SIGN_IN.RESOURCE &&
      createHash("sha256").update(verifier, "ascii").digest("base64url") === pending.challenge;
    if (!exchangedAsIssued || pending === undefined) {
      return jsonResponse({ error: "invalid_grant" }, HTTP_STATUS.BAD_REQUEST);
    }
    return jsonResponse({
      access_token: CHATGPT_FAKE.ACCESS_TOKEN,
      refresh_token: CHATGPT_FAKE.REFRESH_TOKEN,
      id_token: idToken({
        iss: CHATGPT_SIGN_IN.ISSUER,
        aud: [answers.audience ?? CHATGPT_FAKE.ISSUED_CLIENT],
        sub: CHATGPT_FAKE.SUBJECT,
        nonce: answers.nonce ?? pending.nonce,
        // Far past any clock a test runs on, the test clock moved on by a suite included.
        exp: answers.expiresAt ?? FAR_FUTURE_SECONDS,
      }),
      expires_in: 3600,
      scope: answers.scope ?? CHATGPT_FAKE.GRANTED,
      token_type: "Bearer",
    });
  });
  return {
    http: server.layer,
    requests: server.requests,
    authorize: (url) => {
      const page = new URL(url);
      pending = {
        nonce: page.searchParams.get("nonce") ?? "",
        challenge: page.searchParams.get("code_challenge") ?? "",
        redirectUri: page.searchParams.get("redirect_uri") ?? "",
      };
      return page;
    },
  };
}

/** What the browser's return carries once the developer consents: the code, the state, and the issued client. */
export function grantedCallback(page: URL): Record<string, string> {
  return {
    code: "auth-code",
    state: page.searchParams.get("state") ?? "",
    client_id: CHATGPT_FAKE.ISSUED_CLIENT,
    scope: CHATGPT_FAKE.GRANTED,
  };
}

/** The browser's return to the loopback the page named, on a connection of its own; answers its status. */
export function returnToLoopback(page: URL, parameters: Record<string, string>): Promise<number> {
  const callback = new URL(page.searchParams.get("redirect_uri") ?? "");
  for (const [name, value] of Object.entries(parameters)) callback.searchParams.set(name, value);
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: callback.hostname,
        port: callback.port,
        path: `${callback.pathname}${callback.search}`,
        agent: false,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      },
    );
    request.on("error", reject);
  });
}
