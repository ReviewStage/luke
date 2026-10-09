/**
 * github-app-fake.ts -- the Luke GitHub App over a GitHub that answers from a test's own script, and the account rows a sign-in leaves.
 *
 * A suite stands the real `GitHubApp` over fixed settings and a fake
 * `HttpClient`, so what it holds is what the service asks GitHub and what it
 * makes of the answer. The account rows are the ones Better Auth leaves on
 * a sign-in through the App: tokens sealed under the session secret, with
 * their expiries beside them. A row's instants hang off the test clock as it
 * stands rather than off a clock the test moved: under a real Postgres pool
 * a `TestClock.setTime` jump left every later statement waiting, which
 * PGlite never showed. Synthetic keys, secrets, and tokens throughout.
 */

import { generateKeyPairSync, randomUUID } from "node:crypto";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { symmetricEncrypt } from "better-auth/crypto";
import { Clock, Effect, Layer, Redacted } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import { account, user } from "../../server/db/auth-schema";
import { db } from "../../server/db/query";
import {
  GITHUB_PROVIDER_ID,
  GITHUB_REPOSITORY_SELECTION,
  GitHubApp,
  type GitHubAppSettings,
} from "../../server/github/github-app";

export const GITHUB_FIXTURE = {
  HOUR_MS: 60 * 60 * 1000,
  APP_ID: "4242",
  SLUG: "luke",
  CLIENT_ID: "Iv1.fixture-client-id",
  CLIENT_SECRET: "fixture-client-secret",
  SESSION_SECRET: "fixture-session-secret-of-enough-length",
} as const;

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

/** The key the App's JWT is checked against. */
export const GITHUB_APP_PUBLIC_KEY = publicKey;

export const GITHUB_APP_SETTINGS: GitHubAppSettings = {
  appId: GITHUB_FIXTURE.APP_ID,
  slug: GITHUB_FIXTURE.SLUG,
  clientId: GITHUB_FIXTURE.CLIENT_ID,
  clientSecret: Redacted.make(GITHUB_FIXTURE.CLIENT_SECRET),
  privateKey: Redacted.make(privateKey.export({ type: "pkcs1", format: "pem" }).toString()),
  sessionSecret: Redacted.make(GITHUB_FIXTURE.SESSION_SECRET),
};

/** One request as GitHub saw it. */
export interface SentToGitHub {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string;
}

export interface FakeGitHub {
  readonly layer: Layer.Layer<GitHubApp | HttpClient.HttpClient>;
  /** Every request, in the order sent. */
  readonly sent: SentToGitHub[];
}

/** The App over the fixture settings, which is what every fake stands unless a test hands another. */
const GITHUB_APP_LAYER: Layer.Layer<GitHubApp> = GitHubApp.layer(GITHUB_APP_SETTINGS);

/** The token the fake App mints for a repository, which is what a test reads for at the sandbox's firewall. */
export const GITHUB_FIXTURE_INSTALLATION_TOKEN = "ghs_fixture_installation_token";

/** The App over a GitHub nobody reaches: a test whose calls read no repository hands this where production reads GitHub. */
export const NO_GITHUB: Layer.Layer<GitHubApp | HttpClient.HttpClient> = Layer.suspend(
  () =>
    fakeGitHub(() => {
      throw new Error("this test reaches no GitHub");
    }).layer,
);

/** GitHub's token endpoint and API answering from the script given, every request written down, under the App given. */
export function fakeGitHub(
  answer: (sent: SentToGitHub) => Response | Promise<Response>,
  app: Layer.Layer<GitHubApp> = GITHUB_APP_LAYER,
): FakeGitHub {
  const sent: SentToGitHub[] = [];
  const http = fakeHttpClientLayer(async (url, init) => {
    const request: SentToGitHub = {
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: init.body === undefined ? "" : await new Response(init.body).text(),
    };
    sent.push(request);
    return answer(request);
  });
  return { layer: Layer.mergeAll(http, app), sent };
}

/** One repository as a test names it; GitHub's record is built from it. */
export interface RepositoryFixture {
  readonly owner: string;
  readonly name: string;
  /** When GitHub last saw it change, ISO; a fixed instant when unsaid. */
  readonly updatedAt?: string;
  readonly private?: boolean;
  readonly defaultBranch?: string;
}

/** One installation as a test names it: on whose account, and the repositories it reaches for the user. */
export interface InstallationFixture {
  readonly id: number;
  readonly login: string;
  readonly repositories: readonly RepositoryFixture[];
}

/** GitHub's own record of a repository, as much of it as the service reads and a little it does not. */
function repositoryJson(fixture: RepositoryFixture) {
  return {
    id: 1_000 + fixture.name.length,
    name: fixture.name,
    full_name: `${fixture.owner}/${fixture.name}`,
    owner: { login: fixture.owner, type: "User" },
    private: fixture.private ?? false,
    default_branch: fixture.defaultBranch ?? "main",
    updated_at: fixture.updatedAt ?? "2026-10-01T00:00:00Z",
    pushed_at: fixture.updatedAt ?? "2026-10-01T00:00:00Z",
    html_url: `https://github.com/${fixture.owner}/${fixture.name}`,
  };
}

/** The page GitHub was asked for, as its query spells it; the first, and a hundred, when unsaid. */
function pageOf(url: string) {
  const query = new URL(url).searchParams;
  return { page: Number(query.get("page") ?? 1), perPage: Number(query.get("per_page") ?? 100) };
}

function sliceOf<A>(items: readonly A[], url: string): readonly A[] {
  const { page, perPage } = pageOf(url);
  return items.slice((page - 1) * perPage, page * perPage);
}

const INSTALLATION_REPOSITORIES = /^\/user\/installations\/(\d+)\/repositories$/u;
const INSTALLATION_ACCESS_TOKENS = /^\/app\/installations\/(\d+)\/access_tokens$/u;

/**
 * A GitHub on which the user reaches the installations given, paged the way
 * GitHub pages them, and the App mints a token for any of those
 * installations; nothing else: any other request fails.
 */
export function githubReaching(
  installations: readonly InstallationFixture[],
  app: Layer.Layer<GitHubApp> = GITHUB_APP_LAYER,
): FakeGitHub {
  return fakeGitHub((sent) => {
    const { pathname } = new URL(sent.url);
    const minting = INSTALLATION_ACCESS_TOKENS.exec(pathname);
    if (minting !== null) {
      return installations.some((candidate) => String(candidate.id) === minting[1])
        ? Response.json(
            {
              token: GITHUB_FIXTURE_INSTALLATION_TOKEN,
              expires_at: "2026-10-01T01:00:00Z",
              permissions: { contents: "read" },
              repository_selection: GITHUB_REPOSITORY_SELECTION.SELECTED,
            },
            { status: 201 },
          )
        : Response.json({ message: "Not Found" }, { status: 404 });
    }
    if (pathname === "/user/installations") {
      return Response.json({
        total_count: installations.length,
        installations: sliceOf(installations, sent.url).map((installation) => ({
          id: installation.id,
          account: { login: installation.login, type: "User" },
          repository_selection: GITHUB_REPOSITORY_SELECTION.SELECTED,
          app_id: Number(GITHUB_FIXTURE.APP_ID),
        })),
      });
    }
    const match = INSTALLATION_REPOSITORIES.exec(pathname);
    const installation = installations.find((candidate) => String(candidate.id) === match?.[1]);
    if (installation === undefined) {
      return Response.json({ message: "Not Found" }, { status: 404 });
    }
    return Response.json({
      total_count: installation.repositories.length,
      repository_selection: GITHUB_REPOSITORY_SELECTION.SELECTED,
      repositories: sliceOf(installation.repositories, sent.url).map(repositoryJson),
    });
  }, app);
}

/** A sealed token as Better Auth writes one on the account row. */
const sealed = (token: string): Effect.Effect<string> =>
  Effect.promise(() => symmetricEncrypt({ key: GITHUB_FIXTURE.SESSION_SECRET, data: token }));

/** The token columns of one GitHub account row, unsealed. */
export interface GitHubAccountRow {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly accessTokenExpiresAt: Date | null;
  readonly refreshTokenExpiresAt: Date | null;
}

/** The row a sign-in through the App left at `now`: hours on its token, months on its refresh token. */
export const standingGithubRow = (now: number): GitHubAccountRow => ({
  accessToken: "ghu_standing",
  refreshToken: "ghr_standing",
  accessTokenExpiresAt: new Date(now + 7 * GITHUB_FIXTURE.HOUR_MS),
  refreshTokenExpiresAt: new Date(now + 170 * 24 * GITHUB_FIXTURE.HOUR_MS),
});

/**
 * A user with one GitHub account row, its tokens sealed the way a sign-in
 * leaves them; the standing row off the clock when none is given. The user's id.
 */
export const openGithubUser = (standing?: GitHubAccountRow) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const row = standing ?? standingGithubRow(now);
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
      updatedAt: new Date(now - GITHUB_FIXTURE.HOUR_MS),
    });
    return userId;
  });
