import assert from "node:assert/strict";
import { electron } from "@better-auth/electron";
import { oauthProvider } from "@better-auth/oauth-provider";
import { openMigratedPglite } from "@repo/database/testing";
import { DESKTOP_SESSION_CLIENT_ID } from "@repo/features/desktop-session-wire";
import { betterAuth } from "better-auth";
import { admin, bearer, jwt } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/pglite";
import { Schema } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { USER_ROLE } from "../admin/admin-access.js";
import { authDatabaseAdapter } from "./auth-database.js";
import {
  ACCOUNT_TOKEN_STORAGE,
  ADMIN_OPTIONS,
  DESKTOP_SESSION,
  DISABLED_AUTH_PATHS,
  denyOAuthClientPrivileges,
  JWT_KEY_STORAGE,
  SESSION_BEARER,
  SESSION_COOKIE_CACHE,
  SUPPORT_ACCESS_PATH,
} from "./auth-policy.js";
import { DESKTOP_OAUTH_CLIENT } from "./oauth-clients.js";
import { SUPPORT_ACCESS_ERROR, supportAccess } from "./support-access.js";

/**
 * Support access end to end, on one Better Auth configured as `auth.ts`
 * configures the doors it reaches, over a migrated PGlite. A maintainer is an
 * account a maintainer's own write made an admin; a member grants support
 * access, and the maintainer's browser then signs in as the member for an
 * hour and back out again. The sign-in is refused without the member's
 * grant, after it runs out, from anything but a browser's cookie session,
 * and of an admin; it passes none of Better Auth's doors that would turn it
 * into lasting access; and a revoke ends it. Every other admin endpoint is
 * shut. Email and password sign-up is on in this instance alone, standing
 * in for the social sign-in the deployment offers. Synthetic accounts.
 */

const SERVICE_URL = "http://127.0.0.1";
const NOW = new Date("2026-11-05T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Every admin endpoint but the two a maintainer's browser starts and stops a support sign-in with, by the method it answers. */
const SHUT_ADMIN_ENDPOINTS: ReadonlyArray<{ readonly path: string; readonly method: string }> = [
  { path: "/admin/set-role", method: "POST" },
  { path: "/admin/get-user", method: "GET" },
  { path: "/admin/create-user", method: "POST" },
  { path: "/admin/update-user", method: "POST" },
  { path: "/admin/list-users", method: "GET" },
  { path: "/admin/list-user-sessions", method: "POST" },
  { path: "/admin/unban-user", method: "POST" },
  { path: "/admin/ban-user", method: "POST" },
  { path: "/admin/revoke-user-session", method: "POST" },
  { path: "/admin/revoke-user-sessions", method: "POST" },
  { path: "/admin/remove-user", method: "POST" },
  { path: "/admin/set-user-password", method: "POST" },
  { path: "/admin/has-permission", method: "POST" },
];

/** Better Auth's doors that mint from the session, each as a browser would reach it. */
const MINTING_DOORS: ReadonlyArray<{
  readonly path: string;
  readonly method: string;
  readonly body?: Readonly<Record<string, string | boolean>>;
}> = [
  {
    path: `/oauth2/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: DESKTOP_OAUTH_CLIENT.id,
      redirect_uri: "http://127.0.0.1:54698/callback",
      scope: "openid offline_access",
      state: "oauth-state",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    })}`,
    method: "GET",
  },
  { path: "/oauth2/consent", method: "POST", body: { accept: true } },
  { path: "/oauth2/continue", method: "POST", body: { selected: true } },
  {
    path: `/electron/transfer-user?${new URLSearchParams({
      client_id: DESKTOP_SESSION_CLIENT_ID,
      state: "session-state",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    })}`,
    method: "POST",
    body: {},
  },
  { path: "/link-social", method: "POST", body: { provider: "github" } },
];

const decodeSession = Schema.decodeUnknownSync(
  Schema.NullOr(
    Schema.Struct({
      user: Schema.Struct({
        id: Schema.String,
        supportAccessUntil: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
      session: Schema.Struct({
        expiresAt: Schema.String,
        impersonatedBy: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
    }),
  ),
);
const decodeCode = Schema.decodeUnknownSync(Schema.Struct({ code: Schema.String }));
const decodeGrant = Schema.decodeUnknownSync(
  Schema.Struct({ supportAccessUntil: Schema.NullOr(Schema.Date) }),
);
/** What `auth.api` throws when a call is refused: its status, and its code on the body. */
const decodeThrown = Schema.decodeUnknownSync(
  Schema.Struct({ statusCode: Schema.Number, body: Schema.Struct({ code: Schema.String }) }),
);

function supportAuth(client: Awaited<ReturnType<typeof openMigratedPglite>>) {
  return betterAuth({
    database: authDatabaseAdapter(drizzle({ client })),
    baseURL: SERVICE_URL,
    secret: "support-access-test-secret-with-enough-length",
    emailAndPassword: { enabled: true },
    account: ACCOUNT_TOKEN_STORAGE,
    session: SESSION_COOKIE_CACHE,
    disabledPaths: [...DISABLED_AUTH_PATHS],
    socialProviders: { github: { clientId: "vespin-github", clientSecret: "github-secret" } },
    // The plugins `auth.ts` installs that hold a door a support sign-in could reach, in its order.
    plugins: [
      jwt(JWT_KEY_STORAGE),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        allowDynamicClientRegistration: false,
        clientPrivileges: denyOAuthClientPrivileges,
      }),
      electron(DESKTOP_SESSION),
      bearer(SESSION_BEARER),
      admin(ADMIN_OPTIONS),
      supportAccess(),
    ],
  });
}

type SupportAuth = ReturnType<typeof supportAuth>;

/** A browser's cookies, kept across answers as a browser keeps them: each one set replaces its name, and one expired is dropped. */
type Browser = Map<string, string>;

/** An account, the browser its sign-up signed in, and the signed bearer the bearer plugin handed it. */
interface SignedUp {
  readonly id: string;
  readonly browser: Browser;
  readonly bearer: string;
}

function keep(browser: Browser, headers: Headers): void {
  for (const line of headers.getSetCookie()) {
    const [pair = "", ...attributes] = line.split(";");
    const at = pair.indexOf("=");
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1);
    const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/iu.test(attribute));
    if (expired || value === "") browser.delete(name);
    else browser.set(name, value);
  }
}

function cookieOf(browser: Browser): Record<string, string> {
  return { cookie: [...browser].map(([name, value]) => `${name}=${value}`).join("; ") };
}

async function withSupportAuth(body: (auth: SupportAuth) => Promise<void>): Promise<void> {
  const client = await openMigratedPglite();
  try {
    await body(supportAuth(client));
  } finally {
    await client.close();
  }
}

async function signUp(auth: SupportAuth, name: string): Promise<SignedUp> {
  const { headers, response } = await auth.api.signUpEmail({
    body: { name, email: `${name}@example.com`, password: "a-password-long-enough" },
    returnHeaders: true,
  });
  const browser: Browser = new Map();
  keep(browser, headers);
  const signed = headers.get("set-auth-token");
  assert.ok(signed);
  return { id: response.user.id, browser, bearer: signed };
}

/** An account made an admin by a maintainer's own write, as `admin-access.ts` says one is. */
async function signUpAdmin(auth: SupportAuth, name: string): Promise<SignedUp> {
  const account = await signUp(auth, name);
  await (await auth.$context).internalAdapter.updateUser(account.id, { role: USER_ROLE.ADMIN });
  return account;
}

function send(
  auth: SupportAuth,
  path: string,
  method: string,
  credential: Record<string, string>,
  body?: Readonly<Record<string, string | boolean>>,
): Promise<Response> {
  return auth.handler(
    new Request(`${SERVICE_URL}/api/auth${path}`, {
      method,
      headers: { "content-type": "application/json", origin: SERVICE_URL, ...credential },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

function impersonate(auth: SupportAuth, credential: Record<string, string>, userId: string) {
  return send(auth, "/admin/impersonate-user", "POST", credential, { userId });
}

/** The maintainer's browser signed in as the member, its cookies now the support sign-in's. */
async function signedInAs(auth: SupportAuth, maintainer: SignedUp, member: SignedUp) {
  const started = await impersonate(auth, cookieOf(maintainer.browser), member.id);
  assert.equal(started.status, 200);
  keep(maintainer.browser, started.headers);
}

async function sessionOf(auth: SupportAuth, browser: Browser, query = "") {
  const answered = await auth.handler(
    new Request(`${SERVICE_URL}/api/auth/get-session${query}`, { headers: cookieOf(browser) }),
  );
  return decodeSession(await answered.json());
}

async function codeOf(answer: Response): Promise<string> {
  return decodeCode(await answer.json()).code;
}

async function grant(auth: SupportAuth, account: SignedUp) {
  return decodeGrant(await auth.api.grantSupportAccess({ headers: cookieOf(account.browser) }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// Catches the admin plugin, its columns, or its options coming apart: a sign-in that fails, names the wrong account, or outlasts its hour.
test("an admin's browser signs in as a member who granted support access, for an hour, and stopping signs the admin back in", async () => {
  await withSupportAuth(async (auth) => {
    const maintainer = await signUpAdmin(auth, "maintainer");
    const member = await signUp(auth, "member");
    await grant(auth, member);

    await signedInAs(auth, maintainer, member);
    const viewing = await sessionOf(auth, maintainer.browser);
    assert.equal(viewing?.user.id, member.id);
    assert.equal(viewing?.session.impersonatedBy, maintainer.id);
    assert.equal(Date.parse(viewing?.session.expiresAt ?? ""), NOW.getTime() + HOUR_MS);

    const stopped = await send(
      auth,
      "/admin/stop-impersonating",
      "POST",
      cookieOf(maintainer.browser),
    );
    assert.equal(stopped.status, 200);
    keep(maintainer.browser, stopped.headers);
    assert.equal((await sessionOf(auth, maintainer.browser))?.user.id, maintainer.id);
  });
});

// Catches an `adminUserIds`, a widened `adminRoles`, or a default role that lets a member, or lets someone sign in as an admin.
test("a member who is no admin signs in as nobody, and nobody signs in as an admin", async () => {
  await withSupportAuth(async (auth) => {
    const maintainer = await signUpAdmin(auth, "maintainer");
    const member = await signUp(auth, "member");
    const teammate = await signUp(auth, "teammate");
    const fellow = await signUpAdmin(auth, "fellow");
    await grant(auth, teammate);
    await grant(auth, fellow);

    const byMember = await impersonate(auth, cookieOf(member.browser), teammate.id);
    assert.equal(byMember.status, 403);
    assert.equal(await codeOf(byMember), "YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS");

    const ofAdmin = await impersonate(auth, cookieOf(maintainer.browser), fellow.id);
    assert.equal(ofAdmin.status, 403);
    assert.equal(await codeOf(ofAdmin), "YOU_CANNOT_IMPERSONATE_ADMINS");
  });
});

// Catches an admin path dropped from `DISABLED_AUTH_PATHS`, which would let a browser set a role, ban, or delete an account.
test("every other admin endpoint is shut to an admin's browser", async () => {
  await withSupportAuth(async (auth) => {
    const maintainer = await signUpAdmin(auth, "maintainer");
    const member = await signUp(auth, "member");

    for (const endpoint of SHUT_ADMIN_ENDPOINTS) {
      const query = endpoint.method === "GET" ? `?${new URLSearchParams({ id: member.id })}` : "";
      const answer = await send(
        auth,
        `${endpoint.path}${query}`,
        endpoint.method,
        cookieOf(maintainer.browser),
        endpoint.method === "GET" ? undefined : { userId: member.id, role: USER_ROLE.ADMIN },
      );
      assert.equal(answer.status, 404, endpoint.path);
    }
  });
});

// Catches a door's path drifting from the hook's matcher, or the hook gone: the sign-in would mint the member a lasting session, token, or link.
test("a support sign-in passes none of the doors that mint from a session, and no bearer does", async () => {
  await withSupportAuth(async (auth) => {
    const maintainer = await signUpAdmin(auth, "maintainer");
    const member = await signUp(auth, "member");
    await grant(auth, member);
    await signedInAs(auth, maintainer, member);

    for (const door of MINTING_DOORS) {
      const asMember = await send(
        auth,
        door.path,
        door.method,
        cookieOf(maintainer.browser),
        door.body,
      );
      assert.equal(asMember.status, 403, door.path);
      assert.equal(await codeOf(asMember), SUPPORT_ACCESS_ERROR.IMPERSONATION_REFUSED, door.path);

      const carried = { authorization: `Bearer ${member.bearer}` };
      const byBearer = await send(auth, door.path, door.method, carried, door.body);
      assert.equal(byBearer.status, 403, door.path);
      assert.equal(await codeOf(byBearer), SUPPORT_ACCESS_ERROR.BROWSER_ONLY, door.path);
    }
  });
});

// Catches the `Authorization` refusal gone: a bearer's sign-in has no `dont_remember` cookie, so its first read would slide it to seven days.
test("a support sign-in starts only from a browser's own session, never a bearer", async () => {
  await withSupportAuth(async (auth) => {
    const maintainer = await signUpAdmin(auth, "maintainer");
    const member = await signUp(auth, "member");
    await grant(auth, member);

    const byBearer = await impersonate(
      auth,
      { authorization: `Bearer ${maintainer.bearer}` },
      member.id,
    );
    assert.equal(byBearer.status, 403);
    assert.equal(await codeOf(byBearer), SUPPORT_ACCESS_ERROR.BROWSER_ONLY);
  });
});

// Catches the consent check gone, or one that reads a grant without its end.
test("a support sign-in needs the member's grant, and is refused once the grant runs out", async () => {
  await withSupportAuth(async (auth) => {
    const member = await signUp(auth, "member");
    const early = await signUpAdmin(auth, "early");
    const ungranted = await impersonate(auth, cookieOf(early.browser), member.id);
    assert.equal(ungranted.status, 403);
    assert.equal(await codeOf(ungranted), SUPPORT_ACCESS_ERROR.NOT_GRANTED);

    await grant(auth, member);
    vi.setSystemTime(NOW.getTime() + 7 * DAY_MS + 1);
    // A maintainer signed in after the grant ran out, so their own session still stands.
    const late = await signUpAdmin(auth, "late");
    const ranOut = await impersonate(auth, cookieOf(late.browser), member.id);
    assert.equal(ranOut.status, 403);
    assert.equal(await codeOf(ranOut), SUPPORT_ACCESS_ERROR.NOT_GRANTED);
  });
});

// Catches a grant of another length, a grant a support sign-in can extend, or an endpoint that can set the grant.
test("the member grants seven days, which the account's session answers; nothing else sets it, nor can a support sign-in", async () => {
  await withSupportAuth(async (auth) => {
    const maintainer = await signUpAdmin(auth, "maintainer");
    const member = await signUp(auth, "member");

    const granted = await grant(auth, member);
    const sevenDaysOut = new Date(NOW.getTime() + 7 * DAY_MS);
    assert.deepEqual(granted.supportAccessUntil, sevenDaysOut);
    const read = await sessionOf(auth, member.browser, "?disableCookieCache=true");
    assert.equal(read?.user.supportAccessUntil, sevenDaysOut.toISOString());

    const overHttp = await send(auth, SUPPORT_ACCESS_PATH.GRANT, "POST", cookieOf(member.browser));
    assert.equal(overHttp.status, 404);
    const farOut = new Date(NOW.getTime() + 365 * DAY_MS).toISOString();
    const updated = await send(auth, "/update-user", "POST", cookieOf(member.browser), {
      supportAccessUntil: farOut,
    });
    assert.equal(updated.status, 400);

    await signedInAs(auth, maintainer, member);
    const refusal = await auth.api
      .grantSupportAccess({ headers: new Headers(cookieOf(maintainer.browser)) })
      .then(() => undefined, decodeThrown);
    assert.equal(refusal?.statusCode, 403);
    assert.equal(refusal?.body.code, SUPPORT_ACCESS_ERROR.IMPERSONATION_REFUSED);
  });
});

// Catches a revoke that leaves the grant, or leaves a support sign-in under way standing until its hour ends.
test("the member's revoke clears the grant and ends the support sign-in under way, and the member's own session stands", async () => {
  await withSupportAuth(async (auth) => {
    const maintainer = await signUpAdmin(auth, "maintainer");
    const member = await signUp(auth, "member");
    await grant(auth, member);
    await signedInAs(auth, maintainer, member);

    const revoked = decodeGrant(
      await auth.api.revokeSupportAccess({ headers: new Headers(cookieOf(member.browser)) }),
    );
    assert.equal(revoked.supportAccessUntil, null);

    // A browser's cookie cache may answer for up to its minute, so the sign-in is read from the store.
    assert.equal(await sessionOf(auth, maintainer.browser, "?disableCookieCache=true"), null);
    const own = await sessionOf(auth, member.browser, "?disableCookieCache=true");
    assert.equal(own?.user.id, member.id);
    assert.equal(own?.user.supportAccessUntil, null);
  });
});
