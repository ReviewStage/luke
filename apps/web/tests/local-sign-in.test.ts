import assert from "node:assert/strict";
import { oauthProvider } from "@better-auth/oauth-provider";
import {
  DISABLED_AUTH_PATHS,
  denyOAuthClientPrivileges,
  JWT_KEY_STORAGE,
  LOGIN_PAGE,
} from "@luke/service/auth/auth-policy";
import { DESKTOP_OAUTH_CLIENT, oauthClientRecord } from "@luke/service/auth/oauth-clients";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { jwt } from "better-auth/plugins";
import { Schema } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { localSignIn } from "../server/local-sign-in";

/**
 * The demo's sign-in on one Better Auth configured as `auth.ts` configures
 * the desktop's authorization, over an in-memory database holding the seeded
 * member: the desktop's PKCE flow, sent to the login page, comes back through
 * the local sign-in to the desktop's loopback with a code for that member,
 * and a browser that opens the page bare lands on the web app signed in.
 * Synthetic accounts throughout.
 */

const SERVICE_URL = "http://127.0.0.1:5173";
const LOOPBACK = "http://127.0.0.1:54698/callback";
const LOOPBACK_DATABASE = "postgres://luke:luke@127.0.0.1:54329/luke";

const NOW = new Date("2026-11-02T12:00:00.000Z");

const SEEDED = {
  id: "de300001-0000-4000-8000-000000000001",
  name: "Seeded Member",
  email: "seeded@example.test",
} as const;

/** RFC 7636's example pair, standing in for a verifier the Mac drew. */
const PKCE = {
  verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
} as const;

const decodeTokens = Schema.decodeUnknownSync(Schema.Struct({ access_token: Schema.String }));
const decodeUserInfo = Schema.decodeUnknownSync(Schema.Struct({ sub: Schema.String }));
const decodeSession = Schema.decodeUnknownSync(
  Schema.NullOr(Schema.Struct({ user: Schema.Struct({ id: Schema.String }) })),
);

function serviceAuth() {
  return betterAuth({
    appName: "Vespin",
    baseURL: SERVICE_URL,
    secret: "local-sign-in-test-secret-of-enough-length",
    database: memoryAdapter({
      user: [{ ...SEEDED, emailVerified: true, createdAt: NOW, updatedAt: NOW }],
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
    disabledPaths: [...DISABLED_AUTH_PATHS],
    // The plugins `auth.ts` installs that the desktop's authorization reaches, in its order.
    plugins: [
      jwt(JWT_KEY_STORAGE),
      oauthProvider({
        loginPage: LOGIN_PAGE,
        consentPage: "/consent.html",
        allowDynamicClientRegistration: false,
        clientPrivileges: denyOAuthClientPrivileges,
        cachedTrustedClients: new Set([DESKTOP_OAUTH_CLIENT.id]),
      }),
    ],
  });
}

type Auth = ReturnType<typeof serviceAuth>;

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

function navigate(auth: Auth, url: URL, cookie?: string): Promise<Response> {
  const navigation = { accept: "text/html", "sec-fetch-mode": "navigate" };
  return auth.handler(
    new Request(url, { headers: cookie === undefined ? navigation : { ...navigation, cookie } }),
  );
}

/** Where the desktop's authorize sends a browser that holds no session: the login page, on the query the provider signed. */
async function loginPageOfDesktopAuthorize(auth: Auth): Promise<URL> {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: DESKTOP_OAUTH_CLIENT.id,
    redirect_uri: LOOPBACK,
    scope: "openid profile email offline_access",
    state: "oauth-state",
    code_challenge: PKCE.challenge,
    code_challenge_method: "S256",
    prompt: "login",
  });
  const loginPage = location(
    await navigate(auth, new URL(`/api/auth/oauth2/authorize?${query}`, SERVICE_URL)),
  );
  assert.equal(loginPage.pathname, LOGIN_PAGE);
  return loginPage;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("DATABASE_URL", LOOPBACK_DATABASE);
  vi.stubEnv("DATABASE_URL_UNPOOLED", LOOPBACK_DATABASE);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("the desktop's PKCE sign-in completes as the seeded member through the local sign-in", async () => {
  const auth = serviceAuth();
  const loginPage = await loginPageOfDesktopAuthorize(auth);

  const signedIn = await localSignIn(auth, SEEDED.id).fetch(new Request(loginPage));
  const browser = cookiesFrom(signedIn);
  // Authorize asked `prompt=login`, which only the sign-in's own resume drops; kept, this would land on the login page again.
  const loopback = location(await navigate(auth, location(signedIn), browser));
  assert.equal(`${loopback.origin}${loopback.pathname}`, LOOPBACK);
  assert.equal(loopback.searchParams.get("state"), "oauth-state");

  const tokens = await auth.handler(
    new Request(`${SERVICE_URL}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: loopback.searchParams.get("code") ?? "",
        redirect_uri: LOOPBACK,
        client_id: DESKTOP_OAUTH_CLIENT.id,
        code_verifier: PKCE.verifier,
      }),
    }),
  );
  const userInfo = await auth.handler(
    new Request(`${SERVICE_URL}/api/auth/oauth2/userinfo`, {
      headers: { authorization: `Bearer ${decodeTokens(await tokens.json()).access_token}` },
    }),
  );
  assert.equal(decodeUserInfo(await userInfo.json()).sub, SEEDED.id);
});

test("a browser that opens the sign-in bare lands on the web app signed in as the seeded member", async () => {
  const auth = serviceAuth();

  const signedIn = await localSignIn(auth, SEEDED.id).fetch(
    new Request(new URL(LOGIN_PAGE, SERVICE_URL)),
  );
  assert.equal(location(signedIn).pathname, "/app");

  const session = await auth.handler(
    new Request(`${SERVICE_URL}/api/auth/get-session`, {
      headers: { cookie: cookiesFrom(signedIn) },
    }),
  );
  assert.equal(decodeSession(await session.json())?.user.id, SEEDED.id);
});

test("an authorization the provider did not sign mints no session", async () => {
  const auth = serviceAuth();
  const forged = await loginPageOfDesktopAuthorize(auth);
  forged.searchParams.set("code_challenge", "a-challenge-the-provider-never-signed");

  const answered = await localSignIn(auth, SEEDED.id).fetch(new Request(forged));
  assert.equal(answered.status, 400);
  assert.deepEqual(answered.headers.getSetCookie(), []);
});

test("beside a Vercel deployment's variables the sign-in mints no session", async () => {
  const auth = serviceAuth();
  vi.stubEnv("VERCEL", "1");

  const answered = await localSignIn(auth, SEEDED.id).fetch(
    new Request(new URL(LOGIN_PAGE, SERVICE_URL)),
  );
  assert.equal(answered.status, 403);
  assert.deepEqual(answered.headers.getSetCookie(), []);
});
