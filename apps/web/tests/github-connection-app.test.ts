import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@sidecar/database/core/query";
import { OrganizationRefused } from "@sidecar/database/models/workspace-seams";
import { account } from "@sidecar/database/schemas/auth";
import { openMigratedPglite, sqlClientOverPglite } from "@sidecar/database/testing";
import {
  GITHUB_CONNECT_CLAIM,
  GITHUB_CONNECT_PAGE,
} from "@sidecar/features/github-connection-wire";
import type { WireBoundaryInput } from "@sidecar/wire";
import { betterAuth } from "better-auth";
import { makeSignature } from "better-auth/crypto";
import { bearer } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { Cause, Clock, Duration, Effect, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, vi } from "vitest";
import { authDatabaseAdapter } from "../server/auth-database";
import {
  ACCOUNT_TOKEN_STORAGE,
  DISABLED_AUTH_PATHS,
  GITHUB_SIGN_IN,
  SESSION_BEARER,
} from "../server/auth-policy";
import type { WireValue } from "../server/core";
import { githubConnectionApp } from "../server/github-connection-app";
import { type GitHubUnlink, githubUnlink } from "../server/hosted/github-unlink";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";

/**
 * Connecting an account's GitHub, end to end over Better Auth as `auth.ts`
 * configures it, on a migrated PGlite the group reads too, with GitHub a
 * fake behind `fetch`. The Mac's bearer mints an intent and reads the
 * connection; the browser's real session cookie claims the intent and links
 * GitHub through Better Auth's own `link-social`, `callback/github`,
 * and `list-accounts`, none of which the deployment's disabled paths shut.
 * The Mac disconnects GitHub through the group under its own Better Auth
 * session, a signed bearer the bearer plugin reads, which the group hands to
 * Better Auth's `unlinkAccount`. The browser signs in by email and password here only
 * because a session is what linking needs and how it was made is beside the
 * point, as in `auth-account-linking.test.ts`. GitHub's address is no
 * account's here, which the deployment's `allowDifferentEmails` links.
 *
 * Synthetic accounts, bearers, secrets, and tokens throughout.
 */

const ORIGIN = "https://luke.test";
const SECRET = "github-connection-test-secret-with-enough-length";
const PASSWORD = "fixture-password-of-enough-length";
const GITHUB_ACCOUNT_ID = 4242;
const GITHUB_EMAIL = "octo@github.test";
const DONE_URL = `${GITHUB_CONNECT_PAGE.PATH}?${GITHUB_CONNECT_PAGE.DONE_PARAM}=1`;
const ERROR_URL = `${GITHUB_CONNECT_PAGE.PATH}?${GITHUB_CONNECT_PAGE.ERROR_PARAM}=1`;

function json(body: WireValue): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

/** GitHub's token endpoint, answering the GitHub App's expiring tokens, and the two profile reads, for the one GitHub user these tests link. */
async function fakeGitHub(input: string | URL | Request): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.href === "https://github.com/login/oauth/access_token") {
    return json({
      token_type: "bearer",
      access_token: "ghu_fixture",
      expires_in: 8 * 60 * 60,
      refresh_token: "ghr_fixture",
      refresh_token_expires_in: 180 * 24 * 60 * 60,
      scope: "",
    });
  }
  if (url.href === "https://api.github.com/user") {
    return json({ id: GITHUB_ACCOUNT_ID, login: "octocat", email: null });
  }
  if (url.href === "https://api.github.com/user/emails") {
    return json([{ email: GITHUB_EMAIL, primary: true, verified: true }]);
  }
  throw new Error(`this test reaches no network: ${url.href}`);
}

beforeEach(() => {
  vi.stubGlobal("fetch", fakeGitHub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A browser's cookie jar: the last value each cookie was set to. */
class Browser {
  readonly #cookies = new Map<string, string>();

  keep(response: Response): Response {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ""] = cookie.split(";");
      const at = pair.indexOf("=");
      this.#cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  }

  get cookie(): string {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** Better Auth over its own PGlite, the group over the same database, and a signed-in browser per account. */
const openService = Effect.gen(function* () {
  const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
    Effect.promise(() => opened.close()),
  );
  const auth = betterAuth({
    baseURL: ORIGIN,
    secret: SECRET,
    database: authDatabaseAdapter(drizzle({ client })),
    account: ACCOUNT_TOKEN_STORAGE,
    disabledPaths: [...DISABLED_AUTH_PATHS],
    emailAndPassword: { enabled: true },
    plugins: [bearer(SESSION_BEARER)],
    socialProviders: {
      github: {
        clientId: "Iv1.fixture-app-client",
        clientSecret: "fixture-secret",
        ...GITHUB_SIGN_IN,
      },
    },
  });
  const database = sqlClientOverPglite(client);

  /** One request to Better Auth's own handler from the browser, its cookies kept. */
  const toAuth = (browser: Browser, path: string, body?: WireValue) =>
    Effect.promise(async () =>
      browser.keep(
        await auth.handler(
          new Request(new URL(`/api/auth${path}`, ORIGIN), {
            method: body === undefined ? "GET" : "POST",
            headers: { origin: ORIGIN, "content-type": "application/json", cookie: browser.cookie },
            body: body === undefined ? null : JSON.stringify(body),
          }),
        ),
      ),
    );

  /** A new account signed in on a browser of its own. */
  const signUp = (name: string) =>
    Effect.gen(function* () {
      const browser = new Browser();
      const email = `${name.toLowerCase()}@luke.test`;
      const response = yield* toAuth(browser, "/sign-up/email", {
        email,
        password: PASSWORD,
        name,
      });
      assert.equal(response.status, 200);
      // SAFETY: Better Auth answers a sign-up as JSON with the user it made.
      const made = (yield* Effect.promise(() => response.json())) as { user: { id: string } };
      return { userId: made.user.id, browser };
    });

  /** The page's `linkSocial` and GitHub's return to Better Auth's callback; answers where the browser lands. */
  const linkGitHub = (browser: Browser) =>
    Effect.gen(function* () {
      const started = yield* toAuth(browser, "/link-social", {
        provider: "github",
        callbackURL: DONE_URL,
        errorCallbackURL: ERROR_URL,
      });
      assert.equal(started.status, 200);
      // SAFETY: Better Auth answers a link's start as JSON naming GitHub's authorize URL.
      const { url } = (yield* Effect.promise(() => started.json())) as { url: string };
      const callback = new URL("/api/auth/callback/github", ORIGIN);
      callback.searchParams.set("code", "github-code-under-test");
      callback.searchParams.set("state", new URL(url).searchParams.get("state") ?? "");
      const landed = browser.keep(
        yield* Effect.promise(() =>
          auth.handler(new Request(callback, { headers: { cookie: browser.cookie } })),
        ),
      );
      assert.equal(landed.status, 302);
      return landed.headers.get("location") ?? "";
    });

  /** A fresh session for the account, as the signed bearer token the bearer plugin hands the Mac. */
  const sessionBearerOf = (userId: string) =>
    Effect.promise(async () => {
      const context = await auth.$context;
      const session = await context.internalAdapter.createSession(userId);
      return `${session.token}.${await makeSignature(session.token, SECRET)}`;
    });

  /** One request to the group: the Mac's bearer where given, else the browser's cookie. */
  const ask = (
    path: string,
    init: {
      method: string;
      bearer?: string;
      browser?: Browser | undefined;
      body?: WireValue;
      unlink?: GitHubUnlink;
    },
  ) =>
    Effect.gen(function* () {
      const services = Layer.mergeAll(
        Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
        Layer.succeed(Database, yield* Database),
        Layer.succeed(Clock.Clock, yield* Clock.Clock),
      );
      const { handler, dispose } = HttpRouter.toWebHandler(
        githubConnectionApp({
          resolveUserId: (incoming) =>
            Effect.succeed(
              Option.fromNullishOr(incoming.headers.get("authorization")?.replace(/^Bearer /u, "")),
            ),
          resolveSessionUserId: (incoming) =>
            Effect.tryPromise(async () => {
              const session = await auth.api.getSession({ headers: incoming.headers });
              return Option.fromNullishOr(session?.user.id);
            }),
          unlinkGitHub: init.unlink ?? githubUnlink(auth.api),
        }).pipe(HttpRouter.provideRequest(services)),
        { disableLogger: true },
      );
      const headers = new Headers();
      if (init.bearer !== undefined) headers.set("authorization", `Bearer ${init.bearer}`);
      if (init.browser !== undefined) headers.set("cookie", init.browser.cookie);
      const response = yield* Effect.promise(() =>
        handler(
          new Request(new URL(path, ORIGIN), {
            method: init.method,
            headers,
            body: init.body === undefined ? null : JSON.stringify(init.body),
          }),
        ),
      );
      // SAFETY: the group answers JSON; the test compares it as the wire value it is.
      const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
      yield* Effect.promise(() => dispose());
      return { status: response.status, body } satisfies Answer;
    }).pipe(Effect.provide(database));

  const connection = (bearer: string) => ask("/api/github/connection", { method: "GET", bearer });

  /** The account's GitHub row kept with its tokens nulled, as the GitHub App's authorization-revoked webhook leaves it. */
  const revokeTokens = (userId: string) =>
    Database.use((db) =>
      db
        .update(account)
        .set({
          accessToken: null,
          refreshToken: null,
          accessTokenExpiresAt: null,
          refreshTokenExpiresAt: null,
        })
        .where(eq(account.userId, userId)),
    ).pipe(Effect.provide(database));

  /** The account's providers, as Better Auth lists them to its own browser session. */
  const providers = (browser: Browser) =>
    Effect.gen(function* () {
      const listed = yield* toAuth(browser, "/list-accounts");
      // SAFETY: Better Auth answers the account list as JSON.
      const accounts = (yield* Effect.promise(() => listed.json())) as { providerId: string }[];
      return accounts.map((row) => row.providerId).sort();
    });

  return {
    auth,
    signUp,
    toAuth,
    linkGitHub,
    ask,
    connection,
    revokeTokens,
    sessionBearerOf,
    providers,
  };
});

/** The intent the page's address carries, failing the test where the answer names no page. */
function intentOf(answered: Answer): string {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  // SAFETY: the status is OK, and the group answers a connect with the wire's `{ url }`.
  const { url } = answered.body as { url: string };
  const page = new URL(url);
  assert.equal(page.origin + page.pathname, `${ORIGIN}${GITHUB_CONNECT_PAGE.PATH}`);
  return page.searchParams.get(GITHUB_CONNECT_PAGE.INTENT_PARAM) ?? assert.fail("no intent");
}

it.effect(
  "an intent is minted for the bearer's account, and only that account's browser session claims it, again on a retry, until it expires",
  () =>
    Effect.gen(function* () {
      const service = yield* openService;
      const ada = yield* service.signUp("Ada");
      const bob = yield* service.signUp("Bob");

      assert.deepEqual(yield* service.ask("/api/github/connect", { method: "POST" }), {
        status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
        body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
      });
      const intent = intentOf(
        yield* service.ask("/api/github/connect", { method: "POST", bearer: ada.userId }),
      );
      const claim = (browser?: Browser) =>
        service.ask("/api/github/connect/claim", { method: "POST", browser, body: { intent } });

      assert.deepEqual(yield* claim(), {
        status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
        body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
      });
      assert.deepEqual((yield* claim(bob.browser)).body, {
        claim: GITHUB_CONNECT_CLAIM.OTHER_ACCOUNT,
      });
      assert.deepEqual((yield* claim(ada.browser)).body, { claim: GITHUB_CONNECT_CLAIM.CLAIMED });
      assert.deepEqual((yield* claim(ada.browser)).body, { claim: GITHUB_CONNECT_CLAIM.CLAIMED });

      yield* TestClock.adjust(Duration.minutes(10));
      assert.deepEqual((yield* claim(ada.browser)).body, { claim: GITHUB_CONNECT_CLAIM.EXPIRED });
    }),
);

it.effect(
  "linkSocial connects GitHub to the signed-in account, and another account cannot take the same GitHub",
  () =>
    Effect.gen(function* () {
      const service = yield* openService;
      const ada = yield* service.signUp("Ada");
      const bob = yield* service.signUp("Bob");
      assert.deepEqual(yield* service.connection(ada.userId), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { connected: false, login: null },
      });

      assert.equal(yield* service.linkGitHub(ada.browser), DONE_URL);
      const refused = new URL(yield* service.linkGitHub(bob.browser), ORIGIN);

      assert.deepEqual(refused.searchParams.getAll(GITHUB_CONNECT_PAGE.ERROR_PARAM), [
        "1",
        "account_already_linked_to_different_user",
      ]);
      assert.deepEqual((yield* service.connection(ada.userId)).body, {
        connected: true,
        login: null,
      });
      assert.deepEqual((yield* service.connection(bob.userId)).body, {
        connected: false,
        login: null,
      });
      const listed = yield* service.toAuth(ada.browser, "/list-accounts");
      // SAFETY: Better Auth answers the account list as JSON.
      const accounts = (yield* Effect.promise(() => listed.json())) as { providerId: string }[];
      assert.deepEqual(accounts.map((row) => row.providerId).sort(), ["credential", "github"]);
    }),
);

it.effect("a GitHub account kept with its tokens revoked reads as not connected", () =>
  Effect.gen(function* () {
    const service = yield* openService;
    const ada = yield* service.signUp("Ada");
    yield* service.linkGitHub(ada.browser);
    assert.deepEqual((yield* service.connection(ada.userId)).body, {
      connected: true,
      login: null,
    });

    yield* service.revokeTokens(ada.userId);

    assert.deepEqual((yield* service.connection(ada.userId)).body, {
      connected: false,
      login: null,
    });
    const listed = yield* service.toAuth(ada.browser, "/list-accounts");
    // SAFETY: Better Auth answers the account list as JSON.
    const accounts = (yield* Effect.promise(() => listed.json())) as { providerId: string }[];
    assert.ok(
      accounts.some((row) => row.providerId === "github"),
      "the GitHub row is kept",
    );
  }),
);

it.effect(
  "the Mac's session disconnects its own GitHub and no one else's, and keeps the account's other sign-in",
  () =>
    Effect.gen(function* () {
      const service = yield* openService;
      const ada = yield* service.signUp("Ada");
      const bob = yield* service.signUp("Bob");
      yield* service.linkGitHub(ada.browser);

      // Bob's session asks: Bob has no GitHub, so nothing of Ada's goes.
      const byBob = yield* service.ask("/api/github/disconnect", {
        method: "POST",
        bearer: yield* service.sessionBearerOf(bob.userId),
      });
      const adaAfterBob = (yield* service.connection(ada.userId)).body;
      const byAda = yield* service.ask("/api/github/disconnect", {
        method: "POST",
        bearer: yield* service.sessionBearerOf(ada.userId),
      });

      assert.deepEqual(byBob, {
        status: HOSTED_HTTP_STATUS.OK,
        body: { connected: false, login: null },
      });
      assert.deepEqual(adaAfterBob, { connected: true, login: null });
      assert.deepEqual(byAda, {
        status: HOSTED_HTTP_STATUS.OK,
        body: { connected: false, login: null },
      });
      assert.deepEqual(yield* service.providers(ada.browser), ["credential"]);
    }),
);

it.effect(
  "an OAuth token alone, or no bearer, is no session: unauthenticated, and GitHub stays linked",
  () =>
    Effect.gen(function* () {
      const service = yield* openService;
      const ada = yield* service.signUp("Ada");
      yield* service.linkGitHub(ada.browser);

      // The test's OAuth stand-in names the account on every bearer path, but this one reads a session.
      const underToken = yield* service.ask("/api/github/disconnect", {
        method: "POST",
        bearer: ada.userId,
      });
      const anonymous = yield* service.ask("/api/github/disconnect", { method: "POST" });

      const unauthenticated = {
        status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
        body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
      };
      assert.deepEqual(underToken, unauthenticated);
      assert.deepEqual(anonymous, unauthenticated);
      assert.deepEqual(yield* service.providers(ada.browser), ["credential", "github"]);
    }),
);

it.effect(
  "a refusal Luke does not read, or a failure that is not a refusal, is unavailable, never the last sign-in",
  () =>
    Effect.gen(function* () {
      const service = yield* openService;
      const ada = yield* service.signUp("Ada");
      const asAda = yield* service.sessionBearerOf(ada.userId);
      const answering =
        (failure: OrganizationRefused | Cause.UnknownError): GitHubUnlink =>
        () =>
          Effect.fail(failure);

      const unread = yield* service.ask("/api/github/disconnect", {
        method: "POST",
        bearer: asAda,
        unlink: answering(new OrganizationRefused({ status: 403, code: "SOMETHING_ELSE" })),
      });
      const broken = yield* service.ask("/api/github/disconnect", {
        method: "POST",
        bearer: asAda,
        unlink: answering(new Cause.UnknownError("the auth service threw")),
      });

      assert.deepEqual(unread, {
        status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
        body: { error: HOSTED_API_ERROR.UNAVAILABLE },
      });
      assert.deepEqual(broken, {
        status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
        body: { error: HOSTED_API_ERROR.UNAVAILABLE },
      });
    }),
);

it.effect(
  "a session older than Better Auth's freshness bound is unauthenticated, so the Mac asks for a fresh one, and GitHub stays",
  () =>
    Effect.gen(function* () {
      const service = yield* openService;
      const ada = yield* service.signUp("Ada");
      yield* service.linkGitHub(ada.browser);
      // A session the Mac has held for two days, past `unlinkAccount`'s one-day freshness.
      const aged = yield* Effect.promise(async () => {
        const context = await service.auth.$context;
        const session = await context.internalAdapter.createSession(
          ada.userId,
          false,
          { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
          true,
        );
        return `${session.token}.${await makeSignature(session.token, SECRET)}`;
      });

      const refused = yield* service.ask("/api/github/disconnect", {
        method: "POST",
        bearer: aged,
      });

      assert.deepEqual(refused, {
        status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
        body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
      });
      assert.deepEqual(yield* service.providers(ada.browser), ["credential", "github"]);
    }),
);

it.effect("GitHub as an account's only way to sign in is not disconnected", () =>
  Effect.gen(function* () {
    const service = yield* openService;
    // An account made by signing in with GitHub alone: one user, one GitHub account row.
    const browser = new Browser();
    const started = yield* service.toAuth(browser, "/sign-in/social", {
      provider: "github",
      callbackURL: DONE_URL,
    });
    // SAFETY: Better Auth answers a social sign-in's start as JSON naming GitHub's authorize URL.
    const { url } = (yield* Effect.promise(() => started.json())) as { url: string };
    const callback = new URL("/api/auth/callback/github", ORIGIN);
    callback.searchParams.set("code", "github-code-under-test");
    callback.searchParams.set("state", new URL(url).searchParams.get("state") ?? "");
    browser.keep(
      yield* Effect.promise(() =>
        service.auth.handler(new Request(callback, { headers: { cookie: browser.cookie } })),
      ),
    );
    const session = yield* Effect.promise(() =>
      service.auth.api.getSession({ headers: new Headers({ cookie: browser.cookie }) }),
    );
    const user = session?.user ?? assert.fail("GitHub's sign-in made no session");
    assert.deepEqual(yield* service.providers(browser), ["github"]);

    const refused = yield* service.ask("/api/github/disconnect", {
      method: "POST",
      bearer: yield* service.sessionBearerOf(user.id),
    });

    assert.deepEqual(refused, {
      status: HOSTED_HTTP_STATUS.FORBIDDEN,
      body: { error: HOSTED_API_ERROR.NOT_PERMITTED },
    });
    assert.deepEqual((yield* service.connection(user.id)).body, { connected: true, login: null });
  }),
);
