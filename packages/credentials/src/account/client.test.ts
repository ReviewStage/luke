import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { type FakeResponder, fakeHttpClientLayer, type JsonValue } from "@luke/wire/testing";
import { Effect, Exit } from "effect";
import { test } from "vitest";
import { AccountClient, accountGateOpen, withIssuedAccountTokens } from "./client.js";
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
it.effect("the code exchange sends the verifier and redirect as form fields", () =>
  Effect.gen(function* () {
    let request: Request | undefined;
    const fetch: FakeResponder = async (input, init) => {
      request = new Request(input, init);
      return json({ access_token: "access", refresh_token: "refresh" });
    };
    const client = new AccountClient({
      baseUrl: "https://tryluke.dev/api/auth",
      clientId: "luke-desktop",
      httpClient: fakeHttpClientLayer(fetch),
    });

    assert.deepEqual(
      yield* client.exchangeCode({
        code: "authorization-code",
        codeVerifier: "verifier",
        redirectUri: "http://127.0.0.1:49152/callback",
      }),
      { accessToken: "access", refreshToken: "refresh" },
    );
    assert.ok(request);
    const sent = request;
    assert.equal(sent.method, "POST");
    assert.equal(sent.headers.get("content-type"), "application/x-www-form-urlencoded");
    const form = new URLSearchParams(yield* Effect.promise(() => sent.text()));
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("code"), "authorization-code");
    assert.equal(form.get("code_verifier"), "verifier");
    assert.equal(form.get("client_id"), "luke-desktop");
    assert.equal(form.get("redirect_uri"), "http://127.0.0.1:49152/callback");
  }),
);

it.effect("userinfo returns the identity fields and nothing else the claim carried", () =>
  Effect.gen(function* () {
    const fetch: FakeResponder = async (_input, init) => {
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
      httpClient: fakeHttpClientLayer(fetch),
    });

    assert.deepEqual(yield* client.userInfo("access-token", ACCOUNT_PROVIDER.GITHUB), {
      id: "internal-user-id",
      email: "developer@example.com",
      name: "Developer",
      provider: ACCOUNT_PROVIDER.GITHUB,
    });
  }),
);

it.effect("invalid token and identity responses are refused", () =>
  Effect.gen(function* () {
    const tokenClient = new AccountClient({
      baseUrl: "https://tryluke.dev/api/auth",
      clientId: "luke-desktop",
      httpClient: fakeHttpClientLayer(async () => json({ access_token: "access-only" })),
    });
    const tokens = yield* Effect.flip(
      tokenClient.exchangeCode({
        code: "authorization-code",
        codeVerifier: "verifier",
        redirectUri: "http://127.0.0.1:49152/callback",
      }),
    );
    assert.match(tokens.message, /both tokens/);

    const identityClient = new AccountClient({
      baseUrl: "https://tryluke.dev/api/auth",
      clientId: "luke-desktop",
      httpClient: fakeHttpClientLayer(async () => json({ provider: "unknown" })),
    });
    const identity = yield* Effect.flip(identityClient.userInfo("access", ACCOUNT_PROVIDER.GOOGLE));
    assert.match(identity.message, /invalid identity/);
  }),
);

test("capture and fixture runs bypass the account wall", () => {
  assert.equal(accountGateOpen({ requiresAccount: false }, false), true);
  assert.equal(accountGateOpen({ requiresAccount: true }, false), false);
  assert.equal(accountGateOpen({ requiresAccount: true }, true), true);
});

const ISSUED_TOKENS = { accessToken: "issued-access", refreshToken: "issued-refresh" };

it.effect("a failed account completion revokes every issued refresh token", () =>
  Effect.gen(function* () {
    const revoked: string[] = [];
    const failure = new Error("identity failed");
    const outcome = yield* Effect.exit(
      withIssuedAccountTokens({
        issue: Effect.succeed(ISSUED_TOKENS),
        use: () => Effect.fail(failure),
        revoke: (refreshToken) =>
          Effect.sync(() => {
            revoked.push(refreshToken);
          }),
      }),
    );

    assert.deepEqual(outcome, Exit.fail(failure));
    assert.deepEqual(revoked, [ISSUED_TOKENS.refreshToken]);
  }),
);

/** A client over a fake service that records the one request it was sent. */
function recordingClient(answer: () => Response) {
  let request: Request | undefined;
  const fetch: FakeResponder = async (input, init) => {
    request = new Request(input, init);
    return answer();
  };
  const client = new AccountClient({
    baseUrl: "https://tryluke.dev/api/auth",
    clientId: "luke-desktop",
    httpClient: fakeHttpClientLayer(fetch),
  });
  return { client, sent: () => request };
}

it.effect(
  "the session exchange sends the plugin's code, state, and verifier, and keeps the signed token",
  () =>
    Effect.gen(function* () {
      const { client, sent } = recordingClient(() => {
        const answered = json({
          token: "bare-session",
          user: { id: "user-1", email: "dev@example.com" },
        });
        answered.headers.set("set-auth-token", "bare-session.signature");
        return answered;
      });

      const session = yield* client.exchangeSessionCode({
        code: "plugin-code",
        state: "state-value",
        codeVerifier: "verifier",
      });

      assert.deepEqual(session, {
        sessionToken: "bare-session.signature",
        userId: "user-1",
        email: "dev@example.com",
      });
      const request = sent();
      assert.equal(request?.url, "https://tryluke.dev/api/auth/electron/token");
      assert.equal(request?.method, "POST");
      assert.deepEqual(yield* Effect.promise(() => request?.json() ?? Promise.resolve()), {
        token: "plugin-code",
        state: "state-value",
        code_verifier: "verifier",
      });
    }),
);

it.effect("an exchange answered without the signed token is no session", () =>
  Effect.gen(function* () {
    const { client } = recordingClient(() =>
      json({ token: "bare-session", user: { id: "user-1" } }),
    );

    const exchanged = yield* Effect.exit(
      client.exchangeSessionCode({ code: "plugin-code", state: "s", codeVerifier: "v" }),
    );

    assert.equal(Exit.isFailure(exchanged), true);
  }),
);

it.effect("ending the session signs out under the session as a bearer", () =>
  Effect.gen(function* () {
    const { client, sent } = recordingClient(() => json({ success: true }));

    yield* client.endSession("bare-session.signature");

    assert.equal(sent()?.url, "https://tryluke.dev/api/auth/sign-out");
    assert.equal(sent()?.headers.get("authorization"), "Bearer bare-session.signature");
  }),
);
