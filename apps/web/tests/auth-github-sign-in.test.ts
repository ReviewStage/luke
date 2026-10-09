import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Schema } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { ACCOUNT_TOKEN_STORAGE, DISABLED_AUTH_PATHS, GITHUB_SIGN_IN } from "../server/auth-policy";
import type { WireValue } from "../server/core";

/**
 * A GitHub sign-in, configured as `auth.ts` configures it, over an in-memory
 * database with GitHub a fake behind `fetch`. Sign-in is the Luke GitHub
 * App's user authorization, so what this holds is that GitHub is asked as
 * the App's client and for no OAuth scope; that an account from before the
 * App, the same GitHub user, signs in to the user it already has and comes
 * away holding the App's expiring token and its refresh token, sealed; and
 * that the auth service hands no browser that token.
 *
 * Synthetic accounts, secrets, and tokens throughout.
 */

const BASE_URL = "https://tryluke.dev";
const APP_CLIENT_ID = "Iv1.fixture-app-client";
const APP_CLIENT_SECRET = "fixture-app-client-secret";
const GITHUB_ACCOUNT_ID = "4242";
const GITHUB_EMAIL = "octo@github.test";
const NOW = new Date("2026-10-09T12:00:00.000Z");
const HOUR_SECONDS = 60 * 60;

const decodeStarted = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));

/** What the fake GitHub answers the next token exchange with; the App's answer carries expiries, the OAuth App's did not. */
interface Grant {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly refresh_token_expires_in?: number;
  readonly scope: string;
}

const OAUTH_APP_GRANT: Grant = { access_token: "gho_oauth-app", scope: "read:user,user:email" };
const APP_GRANT = {
  access_token: "ghu_app-token",
  refresh_token: "ghr_app-refresh",
  expires_in: 8 * HOUR_SECONDS,
  refresh_token_expires_in: 180 * 24 * HOUR_SECONDS,
  scope: "",
} as const satisfies Grant;

/** Every token exchange GitHub was asked for, as the form it was sent. */
const exchanges: URLSearchParams[] = [];
let grant: Grant = APP_GRANT;

function json(body: WireValue): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

/** GitHub's token endpoint and the two profile reads, answering whatever `grant` holds. */
async function fakeGitHub(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.href === "https://github.com/login/oauth/access_token") {
    const body = input instanceof Request ? await input.text() : String(init?.body ?? "");
    exchanges.push(new URLSearchParams(body));
    return json({ token_type: "bearer", ...grant });
  }
  if (url.href === "https://api.github.com/user") {
    return json({ id: Number(GITHUB_ACCOUNT_ID), login: "octocat", email: null });
  }
  if (url.href === "https://api.github.com/user/emails") {
    return json([{ email: GITHUB_EMAIL, primary: true, verified: true }]);
  }
  throw new Error(`this test reaches no network: ${url.href}`);
}

function authService() {
  return betterAuth({
    baseURL: BASE_URL,
    secret: "fixture-session-secret-of-enough-length",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    account: ACCOUNT_TOKEN_STORAGE,
    disabledPaths: [...DISABLED_AUTH_PATHS],
    socialProviders: {
      github: { clientId: APP_CLIENT_ID, clientSecret: APP_CLIENT_SECRET, ...GITHUB_SIGN_IN },
    },
  });
}

type Auth = ReturnType<typeof authService>;

function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** The sign-in page's GitHub press: answers GitHub's authorize URL and the flow's cookie. */
async function startSignIn(auth: Auth) {
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ provider: "github", callbackURL: "/" }),
    }),
  );
  return {
    authorize: new URL(decodeStarted(await response.json()).url),
    cookie: cookiesFrom(response),
  };
}

/** A whole GitHub sign-in: the press, GitHub's consent, and the callback landing; answers the session cookie. */
async function signIn(auth: Auth) {
  const { authorize, cookie } = await startSignIn(auth);
  const callback = new URL(`${BASE_URL}/api/auth/callback/github`);
  callback.searchParams.set("code", "github-code-under-test");
  callback.searchParams.set("state", authorize.searchParams.get("state") ?? "");
  const landed = await auth.handler(new Request(callback, { headers: { cookie } }));
  assert.equal(landed.status, 302);
  return cookiesFrom(landed);
}

async function githubAccounts(auth: Auth) {
  const context = await auth.$context;
  const found = await context.internalAdapter.findUserByEmail(GITHUB_EMAIL);
  assert.ok(found);
  const accounts = await context.internalAdapter.findAccounts(found.user.id);
  return { userId: found.user.id, rows: accounts.filter((row) => row.providerId === "github") };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", fakeGitHub);
  exchanges.length = 0;
  grant = APP_GRANT;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("a GitHub sign-in is the App's own authorization: its client id, no OAuth scope, and its secret on the exchange", async () => {
  const auth = authService();
  const { authorize } = await startSignIn(auth);
  await signIn(auth);

  assert.equal(authorize.origin + authorize.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(authorize.searchParams.get("client_id"), APP_CLIENT_ID);
  assert.equal(authorize.searchParams.get("scope") ?? "", "");
  const [exchange] = exchanges;
  assert.ok(exchange);
  assert.equal(exchange.get("client_id"), APP_CLIENT_ID);
  assert.equal(exchange.get("client_secret"), APP_CLIENT_SECRET);
});

test("an account from before the App signs in to the same user and comes away with the App's tokens, sealed", async () => {
  const auth = authService();
  grant = OAUTH_APP_GRANT;
  await signIn(auth);
  const before = await githubAccounts(auth);
  assert.equal(before.rows.length, 1);
  assert.equal(before.rows[0]?.refreshToken ?? null, null);

  grant = APP_GRANT;
  await signIn(auth);
  const after = await githubAccounts(auth);

  assert.equal(after.userId, before.userId);
  assert.equal(after.rows.length, 1);
  const [row] = after.rows;
  assert.ok(row);
  assert.equal(row.accountId, GITHUB_ACCOUNT_ID);
  assert.equal(row.accessTokenExpiresAt?.getTime(), NOW.getTime() + APP_GRANT.expires_in * 1000);
  assert.equal(
    row.refreshTokenExpiresAt?.getTime(),
    NOW.getTime() + APP_GRANT.refresh_token_expires_in * 1000,
  );
  // Sealed under the session secret: the row holds neither token as GitHub spelled it.
  assert.ok(row.accessToken && row.refreshToken);
  assert.notEqual(row.accessToken, APP_GRANT.access_token);
  assert.notEqual(row.refreshToken, APP_GRANT.refresh_token);
});

test("the auth service hands no browser the GitHub token: the token endpoints are not served", async () => {
  const auth = authService();
  const cookie = await signIn(auth);

  for (const path of ["/get-access-token", "/refresh-token"]) {
    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth${path}`, {
        method: "POST",
        headers: { origin: BASE_URL, "content-type": "application/json", cookie },
        body: JSON.stringify({ providerId: "github" }),
      }),
    );
    assert.equal(response.status, 404, path);
    assert.equal((await response.text()).includes(APP_GRANT.access_token), false);
  }
});
