import { generateKeyPairSync, sign } from "node:crypto";
import type { WireRecord } from "@luke/wire";
import { describe, expect, it } from "vitest";
import {
  authorizeUrl,
  beginAuthorization,
  type ChatGptCredentials,
  codeChallengeOf,
  type Endpoints,
  exchangeCode,
  type Fetch,
  type PendingAuthorization,
  readCallback,
  readDiscovery,
  readTokenResponse,
  refreshCredentials,
  SIGN_IN_REFUSAL,
  SignInRefused,
  verifyIdToken,
} from "./oauth.js";

const PENDING: PendingAuthorization = {
  state: "state-1",
  nonce: "nonce-1",
  codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  redirectUri: "http://127.0.0.1:1455/auth/callback",
  extAgentHostId: "urn:uuid:11111111-1111-4111-8111-111111111111",
};

const ENDPOINTS: Endpoints = {
  authorize: "https://auth.example.test/authorize",
  token: "https://auth.example.test/token",
  jwks: "https://auth.example.test/jwks.json",
};

const TOKEN_BODY = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  id_token: "id-1",
  expires_in: 3600,
  scope: "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke",
};

/** The refusal a call threw, so a test asserts its kind. */
function refusalOf(run: () => void): string | undefined {
  try {
    run();
  } catch (cause) {
    return cause instanceof SignInRefused ? cause.kind : "not a refusal";
  }
  return undefined;
}

/** A fake token endpoint that answers one body and keeps what it was sent. */
function tokenEndpoint(status: number, body: WireRecord) {
  const sent: URLSearchParams[] = [];
  const fetcher: Fetch = async (_url, init) => {
    sent.push(new URLSearchParams(String(init.body)));
    return new Response(JSON.stringify(body), { status });
  };
  return { fetcher, sent };
}

/** An RS256 ID token signed by a fresh key, with the JWKS that publishes it. */
function signedIdToken(claims: WireRecord) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString(
    "base64url",
  );
  const jwks = {
    keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }],
  };
  return { idToken: `${header}.${payload}.${signature}`, jwks: JSON.parse(JSON.stringify(jwks)) };
}

describe("PKCE", () => {
  it("derives RFC 7636's own S256 challenge from its example verifier", () => {
    expect(codeChallengeOf(PENDING.codeVerifier)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("starts every attempt with fresh state, nonce and verifier on a 127.0.0.1 callback", () => {
    const one = beginAuthorization(54321, PENDING.extAgentHostId);
    const two = beginAuthorization(54321, PENDING.extAgentHostId);
    expect(one.redirectUri).toBe("http://127.0.0.1:54321/auth/callback");
    expect(new Set([one.state, two.state, one.nonce, two.nonce]).size).toBe(4);
    expect(one.codeVerifier).not.toBe(two.codeVerifier);
    expect(one.codeVerifier).toMatch(/^[\w-]{43}$/u);
  });
});

describe("readDiscovery", () => {
  it("reads the endpoints of OpenAI's own issuer and refuses another issuer's document", () => {
    const document = {
      issuer: "https://auth.openai.com",
      authorization_endpoint: ENDPOINTS.authorize,
      token_endpoint: ENDPOINTS.token,
      jwks_uri: ENDPOINTS.jwks,
    };
    expect(readDiscovery(document)).toEqual(ENDPOINTS);
    expect(
      refusalOf(() => readDiscovery({ ...document, issuer: "https://auth.example.test" })),
    ).toBe(SIGN_IN_REFUSAL.TOKEN_RESPONSE);
  });
});

describe("authorizeUrl", () => {
  it("asks for a first registration as OpenAI's open-source flow documents it", () => {
    const url = new URL(authorizeUrl(ENDPOINTS, PENDING));
    expect(`${url.origin}${url.pathname}`).toBe(ENDPOINTS.authorize);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "dynamic_agent_client",
      agent_name_hint: "Luke",
      ext_agent_host_id: PENDING.extAgentHostId,
      response_type: "code",
      redirect_uri: "http://127.0.0.1:1455/auth/callback",
      scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      resource: "https://api.openai.com/v1",
      state: "state-1",
      nonce: "nonce-1",
      code_challenge_method: "S256",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    });
  });
});

describe("readCallback", () => {
  const query = (fields: Record<string, string>) => new URLSearchParams(fields);

  it("answers the code and the issued client of a first registration", () => {
    expect(
      readCallback(query({ state: "state-1", code: "c", client_id: "oaiapp_1" }), PENDING),
    ).toEqual({
      code: "c",
      issuedClientId: "oaiapp_1",
    });
  });

  it("checks the state before anything else", () => {
    expect(
      refusalOf(() => readCallback(query({ state: "other", error: "access_denied" }), PENDING)),
    ).toBe(SIGN_IN_REFUSAL.STATE_MISMATCH);
  });

  it("stops on a declined consent without a code to exchange", () => {
    expect(
      refusalOf(() => readCallback(query({ state: "state-1", error: "access_denied" }), PENDING)),
    ).toBe(SIGN_IN_REFUSAL.ACCESS_DENIED);
  });

  it("treats a registration without an issued client, or one naming dynamic_agent_client, as incomplete", () => {
    expect(refusalOf(() => readCallback(query({ state: "state-1", code: "c" }), PENDING))).toBe(
      SIGN_IN_REFUSAL.NO_ISSUED_CLIENT,
    );
    expect(
      refusalOf(() =>
        readCallback(
          query({ state: "state-1", code: "c", client_id: "dynamic_agent_client" }),
          PENDING,
        ),
      ),
    ).toBe(SIGN_IN_REFUSAL.NO_ISSUED_CLIENT);
  });
});

describe("the token endpoint", () => {
  it("exchanges the code under the issued client with the same redirect, verifier and resource", async () => {
    const endpoint = tokenEndpoint(200, TOKEN_BODY);
    const tokens = await exchangeCode(
      endpoint.fetcher,
      ENDPOINTS,
      { code: "c", issuedClientId: "oaiapp_1" },
      PENDING,
    );
    expect(tokens.accessToken).toBe("access-1");
    expect(Object.fromEntries(endpoint.sent[0] ?? [])).toEqual({
      grant_type: "authorization_code",
      client_id: "oaiapp_1",
      code: "c",
      code_verifier: PENDING.codeVerifier,
      redirect_uri: PENDING.redirectUri,
      resource: "https://api.openai.com/v1",
    });
  });

  it("refreshes under the issued client without a scope, replacing the tokens and keeping the ID token", async () => {
    const { id_token: _omitted, ...withoutIdToken } = TOKEN_BODY;
    const endpoint = tokenEndpoint(200, {
      ...withoutIdToken,
      access_token: "access-2",
      refresh_token: "refresh-2",
    });
    const before: ChatGptCredentials = {
      issuedClientId: "oaiapp_1",
      extAgentHostId: PENDING.extAgentHostId,
      tokens: readTokenResponse(TOKEN_BODY),
      receivedAt: 0,
    };
    const after = await refreshCredentials(endpoint.fetcher, ENDPOINTS, before, 5);
    expect(after.tokens).toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      idToken: "id-1",
    });
    expect(after.receivedAt).toBe(5);
    expect(Object.fromEntries(endpoint.sent[0] ?? [])).toEqual({
      grant_type: "refresh_token",
      client_id: "oaiapp_1",
      refresh_token: "refresh-1",
      resource: "https://api.openai.com/v1",
    });
  });

  it("refuses a grant without ChatGPT plan usage", () => {
    expect(
      refusalOf(() => readTokenResponse({ ...TOKEN_BODY, scope: "openid email offline_access" })),
    ).toBe(SIGN_IN_REFUSAL.USAGE_NOT_GRANTED);
  });

  it("names only the OAuth error code when the endpoint refuses, never what was sent", async () => {
    const endpoint = tokenEndpoint(400, {
      error: "invalid_grant",
      error_description: "refresh-1 is spent",
    });
    const failure = await exchangeCode(
      endpoint.fetcher,
      ENDPOINTS,
      { code: "c", issuedClientId: "oaiapp_1" },
      PENDING,
    ).catch((cause: Error) => cause.message);
    expect(failure).toBe("token_response: the token endpoint answered 400 (invalid_grant)");
  });
});

describe("verifyIdToken", () => {
  const claims = {
    iss: "https://auth.openai.com",
    aud: "oaiapp_1",
    nonce: "nonce-1",
    exp: 2000,
    sub: "subject-1",
  };
  const check = (token: { idToken: string; jwks: object }, nowSeconds = 1000) =>
    verifyIdToken({
      ...token,
      jwks: JSON.parse(JSON.stringify(token.jwks)),
      issuedClientId: "oaiapp_1",
      nonce: "nonce-1",
      nowSeconds,
    });

  it("answers the subject of a token signed by the published key for this client and attempt", () => {
    expect(check(signedIdToken(claims))).toBe("subject-1");
  });

  it("refuses a token for another client, another attempt, or past its expiry", () => {
    expect(refusalOf(() => check(signedIdToken({ ...claims, aud: "oaiapp_2" })))).toBe(
      SIGN_IN_REFUSAL.ID_TOKEN,
    );
    expect(refusalOf(() => check(signedIdToken({ ...claims, nonce: "nonce-2" })))).toBe(
      SIGN_IN_REFUSAL.ID_TOKEN,
    );
    expect(refusalOf(() => check(signedIdToken(claims), 3000))).toBe(SIGN_IN_REFUSAL.ID_TOKEN);
  });

  it("refuses a token whose signature another key made", () => {
    const signed = signedIdToken(claims);
    const other = signedIdToken(claims);
    expect(refusalOf(() => check({ idToken: signed.idToken, jwks: other.jwks }))).toBe(
      SIGN_IN_REFUSAL.ID_TOKEN,
    );
  });
});
