import assert from "node:assert/strict";
import test from "node:test";
import type { JsonValue } from "@sidecar/wire/testing";
import { AccountClient, AccountClientError, type FetchLike } from "./client.js";
import { ACCOUNT_PROVIDER } from "./snapshot.js";

function json(body: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("the authorization URL carries the native public-client contract", () => {
  const client = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth/",
    clientId: "luke-desktop",
  });
  const url = new URL(
    client.authorizeUrl({
      redirectUri: "http://127.0.0.1:49152/callback",
      state: "state-value",
      codeChallenge: "challenge-value",
    }),
  );

  assert.equal(url.href.startsWith("https://tryluke.dev/api/auth/oauth2/authorize?"), true);
  assert.equal(url.searchParams.get("client_id"), "luke-desktop");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:49152/callback");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-value");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "openid profile email offline_access");
  assert.equal(url.searchParams.get("prompt"), "login");
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("the code exchange sends the verifier and redirect as form fields", async () => {
  let request: Request | undefined;
  const fetch: FetchLike = async (input, init) => {
    request = new Request(input, init);
    return json({ access_token: "access", refresh_token: "refresh" });
  };
  const client = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
    fetch,
  });

  assert.deepEqual(
    await client.exchangeCode({
      code: "authorization-code",
      codeVerifier: "verifier",
      redirectUri: "http://127.0.0.1:49152/callback",
    }),
    { accessToken: "access", refreshToken: "refresh" },
  );
  assert.ok(request);
  assert.equal(request.method, "POST");
  assert.equal(request.headers.get("content-type"), "application/x-www-form-urlencoded");
  const form = new URLSearchParams(await request.text());
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code"), "authorization-code");
  assert.equal(form.get("code_verifier"), "verifier");
  assert.equal(form.get("client_id"), "luke-desktop");
  assert.equal(form.get("redirect_uri"), "http://127.0.0.1:49152/callback");
});

test("a refresh keeps the existing refresh token when rotation omits one", async () => {
  const fetch: FetchLike = async (_input, init) => {
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("refresh_token"), "existing-refresh");
    return json({ access_token: "new-access" });
  };
  const client = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
    fetch,
  });

  assert.deepEqual(await client.refresh("existing-refresh"), {
    accessToken: "new-access",
    refreshToken: "existing-refresh",
  });
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("sign-out revokes the refresh token as a public client", async () => {
  let request: Request | undefined;
  const client = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
    fetch: async (input, init) => {
      request = new Request(input, init);
      return new Response(null, { status: 200 });
    },
  });

  await client.revoke("refresh-to-revoke");

  assert.ok(request);
  assert.equal(request.url, "https://tryluke.dev/api/auth/oauth2/revoke");
  assert.equal(request.method, "POST");
  const form = new URLSearchParams(await request.text());
  assert.equal(form.get("client_id"), "luke-desktop");
  assert.equal(form.get("token"), "refresh-to-revoke");
  assert.equal(form.get("token_type_hint"), "refresh_token");
});

test("userinfo returns the identity fields and nothing else the claim carried", async () => {
  const fetch: FetchLike = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer access-token");
    return json({
      sub: "internal-user-id",
      email: "developer@example.com",
      name: "Developer",
    });
  };
  const client = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
    fetch,
  });

  assert.deepEqual(await client.userInfo("access-token", ACCOUNT_PROVIDER.GITHUB), {
    id: "internal-user-id",
    email: "developer@example.com",
    name: "Developer",
    provider: ACCOUNT_PROVIDER.GITHUB,
  });
});

/**
 * The id is the one field nothing user-facing needs, so its absence must cost
 * an account nothing: every hosted endpoint resolves the same claim from the
 * bearer token, and only what has to name a person on this machine stands
 * down without it.
 */
test("an identity with no subject claim still signs in, without an id", async () => {
  const client = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
    fetch: async () => json({ email: "developer@example.com" }),
  });

  assert.deepEqual(await client.userInfo("access", ACCOUNT_PROVIDER.GOOGLE), {
    email: "developer@example.com",
    provider: ACCOUNT_PROVIDER.GOOGLE,
  });
});

test("userinfo keeps a picture only from the hosts the renderer's policy pins", async () => {
  const clientFor = (picture: string) =>
    new AccountClient({
      baseUrl: "https://tryluke.dev/api/auth",
      clientId: "luke-desktop",
      fetch: async () => json({ email: "developer@example.com", picture }),
    });

  const google = await clientFor("https://lh3.googleusercontent.com/a/portrait").userInfo(
    "access",
    ACCOUNT_PROVIDER.GOOGLE,
  );
  assert.equal(google.pictureUrl, "https://lh3.googleusercontent.com/a/portrait");

  const github = await clientFor("https://avatars.githubusercontent.com/u/1?v=4").userInfo(
    "access",
    ACCOUNT_PROVIDER.GITHUB,
  );
  assert.equal(github.pictureUrl, "https://avatars.githubusercontent.com/u/1?v=4");

  // Anywhere else — another host, a scheme downgrade, a suffix imposter, or
  // no URL at all — the identity simply travels without a picture.
  for (const refused of [
    "https://example.com/avatar.png",
    "http://lh3.googleusercontent.com/a/portrait",
    "https://evilgoogleusercontent.com/a/portrait",
    "https://avatars.githubusercontent.com.evil.example/u/1",
    "not a url",
  ]) {
    const identity = await clientFor(refused).userInfo("access", ACCOUNT_PROVIDER.GOOGLE);
    assert.equal(identity.pictureUrl, undefined, refused);
  }
});

test("OAuth errors preserve their status and machine-readable code", async () => {
  const client = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
    fetch: async () =>
      json({ error: "invalid_grant", error_description: "Refresh token was revoked" }, 400),
  });

  await assert.rejects(client.refresh("revoked"), (error) => {
    assert.ok(error instanceof AccountClientError);
    assert.equal(error.status, 400);
    assert.equal(error.oauthError, "invalid_grant");
    assert.equal(error.message, "Refresh token was revoked");
    return true;
  });
});

test("invalid token and identity responses are refused", async () => {
  const tokenClient = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
    fetch: async () => json({ access_token: "access-only" }),
  });
  await assert.rejects(
    tokenClient.exchangeCode({
      code: "authorization-code",
      codeVerifier: "verifier",
      redirectUri: "http://127.0.0.1:49152/callback",
    }),
    /both tokens/,
  );

  const identityClient = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
    fetch: async () => json({ provider: "unknown" }),
  });
  await assert.rejects(
    identityClient.userInfo("access", ACCOUNT_PROVIDER.GOOGLE),
    /invalid identity/,
  );
});
