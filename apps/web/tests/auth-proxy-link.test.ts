import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { Schema } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { type AuthDeployment, authDeployment } from "../server/auth-deployment";
import { ACCOUNT_TOKEN_STORAGE } from "../server/auth-policy";
import { authProxy } from "../server/auth-proxy";
import type { WireValue } from "../server/core";

/**
 * A Preview's Connect GitHub link, carried end to end across the proxy's
 * two ends: a Preview and production, each a Better Auth over its own
 * in-memory database, configured as `auth.ts` configures them, with GitHub
 * a fake behind `fetch`. The OAuth App has registered production's callback
 * alone, so what these hold is that a link begun on the Preview is sent
 * through that callback, that production relays it without signing anyone
 * in on its side, and that the Preview attaches GitHub to the user who asked
 * and to nobody else.
 */

const PRODUCTION_URL = "https://tryluke.dev";
const PREVIEW_URL = "https://luke-abc123-stage-review.vercel.app";
/** The Preview's second hostname, the branch alias, which it trusts but does not call itself. */
const BRANCH_URL = "https://luke-git-planning-stage-review.vercel.app";
const PROXY_SECRET = "proxy-secret-shared-by-both-ends-of-the-relay";
const REGISTERED_CALLBACK = `${PRODUCTION_URL}/api/auth/callback/github`;
const PROFILE_PATH = "/api/auth/oauth-proxy-callback";

const GITHUB_CODE = "github-code-under-test";
const GITHUB_TOKEN = "gho_linked-token-under-test";
const GITHUB_EMAIL = "octo@github.test";
const GITHUB_ACCOUNT_ID = "4242";

const PASSWORD = "a-password-long-enough";
const NOW = new Date("2026-09-28T12:00:00.000Z");

/** What the sign-up and the two OAuth starts answer, as far as a browser reads them. */
const decodeSignedUp = Schema.decodeUnknownSync(
  Schema.Struct({ user: Schema.Struct({ id: Schema.String }) }),
);
const decodeStarted = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));
/** The proxy's sealed `state`, opened: the nonce of the state the Preview stored. */
const decodeStatePackage = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ state: Schema.String })),
);

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
    emailAndPassword: { enabled: true },
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
      VERCEL_BRANCH_URL: new URL(BRANCH_URL).host,
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

async function signUp(
  preview: Auth,
  email: string,
  host = PREVIEW_URL,
): Promise<{ userId: string; cookie: string }> {
  const response = await preview.handler(
    new Request(`${host}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin: host, "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, name: email }),
    }),
  );
  const answer = decodeSignedUp(await response.json());
  return { userId: answer.user.id, cookie: cookiesFrom(response) };
}

/** The Connect GitHub page's press, as `connect-github.tsx` makes it; answers the provider's authorize URL. */
async function startLink(ends: Ends, userId: string, cookie: string, host = PREVIEW_URL) {
  const response = await ends.preview.handler(
    new Request(`${host}/api/auth/link-social`, {
      method: "POST",
      headers: { origin: host, "content-type": "application/json", cookie },
      body: JSON.stringify({
        provider: "github",
        scopes: ["repo"],
        callbackURL: `/connect-github.html?account=${userId}&connected=1`,
        errorCallbackURL: `/connect-github.html?account=${userId}`,
      }),
    }),
  );
  const answer = decodeStarted(await response.json());
  ends.trail.urls.push(answer.url);
  return { authorize: new URL(answer.url), cookie: `${cookie}; ${cookiesFrom(response)}` };
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

test("a Preview's link goes through production's callback and lands, sealed, on the user who asked", async () => {
  const both = ends();
  const { userId, cookie } = await signUp(both.preview, "planner@luke.test");

  const { authorize, cookie: flowCookie } = await startLink(both, userId, cookie);
  assert.equal(authorize.searchParams.get("redirect_uri"), REGISTERED_CALLBACK);
  assert.deepEqual(authorize.searchParams.get("scope")?.split(" ").includes("repo"), true);

  const relayed = await githubReturns(both, authorize, `code=${GITHUB_CODE}`);
  assert.equal(new URL(relayed).origin, PREVIEW_URL);
  assert.equal(new URL(relayed).pathname, PROFILE_PATH);

  const landed = await land(both, relayed, flowCookie);
  assert.equal(location(landed, both.trail), `/connect-github.html?account=${userId}&connected=1`);
  // Linking signs nobody in, on either end.
  assert.equal(sessionCookieSet(landed), false);
  assert.equal(await githubUser(both.preview), null);
  assert.equal(await githubUser(both.production), null);

  const [linked, ...others] = await githubAccounts(both.preview, userId);
  assert.ok(linked);
  assert.equal(others.length, 0);
  assert.equal(linked.accountId, GITHUB_ACCOUNT_ID);
  assert.equal(linked.scope?.split(",").includes("repo"), true);
  assert.notEqual(linked.accessToken, GITHUB_TOKEN);
  const opened = await both.preview.api.getAccessToken({
    body: { providerId: "github" },
    headers: new Headers({ cookie }),
  });
  assert.equal(opened.accessToken, GITHUB_TOKEN);

  // The token rides only inside the relay's encrypted profile.
  assert.equal(
    both.trail.urls.some((url) => url.includes(GITHUB_TOKEN)),
    false,
  );
  assert.equal(
    both.trail.logs.some((line) => line.includes(GITHUB_TOKEN)),
    false,
  );
});

test("a link begun on the Preview's branch hostname returns to that hostname, where its session is", async () => {
  const both = ends();
  const { userId, cookie } = await signUp(both.preview, "planner@luke.test", BRANCH_URL);
  const { authorize, cookie: flowCookie } = await startLink(both, userId, cookie, BRANCH_URL);
  assert.equal(authorize.searchParams.get("redirect_uri"), REGISTERED_CALLBACK);

  const relayed = await githubReturns(both, authorize, `code=${GITHUB_CODE}`);
  assert.equal(new URL(relayed).origin, BRANCH_URL);
  const landed = await land(both, relayed, flowCookie);
  assert.equal(location(landed, both.trail), `/connect-github.html?account=${userId}&connected=1`);
  assert.equal((await githubAccounts(both.preview, userId)).length, 1);
});

test("a link's profile the Preview cannot read is refused rather than taken for a sign-in", async () => {
  const both = ends();
  const asker = await signUp(both.preview, "planner@luke.test");
  const { authorize, cookie } = await startLink(both, asker.userId, asker.cookie);
  // A profile sealed under the proxy key for the link's own state, missing the GitHub email.
  const statePackage = decodeStatePackage(
    await symmetricDecrypt({ key: PROXY_SECRET, data: authorize.searchParams.get("state") ?? "" }),
  );
  const profile = await symmetricEncrypt({
    key: PROXY_SECRET,
    data: JSON.stringify({
      state: statePackage.state,
      timestamp: NOW.getTime(),
      callbackURL: `/connect-github.html?account=${asker.userId}&connected=1`,
      errorURL: `${PREVIEW_URL}/connect-github.html?account=${asker.userId}`,
      userInfo: { id: GITHUB_ACCOUNT_ID, name: "octocat", emailVerified: true },
      account: { providerId: "github", accountId: GITHUB_ACCOUNT_ID, accessToken: GITHUB_TOKEN },
    }),
  });
  const relayed = new URL(`${PREVIEW_URL}${PROFILE_PATH}`);
  relayed.searchParams.set("callbackURL", "/connect-github.html");
  relayed.searchParams.set("profile", profile);

  const landed = await land(both, relayed.href, cookie);
  assert.equal(
    location(landed, both.trail),
    `${PREVIEW_URL}/connect-github.html?account=${asker.userId}&error=invalid_payload`,
  );
  assert.equal(sessionCookieSet(landed), false);
  assert.deepEqual(await githubAccounts(both.preview, asker.userId), []);
  const context = await both.preview.$context;
  assert.equal((await context.internalAdapter.listUsers()).length, 1);
});

test("a link landed in a browser signed in as anyone else is refused and writes nothing", async () => {
  const both = ends();
  const asker = await signUp(both.preview, "planner@luke.test");
  const stranger = await signUp(both.preview, "stranger@luke.test");
  const { authorize } = await startLink(both, asker.userId, asker.cookie);
  const relayed = await githubReturns(both, authorize, `code=${GITHUB_CODE}`);

  const landed = await land(both, relayed, stranger.cookie);
  assert.equal(
    location(landed, both.trail),
    `${PREVIEW_URL}/connect-github.html?account=${asker.userId}&error=session_mismatch`,
  );
  assert.equal(sessionCookieSet(landed), false);
  assert.deepEqual(await githubAccounts(both.preview, asker.userId), []);
  assert.deepEqual(await githubAccounts(both.preview, stranger.userId), []);
  assert.equal(await githubUser(both.preview), null);
});

test("a link landed in a browser signed in as nobody is refused and signs nobody in", async () => {
  const both = ends();
  const asker = await signUp(both.preview, "planner@luke.test");
  const { authorize } = await startLink(both, asker.userId, asker.cookie);
  const relayed = await githubReturns(both, authorize, `code=${GITHUB_CODE}`);

  const landed = await land(both, relayed);
  assert.equal(
    location(landed, both.trail),
    `${PREVIEW_URL}/connect-github.html?account=${asker.userId}&error=session_mismatch`,
  );
  assert.equal(sessionCookieSet(landed), false);
  assert.deepEqual(await githubAccounts(both.preview, asker.userId), []);
  assert.equal(await githubUser(both.preview), null);
});

test("a relayed link is landed once, and a replay of it is refused without a session", async () => {
  const both = ends();
  const asker = await signUp(both.preview, "planner@luke.test");
  const { authorize, cookie } = await startLink(both, asker.userId, asker.cookie);
  const relayed = await githubReturns(both, authorize, `code=${GITHUB_CODE}`);
  await land(both, relayed, cookie);

  const replayed = await land(both, relayed, cookie);
  assert.equal(
    location(replayed, both.trail),
    `${PREVIEW_URL}/connect-github.html?account=${asker.userId}&error=state_mismatch`,
  );
  assert.equal(sessionCookieSet(replayed), false);
  assert.equal((await githubAccounts(both.preview, asker.userId)).length, 1);
  assert.equal(await githubUser(both.preview), null);
});

test("a relayed link older than the proxy's minute is refused and writes nothing", async () => {
  const both = ends();
  const asker = await signUp(both.preview, "planner@luke.test");
  const { authorize, cookie } = await startLink(both, asker.userId, asker.cookie);
  const relayed = await githubReturns(both, authorize, `code=${GITHUB_CODE}`);

  vi.setSystemTime(new Date(NOW.getTime() + 61_000));
  const landed = await land(both, relayed, cookie);
  assert.equal(
    location(landed, both.trail),
    `${PREVIEW_URL}/connect-github.html?account=${asker.userId}&error=payload_expired`,
  );
  assert.deepEqual(await githubAccounts(both.preview, asker.userId), []);
});

test("GitHub's refusal of a Preview's link returns the browser to the Preview's page, not production's", async () => {
  const both = ends();
  const asker = await signUp(both.preview, "planner@luke.test");
  const { authorize } = await startLink(both, asker.userId, asker.cookie);

  const refused = await githubReturns(both, authorize, "error=access_denied");
  assert.equal(
    refused,
    `${PREVIEW_URL}/connect-github.html?account=${asker.userId}&error=access_denied`,
  );
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
