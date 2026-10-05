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
 * sign-in asks for the developer's profile and email and nothing more.
 *
 * Synthetic accounts, secrets, and tokens throughout.
 */

const BASE_URL = "https://tryluke.dev";
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
