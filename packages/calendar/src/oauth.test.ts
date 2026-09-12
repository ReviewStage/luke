import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  fakeHttpClientLayer,
  HTTP_STATUS,
  type RecordedRequest,
  recordingHttpClient,
} from "@sidecar/wire/testing";
import { Effect, Fiber } from "effect";
import { test } from "vitest";
import {
  exchangeGoogleCode,
  GOOGLE_AUTHORIZATION_URL,
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_TOKEN_URL,
  googleCalendarSignIn,
  googleCalendarSignInConfig,
} from "./oauth.js";

const CLIENT_ID = "324871084874-test.apps.googleusercontent.com";
const CLIENT_SECRET = "GOCSPX-test-secret";

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    GOOGLE_CALENDAR_OAUTH_CLIENT_ID: CLIENT_ID,
    GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
    ...overrides,
  };
}

function tokenResponse(): Response {
  return new Response(
    JSON.stringify({ access_token: "at-1", refresh_token: "1//refresh-token", expires_in: 3599 }),
    { status: HTTP_STATUS.OK, headers: { "content-type": "application/json" } },
  );
}

test("the sign-in is offered exactly when the whole registration is held", () => {
  // A bare checkout holds the registered client id but no secret — packaging
  // injects that — so it offers no sign-in rather than one that would fail
  // mid-exchange.
  assert.equal(googleCalendarSignInConfig({}), undefined);

  // The registered id stands in source, so a secret alone — the one thing
  // packaging injects — completes the registration.
  const completed = googleCalendarSignInConfig({
    GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET: "GOCSPX-supplied",
  });
  assert.equal(completed?.clientSecret, "GOCSPX-supplied");

  // The variables stand in for development against another registration.
  const overridden = googleCalendarSignInConfig(environment());
  assert.equal(overridden?.clientId, CLIENT_ID);
});

it.effect("a run without the registration offers a flow that says so", () =>
  Effect.gen(function* () {
    const signIn = googleCalendarSignIn({ openExternal: () => undefined, environment: {} });
    assert.deepEqual(yield* Effect.scoped(signIn.signInEffect()), {
      reason: "Sign-in is not configured in this build.",
    });
  }),
);

it.effect("the consent page is Google's own, asking for availability alone, with PKCE", () =>
  Effect.gen(function* () {
    const opened: string[] = [];
    const signIn = googleCalendarSignIn({
      openExternal: (url) => opened.push(url),
      environment: environment(),
    });

    const pending = yield* Effect.fork(Effect.scoped(signIn.signInEffect()));
    // The browser is opened once the loopback is listening; wait for the URL.
    yield* Effect.promise(async () => {
      while (opened.length === 0) await new Promise((resolve) => setImmediate(resolve));
    });
    // SAFETY: The loop above returns only once the first URL was recorded.
    const authorization = new URL(opened[0] as string);

    assert.equal(authorization.origin + authorization.pathname, GOOGLE_AUTHORIZATION_URL);
    assert.equal(authorization.searchParams.get("client_id"), CLIENT_ID);
    assert.equal(authorization.searchParams.get("scope"), GOOGLE_CALENDAR_SCOPES);
    assert.equal(authorization.searchParams.get("response_type"), "code");
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    // Offline access is what a refresh token is, and the forced prompt is what
    // guarantees Google issues one rather than assuming an earlier grant.
    assert.equal(authorization.searchParams.get("access_type"), "offline");
    assert.equal(authorization.searchParams.get("prompt"), "consent");

    signIn.cancel();
    assert.deepEqual(yield* Fiber.join(pending), { reason: "Sign-in was cancelled." });
  }),
);

test("the exchange carries the desktop client's secret and the verifier", async () => {
  const { layer, requests } = recordingHttpClient(() => tokenResponse());
  const grant = await exchangeGoogleCode(
    { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
    { code: "auth-code", redirectUri: "http://127.0.0.1:4321/oauth/callback", codeVerifier: "v" },
    layer,
  );
  assert.deepEqual(grant, { refreshToken: "1//refresh-token", accessToken: "at-1" });

  // SAFETY: The exchange above recorded exactly one request.
  const exchange = requests[0] as RecordedRequest;
  assert.equal(exchange.url, GOOGLE_TOKEN_URL);
  const body = new URLSearchParams(exchange.body ?? "");
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "auth-code");
  assert.equal(body.get("redirect_uri"), "http://127.0.0.1:4321/oauth/callback");
  // Google's desktop client type expects the secret it documents as
  // non-confidential; PKCE is still what actually protects the flow.
  assert.equal(body.get("client_secret"), CLIENT_SECRET);
  assert.equal(body.get("code_verifier"), "v");
});

test("every way the exchange can fail is a sentence, never a throw", async () => {
  const config = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
  const input = {
    code: "auth-code",
    redirectUri: "http://127.0.0.1:4321/oauth/callback",
    codeVerifier: "v",
  };

  const { layer: refusing } = recordingHttpClient(
    () => new Response("no", { status: HTTP_STATUS.UNAUTHORIZED }),
  );
  assert.deepEqual(await exchangeGoogleCode(config, input, refusing), {
    reason: "Google refused the sign-in exchange.",
  });

  const { layer: tokenless } = recordingHttpClient(
    () =>
      new Response(JSON.stringify({ access_token: "at-1" }), {
        status: HTTP_STATUS.OK,
        headers: { "content-type": "application/json" },
      }),
  );
  assert.deepEqual(await exchangeGoogleCode(config, input, tokenless), {
    reason: "Google answered the sign-in without a token.",
  });

  const offline = () => Promise.reject(new Error("offline"));
  assert.deepEqual(await exchangeGoogleCode(config, input, fakeHttpClientLayer(offline)), {
    reason: "The sign-in exchange with Google did not complete.",
  });
});
