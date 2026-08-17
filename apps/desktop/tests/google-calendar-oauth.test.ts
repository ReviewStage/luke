import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  GOOGLE_AUTHORIZATION_URL,
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_TOKEN_URL,
  GoogleCalendarSignIn,
  googleCalendarSignInConfig,
} from "../src/google-calendar-oauth";
import { HTTP_STATUS, type RecordedRequest, recordingFetch } from "./support/http-fake";

const CLIENT_ID = "324871084874-test.apps.googleusercontent.com";

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { GOOGLE_CALENDAR_OAUTH_CLIENT_ID: CLIENT_ID, ...overrides };
}

/** Follows the redirect the browser would make, code and all. */
async function answerCallback(
  authorizationUrl: string,
  parameters: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const redirectUri = new URL(authorizationUrl).searchParams.get("redirect_uri");
  assert.ok(redirectUri, "the authorization URL names the loopback redirect");
  const callback = new URL(redirectUri);
  for (const [name, value] of Object.entries(parameters)) {
    callback.searchParams.set(name, value);
  }
  const response = await fetch(callback);
  return { status: response.status, body: await response.text() };
}

function tokenResponse(): Response {
  return new Response(
    JSON.stringify({ access_token: "at-1", refresh_token: "1//refresh-token", expires_in: 3599 }),
    { status: HTTP_STATUS.OK, headers: { "content-type": "application/json" } },
  );
}

test("offers no sign-in without a client id", async () => {
  assert.equal(googleCalendarSignInConfig({}), undefined);

  const signIn = new GoogleCalendarSignIn({ openExternal: () => undefined, environment: {} });
  assert.deepEqual(await signIn.signIn(), { reason: "Sign-in is not configured in this build." });
});

test("runs the documented installed-app flow end to end", async () => {
  const opened: string[] = [];
  const { fetch: fakeFetch, requests } = recordingFetch(() => tokenResponse());
  const signIn = new GoogleCalendarSignIn({
    openExternal: (url) => opened.push(url),
    environment: environment(),
    fetchImplementation: fakeFetch as typeof globalThis.fetch,
  });

  const pending = signIn.signIn();
  // The browser is opened synchronously with the flow's start; wait a tick
  // for the loopback to be listening and the URL to be recorded.
  while (opened.length === 0) await new Promise((resolve) => setImmediate(resolve));
  const authorization = new URL(opened[0] as string);

  // The page is Google's own, asking for availability alone, with PKCE.
  assert.equal(authorization.origin + authorization.pathname, GOOGLE_AUTHORIZATION_URL);
  assert.equal(authorization.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(authorization.searchParams.get("scope"), GOOGLE_CALENDAR_SCOPES);
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("response_type"), "code");
  assert.equal(authorization.searchParams.get("access_type"), "offline");
  assert.match(authorization.searchParams.get("redirect_uri") ?? "", /^http:\/\/127\.0\.0\.1:\d+/);

  const state = authorization.searchParams.get("state") ?? "";
  const answered = await answerCallback(opened[0] as string, { state, code: "auth-code" });
  assert.equal(answered.status, 200);
  assert.match(answered.body, /connected/i);

  assert.deepEqual(await pending, { refreshToken: "1//refresh-token", accessToken: "at-1" });

  // The exchange went to Google's token endpoint carrying the verifier whose
  // hash the authorization page was shown — the PKCE contract, checkable here.
  assert.equal(requests.length, 1);
  const exchange = requests[0] as RecordedRequest;
  assert.equal(exchange.url, GOOGLE_TOKEN_URL);
  const body = new URLSearchParams(exchange.body ?? "");
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "auth-code");
  assert.equal(body.get("redirect_uri"), authorization.searchParams.get("redirect_uri"));
  const verifier = body.get("code_verifier") ?? "";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  assert.equal(authorization.searchParams.get("code_challenge"), challenge);
});

test("a redirect with the wrong state is refused without ending the wait", async () => {
  const opened: string[] = [];
  const { fetch: fakeFetch } = recordingFetch(() => tokenResponse());
  const signIn = new GoogleCalendarSignIn({
    openExternal: (url) => opened.push(url),
    environment: environment(),
    fetchImplementation: fakeFetch as typeof globalThis.fetch,
  });

  const pending = signIn.signIn();
  while (opened.length === 0) await new Promise((resolve) => setImmediate(resolve));
  const authorization = new URL(opened[0] as string);
  const state = authorization.searchParams.get("state") ?? "";

  // A stray or forged request is answered 404 and the flow keeps waiting.
  const forged = await answerCallback(opened[0] as string, { state: "not-it", code: "stolen" });
  assert.equal(forged.status, 404);

  const genuine = await answerCallback(opened[0] as string, { state, code: "auth-code" });
  assert.equal(genuine.status, 200);
  assert.deepEqual(await pending, { refreshToken: "1//refresh-token", accessToken: "at-1" });
});

test("a refusal from Google is an answer, not an exchange", async () => {
  const opened: string[] = [];
  const { fetch: fakeFetch, requests } = recordingFetch(() => tokenResponse());
  const signIn = new GoogleCalendarSignIn({
    openExternal: (url) => opened.push(url),
    environment: environment(),
    fetchImplementation: fakeFetch as typeof globalThis.fetch,
  });

  const pending = signIn.signIn();
  while (opened.length === 0) await new Promise((resolve) => setImmediate(resolve));
  const state = new URL(opened[0] as string).searchParams.get("state") ?? "";

  const answered = await answerCallback(opened[0] as string, {
    state,
    error: "access_denied",
  });
  assert.equal(answered.status, 200);
  assert.match(answered.body, /didn’t complete/i);
  assert.deepEqual(await pending, { reason: "Google did not grant access." });
  assert.deepEqual(requests, []);
});

test("an abandoned sign-in times out instead of listening forever", async () => {
  const signIn = new GoogleCalendarSignIn({
    openExternal: () => undefined,
    environment: environment(),
    timeoutMs: 20,
  });

  const outcome = await signIn.signIn();
  assert.ok("reason" in outcome && /timed out/i.test(outcome.reason));
});

test("one sign-in at a time", async () => {
  const opened: string[] = [];
  const { fetch: fakeFetch } = recordingFetch(() => tokenResponse());
  const signIn = new GoogleCalendarSignIn({
    openExternal: (url) => opened.push(url),
    environment: environment(),
    fetchImplementation: fakeFetch as typeof globalThis.fetch,
  });

  const first = signIn.signIn();
  while (opened.length === 0) await new Promise((resolve) => setImmediate(resolve));
  const second = await signIn.signIn();
  assert.ok("reason" in second && /already/i.test(second.reason));

  const state = new URL(opened[0] as string).searchParams.get("state") ?? "";
  await answerCallback(opened[0] as string, { state, code: "auth-code" });
  assert.deepEqual(await first, { refreshToken: "1//refresh-token", accessToken: "at-1" });
});

test("cancelling ends the wait; a grant given after lands nowhere", async () => {
  const opened: string[] = [];
  const { fetch: fakeFetch, requests } = recordingFetch(() => tokenResponse());
  const signIn = new GoogleCalendarSignIn({
    openExternal: (url) => opened.push(url),
    environment: environment(),
    fetchImplementation: fakeFetch as typeof globalThis.fetch,
  });

  const pending = signIn.signIn();
  while (opened.length === 0) await new Promise((resolve) => setImmediate(resolve));
  signIn.cancel();
  assert.deepEqual(await pending, { reason: "Sign-in was cancelled." });

  // The loopback has stopped listening: the redirect has nowhere to land.
  const state = new URL(opened[0] as string).searchParams.get("state") ?? "";
  await assert.rejects(() => answerCallback(opened[0] as string, { state, code: "late" }));
  assert.deepEqual(requests, []);
});

test("a lost tab reopens the very page the flow is listening for", async () => {
  const opened: string[] = [];
  const { fetch: fakeFetch } = recordingFetch(() => tokenResponse());
  const signIn = new GoogleCalendarSignIn({
    openExternal: (url) => opened.push(url),
    environment: environment(),
    fetchImplementation: fakeFetch as typeof globalThis.fetch,
  });

  // Nothing waiting, nothing to reopen.
  signIn.reopen();
  assert.deepEqual(opened, []);

  const pending = signIn.signIn();
  while (opened.length === 0) await new Promise((resolve) => setImmediate(resolve));
  signIn.reopen();
  assert.equal(opened.length, 2);
  // The same URL exactly: same state, same challenge, same loopback port.
  assert.equal(opened[1], opened[0]);

  const state = new URL(opened[0] as string).searchParams.get("state") ?? "";
  await answerCallback(opened[0] as string, { state, code: "auth-code" });
  await pending;
  // A finished flow leaves nothing listening, so nothing reopens.
  signIn.reopen();
  assert.equal(opened.length, 2);
});
