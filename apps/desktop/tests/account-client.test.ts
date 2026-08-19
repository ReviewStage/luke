import assert from "node:assert/strict";
import test from "node:test";
import { AccountClientFailure, CLOUD_FAILURE, CloudFailure } from "@sidecar/core/effect-errors";
import { Effect, Layer } from "effect";
import { AccountClient } from "../src/account-client";
import { Http } from "../src/services/http";
import { ACCOUNT_PROVIDER } from "../src/shared/contracts";
import type { JsonValue } from "./support/json";

function json(body: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockHttp(fetch: (input: string, init?: RequestInit) => Promise<Response>) {
  return Layer.succeed(Http, {
    request: (url, init) =>
      Effect.tryPromise({
        try: () => fetch(url, init),
        catch: () => new CloudFailure({ failure: CLOUD_FAILURE.TRANSIENT, provider: "http" }),
      }),
    readJson: (response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: () => new CloudFailure({ failure: CLOUD_FAILURE.TRANSIENT, provider: "http" }),
      }),
    listenLoopback: () =>
      Effect.fail(new CloudFailure({ failure: CLOUD_FAILURE.TRANSIENT, provider: "http" })),
    closeServer: () => Effect.void,
    closeAllConnections: () => Effect.void,
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
  const layer = mockHttp(async (input, init) => {
    request = new Request(input, init);
    return json({ access_token: "access", refresh_token: "refresh" });
  });
  const client = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
  });

  assert.deepEqual(
    await Effect.runPromise(
      client
        .exchangeCode({
          code: "authorization-code",
          codeVerifier: "verifier",
          redirectUri: "http://127.0.0.1:49152/callback",
        })
        .pipe(Effect.provide(layer)),
    ),
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
  const layer = mockHttp(async (_input, init) => {
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("refresh_token"), "existing-refresh");
    return json({ access_token: "new-access" });
  });
  const client = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
  });

  assert.deepEqual(
    await Effect.runPromise(client.refresh("existing-refresh").pipe(Effect.provide(layer))),
    {
      accessToken: "new-access",
      refreshToken: "existing-refresh",
    },
  );
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("sign-out revokes the refresh token as a public client", async () => {
  let request: Request | undefined;
  const layer = mockHttp(async (input, init) => {
    request = new Request(input, init);
    return new Response(null, { status: 200 });
  });
  const client = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
  });

  await Effect.runPromise(client.revoke("refresh-to-revoke").pipe(Effect.provide(layer)));

  assert.ok(request);
  assert.equal(request.url, "https://tryluke.dev/api/auth/oauth2/revoke");
  assert.equal(request.method, "POST");
  const form = new URLSearchParams(await request.text());
  assert.equal(form.get("client_id"), "luke-desktop");
  assert.equal(form.get("token"), "refresh-to-revoke");
  assert.equal(form.get("token_type_hint"), "refresh_token");
});

test("userinfo returns only the renderer-safe identity fields", async () => {
  const layer = mockHttp(async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer access-token");
    return json({
      sub: "internal-user-id",
      email: "developer@example.com",
      name: "Developer",
    });
  });
  const client = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
  });

  assert.deepEqual(
    await Effect.runPromise(
      client.userInfo("access-token", ACCOUNT_PROVIDER.GITHUB).pipe(Effect.provide(layer)),
    ),
    {
      email: "developer@example.com",
      name: "Developer",
      provider: ACCOUNT_PROVIDER.GITHUB,
    },
  );
});

test("userinfo keeps a picture only from the hosts the renderer's policy pins", async () => {
  const clientFor = (picture: string) => {
    const layer = mockHttp(async () => json({ email: "developer@example.com", picture }));
    return {
      client: new AccountClient({
        baseUrl: "https://tryluke.dev/api/auth",
        clientId: "luke-desktop",
      }),
      layer,
    };
  };

  const googleFixture = clientFor("https://lh3.googleusercontent.com/a/portrait");
  const google = await Effect.runPromise(
    googleFixture.client
      .userInfo("access", ACCOUNT_PROVIDER.GOOGLE)
      .pipe(Effect.provide(googleFixture.layer)),
  );
  assert.equal(google.pictureUrl, "https://lh3.googleusercontent.com/a/portrait");

  const githubFixture = clientFor("https://avatars.githubusercontent.com/u/1?v=4");
  const github = await Effect.runPromise(
    githubFixture.client
      .userInfo("access", ACCOUNT_PROVIDER.GITHUB)
      .pipe(Effect.provide(githubFixture.layer)),
  );
  assert.equal(github.pictureUrl, "https://avatars.githubusercontent.com/u/1?v=4");

  for (const refused of [
    "https://example.com/avatar.png",
    "http://lh3.googleusercontent.com/a/portrait",
    "https://evilgoogleusercontent.com/a/portrait",
    "https://avatars.githubusercontent.com.evil.example/u/1",
    "not a url",
  ]) {
    const { client, layer } = clientFor(refused);
    const identity = await Effect.runPromise(
      client.userInfo("access", ACCOUNT_PROVIDER.GOOGLE).pipe(Effect.provide(layer)),
    );
    assert.equal(identity.pictureUrl, undefined, refused);
  }
});

test("OAuth errors preserve their status and machine-readable code", async () => {
  const layer = mockHttp(async () =>
    json({ error: "invalid_grant", error_description: "Refresh token was revoked" }, 400),
  );
  const client = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
  });

  const result = await Effect.runPromise(
    client.refresh("revoked").pipe(Effect.provide(layer), Effect.either),
  );
  assert.equal(result._tag, "Left");
  if (result._tag === "Left") {
    assert.ok(result.left instanceof AccountClientFailure);
    assert.equal(result.left.status, 400);
    assert.equal(result.left.oauthError, "invalid_grant");
  }
});

test("invalid token and identity responses are refused", async () => {
  const tokenLayer = mockHttp(async () => json({ access_token: "access-only" }));
  const tokenClient = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
  });
  const tokenResult = await Effect.runPromise(
    tokenClient
      .exchangeCode({
        code: "authorization-code",
        codeVerifier: "verifier",
        redirectUri: "http://127.0.0.1:49152/callback",
      })
      .pipe(Effect.provide(tokenLayer), Effect.either),
  );
  assert.equal(tokenResult._tag, "Left");

  const identityLayer = mockHttp(async () => json({ provider: "unknown" }));
  const identityClient = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
  });
  const identityResult = await Effect.runPromise(
    identityClient
      .userInfo("access", ACCOUNT_PROVIDER.GOOGLE)
      .pipe(Effect.provide(identityLayer), Effect.either),
  );
  assert.equal(identityResult._tag, "Left");
});
