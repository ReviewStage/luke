import assert from "node:assert/strict";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { jwt, oAuthProxy } from "better-auth/plugins";
import { Schema } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { type AuthDeployment, authDeployment } from "../server/auth-deployment";
import {
  ACCOUNT_TOKEN_STORAGE,
  denyOAuthClientPrivileges,
  JWT_KEY_STORAGE,
} from "../server/auth-policy";
import type { WireValue } from "../server/core";
import { DESKTOP_OAUTH_CLIENT, oauthClientRecord } from "../server/oauth-clients";

/**
 * The desktop's sign-in on a Preview, carried end to end across the proxy's
 * two ends: a Preview and production, each a Better Auth over its own
 * in-memory database, configured as `auth.ts` configures them, with GitHub a
 * fake behind `fetch`. The OAuth App has registered production's callback
 * alone, so what this holds is that a sign-in begun on the Preview is sent
 * through that callback, that production relays it, and that the Preview
 * resumes the desktop's authorization and hands its loopback the code.
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

type Ends = ReturnType<typeof ends>;

function endFor(deployment: AuthDeployment, secret: string, trail: Trail) {
  return betterAuth({
    appName: "Luke",
    baseURL: deployment.baseURL,
    trustedOrigins: deployment.trustedOrigins,
    secret,
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
    socialProviders: {
      github: { clientId: "luke-github", clientSecret: "github-secret", scope: ["read:user"] },
    },
    // The plugins `auth.ts` installs, in its order.
    plugins: [
      oAuthProxy({ productionURL: deployment.productionURL, secret: deployment.proxySecret }),
      jwt(JWT_KEY_STORAGE),
      oauthProvider({
        loginPage: "/sign-in.html",
        consentPage: "/consent.html",
        allowDynamicClientRegistration: false,
        clientPrivileges: denyOAuthClientPrivileges,
        cachedTrustedClients: new Set([DESKTOP_OAUTH_CLIENT.id]),
      }),
    ],
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

/** The browser navigating to a Preview URL, as a top-level navigation sends it. */
async function land(ends: Ends, relayed: string, cookie?: string) {
  const navigation = { accept: "text/html", "sec-fetch-mode": "navigate" };
  return ends.preview.handler(
    new Request(relayed, {
      headers: cookie === undefined ? navigation : { ...navigation, cookie },
    }),
  );
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

test("the desktop's sign-in on a Preview, proxied through production, hands the desktop its code", async () => {
  const both = ends();
  const loopback = "http://127.0.0.1:54698/callback";
  const authorizeQuery = new URLSearchParams({
    response_type: "code",
    client_id: DESKTOP_OAUTH_CLIENT.id,
    redirect_uri: loopback,
    scope: "openid profile email offline_access",
    state: "desktop-state",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
  });
  const toLogin = await both.preview.handler(
    new Request(`${PREVIEW_URL}/api/auth/oauth2/authorize?${authorizeQuery}`, {
      headers: { accept: "text/html", "sec-fetch-mode": "navigate" },
    }),
  );
  const loginPage = new URL(location(toLogin, both.trail), PREVIEW_URL);
  assert.equal(loginPage.pathname, "/sign-in.html");

  // What the sign-in page's provider client sends: the login page's own signed query.
  const started = await both.preview.handler(
    new Request(`${PREVIEW_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { origin: PREVIEW_URL, "content-type": "application/json" },
      body: JSON.stringify({ provider: "github", oauth_query: loginPage.search.slice(1) }),
    }),
  );
  const authorize = new URL(decodeStarted(await started.json()).url);
  assert.equal(authorize.searchParams.get("redirect_uri"), REGISTERED_CALLBACK);
  const relayed = await githubReturns(both, authorize, `code=${GITHUB_CODE}`);
  const landed = await land(both, relayed, cookiesFrom(started));

  // The browser follows the Preview's own redirects, carrying the session it was just given, until one leaves it.
  let next = new URL(location(landed, both.trail), PREVIEW_URL);
  const session = cookiesFrom(landed);
  for (let hop = 0; next.origin === PREVIEW_URL && hop < 3; hop += 1) {
    next = new URL(location(await land(both, next.href, session), both.trail), PREVIEW_URL);
  }
  const desktop = next;
  assert.equal(`${desktop.origin}${desktop.pathname}`, loopback);
  assert.equal(desktop.searchParams.get("state"), "desktop-state");
  assert.ok(desktop.searchParams.get("code"));
});
