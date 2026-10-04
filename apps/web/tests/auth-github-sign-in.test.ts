import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Schema } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { ACCOUNT_TOKEN_STORAGE, GITHUB_SIGN_IN_SCOPES } from "../server/auth-policy";
import type { WireValue } from "../server/core";

/**
 * A GitHub sign-in, configured as `auth.ts` configures it, over an in-memory
 * database with GitHub a fake behind `fetch`. What these hold is that a
 * GitHub sign-in alone leaves the account a GitHub row that reads source,
 * so a developer who signed in with GitHub is never sent to the Connect
 * GitHub step, and that a row from before sign-in asked for `repo` gains it
 * the next time the developer signs in.
 *
 * Synthetic accounts, secrets, and tokens throughout.
 */

const BASE_URL = "https://tryluke.dev";
const GITHUB_ACCOUNT_ID = "4242";
const GITHUB_EMAIL = "octo@github.test";
const NOW = new Date("2026-10-04T12:00:00.000Z");

/** The scopes GitHub reports granting, before sign-in asked for `repo` and since. */
const GRANTED = {
  PROFILE_ONLY: "read:user,user:email",
  WITH_REPOSITORIES: "repo,read:user,user:email",
} as const;

const decodeStarted = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));

/** What the fake GitHub answers the next token exchange with. */
interface Grant {
  token: string;
  scope: string;
}

function json(body: WireValue): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

/** GitHub's token endpoint and the two profile reads, answering whatever `grant` holds. */
function fakeGitHub(grant: Grant) {
  return (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.href === "https://github.com/login/oauth/access_token") {
      return Promise.resolve(
        json({ access_token: grant.token, token_type: "bearer", scope: grant.scope }),
      );
    }
    if (url.href === "https://api.github.com/user") {
      return Promise.resolve(
        json({ id: Number(GITHUB_ACCOUNT_ID), login: "octocat", email: null }),
      );
    }
    if (url.href === "https://api.github.com/user/emails") {
      return Promise.resolve(json([{ email: GITHUB_EMAIL, primary: true, verified: true }]));
    }
    throw new Error(`this test reaches no network: ${url.href}`);
  };
}

function authService() {
  return betterAuth({
    baseURL: BASE_URL,
    secret: "fixture-session-secret-of-enough-length",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    account: ACCOUNT_TOKEN_STORAGE,
    socialProviders: {
      github: {
        clientId: "luke-github",
        clientSecret: "github-secret",
        scope: [...GITHUB_SIGN_IN_SCOPES],
      },
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

/** The account's GitHub token and scope, opened as a planning read opens them. */
async function githubConnection(auth: Auth, cookie: string) {
  const opened = await auth.api.getAccessToken({
    body: { providerId: "github" },
    headers: new Headers({ cookie }),
  });
  return { token: opened.accessToken, scopes: opened.scopes };
}

const grant: Grant = { token: "", scope: "" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", fakeGitHub(grant));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("a GitHub sign-in asks for repositories and leaves a connection that reads them", async () => {
  const auth = authService();
  const { authorize } = await startSignIn(auth);
  assert.equal(authorize.searchParams.get("scope")?.split(" ").includes("repo"), true);

  Object.assign(grant, { token: "gho_signed-in", scope: GRANTED.WITH_REPOSITORIES });
  const cookie = await signIn(auth);

  const connection = await githubConnection(auth, cookie);
  assert.equal(connection.token, "gho_signed-in");
  assert.equal(connection.scopes.includes("repo"), true);
});

test("signing in again with GitHub replaces a profile-only token with one that reads repositories", async () => {
  const auth = authService();
  Object.assign(grant, { token: "gho_profile-only", scope: GRANTED.PROFILE_ONLY });
  await signIn(auth);

  Object.assign(grant, { token: "gho_with-repositories", scope: GRANTED.WITH_REPOSITORIES });
  const cookie = await signIn(auth);

  const connection = await githubConnection(auth, cookie);
  assert.equal(connection.token, "gho_with-repositories");
  assert.equal(connection.scopes.includes("repo"), true);
});
