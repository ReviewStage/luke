import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, vi } from "vitest";
import { AUTH_SECRET_ENVIRONMENT, GITHUB_APP_ENVIRONMENT } from "../server/auth-deployment";
import { account, user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import {
  GITHUB_FAILURE,
  GITHUB_PROVIDER_ID,
  GITHUB_REPOSITORY_SELECTION,
  GitHubApp,
  type GitHubAppSettings,
  githubAppFromEnvironment,
  SIGN_IN_REQUIRED,
} from "../server/github/github-app";
import { testSqlClient } from "./support/sql-client";

/**
 * The Luke GitHub App's server client with GitHub a fake behind the
 * `HttpClient` and the account rows on a real Postgres dialect. What is held
 * here: the App speaks as itself with a JWT its own key signed; an
 * installation is confirmed as the App's own or not at all; and a signed-in
 * user's token comes off the account row unsealed, refreshed on GitHub's
 * terms before it expires, and re-sealed in place, with every failure
 * carrying a kind or a status and never a token.
 *
 * Synthetic keys, secrets, and tokens throughout.
 */

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const APP_ID = "4242";
const SLUG = "luke";
const CLIENT_ID = "Iv1.fixture-client-id";
const CLIENT_SECRET = "fixture-client-secret";
const SESSION_SECRET = "fixture-session-secret-of-enough-length";
const INSTALLATION_ID = 777;

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

const SETTINGS: GitHubAppSettings = {
  appId: APP_ID,
  slug: SLUG,
  clientId: CLIENT_ID,
  clientSecret: Redacted.make(CLIENT_SECRET),
  privateKey: Redacted.make(PRIVATE_KEY_PEM),
  sessionSecret: Redacted.make(SESSION_SECRET),
};

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string;
}

interface FakeGitHub {
  readonly layer: Layer.Layer<GitHubApp | import("effect/unstable/http/HttpClient").HttpClient>;
  readonly sent: Sent[];
}

/** GitHub's token endpoint and API, answering from the script given, every request written down. */
function github(
  answer: (sent: Sent) => Response | Promise<Response>,
  settings: GitHubAppSettings | undefined = SETTINGS,
): FakeGitHub {
  const sent: Sent[] = [];
  const http = fakeHttpClientLayer(async (url, init) => {
    const request: Sent = {
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: init.body === undefined ? "" : await new Response(init.body).text(),
    };
    sent.push(request);
    return answer(request);
  });
  return { layer: Layer.mergeAll(http, GitHubApp.layer(settings)), sent };
}

function installationJson(id: number): Response {
  return Response.json({
    id,
    account: { login: "octo-org", type: "Organization" },
    repository_selection: GITHUB_REPOSITORY_SELECTION.SELECTED,
    app_id: Number(APP_ID),
  });
}

function refreshedJson(suffix: string): Response {
  return Response.json({
    access_token: `ghu_fresh-${suffix}`,
    expires_in: 8 * 60 * 60,
    refresh_token: `ghr_fresh-${suffix}`,
    refresh_token_expires_in: 180 * 24 * 60 * 60,
    scope: "",
    token_type: "bearer",
  });
}

/** A JWT's three parts, the signature checked against the App's public key. */
function readJwt(jwt: string) {
  const [header, payload, signature] = jwt.split(".");
  assert.ok(header && payload && signature);
  const signed = verify(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    publicKey,
    Buffer.from(signature, "base64url"),
  );
  return {
    signed,
    header: JSON.parse(Buffer.from(header, "base64url").toString()),
    payload: JSON.parse(Buffer.from(payload, "base64url").toString()),
  };
}

it.effect(
  "the App speaks as itself with a JWT its key signed, issued a minute back and good for minutes",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const app = yield* GitHubApp;
      const jwt = readJwt(Redacted.value(yield* app.appJwt));

      assert.equal(jwt.signed, true);
      assert.deepEqual(jwt.header, { alg: "RS256", typ: "JWT" });
      assert.equal(jwt.payload.iss, APP_ID);
      assert.equal(jwt.payload.iat, NOW / 1000 - 60);
      assert.ok(jwt.payload.exp > NOW / 1000);
      assert.ok(jwt.payload.exp <= NOW / 1000 + 10 * 60);
    }).pipe(Effect.provide(github(() => new Response(null, { status: 500 })).layer)),
);

it.effect(
  "an installation is read as the App, and only one GitHub knows as this App's is an installation",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const fake = github((sent) =>
        sent.url.endsWith(`/app/installations/${INSTALLATION_ID}`)
          ? installationJson(INSTALLATION_ID)
          : Response.json({ message: "Not Found" }, { status: 404 }),
      );
      const app = yield* GitHubApp;

      const found = yield* app.installation(INSTALLATION_ID).pipe(Effect.provide(fake.layer));
      const missing = yield* app.installation(INSTALLATION_ID + 1).pipe(Effect.provide(fake.layer));

      assert.deepEqual(Option.getOrUndefined(found), {
        id: INSTALLATION_ID,
        accountLogin: "octo-org",
        repositorySelection: GITHUB_REPOSITORY_SELECTION.SELECTED,
      });
      assert.equal(Option.isNone(missing), true);
      const [read] = fake.sent;
      assert.ok(read);
      assert.equal(read.url, `https://api.github.com/app/installations/${INSTALLATION_ID}`);
      assert.equal(read.headers.get("accept"), "application/vnd.github+json");
      assert.equal(read.headers.get("x-github-api-version"), "2022-11-28");
      assert.ok(read.headers.get("user-agent"));
      const bearer = read.headers.get("authorization") ?? "";
      assert.match(bearer, /^Bearer /u);
      assert.equal(readJwt(bearer.slice("Bearer ".length)).payload.iss, APP_ID);
    }).pipe(Effect.provide(GitHubApp.layer(SETTINGS))),
);

it.effect("a refusal or a dropped connection fails by status or kind alone", () =>
  Effect.gen(function* () {
    const refused = github(() => Response.json({ message: "no" }, { status: 503 }));
    const dropped = github(() => {
      throw new Error("socket hang up");
    });
    const app = yield* GitHubApp;

    const status = yield* app
      .installation(INSTALLATION_ID)
      .pipe(Effect.provide(refused.layer), Effect.flip);
    const transport = yield* app
      .installation(INSTALLATION_ID)
      .pipe(Effect.provide(dropped.layer), Effect.flip);

    assert.ok(status._tag === "GitHubUnavailable");
    assert.deepEqual([status.reason, status.status], [GITHUB_FAILURE.STATUS, 503]);
    assert.ok(transport._tag === "GitHubUnavailable");
    assert.deepEqual([transport.reason, transport.status], [GITHUB_FAILURE.TRANSPORT, undefined]);
    assert.equal(JSON.stringify([status, transport]).includes("Bearer"), false);
  }).pipe(Effect.provide(GitHubApp.layer(SETTINGS))),
);

it.effect("a deployment without the App answers what is missing, by name, from every read", () =>
  Effect.gen(function* () {
    const app = yield* GitHubApp;
    const failure = yield* Effect.flip(app.installUrl);
    assert.equal(failure._tag, "GitHubAppNotConfigured");
    assert.deepEqual(failure.missing, [GITHUB_APP_ENVIRONMENT.SLUG]);
  }).pipe(Effect.provide(GitHubApp.layer(undefined, [GITHUB_APP_ENVIRONMENT.SLUG]))),
);

it.effect("a private key that will not parse leaves the App unconfigured, naming the key", () =>
  Effect.gen(function* () {
    const app = yield* GitHubApp;
    const failure = yield* Effect.flip(app.appJwt);
    assert.equal(failure._tag, "GitHubAppNotConfigured");
    assert.deepEqual(failure.missing, [GITHUB_APP_ENVIRONMENT.PRIVATE_KEY]);
  }).pipe(
    Effect.provide(
      GitHubApp.layer({ ...SETTINGS, privateKey: Redacted.make("-----BEGIN NOTHING-----") }),
    ),
  ),
);

const ENVIRONMENT_NAMES = [
  ...Object.values(GITHUB_APP_ENVIRONMENT),
  AUTH_SECRET_ENVIRONMENT.SESSION_SECRET,
];

beforeEach(() => {
  for (const name of ENVIRONMENT_NAMES) vi.stubEnv(name, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it.effect(
  "the environment layer reads the six variables, a PEM with flattened newlines included",
  () =>
    Effect.gen(function* () {
      vi.stubEnv(GITHUB_APP_ENVIRONMENT.APP_ID, APP_ID);
      vi.stubEnv(GITHUB_APP_ENVIRONMENT.SLUG, ` ${SLUG} `);
      vi.stubEnv(GITHUB_APP_ENVIRONMENT.CLIENT_ID, CLIENT_ID);
      vi.stubEnv(GITHUB_APP_ENVIRONMENT.CLIENT_SECRET, CLIENT_SECRET);
      vi.stubEnv(GITHUB_APP_ENVIRONMENT.PRIVATE_KEY, PRIVATE_KEY_PEM.replaceAll("\n", "\\n"));
      vi.stubEnv(AUTH_SECRET_ENVIRONMENT.SESSION_SECRET, SESSION_SECRET);
      yield* TestClock.setTime(NOW);

      const app = yield* Effect.provide(GitHubApp, githubAppFromEnvironment);
      assert.equal(yield* app.installUrl, `https://github.com/apps/${SLUG}/installations/new`);
      assert.equal(readJwt(Redacted.value(yield* app.appJwt)).signed, true);
    }),
);

it.effect(
  "the environment layer builds with nothing set, and names what every read is missing",
  () =>
    Effect.gen(function* () {
      vi.stubEnv(GITHUB_APP_ENVIRONMENT.APP_ID, APP_ID);
      vi.stubEnv(GITHUB_APP_ENVIRONMENT.CLIENT_ID, "   ");
      const app = yield* Effect.provide(GitHubApp, githubAppFromEnvironment);
      const failure = yield* Effect.flip(app.installUrl);
      assert.equal(failure._tag, "GitHubAppNotConfigured");
      assert.deepEqual(failure.missing, [
        GITHUB_APP_ENVIRONMENT.SLUG,
        GITHUB_APP_ENVIRONMENT.CLIENT_ID,
        GITHUB_APP_ENVIRONMENT.CLIENT_SECRET,
        GITHUB_APP_ENVIRONMENT.PRIVATE_KEY,
        AUTH_SECRET_ENVIRONMENT.SESSION_SECRET,
      ]);
    }),
);

/** A sealed token as Better Auth writes one on the account row. */
const sealed = (token: string) =>
  Effect.promise(() => symmetricEncrypt({ key: SESSION_SECRET, data: token }));

const unsealed = (token: string | null) =>
  Effect.promise(async () =>
    token === null ? null : symmetricDecrypt({ key: SESSION_SECRET, data: token }),
  );

interface GitHubRow {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly accessTokenExpiresAt: Date | null;
  readonly refreshTokenExpiresAt: Date | null;
}

/** A user with one GitHub account row, its tokens sealed the way a sign-in leaves them. */
const openGithubUser = (row: GitHubRow) =>
  Effect.gen(function* () {
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    yield* db.insert(account).values({
      id: `account-${randomUUID()}`,
      accountId: "4242",
      providerId: GITHUB_PROVIDER_ID,
      userId,
      accessToken: yield* sealed(row.accessToken),
      refreshToken: row.refreshToken === null ? null : yield* sealed(row.refreshToken),
      accessTokenExpiresAt: row.accessTokenExpiresAt,
      refreshTokenExpiresAt: row.refreshTokenExpiresAt,
      scope: "",
      updatedAt: new Date(NOW - HOUR_MS),
    });
    return userId;
  });

const readRow = (userId: string) =>
  Effect.gen(function* () {
    const [row] = yield* db
      .select({
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        accessTokenExpiresAt: account.accessTokenExpiresAt,
        refreshTokenExpiresAt: account.refreshTokenExpiresAt,
        updatedAt: account.updatedAt,
      })
      .from(account)
      .where(eq(account.userId, userId));
    assert.ok(row);
    return {
      ...row,
      accessToken: yield* unsealed(row.accessToken),
      refreshToken: yield* unsealed(row.refreshToken),
    };
  });

const APP_ROW: GitHubRow = {
  accessToken: "ghu_standing",
  refreshToken: "ghr_standing",
  accessTokenExpiresAt: new Date(NOW + 7 * HOUR_MS),
  refreshTokenExpiresAt: new Date(NOW + 170 * 24 * HOUR_MS),
};

it.layer(testSqlClient)("a signed-in user's token off the account row", (it) => {
  it.effect("a token with hours left is handed out as stored, with no word to GitHub", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const fake = github(() => new Response(null, { status: 500 }));
      const userId = yield* openGithubUser(APP_ROW);
      const app = yield* GitHubApp;

      const token = yield* app.userToken(userId).pipe(Effect.provide(fake.layer));

      assert.equal(Redacted.value(token), APP_ROW.accessToken);
      assert.equal(fake.sent.length, 0);
    }).pipe(Effect.provide(GitHubApp.layer(SETTINGS))),
  );

  it.effect(
    "a token about to expire is refreshed on the App's client, re-sealed in place, and reused",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const fake = github(() => refreshedJson("1"));
        const userId = yield* openGithubUser({
          ...APP_ROW,
          accessTokenExpiresAt: new Date(NOW + 30_000),
        });
        const app = yield* GitHubApp;

        const token = yield* app.userToken(userId).pipe(Effect.provide(fake.layer));
        const again = yield* app.userToken(userId).pipe(Effect.provide(fake.layer));

        assert.equal(Redacted.value(token), "ghu_fresh-1");
        assert.equal(Redacted.value(again), "ghu_fresh-1");
        assert.equal(fake.sent.length, 1);
        const [refresh] = fake.sent;
        assert.ok(refresh);
        assert.equal(refresh.url, "https://github.com/login/oauth/access_token");
        assert.equal(refresh.method, "POST");
        assert.equal(refresh.headers.get("accept"), "application/json");
        assert.deepEqual(Object.fromEntries(new URLSearchParams(refresh.body)), {
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: "refresh_token",
          refresh_token: APP_ROW.refreshToken,
        });
        const row = yield* readRow(userId);
        assert.equal(row.accessToken, "ghu_fresh-1");
        assert.equal(row.refreshToken, "ghr_fresh-1");
        assert.equal(row.accessTokenExpiresAt?.getTime(), NOW + 8 * HOUR_MS);
        assert.equal(row.refreshTokenExpiresAt?.getTime(), NOW + 180 * 24 * HOUR_MS);
        assert.equal(row.updatedAt.getTime(), NOW);
      }).pipe(Effect.provide(GitHubApp.layer(SETTINGS))),
  );

  it.effect("the row stays sealed: what the table holds is not the token", () =>
    Effect.gen(function* () {
      const userId = yield* openGithubUser(APP_ROW);
      const [row] = yield* db
        .select({ accessToken: account.accessToken, refreshToken: account.refreshToken })
        .from(account)
        .where(eq(account.userId, userId));
      assert.ok(row);
      assert.notEqual(row.accessToken, APP_ROW.accessToken);
      assert.notEqual(row.refreshToken, APP_ROW.refreshToken);
    }),
  );

  it.effect(
    "GitHub refusing the refresh means signing in again, and the row is left as it was",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const fake = github(() =>
          Response.json({ error: "bad_refresh_token", error_description: "retired" }),
        );
        const userId = yield* openGithubUser({ ...APP_ROW, accessTokenExpiresAt: new Date(NOW) });
        const app = yield* GitHubApp;

        const failure = yield* app.userToken(userId).pipe(Effect.provide(fake.layer), Effect.flip);

        assert.deepEqual(
          [failure._tag, "reason" in failure ? failure.reason : undefined],
          ["GitHubSignInRequired", SIGN_IN_REQUIRED.REFRESH_REFUSED],
        );
        const row = yield* readRow(userId);
        assert.equal(row.accessToken, APP_ROW.accessToken);
        assert.equal(row.refreshToken, APP_ROW.refreshToken);
      }).pipe(Effect.provide(GitHubApp.layer(SETTINGS))),
  );

  it.effect("an expired refresh token is not even tried", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const fake = github(() => refreshedJson("never"));
      const userId = yield* openGithubUser({
        ...APP_ROW,
        accessTokenExpiresAt: new Date(NOW - HOUR_MS),
        refreshTokenExpiresAt: new Date(NOW - 1),
      });
      const app = yield* GitHubApp;

      const failure = yield* app.userToken(userId).pipe(Effect.provide(fake.layer), Effect.flip);

      assert.equal(failure._tag, "GitHubSignInRequired");
      assert.equal(fake.sent.length, 0);
    }).pipe(Effect.provide(GitHubApp.layer(SETTINGS))),
  );

  it.effect("a row from before the App, with no refresh token, calls for a new sign-in", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const fake = github(() => refreshedJson("never"));
      const userId = yield* openGithubUser({
        accessToken: "gho_oauth-app-token",
        refreshToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      });
      const app = yield* GitHubApp;

      const failure = yield* app.userToken(userId).pipe(Effect.provide(fake.layer), Effect.flip);

      assert.deepEqual(
        [failure._tag, "reason" in failure ? failure.reason : undefined],
        ["GitHubSignInRequired", SIGN_IN_REQUIRED.BEFORE_THE_APP],
      );
      assert.equal(fake.sent.length, 0);
    }).pipe(Effect.provide(GitHubApp.layer(SETTINGS))),
  );

  it.effect("an account with no GitHub row calls for a GitHub sign-in", () =>
    Effect.gen(function* () {
      const fake = github(() => refreshedJson("never"));
      const userId = `user-${randomUUID()}`;
      yield* db
        .insert(user)
        .values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
      const app = yield* GitHubApp;

      const failure = yield* app.userToken(userId).pipe(Effect.provide(fake.layer), Effect.flip);

      assert.deepEqual(
        [failure._tag, "reason" in failure ? failure.reason : undefined],
        ["GitHubSignInRequired", SIGN_IN_REQUIRED.NO_GITHUB_ACCOUNT],
      );
    }).pipe(Effect.provide(GitHubApp.layer(SETTINGS))),
  );

  it.effect("the user's installations are read on the user's own token", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const fake = github((sent) =>
        sent.url === "https://api.github.com/user/installations"
          ? Response.json({
              total_count: 1,
              installations: [
                {
                  id: INSTALLATION_ID,
                  account: { login: "octocat", type: "User" },
                  repository_selection: GITHUB_REPOSITORY_SELECTION.ALL,
                },
              ],
            })
          : new Response(null, { status: 500 }),
      );
      const userId = yield* openGithubUser(APP_ROW);
      const app = yield* GitHubApp;

      const installations = yield* app.userInstallations(userId).pipe(Effect.provide(fake.layer));

      assert.deepEqual(installations, [
        {
          id: INSTALLATION_ID,
          accountLogin: "octocat",
          repositorySelection: GITHUB_REPOSITORY_SELECTION.ALL,
        },
      ]);
      const [read] = fake.sent;
      assert.equal(read?.headers.get("authorization"), `Bearer ${APP_ROW.accessToken}`);
    }).pipe(Effect.provide(GitHubApp.layer(SETTINGS))),
  );

  it.effect(
    "a token that will not open under this deployment's secret calls for a new sign-in",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const fake = github(() => new Response(null, { status: 500 }));
        const userId = yield* openGithubUser(APP_ROW);
        const app = yield* Effect.provide(
          GitHubApp,
          GitHubApp.layer({ ...SETTINGS, sessionSecret: Redacted.make("another-secret-entirely") }),
        );

        const failure = yield* app.userToken(userId).pipe(Effect.provide(fake.layer), Effect.flip);

        assert.deepEqual(
          [failure._tag, "reason" in failure ? failure.reason : undefined],
          ["GitHubSignInRequired", SIGN_IN_REQUIRED.UNREADABLE_TOKEN],
        );
      }),
  );
});
