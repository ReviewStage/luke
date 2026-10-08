import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Schema } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { type AuthDeployment, authDeployment } from "../server/auth-deployment";
import { ACCOUNT_TOKEN_STORAGE } from "../server/auth-policy";
import { authProxy } from "../server/auth-proxy";
import type { WireValue } from "../server/core";

/**
 * A Preview's GitHub sign-in, carried end to end across the proxy's two
 * ends: a Preview and production, each a Better Auth over its own in-memory
 * database, configured as `auth.ts` configures them, with GitHub a fake
 * behind `fetch`. The OAuth App has registered production's callback alone,
 * so what this holds is that a sign-in begun on the Preview is sent through
 * that callback, that production relays it without signing anyone in on its
 * side, and that the Preview signs the GitHub user in.
 */

const PRODUCTION_URL = "https://tryluke.dev";
const PREVIEW_URL = "https://luke-abc123-stage-review.vercel.app";
const PROXY_SECRET = "proxy-secret-shared-by-both-ends-of-the-relay";
const REGISTERED_CALLBACK = `${PRODUCTION_URL}/api/auth/callback/github`;

const GITHUB_CODE = "github-code-under-test";
const GITHUB_TOKEN = "gho_signed-in-token-under-test";
const GITHUB_EMAIL = "octo@github.test";
const GITHUB_ACCOUNT_ID = "4242";

const NOW = new Date("2026-09-28T12:00:00.000Z");

/** What the OAuth start answers, as far as a browser reads it. */
const decodeStarted = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));

/** Everything that left either end: every URL a browser was sent to, and every log line. */
interface Trail {
  readonly urls: string[];
  readonly logs: string[];
}

type Auth = ReturnType<typeof endFor>;
type Ends = ReturnType<typeof ends>;

function endFor(deployment: AuthDeployment, secret: string, trail: Trail) {
  return betterAuth({
    appName: "Luke",
    baseURL: deployment.baseURL,
    trustedOrigins: deployment.trustedOrigins,
    secret,
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    account: ACCOUNT_TOKEN_STORAGE,
    socialProviders: {
      github: { clientId: "luke-github", clientSecret: "github-secret", scope: ["read:user"] },
    },
    plugins: [authProxy(deployment)],
    logger: {
      level: "debug",
      log: (_level, message, ...details) => {
        trail.logs.push([message, ...details.map((detail) => JSON.stringify(detail))].join(" "));
      },
    },
  });
}

function ends() {
  const trail: Trail = { urls: [], logs: [] };
  const production = endFor(
    authDeployment({
      VERCEL_ENV: "production",
      BETTER_AUTH_URL: PRODUCTION_URL,
      BETTER_AUTH_PROXY_SECRET: PROXY_SECRET,
      BETTER_AUTH_PROXY_TRUSTED_ORIGINS: "https://luke-*-stage-review.vercel.app",
    }),
    "production-session-secret-of-enough-length",
    trail,
  );
  const preview = endFor(
    authDeployment({
      VERCEL_ENV: "preview",
      VERCEL_URL: new URL(PREVIEW_URL).host,
      BETTER_AUTH_URL: PRODUCTION_URL,
      BETTER_AUTH_PROXY_SECRET: PROXY_SECRET,
    }),
    "preview-session-secret-of-enough-length",
    trail,
  );
  return { trail, production, preview };
}

function json(body: WireValue): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

/** GitHub's token endpoint and the two profile reads, as the OAuth App answers them. */
function fakeGitHub(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input);
  const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
  if (url.href === "https://github.com/login/oauth/access_token") {
    return Promise.resolve(
      json({
        access_token: GITHUB_TOKEN,
        token_type: "bearer",
        scope: "repo,read:user,user:email",
      }),
    );
  }
  assert.equal(headers.get("authorization"), `Bearer ${GITHUB_TOKEN}`);
  if (url.href === "https://api.github.com/user") {
    return Promise.resolve(json({ id: Number(GITHUB_ACCOUNT_ID), login: "octocat", email: null }));
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

function sessionCookieSet(response: Response): boolean {
  return response.headers
    .getSetCookie()
    .some((cookie) => /^[^=]*session_token=[^;]+/u.test(cookie));
}

function location(response: Response, trail: Trail): string {
  const next = response.headers.get("location");
  assert.ok(next, `expected a redirect, got ${response.status}`);
  trail.urls.push(next);
  return next;
}

/** GitHub returning the browser to the registered callback, which only production answers. */
async function githubReturns(ends: Ends, authorize: URL, query: string) {
  const callback = new URL(`${authorize.searchParams.get("redirect_uri")}?${query}`);
  callback.searchParams.set("state", authorize.searchParams.get("state") ?? "");
  ends.trail.urls.push(callback.href);
  return location(await ends.production.handler(new Request(callback)), ends.trail);
}

async function land(ends: Ends, relayed: string, cookie?: string) {
  return ends.preview.handler(
    new Request(relayed, { headers: cookie === undefined ? {} : { cookie } }),
  );
}

async function githubAccounts(auth: Auth, userId: string) {
  const context = await auth.$context;
  return (await context.internalAdapter.findAccounts(userId)).filter(
    (row) => row.providerId === "github",
  );
}

async function githubUser(auth: Auth) {
  const found = await (await auth.$context).internalAdapter.findUserByEmail(GITHUB_EMAIL);
  return found?.user ?? null;
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

test("a Preview's proxied GitHub sign-in still signs the GitHub user in on the Preview", async () => {
  const both = ends();
  const started = await both.preview.handler(
    new Request(`${PREVIEW_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { origin: PREVIEW_URL, "content-type": "application/json" },
      body: JSON.stringify({ provider: "github", callbackURL: "/account.html" }),
    }),
  );
  const authorize = new URL(decodeStarted(await started.json()).url);
  assert.equal(authorize.searchParams.get("redirect_uri"), REGISTERED_CALLBACK);

  const relayed = await githubReturns(both, authorize, `code=${GITHUB_CODE}`);
  const landed = await land(both, relayed, cookiesFrom(started));
  assert.equal(location(landed, both.trail), "/account.html");
  assert.equal(sessionCookieSet(landed), true);
  const user = await githubUser(both.preview);
  assert.ok(user);
  assert.equal((await githubAccounts(both.preview, user.id)).length, 1);
  assert.equal(await githubUser(both.production), null);
});
