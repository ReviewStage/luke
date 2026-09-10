import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject } from "@sidecar/wire/testing";
import {
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordingFetch,
} from "@sidecar/wire/testing";
import {
  exchangeLinearCode,
  LINEAR_AUTHORIZATION_URL,
  LINEAR_REDIRECT_URIS,
  LINEAR_REFRESH_STATUS,
  LINEAR_REVOKE_URL,
  LINEAR_SCOPES,
  LINEAR_TOKEN_URL,
  linearSignIn,
  linearSignInConfig,
  refreshLinearGrant,
  revokeLinearGrant,
} from "./oauth.js";

const CLIENT_ID = "6f0a2c1e9b3d4f5a";
const NOW = 1_760_000_000_000;
const REDIRECT_URI = "http://127.0.0.1:47821/linear/callback";

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { LINEAR_OAUTH_CLIENT_ID: CLIENT_ID, ...overrides };
}

function grantResponse(overrides: JsonObject = {}): Response {
  return jsonResponse({
    access_token: "lin_oauth_access",
    refresh_token: "lin_oauth_refresh",
    expires_in: 86_400,
    token_type: "Bearer",
    scope: LINEAR_SCOPES,
    ...overrides,
  });
}

test("the sign-in carries its registration, and the environment may replace it", () => {
  // Linear needs no secret under PKCE, so the registered client id is the
  // whole registration and it stands in source: a bare checkout offers the
  // sign-in rather than hiding a row it could not open.
  const registered = linearSignInConfig({});

  // The variable stands in for development against another registration.
  assert.deepEqual(linearSignInConfig(environment()), { clientId: CLIENT_ID });

  // A build whose registration was stripped offers nothing, which is what
  // keeps the row from being drawn refusing.
  assert.equal(
    linearSignInConfig({ LINEAR_OAUTH_CLIENT_ID: "   " })?.clientId,
    registered?.clientId,
  );
});

test("the consent page is Linear's own, as the developer rather than as an app", async () => {
  const opened: string[] = [];
  const signIn = linearSignIn({
    openExternal: (url) => opened.push(url),
    environment: environment(),
    now: () => NOW,
  });

  const pending = signIn.signIn();
  // The browser is opened once the loopback is listening; wait for the URL.
  while (opened.length === 0) await new Promise((resolve) => setImmediate(resolve));
  // SAFETY: The loop above returns only once the first URL was recorded.
  const authorization = new URL(opened[0] as string);

  assert.equal(authorization.origin + authorization.pathname, LINEAR_AUTHORIZATION_URL);
  assert.equal(authorization.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(authorization.searchParams.get("scope"), LINEAR_SCOPES);
  assert.equal(authorization.searchParams.get("response_type"), "code");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("actor"), "user");
  assert.equal(authorization.searchParams.get("prompt"), "consent");
  // Linear matches the redirect against what the application registered, so
  // the flow may only ever use an address that registration carries.
  assert.ok(
    LINEAR_REDIRECT_URIS.includes(authorization.searchParams.get("redirect_uri") ?? ""),
    "the authorization URL names one of the registered redirects",
  );

  signIn.cancel();
  assert.deepEqual(await pending, { reason: "Sign-in was cancelled." });
});

test("the exchange trades the code for a grant, and carries no secret", async () => {
  const { fetch: fakeFetch, requests } = recordingFetch(() => grantResponse());
  const grant = await exchangeLinearCode(
    { clientId: CLIENT_ID },
    { code: "auth-code", redirectUri: REDIRECT_URI, codeVerifier: "v" },
    // SAFETY: Recording fetch matches globalThis.fetch for test harness injection.
    { fetchImplementation: fakeFetch as typeof globalThis.fetch, now: () => NOW },
  );
  assert.deepEqual(grant, {
    accessToken: "lin_oauth_access",
    refreshToken: "lin_oauth_refresh",
    expiresAt: NOW + 86_400_000,
  });

  // SAFETY: The exchange above recorded exactly one request.
  const exchange = requests[0] as RecordedRequest;
  assert.equal(exchange.url, LINEAR_TOKEN_URL);
  const body = new URLSearchParams(exchange.body ?? "");
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "auth-code");
  assert.equal(body.get("redirect_uri"), REDIRECT_URI);
  assert.equal(body.get("code_verifier"), "v");
  // No secret travels: PKCE is what protects a public client, and a secret
  // every installed copy carried would protect nothing the verifier does not.
  assert.equal(body.get("client_secret"), null);
});

test("every way the exchange can fail is a sentence, never a throw", async () => {
  const config = { clientId: CLIENT_ID };
  const input = { code: "auth-code", redirectUri: REDIRECT_URI, codeVerifier: "v" };

  const { fetch: refusing } = recordingFetch(() => jsonResponse({}, HTTP_STATUS.UNAUTHORIZED));
  assert.deepEqual(
    // SAFETY: Recording fetch matches globalThis.fetch for test harness injection.
    await exchangeLinearCode(config, input, {
      fetchImplementation: refusing as typeof globalThis.fetch,
    }),
    { reason: "Linear refused the sign-in exchange." },
  );

  const { fetch: tokenless } = recordingFetch(() => jsonResponse({ expires_in: 86_400 }));
  assert.deepEqual(
    // SAFETY: Recording fetch matches globalThis.fetch for test harness injection.
    await exchangeLinearCode(config, input, {
      fetchImplementation: tokenless as typeof globalThis.fetch,
    }),
    { reason: "Linear answered the sign-in without a token." },
  );

  assert.deepEqual(
    await exchangeLinearCode(config, input, {
      // SAFETY: Rejected fetch matches globalThis.fetch for test harness injection.
      fetchImplementation: (() => Promise.reject(new Error("offline"))) as typeof globalThis.fetch,
    }),
    { reason: "The sign-in exchange with Linear did not complete." },
  );
});

test("a refresh answer without its rotated refresh token is not persisted", async () => {
  const { fetch: fakeFetch } = recordingFetch(() =>
    grantResponse({ refresh_token: undefined, expires_in: 3_600 }),
  );
  const outcome = await refreshLinearGrant("spent-refresh", {
    environment: environment(),
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    fetchImplementation: fakeFetch as typeof globalThis.fetch,
    now: () => NOW,
  });

  assert.deepEqual(outcome, { status: LINEAR_REFRESH_STATUS.UNREACHABLE });
});

test("Linear saying no and Linear saying nothing are different answers", async () => {
  const { fetch: refusedFetch } = recordingFetch(() =>
    jsonResponse({ error: "invalid_grant" }, HTTP_STATUS.UNAUTHORIZED),
  );
  const refused = await refreshLinearGrant("dead-refresh", {
    environment: environment(),
    // SAFETY: Recording fetch matches globalThis.fetch for test harness injection.
    fetchImplementation: refusedFetch as typeof globalThis.fetch,
  });
  assert.deepEqual(refused, { status: LINEAR_REFRESH_STATUS.REFUSED });

  // Someone else's outage is not a withdrawn grant, and neither is a network
  // that never answered: a developer must not be disconnected by either.
  const { fetch: faultedFetch } = recordingFetch(() => jsonResponse({}, HTTP_STATUS.SERVER_ERROR));
  const faulted = await refreshLinearGrant("good-refresh", {
    environment: environment(),
    // SAFETY: Recording fetch matches globalThis.fetch for test harness injection.
    fetchImplementation: faultedFetch as typeof globalThis.fetch,
  });
  assert.deepEqual(faulted, { status: LINEAR_REFRESH_STATUS.UNREACHABLE });

  const unreachable = await refreshLinearGrant("good-refresh", {
    environment: environment(),
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    fetchImplementation: (() => Promise.reject(new Error("offline"))) as typeof globalThis.fetch,
  });
  assert.deepEqual(unreachable, { status: LINEAR_REFRESH_STATUS.UNREACHABLE });

  for (const status of [408, HTTP_STATUS.TOO_MANY_REQUESTS]) {
    const { fetch: transientFetch } = recordingFetch(() =>
      jsonResponse({ error: "try_again" }, status),
    );
    const transient = await refreshLinearGrant("good-refresh", {
      environment: environment(),
      // SAFETY: Recording fetch matches globalThis.fetch for test harness injection.
      fetchImplementation: transientFetch as typeof globalThis.fetch,
    });
    assert.deepEqual(transient, { status: LINEAR_REFRESH_STATUS.UNREACHABLE });
  }

  const { fetch: malformedFetch } = recordingFetch(() => jsonResponse({ expires_in: 86_400 }));
  const malformed = await refreshLinearGrant("good-refresh", {
    environment: environment(),
    // SAFETY: Recording fetch matches globalThis.fetch for test harness injection.
    fetchImplementation: malformedFetch as typeof globalThis.fetch,
  });
  assert.deepEqual(malformed, { status: LINEAR_REFRESH_STATUS.UNREACHABLE });
});

test("revoking posts the grant to Linear and never throws", async () => {
  const { fetch: fakeFetch, requests } = recordingFetch(() => jsonResponse({}, HTTP_STATUS.OK));
  assert.equal(
    await revokeLinearGrant(
      "lin_oauth_refresh",
      "refresh_token",
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      fakeFetch as typeof globalThis.fetch,
    ),
    true,
  );

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const revoke = requests[0] as RecordedRequest;
  assert.equal(revoke.url, LINEAR_REVOKE_URL);
  assert.equal(revoke.authorization, undefined);
  const revokeBody = new URLSearchParams(revoke.body ?? "");
  assert.equal(revokeBody.get("token"), "lin_oauth_refresh");
  assert.equal(revokeBody.get("token_type_hint"), "refresh_token");

  // Best effort by design: the developer asked to disconnect, and a network
  // that cannot carry the message is no reason to keep the grant here.
  const offlineFetch = () => Promise.reject(new Error("offline"));
  assert.equal(
    // SAFETY: Rejected fetch matches globalThis.fetch for test harness injection.
    await revokeLinearGrant(
      "lin_oauth_refresh",
      "refresh_token",
      offlineFetch as typeof globalThis.fetch,
    ),
    false,
  );
});
