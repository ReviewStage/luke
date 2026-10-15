import assert from "node:assert/strict";
import { electron } from "@better-auth/electron";
import { oauthProvider } from "@better-auth/oauth-provider";
import { DESKTOP_SESSION_CLIENT_ID } from "@luke/features/desktop-session-wire";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { bearer, jwt } from "better-auth/plugins";
import { Schema } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { WireValue } from "../core.js";
import {
  ACCOUNT_TOKEN_STORAGE,
  DESKTOP_SESSION,
  DISABLED_AUTH_PATHS,
  denyOAuthClientPrivileges,
  JWT_KEY_STORAGE,
  SESSION_BEARER,
} from "./auth-policy.js";
import { DESKTOP_OAUTH_CLIENT, oauthClientRecord } from "./oauth-clients.js";

/**
 * The Mac's session beside its OAuth token, end to end on one Better Auth
 * configured as `auth.ts` configures it, over an in-memory database, with
 * GitHub a fake behind `fetch`. The Mac signs in through its OAuth
 * authorization; the signed-in browser then asks the Electron plugin to
 * transfer the user, and the Mac exchanges the code with its verifier for a
 * session it carries as a signed bearer token. Synthetic accounts throughout.
 */

const SERVICE_URL = "https://tryluke.dev";
const LOOPBACK = "http://127.0.0.1:54698/callback";

const GITHUB_CODE = "github-code-under-test";
const GITHUB_TOKEN = "ghu_signed-in-token-under-test";
const GITHUB_EMAIL = "octo@github.test";

const NOW = new Date("2026-10-14T12:00:00.000Z");

/** RFC 7636's example pair, standing in for a verifier the Mac drew. */
const PKCE = {
  verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
} as const;

const decodeStarted = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));
const decodeTokens = Schema.decodeUnknownSync(Schema.Struct({ access_token: Schema.String }));
const decodeUserInfo = Schema.decodeUnknownSync(Schema.Struct({ sub: Schema.String }));
const decodeTransfer = Schema.decodeUnknownSync(
  Schema.Struct({ electron_authorization_code: Schema.String }),
);
const decodeExchanged = Schema.decodeUnknownSync(
  Schema.Struct({ token: Schema.String, user: Schema.Struct({ email: Schema.String }) }),
);
const decodeSession = Schema.decodeUnknownSync(
  Schema.NullOr(
    Schema.Struct({ user: Schema.Struct({ id: Schema.String, email: Schema.String }) }),
  ),
);

function desktopAuth() {
  return betterAuth({
    appName: "Luke",
    baseURL: SERVICE_URL,
    secret: "desktop-session-test-secret-of-enough-length",
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      jwks: [],
      oauthClient: [oauthClientRecord(DESKTOP_OAUTH_CLIENT, NOW)],
      oauthAccessToken: [],
      oauthRefreshToken: [],
      oauthConsent: [],
      oauthClientResource: [],
      oauthResource: [],
    }),
    account: ACCOUNT_TOKEN_STORAGE,
    disabledPaths: [...DISABLED_AUTH_PATHS],
    socialProviders: {
      github: { clientId: "luke-github", clientSecret: "github-secret", scope: ["read:user"] },
    },
    // The plugins `auth.ts` installs that this flow reaches, in its order.
    plugins: [
      jwt(JWT_KEY_STORAGE),
      oauthProvider({
        loginPage: "/sign-in.html",
        consentPage: "/consent.html",
        allowDynamicClientRegistration: false,
        clientPrivileges: denyOAuthClientPrivileges,
        cachedTrustedClients: new Set([DESKTOP_OAUTH_CLIENT.id]),
      }),
      electron(DESKTOP_SESSION),
      bearer(SESSION_BEARER),
    ],
  });
}

type Auth = ReturnType<typeof desktopAuth>;

function json(body: WireValue): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

/** GitHub's token endpoint and the two profile reads. */
function fakeGitHub(input: string | URL | Request): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.href === "https://github.com/login/oauth/access_token") {
    return Promise.resolve(json({ access_token: GITHUB_TOKEN, token_type: "bearer" }));
  }
  if (url.href === "https://api.github.com/user") {
    return Promise.resolve(json({ id: 4242, login: "octocat", email: null }));
  }
  if (url.href === "https://api.github.com/user/emails") {
    return Promise.resolve(json([{ email: GITHUB_EMAIL, primary: true, verified: true }]));
  }
  throw new Error(`this test reaches no network: ${url.href}`);
}

/** The `name=value` pairs a browser would send back from a response's cookies. */
function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

function location(response: Response): URL {
  const next = response.headers.get("location");
  assert.ok(next, `expected a redirect, got ${response.status}`);
  return new URL(next, SERVICE_URL);
}

function navigate(auth: Auth, url: URL | string, cookie?: string): Promise<Response> {
  const navigation = { accept: "text/html", "sec-fetch-mode": "navigate" };
  return auth.handler(
    new Request(url, { headers: cookie === undefined ? navigation : { ...navigation, cookie } }),
  );
}

function post(
  auth: Auth,
  path: string,
  body: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> {
  return auth.handler(
    new Request(`${SERVICE_URL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * The Mac's OAuth sign-in as today: authorize, the sign-in page's social
 * start, GitHub's return, and the redirects back to the loopback. Answers the
 * browser's session cookie and the Mac's OAuth access token.
 */
async function desktopSignsIn(auth: Auth): Promise<{ browser: string; accessToken: string }> {
  const authorizeQuery = new URLSearchParams({
    response_type: "code",
    client_id: DESKTOP_OAUTH_CLIENT.id,
    redirect_uri: LOOPBACK,
    scope: "openid profile email offline_access",
    state: "oauth-state",
    code_challenge: PKCE.challenge,
    code_challenge_method: "S256",
  });
  const loginPage = location(
    await navigate(auth, `${SERVICE_URL}/api/auth/oauth2/authorize?${authorizeQuery}`),
  );
  const started = await post(
    auth,
    "/sign-in/social",
    { provider: "github", oauth_query: loginPage.search.slice(1) },
    { origin: SERVICE_URL },
  );
  const github = new URL(decodeStarted(await started.json()).url);
  const callback = new URL(github.searchParams.get("redirect_uri") ?? "");
  callback.searchParams.set("code", GITHUB_CODE);
  callback.searchParams.set("state", github.searchParams.get("state") ?? "");
  const landed = await navigate(auth, callback, cookiesFrom(started));
  const browser = cookiesFrom(landed);
  let next = location(landed);
  for (let hop = 0; next.origin === SERVICE_URL && hop < 3; hop += 1) {
    next = location(await navigate(auth, next, browser));
  }
  assert.equal(`${next.origin}${next.pathname}`, LOOPBACK);
  const tokens = await auth.handler(
    new Request(`${SERVICE_URL}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: next.searchParams.get("code") ?? "",
        redirect_uri: LOOPBACK,
        client_id: DESKTOP_OAUTH_CLIENT.id,
        code_verifier: PKCE.verifier,
      }),
    }),
  );
  return { browser, accessToken: decodeTokens(await tokens.json()).access_token };
}

/** The hand-off page asking the plugin to transfer the browser's user, on the Mac's challenge and state. */
async function transfer(auth: Auth, browser: string, state: string): Promise<string> {
  const query = new URLSearchParams({
    client_id: DESKTOP_SESSION_CLIENT_ID,
    state,
    code_challenge: PKCE.challenge,
  });
  const answered = await post(
    auth,
    `/electron/transfer-user?${query}`,
    {},
    { origin: SERVICE_URL, cookie: browser },
  );
  assert.equal(answered.status, 200);
  return decodeTransfer(await answered.json()).electron_authorization_code;
}

/** The Mac's exchange at `/electron/token`, from its main process: no cookie, no origin. */
function exchange(auth: Auth, token: string, state: string, verifier: string): Promise<Response> {
  return post(auth, "/electron/token", { token, state, code_verifier: verifier });
}

async function sessionFor(auth: Auth, headers: Readonly<Record<string, string>>) {
  const answered = await auth.handler(
    new Request(`${SERVICE_URL}/api/auth/get-session`, { headers }),
  );
  return decodeSession(await answered.json());
}

async function userInfoSubject(auth: Auth, accessToken: string): Promise<string> {
  const answered = await auth.handler(
    new Request(`${SERVICE_URL}/api/auth/oauth2/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}` },
    }),
  );
  assert.equal(answered.status, 200);
  return decodeUserInfo(await answered.json()).sub;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", fakeGitHub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("after its OAuth sign-in the Mac holds a session of its own, carried as a signed bearer token", async () => {
  const auth = desktopAuth();
  const { browser, accessToken } = await desktopSignsIn(auth);

  const code = await transfer(auth, browser, "session-state");
  const exchanged = await exchange(auth, code, "session-state", PKCE.verifier);
  assert.equal(exchanged.status, 200);
  const signed = exchanged.headers.get("set-auth-token");
  assert.ok(signed);
  assert.equal(decodeExchanged(await exchanged.json()).user.email, GITHUB_EMAIL);

  const session = await sessionFor(auth, { authorization: `Bearer ${signed}` });
  assert.equal(session?.user.email, GITHUB_EMAIL);
  // Luke's own routes still read the OAuth token through userinfo, beside the bearer plugin.
  assert.equal(await userInfoSubject(auth, accessToken), session?.user.id);
});

test("the Mac's session outlives the browser's sign-out, since it is a session of its own", async () => {
  const auth = desktopAuth();
  const { browser } = await desktopSignsIn(auth);
  const code = await transfer(auth, browser, "session-state");
  const signed = (await exchange(auth, code, "session-state", PKCE.verifier)).headers.get(
    "set-auth-token",
  );

  const signedOut = await post(auth, "/sign-out", {}, { origin: SERVICE_URL, cookie: browser });
  assert.equal(signedOut.status, 200);

  assert.equal((await sessionFor(auth, { cookie: browser }))?.user, undefined);
  assert.equal(
    (await sessionFor(auth, { authorization: `Bearer ${signed}` }))?.user.email,
    GITHUB_EMAIL,
  );
});

test("a code is spent once, and only with the verifier and state the Mac drew", async () => {
  const auth = desktopAuth();
  const { browser } = await desktopSignsIn(auth);

  const wrongVerifier = await transfer(auth, browser, "state-a");
  assert.equal((await exchange(auth, wrongVerifier, "state-a", "not-the-verifier")).status, 400);

  const wrongState = await transfer(auth, browser, "state-b");
  assert.equal((await exchange(auth, wrongState, "state-other", PKCE.verifier)).status, 400);

  const code = await transfer(auth, browser, "state-c");
  assert.equal((await exchange(auth, code, "state-c", PKCE.verifier)).status, 200);
  assert.equal((await exchange(auth, code, "state-c", PKCE.verifier)).status, 404);
});

test("a bare session token is not a bearer token: only the signed one counts", async () => {
  const auth = desktopAuth();
  const { browser } = await desktopSignsIn(auth);
  const code = await transfer(auth, browser, "session-state");
  const bare = decodeExchanged(
    await (await exchange(auth, code, "session-state", PKCE.verifier)).json(),
  ).token;

  assert.equal(await sessionFor(auth, { authorization: `Bearer ${bare}` }), null);
});

test("no browser session, no transfer; and the plugin's own sign-in start is not served", async () => {
  const auth = desktopAuth();
  const query = new URLSearchParams({
    client_id: DESKTOP_SESSION_CLIENT_ID,
    state: "session-state",
    code_challenge: PKCE.challenge,
  });

  const anonymous = await post(
    auth,
    `/electron/transfer-user?${query}`,
    {},
    { origin: SERVICE_URL },
  );
  assert.equal(anonymous.status, 401);

  const proxied = await navigate(
    auth,
    `${SERVICE_URL}/api/auth/electron/init-oauth-proxy?provider=github&${query}`,
  );
  assert.equal(proxied.status, 404);
});

test("the Mac's sign-out under its bearer token ends its session, and the browser's stands", async () => {
  const auth = desktopAuth();
  const { browser } = await desktopSignsIn(auth);
  const code = await transfer(auth, browser, "session-state");
  const signed = (await exchange(auth, code, "session-state", PKCE.verifier)).headers.get(
    "set-auth-token",
  );
  const bearerHeader = { authorization: `Bearer ${signed}` };

  const signedOut = await post(auth, "/sign-out", {}, bearerHeader);
  assert.equal(signedOut.status, 200);

  assert.equal(await sessionFor(auth, bearerHeader), null);
  assert.equal((await sessionFor(auth, { cookie: browser }))?.user.email, GITHUB_EMAIL);
});
