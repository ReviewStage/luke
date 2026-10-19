/**
 * github-app-fake.ts -- the Luke GitHub App over a GitHub that answers from a test's own script, a workspace's connected installation, and the account rows a sign-in leaves.
 *
 * A suite stands the real `GitHubApp` over fixed settings and a fake
 * `HttpClient`, so what it holds is what the service asks GitHub and what it
 * makes of the answer. A workspace reaches repositories only through the
 * installation connected to it, which `connectWorkspaceGitHub` links as a
 * finished connect would. The account rows are the ones Better Auth leaves
 * on a sign-in through the App: tokens sealed under the session secret, with
 * their expiries beside them. A row's instants hang off the test clock as it
 * stands rather than off a clock the test moved: under a real Postgres pool
 * a `TestClock.setTime` jump left every later statement waiting, which
 * PGlite never showed. A member's own GitHub token is saved sealed under a
 * fixture ring the App is stood over where a test hands
 * `GITHUB_APP_WITH_TOKENS`. Synthetic keys, secrets, and tokens throughout.
 */

import { generateKeyPairSync, randomUUID } from "node:crypto";
import { Database } from "@luke/database/core/query";
import { saveGitHubToken } from "@luke/database/models/github-token-store";
import { parseKeyRing, sealGitHubToken } from "@luke/database/models/provider-key-seal";
import { account, user } from "@luke/database/schemas/auth";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { symmetricEncrypt } from "better-auth/crypto";
import { Clock, Effect, Layer, Redacted, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  GITHUB_PROVIDER_ID,
  GITHUB_REPOSITORY_SELECTION,
  GitHubApp,
  type GitHubAppSettings,
} from "../github/github-app.js";
import { linkInstallation } from "../github/github-installations.js";

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

/** The ring members' own tokens are sealed under here: fixed bytes written for the fixtures. */
const GITHUB_FIXTURE_TOKEN_RING = Redacted.make(`1:${Buffer.alloc(32, 7).toString("base64")}`);

/** The App over the fixture settings that opens a member's own token, sealed under the fixture ring. */
export const GITHUB_APP_WITH_TOKENS: Layer.Layer<GitHubApp> = GitHubApp.layer(
  GITHUB_APP_SETTINGS,
  [],
  GITHUB_FIXTURE_TOKEN_RING,
);

/** A member's own classic token as a test saves it, and the GitHub account GitHub said it is. */
export const GITHUB_FIXTURE_MEMBER = {
  TOKEN: "ghp_fixture_member_token",
  LOGIN: "octo-member",
  ID: "4242",
} as const;

/** The token the fake App mints for a repository, which is what a test reads for at the sandbox's firewall. */
export const GITHUB_FIXTURE_INSTALLATION_TOKEN = "ghs_fixture_installation_token";

/** The token the fake App mints for listing one installation's repositories, naming the installation so the listing knows whose it is. */
function listingTokenOf(installationId: number): string {
  return `ghs_fixture_listing_${installationId}`;
}

/** The user access token GitHub's web flow hands the fake for any code but the refused one. */
export const GITHUB_FIXTURE_AUTHORIZED_TOKEN = "ghu_fixture_authorized";

/** A code the fake's token endpoint refuses, as GitHub refuses one spent or expired. */
export const GITHUB_FIXTURE_REFUSED_CODE = "refused-code";

/** One account as GitHub records it, as far as a commit identity reads: the name null where the account set none. */
export interface UserFixture {
  readonly id: number;
  readonly login: string;
  readonly name?: string | null;
}

/** The fixture App's own bot user, under the login GitHub gives an App's bot. */
export const GITHUB_FIXTURE_BOT: UserFixture = {
  id: 90_001,
  login: `${GITHUB_FIXTURE.SLUG}[bot]`,
  name: null,
};

/** Whom GitHub knows, beside the installations: the App's bot, or none under the App's slug. */
export interface GitHubPeople {
  readonly bot?: UserFixture | null;
}

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

/** One installation as a test names it: on whose account, the repositories it reaches for the user, and what it grants the App, by permission name; the fixture's own when unsaid. */
export interface InstallationFixture {
  readonly id: number;
  readonly login: string;
  /** GitHub's id for the account it is on; one derived from the installation's when unsaid. */
  readonly accountId?: number;
  /** The kind of account it is on; a user when unsaid. */
  readonly accountType?: "User" | "Organization";
  readonly repositories: readonly RepositoryFixture[];
  readonly permissions?: Readonly<Record<string, string>>;
  /** Whether it was given every repository of its account or a chosen few; a chosen few when unsaid. */
  readonly repositorySelection?: "all" | "selected";
  /** When its account suspended it, ISO; running when unsaid. */
  readonly suspendedAt?: string;
}

/** What an installation grants the App where a test says nothing: what every installation of the App granted before CI read was added. */
const FIXTURE_INSTALLATION_PERMISSIONS = {
  contents: "write",
  metadata: "read",
  pull_requests: "write",
} as const;

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

/** GitHub's record of a repository as a member's own token reads it, with whether the token may push to it. */
export function memberRepositoryJson(fixture: RepositoryFixture, push: boolean) {
  return { ...repositoryJson(fixture), permissions: { admin: false, push, pull: true } };
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

const INSTALLATION = /^\/app\/installations\/(\d+)$/u;
const INSTALLATION_ACCESS_TOKENS = /^\/app\/installations\/(\d+)\/access_tokens$/u;
const APP_TOKEN = /^\/applications\/[^/]+\/token$/u;
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const USER_BY_LOGIN = /^\/users\/([^/]+)$/u;

/** GitHub's own record of a user, as much of it as the service reads and a little it does not. */
function userJson(fixture: UserFixture) {
  return {
    login: fixture.login,
    id: fixture.id,
    type: fixture.login.endsWith("[bot]") ? "Bot" : "User",
    name: fixture.name ?? null,
    html_url: `https://github.com/${fixture.login}`,
  };
}

/** What a repository answers on its own paths, where a test scripts one, at once or once a step of the test's own is done; nothing hands the request on to not found. */
export type RepositoryScript = (
  sent: SentToGitHub,
) => Response | undefined | Promise<Response | undefined>;

/** GitHub's own record of an installation, as `GET /app/installations/{id}` and `GET /user/installations` answer it. */
function installationJson(installation: InstallationFixture) {
  return {
    id: installation.id,
    account: {
      login: installation.login,
      id: installation.accountId ?? 50_000 + installation.id,
      type: installation.accountType ?? "User",
    },
    repository_selection: installation.repositorySelection ?? GITHUB_REPOSITORY_SELECTION.SELECTED,
    permissions: installation.permissions ?? FIXTURE_INSTALLATION_PERMISSIONS,
    app_id: Number(GITHUB_FIXTURE.APP_ID),
    suspended_at: installation.suspendedAt ?? null,
  };
}

/**
 * A GitHub on which the App is installed as given, each installation's
 * repositories listed on a token minted for the listing and paged the way
 * GitHub pages them; the App mints a token for any of those installations
 * but a suspended one, which GitHub refuses as forbidden;
 * GitHub's web flow exchanges any code but the refused one for a user
 * access token that sees every installation given, and revokes it; the App's
 * bot is the one given, the fixture's own when unsaid; and a repository
 * answers from the script given where a test hands one. Nothing else: any
 * other request fails.
 */
export function githubReaching(
  installations: readonly InstallationFixture[],
  app: Layer.Layer<GitHubApp> = GITHUB_APP_LAYER,
  people: GitHubPeople = {},
  repository: RepositoryScript = () => undefined,
): FakeGitHub {
  const bot = people.bot === undefined ? GITHUB_FIXTURE_BOT : people.bot;
  const notFound = () => Response.json({ message: "Not Found" }, { status: 404 });
  return fakeGitHub(async (sent) => {
    if (sent.url === TOKEN_ENDPOINT) {
      return new URLSearchParams(sent.body).get("code") === GITHUB_FIXTURE_REFUSED_CODE
        ? Response.json({ error: "bad_verification_code" })
        : Response.json({ access_token: GITHUB_FIXTURE_AUTHORIZED_TOKEN, token_type: "bearer" });
    }
    const { pathname } = new URL(sent.url);
    const scripted = await repository(sent);
    if (scripted !== undefined) return scripted;
    if (APP_TOKEN.test(pathname) && sent.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    const byLogin = USER_BY_LOGIN.exec(pathname);
    if (byLogin !== null) {
      return bot !== null && decodeURIComponent(byLogin[1] ?? "") === bot.login
        ? Response.json(userJson(bot))
        : notFound();
    }
    const named = INSTALLATION.exec(pathname);
    if (named !== null) {
      const installation = installations.find((candidate) => String(candidate.id) === named[1]);
      return installation === undefined
        ? notFound()
        : Response.json(installationJson(installation));
    }
    const minting = INSTALLATION_ACCESS_TOKENS.exec(pathname);
    if (minting !== null) {
      const installation = installations.find((candidate) => String(candidate.id) === minting[1]);
      if (installation === undefined) return notFound();
      if (installation.suspendedAt !== undefined) {
        return Response.json({ message: "This installation has been suspended" }, { status: 403 });
      }
      const asked: { repositories?: unknown; permissions?: Record<string, string> } = JSON.parse(
        sent.body,
      );
      // Note that GitHub refuses a mint naming a permission the installation never granted, at any level.
      const granted = installation.permissions ?? FIXTURE_INSTALLATION_PERMISSIONS;
      if (Object.keys(asked.permissions ?? {}).some((permission) => !(permission in granted))) {
        return Response.json(
          { message: "The permissions requested are not granted to this installation." },
          { status: 422 },
        );
      }
      const forRepositories = asked.repositories !== undefined;
      return Response.json(
        {
          token: forRepositories
            ? GITHUB_FIXTURE_INSTALLATION_TOKEN
            : listingTokenOf(installation.id),
          expires_at: "2026-10-01T01:00:00Z",
          repository_selection: GITHUB_REPOSITORY_SELECTION.SELECTED,
        },
        { status: 201 },
      );
    }
    if (pathname === "/user/installations") {
      return Response.json({
        total_count: installations.length,
        installations: sliceOf(installations, sent.url).map(installationJson),
      });
    }
    if (pathname === "/installation/repositories") {
      const bearer = sent.headers.get("authorization");
      const installation = installations.find(
        (candidate) => bearer === `Bearer ${listingTokenOf(candidate.id)}`,
      );
      if (installation === undefined) {
        return Response.json({ message: "Bad credentials" }, { status: 401 });
      }
      return Response.json({
        total_count: installation.repositories.length,
        repository_selection: GITHUB_REPOSITORY_SELECTION.SELECTED,
        repositories: sliceOf(installation.repositories, sent.url).map(repositoryJson),
      });
    }
    return notFound();
  }, app);
}

/** The installation connected to the workspace, as a finished connect links it. */
export const connectWorkspaceGitHub = (organizationId: string, installation: InstallationFixture) =>
  linkInstallation(organizationId, {
    installationId: installation.id,
    accountId: installation.accountId ?? 50_000 + installation.id,
    accountLogin: installation.login,
    accountType: installation.accountType ?? "User",
    suspended: installation.suspendedAt !== undefined,
  });

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
    const db = yield* Database;
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

/**
 * A member signed in with GitHub who saved their own token, the fixture's
 * unless another is given, sealed under the fixture ring. The member's id.
 */
export const openTokenMember = (options: { readonly token?: string } = {}) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const ring = parseKeyRing(GITHUB_FIXTURE_TOKEN_RING);
    if (Result.isFailure(ring)) return yield* Effect.die(ring.failure);
    const token = Redacted.make(options.token ?? GITHUB_FIXTURE_MEMBER.TOKEN);
    const now = yield* Clock.currentTimeMillis;
    yield* saveGitHubToken(
      userId,
      sealGitHubToken(ring.success, userId, token),
      {
        hint: "ghp_…oken",
        githubUserId: GITHUB_FIXTURE_MEMBER.ID,
        githubLogin: GITHUB_FIXTURE_MEMBER.LOGIN,
        expiresAt: null,
      },
      new Date(now),
    );
    return userId;
  });
