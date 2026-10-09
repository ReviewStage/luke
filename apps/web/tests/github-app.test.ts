import assert from "node:assert/strict";
import { randomUUID, verify } from "node:crypto";
import { it } from "@effect/vitest";
import { symmetricDecrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, vi } from "vitest";
import { AUTH_SECRET_ENVIRONMENT, GITHUB_APP_ENVIRONMENT } from "../server/auth-deployment";
import { account, user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import {
  GITHUB_FAILURE,
  GITHUB_REPOSITORY_SELECTION,
  GitHubApp,
  githubAppFromEnvironment,
  SIGN_IN_REQUIRED,
} from "../server/github/github-app";
import { InstantColumnSchema } from "../server/hosted/store/database";
import {
  fakeGitHub,
  GITHUB_APP_PUBLIC_KEY,
  GITHUB_APP_SETTINGS,
  GITHUB_FIXTURE,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  openGithubUser,
  type RepositoryFixture,
  standingGithubRow,
} from "./support/github-app-fake";
import { testSqlClient } from "./support/sql-client";

/**
 * The Luke GitHub App's server client with GitHub a fake behind the
 * `HttpClient` and the account rows on a real Postgres dialect. What is held
 * here: the App speaks as itself with a JWT its own key signed; an
 * installation is confirmed as the App's own or not at all; a signed-in
 * user's token comes off the account row unsealed, refreshed on GitHub's
 * terms before it expires, and re-sealed in place, with every failure
 * carrying a kind or a status and never a token; and what the user reaches
 * through the App is every installation's repositories, paged, and a
 * repository is reachable only through the installation on its owner, which
 * is also what admits the one token the App mints, for that repository
 * alone with contents read.
 *
 * Synthetic keys, secrets, and tokens throughout (`support/github-app-fake.ts`).
 */

const { HOUR_MS, APP_ID, SLUG, CLIENT_ID, CLIENT_SECRET, SESSION_SECRET } = GITHUB_FIXTURE;
const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const INSTALLATION_ID = 777;
const PRIVATE_KEY_PEM = Redacted.value(GITHUB_APP_SETTINGS.privateKey);

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
    GITHUB_APP_PUBLIC_KEY,
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
    }).pipe(Effect.provide(fakeGitHub(() => new Response(null, { status: 500 })).layer)),
);

it.effect(
  "an installation is read as the App, and only one GitHub knows as this App's is an installation",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const fake = fakeGitHub((sent) =>
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
    }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
);

it.effect("a refusal or a dropped connection fails by status or kind alone", () =>
  Effect.gen(function* () {
    const refused = fakeGitHub(() => Response.json({ message: "no" }, { status: 503 }));
    const dropped = fakeGitHub(() => {
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
  }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
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
      GitHubApp.layer({
        ...GITHUB_APP_SETTINGS,
        privateKey: Redacted.make("-----BEGIN NOTHING-----"),
      }),
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

const unsealed = (token: string | null) =>
  Effect.promise(async () =>
    token === null ? null : symmetricDecrypt({ key: SESSION_SECRET, data: token }),
  );

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
      accessToken: yield* unsealed(row.accessToken),
      refreshToken: yield* unsealed(row.refreshToken),
      // Read through the column schema: `@effect/sql-pg` hands a timestamptz back as epoch millis, PGlite as a Date.
      accessTokenExpiresAt: instantOf(row.accessTokenExpiresAt),
      refreshTokenExpiresAt: instantOf(row.refreshTokenExpiresAt),
      updatedAt: instantOf(row.updatedAt),
    };
  });

const decodeInstant = Schema.decodeUnknownSync(Schema.NullOr(InstantColumnSchema));

/** A timestamptz as the two drivers hand it back, as epoch millis; null stays null. */
function instantOf(value: Date | null): number | null {
  return decodeInstant(value)?.getTime() ?? null;
}

it.layer(testSqlClient)("a signed-in user's token off the account row", (it) => {
  it.effect("a token with hours left is handed out as stored, with no word to GitHub", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const fake = fakeGitHub(() => new Response(null, { status: 500 }));
      const userId = yield* openGithubUser(standingGithubRow(now));
      const app = yield* GitHubApp;

      const token = yield* app.userToken(userId).pipe(Effect.provide(fake.layer));

      assert.equal(Redacted.value(token), standingGithubRow(0).accessToken);
      assert.equal(fake.sent.length, 0);
    }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a token about to expire is refreshed on the App's client, re-sealed in place, and reused",
    () =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const fake = fakeGitHub(() => refreshedJson("1"));
        const userId = yield* openGithubUser({
          ...standingGithubRow(now),
          accessTokenExpiresAt: new Date(now + 30_000),
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
          refresh_token: standingGithubRow(0).refreshToken,
        });
        const row = yield* readRow(userId);
        assert.equal(row.accessToken, "ghu_fresh-1");
        assert.equal(row.refreshToken, "ghr_fresh-1");
        assert.equal(row.accessTokenExpiresAt, now + 8 * HOUR_MS);
        assert.equal(row.refreshTokenExpiresAt, now + 180 * 24 * HOUR_MS);
        assert.equal(row.updatedAt, now);
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect("the row stays sealed: what the table holds is not the token", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const userId = yield* openGithubUser(standingGithubRow(now));
      const [row] = yield* db
        .select({ accessToken: account.accessToken, refreshToken: account.refreshToken })
        .from(account)
        .where(eq(account.userId, userId));
      assert.ok(row);
      assert.notEqual(row.accessToken, standingGithubRow(0).accessToken);
      assert.notEqual(row.refreshToken, standingGithubRow(0).refreshToken);
    }),
  );

  it.effect(
    "GitHub refusing the refresh means signing in again, and the row is left as it was",
    () =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const fake = fakeGitHub(() =>
          Response.json({ error: "bad_refresh_token", error_description: "retired" }),
        );
        const userId = yield* openGithubUser({
          ...standingGithubRow(now),
          accessTokenExpiresAt: new Date(now),
        });
        const app = yield* GitHubApp;

        const failure = yield* app.userToken(userId).pipe(Effect.provide(fake.layer), Effect.flip);

        assert.deepEqual(
          [failure._tag, "reason" in failure ? failure.reason : undefined],
          ["GitHubSignInRequired", SIGN_IN_REQUIRED.REFRESH_REFUSED],
        );
        const row = yield* readRow(userId);
        assert.equal(row.accessToken, standingGithubRow(0).accessToken);
        assert.equal(row.refreshToken, standingGithubRow(0).refreshToken);
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect("an expired refresh token is not even tried", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const fake = fakeGitHub(() => refreshedJson("never"));
      const userId = yield* openGithubUser({
        ...standingGithubRow(now),
        accessTokenExpiresAt: new Date(now - HOUR_MS),
        refreshTokenExpiresAt: new Date(now - 1),
      });
      const app = yield* GitHubApp;

      const failure = yield* app.userToken(userId).pipe(Effect.provide(fake.layer), Effect.flip);

      assert.equal(failure._tag, "GitHubSignInRequired");
      assert.equal(fake.sent.length, 0);
    }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect("a row from before the App, with no refresh token, calls for a new sign-in", () =>
    Effect.gen(function* () {
      const fake = fakeGitHub(() => refreshedJson("never"));
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
    }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect("an account with no GitHub row calls for a GitHub sign-in", () =>
    Effect.gen(function* () {
      const fake = fakeGitHub(() => refreshedJson("never"));
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
    }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect("the user's installations are read on the user's own token", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const fake = fakeGitHub((sent) =>
        new URL(sent.url).pathname === "/user/installations"
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
      const userId = yield* openGithubUser(standingGithubRow(now));
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
      assert.equal(
        read?.headers.get("authorization"),
        `Bearer ${standingGithubRow(0).accessToken}`,
      );
    }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect("a user with more installations than one page holds gets every page", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const pageOf = (page: number, size: number) =>
        Array.from({ length: size }, (_, index) => ({
          id: page * 1000 + index,
          account: { login: `org-${page}-${index}`, type: "Organization" },
          repository_selection: GITHUB_REPOSITORY_SELECTION.ALL,
        }));
      const fake = fakeGitHub((sent) => {
        const page = Number(new URL(sent.url).searchParams.get("page"));
        return Response.json({ installations: page === 1 ? pageOf(1, 100) : pageOf(2, 1) });
      });
      const userId = yield* openGithubUser(standingGithubRow(now));
      const app = yield* GitHubApp;

      const installations = yield* app.userInstallations(userId).pipe(Effect.provide(fake.layer));

      assert.equal(installations.length, 101);
      assert.equal(installations.at(-1)?.id, 2000);
      assert.deepEqual(
        fake.sent.map((sent) => new URL(sent.url).search),
        ["?per_page=100&page=1", "?per_page=100&page=2"],
      );
    }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "GitHub refusing a token that has not expired means the authorization was revoked: sign in again",
    () =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const fake = fakeGitHub(() =>
          Response.json({ message: "Bad credentials" }, { status: 401 }),
        );
        const userId = yield* openGithubUser(standingGithubRow(now));
        const app = yield* GitHubApp;

        const failure = yield* app
          .userInstallations(userId)
          .pipe(Effect.provide(fake.layer), Effect.flip);

        assert.deepEqual(
          [failure._tag, "reason" in failure ? failure.reason : undefined],
          ["GitHubSignInRequired", SIGN_IN_REQUIRED.TOKEN_REVOKED],
        );
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "the user's repositories are every installation's, paged through, most recently updated first",
    () =>
      Effect.gen(function* () {
        const many: RepositoryFixture[] = Array.from({ length: 130 }, (_, index) => ({
          owner: "octo-org",
          name: `service-${String(index).padStart(3, "0")}`,
          updatedAt: new Date(Date.UTC(2026, 0, 1) + index * HOUR_MS).toISOString(),
        }));
        const fake = githubReaching([
          {
            id: 1,
            login: "octocat",
            repositories: [
              { owner: "octocat", name: "dotfiles", updatedAt: "2026-10-08T00:00:00Z" },
            ],
          },
          { id: 2, login: "octo-org", repositories: many },
        ]);
        const userId = yield* openGithubUser();
        const app = yield* GitHubApp;

        const reached = yield* app.userRepositories(userId).pipe(Effect.provide(fake.layer));

        assert.equal(reached.installed, true);
        assert.equal(reached.repositories.length, 131);
        assert.deepEqual(reached.repositories[0], {
          owner: "octocat",
          name: "dotfiles",
          fullName: "octocat/dotfiles",
          defaultBranch: "main",
          private: false,
          updatedAt: Date.parse("2026-10-08T00:00:00Z"),
        });
        assert.deepEqual(
          reached.repositories.slice(1, 3).map((repository) => repository.fullName),
          ["octo-org/service-129", "octo-org/service-128"],
        );
        assert.deepEqual(
          fake.sent.map((sent) => new URL(sent.url).pathname + new URL(sent.url).search),
          [
            "/user/installations?per_page=100&page=1",
            "/user/installations/1/repositories?per_page=100&page=1",
            "/user/installations/2/repositories?per_page=100&page=1",
            "/user/installations/2/repositories?per_page=100&page=2",
          ],
        );
        for (const sent of fake.sent) {
          assert.equal(
            sent.headers.get("authorization"),
            `Bearer ${standingGithubRow(0).accessToken}`,
          );
        }
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect("a user with the App installed nowhere reaches no repository, and is told so", () =>
    Effect.gen(function* () {
      const fake = githubReaching([]);
      const userId = yield* openGithubUser();
      const app = yield* GitHubApp;

      const reached = yield* app.userRepositories(userId).pipe(Effect.provide(fake.layer));
      const one = yield* app
        .userRepository(userId, "octocat/dotfiles")
        .pipe(Effect.provide(fake.layer));

      assert.deepEqual(reached, { installed: false, repositories: [] });
      assert.equal(Option.isNone(one), true);
    }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a revoked token calls for a new sign-in from the repository reads too, and leaks no token",
    () =>
      Effect.gen(function* () {
        const fake = fakeGitHub(() =>
          Response.json({ message: "Bad credentials" }, { status: 401 }),
        );
        const userId = yield* openGithubUser();
        const app = yield* GitHubApp;

        const listing = yield* app
          .userRepositories(userId)
          .pipe(Effect.provide(fake.layer), Effect.flip);
        const check = yield* app
          .userRepository(userId, "octocat/dotfiles")
          .pipe(Effect.provide(fake.layer), Effect.flip);

        for (const failure of [listing, check]) {
          assert.deepEqual(
            [failure._tag, "reason" in failure ? failure.reason : undefined],
            ["GitHubSignInRequired", SIGN_IN_REQUIRED.TOKEN_REVOKED],
          );
        }
        assert.equal(JSON.stringify([listing, check]).includes("ghu_"), false);
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a repository is reachable only through the installation on its owner, spelled as GitHub spells it",
    () =>
      Effect.gen(function* () {
        const fake = githubReaching([
          { id: 1, login: "octocat", repositories: [{ owner: "octocat", name: "dotfiles" }] },
          {
            id: 2,
            login: "Octo-Org",
            repositories: [
              { owner: "Octo-Org", name: "Relay", private: true, defaultBranch: "trunk" },
            ],
          },
        ]);
        const userId = yield* openGithubUser();
        const app = yield* GitHubApp;
        const reach = (fullName: string) =>
          app.userRepository(userId, fullName).pipe(Effect.provide(fake.layer));

        const relay = yield* reach("octo-org/relay");
        const elsewhere = yield* reach("octocat/relay");
        const unknownOwner = yield* reach("acme/relay");

        assert.deepEqual(Option.getOrUndefined(relay), {
          owner: "Octo-Org",
          name: "Relay",
          fullName: "Octo-Org/Relay",
          defaultBranch: "trunk",
          private: true,
          updatedAt: Date.parse("2026-10-01T00:00:00Z"),
        });
        assert.equal(Option.isNone(elsewhere), true);
        assert.equal(Option.isNone(unknownOwner), true);
        // Only the owner's installation is read for its repositories.
        assert.deepEqual(
          fake.sent.map((sent) => new URL(sent.url).pathname),
          [
            "/user/installations",
            "/user/installations/2/repositories",
            "/user/installations",
            "/user/installations/1/repositories",
            "/user/installations",
          ],
        );
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a read token is minted as the App for the one repository the user reaches, with contents read, and for no other",
    () =>
      Effect.gen(function* () {
        const fake = githubReaching([
          {
            id: 2,
            login: "octo-org",
            repositories: [{ owner: "octo-org", name: "relay", defaultBranch: "trunk" }],
          },
        ]);
        const userId = yield* openGithubUser();
        const app = yield* GitHubApp;

        const minted = yield* app
          .repositoryReadToken(userId, "Octo-Org/Relay")
          .pipe(Effect.provide(fake.layer));
        const unreached = yield* app
          .repositoryReadToken(userId, "octo-org/ledger")
          .pipe(Effect.provide(fake.layer));

        assert.ok(Option.isSome(minted));
        assert.equal(minted.value.repository.fullName, "octo-org/relay");
        assert.equal(minted.value.repository.defaultBranch, "trunk");
        assert.equal(Redacted.value(minted.value.token), GITHUB_FIXTURE_INSTALLATION_TOKEN);
        assert.equal(String(minted.value.token).includes(GITHUB_FIXTURE_INSTALLATION_TOKEN), false);
        assert.ok(Option.isNone(unreached));
        // The mint is the App's own request, under its JWT, naming the one repository and contents read.
        const mints = fake.sent.filter((sent) => sent.url.endsWith("/access_tokens"));
        assert.equal(mints.length, 1);
        const [mint] = mints;
        assert.ok(mint);
        assert.equal(mint.method, "POST");
        assert.equal(mint.url, "https://api.github.com/app/installations/2/access_tokens");
        assert.deepEqual(JSON.parse(mint.body), {
          repositories: ["relay"],
          permissions: { contents: "read" },
        });
        assert.equal(
          readJwt((mint.headers.get("authorization") ?? "").slice("Bearer ".length)).payload.iss,
          APP_ID,
        );
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect("a mint GitHub refuses is unavailable by status, never a token", () =>
    Effect.gen(function* () {
      const refusing = fakeGitHub((sent) => {
        const { pathname } = new URL(sent.url);
        if (pathname.endsWith("/access_tokens")) {
          return Response.json(
            { message: "Resource not accessible by integration" },
            { status: 403 },
          );
        }
        if (pathname === "/user/installations") {
          return Response.json({
            installations: [
              { id: 2, account: { login: "octo-org" }, repository_selection: "selected" },
            ],
          });
        }
        return Response.json({
          repositories: [
            {
              name: "relay",
              full_name: "octo-org/relay",
              owner: { login: "octo-org" },
              private: true,
              default_branch: "main",
              updated_at: null,
            },
          ],
        });
      });
      const userId = yield* openGithubUser();
      const app = yield* GitHubApp;

      const failure = yield* app
        .repositoryReadToken(userId, "octo-org/relay")
        .pipe(Effect.provide(refusing.layer), Effect.flip);

      assert.ok(failure._tag === "GitHubUnavailable");
      assert.equal(failure.status, 403);
    }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "the owner's listing is read only as far as the repository, which may be past its first page",
    () =>
      Effect.gen(function* () {
        const many: RepositoryFixture[] = Array.from({ length: 250 }, (_, index) => ({
          owner: "octo-org",
          name: `service-${String(index).padStart(3, "0")}`,
        }));
        const fake = githubReaching([{ id: 2, login: "octo-org", repositories: many }]);
        const userId = yield* openGithubUser();
        const app = yield* GitHubApp;

        const onPageTwo = yield* app
          .userRepository(userId, "octo-org/service-150")
          .pipe(Effect.provide(fake.layer));
        const pagesRead = fake.sent.length;
        const onPageThree = yield* app
          .userRepository(userId, "octo-org/service-249")
          .pipe(Effect.provide(fake.layer));

        assert.equal(Option.getOrUndefined(onPageTwo)?.fullName, "octo-org/service-150");
        assert.equal(Option.getOrUndefined(onPageThree)?.fullName, "octo-org/service-249");
        // The installations, then pages one and two: the third page was never asked for.
        assert.equal(pagesRead, 3);
        assert.equal(fake.sent.length - pagesRead, 4);
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a listing GitHub keeps answering full pages of is unreadable, never the part that was read",
    () =>
      Effect.gen(function* () {
        const page = Array.from({ length: 100 }, (_, index) => ({
          id: index,
          account: { login: `org-${index}` },
          repository_selection: GITHUB_REPOSITORY_SELECTION.ALL,
        }));
        const endless = fakeGitHub(() => Response.json({ installations: page }));
        const userId = yield* openGithubUser();
        const app = yield* GitHubApp;

        const listing = yield* app
          .userRepositories(userId)
          .pipe(Effect.provide(endless.layer), Effect.flip);
        const check = yield* app
          .userRepository(userId, "acme/relay")
          .pipe(Effect.provide(endless.layer), Effect.flip);

        for (const failure of [listing, check]) {
          assert.ok(failure._tag === "GitHubUnavailable");
          assert.equal(failure.reason, GITHUB_FAILURE.UNBOUNDED);
        }
        assert.equal(endless.sent.length, 100);
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "an installation uninstalled between the two reads reaches nothing rather than failing the listing",
    () =>
      Effect.gen(function* () {
        const uninstalled = fakeGitHub((sent) => {
          const { pathname } = new URL(sent.url);
          if (pathname === "/user/installations") {
            return Response.json({
              installations: [
                { id: 1, account: { login: "octocat" }, repository_selection: "all" },
                { id: 9, account: { login: "gone" }, repository_selection: "all" },
              ],
            });
          }
          return pathname === "/user/installations/1/repositories"
            ? Response.json({
                repositories: [
                  {
                    name: "dotfiles",
                    full_name: "octocat/dotfiles",
                    owner: { login: "octocat" },
                    private: false,
                    default_branch: "main",
                    updated_at: null,
                  },
                ],
              })
            : Response.json({ message: "Not Found" }, { status: 404 });
        });
        const userId = yield* openGithubUser();
        const app = yield* GitHubApp;

        const reached = yield* app.userRepositories(userId).pipe(Effect.provide(uninstalled.layer));

        assert.equal(reached.installed, true);
        assert.deepEqual(
          reached.repositories.map((repository) => [repository.fullName, repository.updatedAt]),
          [["octocat/dotfiles", 0]],
        );
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a token that will not open under this deployment's secret calls for a new sign-in",
    () =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const fake = fakeGitHub(() => new Response(null, { status: 500 }));
        const userId = yield* openGithubUser(standingGithubRow(now));
        const app = yield* Effect.provide(
          GitHubApp,
          GitHubApp.layer({
            ...GITHUB_APP_SETTINGS,
            sessionSecret: Redacted.make("another-secret-entirely"),
          }),
        );

        const failure = yield* app.userToken(userId).pipe(Effect.provide(fake.layer), Effect.flip);

        assert.deepEqual(
          [failure._tag, "reason" in failure ? failure.reason : undefined],
          ["GitHubSignInRequired", SIGN_IN_REQUIRED.UNREADABLE_TOKEN],
        );
      }),
  );
});
