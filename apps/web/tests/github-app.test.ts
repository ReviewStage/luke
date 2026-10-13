import assert from "node:assert/strict";
import { verify } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { GITHUB_ACCOUNT_TYPE } from "@sidecar/database/github-installation-vocabulary";
import { account } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, vi } from "vitest";
import { AUTH_SECRET_ENVIRONMENT, GITHUB_APP_ENVIRONMENT } from "../server/auth-deployment";
import {
  GITHUB_REPOSITORY_SELECTION,
  GitHubApp,
  SIGN_IN_REQUIRED,
} from "../server/github/github-app";
import {
  fakeGitHub,
  GITHUB_APP_PUBLIC_KEY,
  GITHUB_APP_SETTINGS,
  GITHUB_FIXTURE,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  openGithubUser,
  standingGithubRow,
} from "./support/github-app-fake";

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

const { APP_ID } = GITHUB_FIXTURE;
const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const INSTALLATION_ID = 777;

function installationJson(id: number): Response {
  return Response.json({
    id,
    account: { login: "octo-org", id: 7_001, type: "Organization" },
    repository_selection: GITHUB_REPOSITORY_SELECTION.SELECTED,
    app_id: Number(APP_ID),
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
        accountId: 7_001,
        accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
        repositorySelection: GITHUB_REPOSITORY_SELECTION.SELECTED,
        ciReadable: false,
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

it.layer(getTestDB())("a signed-in user's token off the account row", (it) => {
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
                  account: { login: "octocat", id: 583_231, type: "User" },
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
          accountId: 583_231,
          accountType: GITHUB_ACCOUNT_TYPE.USER,
          repositorySelection: GITHUB_REPOSITORY_SELECTION.ALL,
          ciReadable: false,
        },
      ]);
      const [read] = fake.sent;
      assert.equal(
        read?.headers.get("authorization"),
        `Bearer ${standingGithubRow(0).accessToken}`,
      );
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
});
