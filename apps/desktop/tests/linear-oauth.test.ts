import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import test from "node:test";
import {
  LINEAR_AUTHORIZATION_URL,
  LINEAR_REDIRECT_URIS,
  LINEAR_REFRESH_STATUS,
  LINEAR_REVOKE_URL,
  LINEAR_SCOPES,
  LINEAR_TOKEN_URL,
  LinearSignIn,
  linearSignInConfig,
  refreshLinearGrant,
  revokeLinearGrant,
} from "../src/linear-oauth";
import {
  HTTP_STATUS,
  jsonResponse,
  type RecordedRequest,
  recordingFetch,
} from "./support/http-fake";

const CLIENT_ID = "6f0a2c1e9b3d4f5a";
const NOW = 1_760_000_000_000;

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { LINEAR_OAUTH_CLIENT_ID: CLIENT_ID, ...overrides };
}

/**
 * Follows the redirect the browser would make, code and all. On its own
 * connection every time: the loopback binds one of a few registered ports
 * rather than an ephemeral one, so a pooled socket left over from an earlier
 * flow would be reused against a server that has since closed.
 */
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
  return new Promise((resolve, reject) => {
    const request = http.get({ ...urlParts(callback), agent: false }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", reject);
  });
}

function urlParts(url: URL): { host: string; port: string; path: string } {
  return { host: url.hostname, port: url.port, path: `${url.pathname}${url.search}` };
}

function grantResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    access_token: "lin_oauth_access",
    refresh_token: "lin_oauth_refresh",
    expires_in: 86_400,
    token_type: "Bearer",
    scope: LINEAR_SCOPES,
    ...overrides,
  });
}

function signInWith(respond: (request: RecordedRequest) => Response): {
  signIn: LinearSignIn;
  opened: string[];
  requests: RecordedRequest[];
} {
  const opened: string[] = [];
  const { fetch: fakeFetch, requests } = recordingFetch(respond);
  const signIn = new LinearSignIn({
    openExternal: (url) => opened.push(url),
    environment: environment(),
    fetchImplementation: fakeFetch as typeof globalThis.fetch,
    now: () => NOW,
  });
  return { signIn, opened, requests };
}

/** The browser is opened synchronously with the flow; wait for the loopback. */
async function openedUrl(opened: readonly string[]): Promise<URL> {
  while (opened.length === 0) await new Promise((resolve) => setImmediate(resolve));
  return new URL(opened[0] as string);
}

test("the sign-in carries its registration, and the environment may replace it", () => {
  // Linear needs no secret under PKCE, so the registered client id is the
  // whole registration and it stands in source: a bare checkout offers the
  // sign-in rather than hiding a row it could not open.
  const registered = linearSignInConfig({});
  assert.match(registered?.clientId ?? "", /^[0-9a-f]{32}$/);

  // The variable stands in for development against another registration.
  assert.deepEqual(linearSignInConfig(environment()), { clientId: CLIENT_ID });

  // A build whose registration was stripped offers nothing, which is what
  // keeps the row from being drawn refusing.
  assert.equal(
    linearSignInConfig({ LINEAR_OAUTH_CLIENT_ID: "   " })?.clientId,
    registered?.clientId,
  );
});

test("runs Linear's documented public-client flow end to end", async () => {
  const { signIn, opened, requests } = signInWith(() => grantResponse());

  const pending = signIn.signIn();
  const authorization = await openedUrl(opened);

  // The page is Linear's own, asking for the two scopes the two acts need,
  // with PKCE and as the developer rather than as an app of Luke's own.
  assert.equal(authorization.origin + authorization.pathname, LINEAR_AUTHORIZATION_URL);
  assert.equal(authorization.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(authorization.searchParams.get("scope"), LINEAR_SCOPES);
  assert.equal(authorization.searchParams.get("response_type"), "code");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("actor"), "user");
  assert.equal(authorization.searchParams.get("prompt"), "consent");
  // Linear matches the redirect against what the application registered, so
  // the flow may only ever use an address that registration carries.
  const redirectUri = authorization.searchParams.get("redirect_uri") ?? "";
  assert.ok(
    LINEAR_REDIRECT_URIS.includes(redirectUri),
    `${redirectUri} is one of the registered redirects`,
  );

  const state = authorization.searchParams.get("state") ?? "";
  const answered = await answerCallback(opened[0] as string, { state, code: "auth-code" });
  assert.equal(answered.status, 200);
  assert.match(answered.body, /connected/i);

  assert.deepEqual(await pending, {
    accessToken: "lin_oauth_access",
    refreshToken: "lin_oauth_refresh",
    expiresAt: NOW + 86_400_000,
  });

  // The exchange went to Linear's token endpoint carrying the verifier whose
  // hash the authorization page was shown — the PKCE contract, checkable here.
  assert.equal(requests.length, 1);
  const exchange = requests[0] as RecordedRequest;
  assert.equal(exchange.url, LINEAR_TOKEN_URL);
  const body = new URLSearchParams(exchange.body ?? "");
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "auth-code");
  assert.equal(body.get("redirect_uri"), redirectUri);
  // No secret travels: PKCE is what protects a public client, and a secret
  // every installed copy carried would protect nothing the verifier does not.
  assert.equal(body.get("client_secret"), null);
  const verifier = body.get("code_verifier") ?? "";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  assert.equal(authorization.searchParams.get("code_challenge"), challenge);
});

test("a redirect with the wrong state is refused without ending the wait", async () => {
  const { signIn, opened } = signInWith(() => grantResponse());

  const pending = signIn.signIn();
  const authorization = await openedUrl(opened);
  const state = authorization.searchParams.get("state") ?? "";

  // A stray or forged request is answered 404 and the flow keeps waiting.
  const forged = await answerCallback(opened[0] as string, { state: "not-it", code: "stolen" });
  assert.equal(forged.status, 404);

  const genuine = await answerCallback(opened[0] as string, { state, code: "auth-code" });
  assert.equal(genuine.status, 200);
  assert.equal("accessToken" in (await pending), true);
});

test("the first valid callback exclusively claims the one-time code exchange", async () => {
  let finishExchange: ((response: Response) => void) | undefined;
  const exchangeResponse = new Promise<Response>((resolve) => {
    finishExchange = resolve;
  });
  const opened: string[] = [];
  const requests: RecordedRequest[] = [];
  const signIn = new LinearSignIn({
    openExternal: (url) => opened.push(url),
    environment: environment(),
    fetchImplementation: (async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return exchangeResponse;
    }) as typeof globalThis.fetch,
    now: () => NOW,
  });

  const pending = signIn.signIn();
  const authorization = await openedUrl(opened);
  const state = authorization.searchParams.get("state") ?? "";
  const first = answerCallback(opened[0] as string, { state, code: "auth-code" });
  while (requests.length === 0) await new Promise((resolve) => setImmediate(resolve));
  const duplicate = await answerCallback(opened[0] as string, { state, code: "auth-code" });
  assert.equal(duplicate.status, 404);
  assert.equal(requests.length, 1);

  finishExchange?.(grantResponse());
  assert.equal((await first).status, 200);
  assert.equal("accessToken" in (await pending), true);
});

test("a refusal from Linear is an answer, not an exchange", async () => {
  const { signIn, opened, requests } = signInWith(() => grantResponse());

  const pending = signIn.signIn();
  const authorization = await openedUrl(opened);
  const state = authorization.searchParams.get("state") ?? "";

  const answered = await answerCallback(opened[0] as string, { state, error: "access_denied" });
  assert.equal(answered.status, 200);
  assert.match(answered.body, /didn’t complete/i);
  assert.deepEqual(await pending, { reason: "Linear did not grant access." });
  assert.deepEqual(requests, []);
});

test("an abandoned sign-in times out instead of listening forever", async () => {
  const signIn = new LinearSignIn({
    openExternal: () => undefined,
    environment: environment(),
    timeoutMs: 20,
  });

  const outcome = await signIn.signIn();
  assert.ok("reason" in outcome && /timed out/i.test(outcome.reason));
});

test("one sign-in at a time", async () => {
  const { signIn, opened } = signInWith(() => grantResponse());

  const first = signIn.signIn();
  await openedUrl(opened);
  const second = await signIn.signIn();
  assert.deepEqual(second, { reason: "A sign-in is already waiting in your browser." });

  signIn.cancel();
  assert.deepEqual(await first, { reason: "Sign-in was cancelled." });
});

test("a refresh answer without its rotated refresh token is not persisted", async () => {
  const { fetch: fakeFetch } = recordingFetch(() =>
    grantResponse({ refresh_token: undefined, expires_in: 3_600 }),
  );
  const outcome = await refreshLinearGrant("spent-refresh", {
    environment: environment(),
    fetchImplementation: fakeFetch as typeof globalThis.fetch,
    now: () => NOW,
  });

  assert.deepEqual(outcome, { status: LINEAR_REFRESH_STATUS.UNREACHABLE });
});

test("Linear saying no and Linear saying nothing are different answers", async () => {
  const refused = await refreshLinearGrant("dead-refresh", {
    environment: environment(),
    fetchImplementation: recordingFetch(() =>
      jsonResponse({ error: "invalid_grant" }, HTTP_STATUS.UNAUTHORIZED),
    ).fetch as typeof globalThis.fetch,
  });
  assert.deepEqual(refused, { status: LINEAR_REFRESH_STATUS.REFUSED });

  // Someone else's outage is not a withdrawn grant, and neither is a network
  // that never answered: a developer must not be disconnected by either.
  const faulted = await refreshLinearGrant("good-refresh", {
    environment: environment(),
    fetchImplementation: recordingFetch(() => jsonResponse({}, HTTP_STATUS.SERVER_ERROR))
      .fetch as typeof globalThis.fetch,
  });
  assert.deepEqual(faulted, { status: LINEAR_REFRESH_STATUS.UNREACHABLE });

  const unreachable = await refreshLinearGrant("good-refresh", {
    environment: environment(),
    fetchImplementation: (() => Promise.reject(new Error("offline"))) as typeof globalThis.fetch,
  });
  assert.deepEqual(unreachable, { status: LINEAR_REFRESH_STATUS.UNREACHABLE });

  for (const status of [408, HTTP_STATUS.TOO_MANY_REQUESTS]) {
    const transient = await refreshLinearGrant("good-refresh", {
      environment: environment(),
      fetchImplementation: recordingFetch(() => jsonResponse({ error: "try_again" }, status))
        .fetch as typeof globalThis.fetch,
    });
    assert.deepEqual(transient, { status: LINEAR_REFRESH_STATUS.UNREACHABLE });
  }

  const malformed = await refreshLinearGrant("good-refresh", {
    environment: environment(),
    fetchImplementation: recordingFetch(() => jsonResponse({ expires_in: 86_400 }))
      .fetch as typeof globalThis.fetch,
  });
  assert.deepEqual(malformed, { status: LINEAR_REFRESH_STATUS.UNREACHABLE });
});

test("revoking posts the grant to Linear and never throws", async () => {
  const { fetch: fakeFetch, requests } = recordingFetch(() => jsonResponse({}, HTTP_STATUS.OK));
  assert.equal(
    await revokeLinearGrant("lin_oauth_access", fakeFetch as typeof globalThis.fetch),
    true,
  );

  const revoke = requests[0] as RecordedRequest;
  assert.equal(revoke.url, LINEAR_REVOKE_URL);
  assert.equal(revoke.authorization, "Bearer lin_oauth_access");
  assert.equal(new URLSearchParams(revoke.body ?? "").get("token"), "lin_oauth_access");

  // Best effort by design: the developer asked to disconnect, and a network
  // that cannot carry the message is no reason to keep the grant here.
  assert.equal(
    await revokeLinearGrant("lin_oauth_access", (() =>
      Promise.reject(new Error("offline"))) as typeof globalThis.fetch),
    false,
  );
});
