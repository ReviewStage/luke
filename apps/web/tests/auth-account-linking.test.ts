import assert from "node:assert/strict";
import { openMigratedPglite } from "@sidecar/database/testing";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/pglite";
import { Schema } from "effect";
import { afterEach, test, vi } from "vitest";
import { authDatabaseAdapter } from "../server/auth-database";
import { ACCOUNT_TOKEN_STORAGE, DISABLED_AUTH_PATHS, GITHUB_SIGN_IN } from "../server/auth-policy";
import type { WireValue } from "../server/core";

/**
 * Linking GitHub to an account, configured as `auth.ts` configures it, over a
 * migrated PGlite database with GitHub a fake behind `fetch`. An account made
 * with Google rarely shares GitHub's address, so a signed-in account links
 * the GitHub it names whatever address GitHub holds, and comes away holding a
 * GitHub row of its own.
 *
 * The session is an email and password one, which this deployment does not
 * offer: it stands in for the Google sign-in the account was made with,
 * since Google's own sign-in verifies an ID token this test cannot sign.
 * Synthetic accounts, secrets, and tokens throughout.
 */

const BASE_URL = "http://127.0.0.1";
const LUKE_EMAIL = "planner@luke.test";
const GITHUB_ACCOUNT_ID = 5151;
const DONE_URL = "/connect-github.html?done=1";
const ERROR_URL = "/connect-github.html?error=1";

const decodeStarted = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));

function json(body: WireValue): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

/** GitHub's token endpoint and the two profile reads, for a user whose only address is not the Luke account's. */
async function fakeGitHub(input: string | URL | Request): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.href === "https://github.com/login/oauth/access_token") {
    return json({ token_type: "bearer", access_token: "ghu_linked", scope: "" });
  }
  if (url.href === "https://api.github.com/user") {
    return json({ id: GITHUB_ACCOUNT_ID, login: "octocat", name: "Octo", email: null });
  }
  if (url.href === "https://api.github.com/user/emails") {
    return json([{ email: "octo@github.test", primary: true, verified: true }]);
  }
  throw new Error(`this test reaches no network: ${url.href}`);
}

function cookiesFrom(response: Response, carried = ""): string {
  const fresh = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
  return [carried, ...fresh].filter((part) => part !== "").join("; ");
}

/** The auth service as `auth.ts` configures an account's rows and GitHub, over the database given. */
function linkingAuth(client: Awaited<ReturnType<typeof openMigratedPglite>>) {
  return betterAuth({
    baseURL: BASE_URL,
    secret: "auth-account-linking-test-secret-of-enough-length",
    database: authDatabaseAdapter(drizzle({ client })),
    account: ACCOUNT_TOKEN_STORAGE,
    disabledPaths: [...DISABLED_AUTH_PATHS],
    emailAndPassword: { enabled: true },
    socialProviders: {
      github: { clientId: "Iv1.fixture-app-client", clientSecret: "fixture", ...GITHUB_SIGN_IN },
    },
  });
}

type Auth = ReturnType<typeof linkingAuth>;

async function withAuth(body: (auth: Auth) => Promise<void>): Promise<void> {
  const client = await openMigratedPglite();
  try {
    vi.stubGlobal("fetch", fakeGitHub);
    await body(linkingAuth(client));
  } finally {
    vi.unstubAllGlobals();
    await client.close();
  }
}

/** Signs a Luke account up and links GitHub from its session; answers where the callback sent the browser and the account's providers. */
async function linkGitHub(auth: Auth) {
  const signedUp = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({ email: LUKE_EMAIL, password: "fixture-password", name: "Planner" }),
    }),
  );
  assert.equal(signedUp.status, 200);
  const session = cookiesFrom(signedUp);

  const started = await auth.handler(
    new Request(`${BASE_URL}/api/auth/link-social`, {
      method: "POST",
      headers: { origin: BASE_URL, "content-type": "application/json", cookie: session },
      body: JSON.stringify({
        provider: "github",
        callbackURL: DONE_URL,
        errorCallbackURL: ERROR_URL,
      }),
    }),
  );
  const authorize = new URL(decodeStarted(await started.json()).url);
  const callback = new URL(`${BASE_URL}/api/auth/callback/github`);
  callback.searchParams.set("code", "github-code-under-test");
  callback.searchParams.set("state", authorize.searchParams.get("state") ?? "");
  const landed = await auth.handler(
    new Request(callback, { headers: { cookie: cookiesFrom(started, session) } }),
  );

  const context = await auth.$context;
  const found = await context.internalAdapter.findUserByEmail(LUKE_EMAIL);
  assert.ok(found);
  const accounts = await context.internalAdapter.findAccounts(found.user.id);
  return {
    location: landed.headers.get("location") ?? "",
    providers: accounts.map((row) => row.providerId).sort(),
    github: accounts.find((row) => row.providerId === "github")?.accountId,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a signed-in account links a GitHub whose address is not its own, and holds that GitHub's row", async () => {
  await withAuth(async (auth) => {
    const linked = await linkGitHub(auth);

    const landedAt = new URL(linked.location, BASE_URL);
    assert.equal(landedAt.pathname + landedAt.search, DONE_URL);
    assert.deepEqual(linked.providers, ["credential", "github"]);
    assert.equal(linked.github, String(GITHUB_ACCOUNT_ID));
  });
});
