import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Schema } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { ACCOUNT_TOKEN_STORAGE, GITHUB_SIGN_IN_SCOPES } from "../server/auth-policy";
import type { WireValue } from "../server/core";

/**
 * A GitHub sign-in, configured as `auth.ts` configures it, over an in-memory
 * database with GitHub a fake behind `fetch`. What it holds is that a GitHub
 * sign-in asks for the developer's profile and email and nothing more, and
 * that moving the client from the OAuth App to the Luke GitHub App keeps
 * every account: GitHub knows the developer by one user id under both.
 *
 * Synthetic accounts, secrets, and tokens throughout.
 */

const BASE_URL = "https://tryluke.dev";
const OAUTH_APP_CLIENT = { clientId: "luke-github", clientSecret: "github-secret" };
const APP_CLIENT = {
  clientId: "Iv1.fixture-app-client",
  clientSecret: "fixture-app-client-secret",
};
const GITHUB_ACCOUNT_ID = "4242";
const GITHUB_EMAIL = "octo@github.test";
const NOW = new Date("2026-10-04T12:00:00.000Z");

/** The scopes GitHub reports granting a sign-in. */
const GRANTED_PROFILE = "read:user,user:email";

const decodeStarted = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));

/** What the fake GitHub answers the next token exchange with. */
interface Grant {
  token: string;
  scope: string;
}

/** The client each token exchange was signed with, in the order GitHub was asked. */
const exchanges: { clientId: string | null; clientSecret: string | null }[] = [];

function json(body: WireValue): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

/** GitHub's token endpoint and the two profile reads, answering whatever `grant` holds. */
function fakeGitHub(grant: Grant) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.href === "https://github.com/login/oauth/access_token") {
      const form = new URLSearchParams(
        input instanceof Request ? await input.text() : String(init?.body ?? ""),
      );
      exchanges.push({ clientId: form.get("client_id"), clientSecret: form.get("client_secret") });
      return json({ access_token: grant.token, token_type: "bearer", scope: grant.scope });
    }
    if (url.href === "https://api.github.com/user") {
      return json({ id: Number(GITHUB_ACCOUNT_ID), login: "octocat", email: null });
    }
    if (url.href === "https://api.github.com/user/emails") {
      return json([{ email: GITHUB_EMAIL, primary: true, verified: true }]);
    }
    throw new Error(`this test reaches no network: ${url.href}`);
  };
}

type Database = Parameters<typeof memoryAdapter>[0];

function emptyDatabase(): Database {
  return { user: [], session: [], account: [], verification: [] };
}

/** The auth service over `database`, signing in through `client`; the memory adapter writes into the object it is handed. */
function authService(client = OAUTH_APP_CLIENT, database = emptyDatabase()) {
  return betterAuth({
    baseURL: BASE_URL,
    secret: "fixture-session-secret-of-enough-length",
    database: memoryAdapter(database),
    account: ACCOUNT_TOKEN_STORAGE,
    socialProviders: {
      github: { ...client, scope: [...GITHUB_SIGN_IN_SCOPES] },
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

/** A whole GitHub sign-in: the press, GitHub's consent, and the callback landing. */
async function signIn(auth: Auth) {
  const { authorize, cookie } = await startSignIn(auth);
  const callback = new URL(`${BASE_URL}/api/auth/callback/github`);
  callback.searchParams.set("code", "github-code-under-test");
  callback.searchParams.set("state", authorize.searchParams.get("state") ?? "");
  const landed = await auth.handler(new Request(callback, { headers: { cookie } }));
  assert.equal(landed.status, 302);
  return cookiesFrom(landed);
}

/** The GitHub account rows of the user GitHub's email names. */
async function githubAccounts(auth: Auth) {
  const context = await auth.$context;
  const found = await context.internalAdapter.findUserByEmail(GITHUB_EMAIL);
  assert.ok(found);
  const accounts = await context.internalAdapter.findAccounts(found.user.id);
  return { userId: found.user.id, rows: accounts.filter((row) => row.providerId === "github") };
}

const grant: Grant = { token: "", scope: "" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", fakeGitHub(grant));
  exchanges.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("a GitHub sign-in asks for the profile and email, and nothing of the developer's repositories", async () => {
  const auth = authService();
  const { authorize } = await startSignIn(auth);

  Object.assign(grant, { token: "gho_signed-in", scope: GRANTED_PROFILE });
  await signIn(auth);

  // Better Auth puts its own defaults beside the configured scopes, so the request is read as a set.
  assert.deepEqual([...new Set(authorize.searchParams.get("scope")?.split(" "))].sort(), [
    "read:user",
    "user:email",
  ]);
});

test("an account that signed in through the OAuth App signs in to the same user through the App", async () => {
  const database = emptyDatabase();
  Object.assign(grant, { token: "gho_oauth-app", scope: GRANTED_PROFILE });
  await signIn(authService(OAUTH_APP_CLIENT, database));
  const before = await githubAccounts(authService(OAUTH_APP_CLIENT, database));

  // Production now holds the App's client; GitHub answers the exchange with the same user id.
  Object.assign(grant, { token: "ghu_app-token", scope: "" });
  const app = authService(APP_CLIENT, database);
  const { authorize } = await startSignIn(app);
  await signIn(app);
  const after = await githubAccounts(app);

  assert.equal(authorize.searchParams.get("client_id"), APP_CLIENT.clientId);
  assert.deepEqual(exchanges.at(-1), APP_CLIENT);
  assert.equal(after.userId, before.userId);
  assert.equal(database.user?.length, 1);
  assert.equal(after.rows.length, 1);
  assert.equal(after.rows[0]?.accountId, GITHUB_ACCOUNT_ID);
  assert.equal(before.rows[0]?.accountId, GITHUB_ACCOUNT_ID);
  // The row signed in through the App now holds the App's token, sealed, in place of the OAuth App's.
  assert.notEqual(after.rows[0]?.accessToken, before.rows[0]?.accessToken);
});
