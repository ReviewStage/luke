import { generateKeyPairSync, randomUUID } from "node:crypto";
import { Database } from "@repo/database/core/query";
import { saveGitHubToken } from "@repo/database/models/github-token-store";
import { parseKeyRing, sealGitHubToken } from "@repo/database/models/provider-key-seal";
import { account, user } from "@repo/database/schemas/auth";
import { GITHUB_REPOSITORY_SELECTION } from "@repo/features/github-repositories-wire";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { symmetricEncrypt } from "better-auth/crypto";
import { Clock, Effect, Layer, Redacted, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { GITHUB_PROVIDER_ID, GitHubApp, type GitHubAppSettings } from "../github/github-app.js";
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

export const GITHUB_APP_PUBLIC_KEY = publicKey;

export const GITHUB_APP_SETTINGS: GitHubAppSettings = {
  appId: GITHUB_FIXTURE.APP_ID,
  slug: GITHUB_FIXTURE.SLUG,
  clientId: GITHUB_FIXTURE.CLIENT_ID,
  clientSecret: Redacted.make(GITHUB_FIXTURE.CLIENT_SECRET),
  privateKey: Redacted.make(privateKey.export({ type: "pkcs1", format: "pem" }).toString()),
  sessionSecret: Redacted.make(GITHUB_FIXTURE.SESSION_SECRET),
};

export interface SentToGitHub {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string;
  readonly signal?: AbortSignal;
}

export interface FakeGitHub {
  readonly layer: Layer.Layer<GitHubApp | HttpClient.HttpClient>;
  readonly sent: SentToGitHub[];
  readonly respond: (url: string, init: RequestInit) => Promise<Response>;
}

const GITHUB_APP_LAYER: Layer.Layer<GitHubApp> = GitHubApp.layer(GITHUB_APP_SETTINGS);

export const GITHUB_FIXTURE_TOKEN_RING = Redacted.make(
  `1:${Buffer.alloc(32, 7).toString("base64")}`,
);

export const GITHUB_APP_WITH_TOKENS: Layer.Layer<GitHubApp> = GitHubApp.layer(
  GITHUB_APP_SETTINGS,
  [],
  GITHUB_FIXTURE_TOKEN_RING,
);

export const GITHUB_FIXTURE_MEMBER = {
  TOKEN: "ghp_fixture_member_token",
  LOGIN: "octo-member",
  ID: "4242",
} as const;

export const GITHUB_FIXTURE_INSTALLATION_TOKEN = "ghs_fixture_installation_token";

export function listingTokenOf(installationId: number): string {
  return `ghs_fixture_listing_${installationId}`;
}

export const GITHUB_FIXTURE_AUTHORIZED_TOKEN = "ghu_fixture_authorized";

export const GITHUB_FIXTURE_REFUSED_CODE = "refused-code";

export interface UserFixture {
  readonly id: number;
  readonly login: string;
  readonly name?: string | null;
}

export const GITHUB_FIXTURE_BOT: UserFixture = {
  id: 90_001,
  login: `${GITHUB_FIXTURE.SLUG}[bot]`,
  name: null,
};

export interface GitHubPeople {
  readonly bot?: UserFixture | null;
}

export const NO_GITHUB: Layer.Layer<GitHubApp | HttpClient.HttpClient> = Layer.suspend(
  () =>
    fakeGitHub(() => {
      throw new Error("this test reaches no GitHub");
    }).layer,
);

export function fakeGitHub(
  answer: (sent: SentToGitHub) => Response | Promise<Response>,
  app: Layer.Layer<GitHubApp> = GITHUB_APP_LAYER,
): FakeGitHub {
  const sent: SentToGitHub[] = [];
  const respond = async (url: string, init: RequestInit) => {
    const request: SentToGitHub = {
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: init.body === undefined ? "" : await new Response(init.body).text(),
      ...(init.signal ? { signal: init.signal } : {}),
    };
    sent.push(request);
    return answer(request);
  };
  return { layer: Layer.mergeAll(fakeHttpClientLayer(respond), app), sent, respond };
}

export interface RepositoryFixture {
  readonly owner: string;
  readonly name: string;
  readonly updatedAt?: string;
  readonly private?: boolean;
  readonly defaultBranch?: string;
}

export interface InstallationFixture {
  readonly id: number;
  readonly login: string;
  readonly accountId?: number;
  readonly accountType?: "User" | "Organization";
  readonly repositories: readonly RepositoryFixture[];
  readonly permissions?: Readonly<Record<string, string>>;
  readonly repositorySelection?: "all" | "selected";
  readonly suspendedAt?: string;
}

const FIXTURE_INSTALLATION_PERMISSIONS = {
  contents: "write",
  metadata: "read",
  pull_requests: "write",
} as const;

export function repositoryIdOf(fixture: RepositoryFixture): number {
  let hash = 2_166_136_261;
  for (const char of `${fixture.owner}/${fixture.name}`.toLowerCase()) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16_777_619) >>> 0;
  }
  return 1_000 + (hash % 1_000_000_000);
}

function repositoryJson(fixture: RepositoryFixture) {
  return {
    id: repositoryIdOf(fixture),
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

export function memberRepositoryJson(fixture: RepositoryFixture, push: boolean) {
  return { ...repositoryJson(fixture), permissions: { admin: false, push, pull: true } };
}

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

function userJson(fixture: UserFixture) {
  return {
    login: fixture.login,
    id: fixture.id,
    type: fixture.login.endsWith("[bot]") ? "Bot" : "User",
    name: fixture.name ?? null,
    html_url: `https://github.com/${fixture.login}`,
  };
}

export type RepositoryScript = (
  sent: SentToGitHub,
) => Response | undefined | Promise<Response | undefined>;

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
      const asked = new URLSearchParams(sent.body);
      if (!asked.has("code")) return new Response(null, { status: 503 });
      return asked.get("code") === GITHUB_FIXTURE_REFUSED_CODE
        ? Response.json({ error: "bad_verification_code" })
        : Response.json({
            access_token: GITHUB_FIXTURE_AUTHORIZED_TOKEN,
            expires_in: 8 * 60 * 60,
            refresh_token: "ghr_fixture_authorized",
            refresh_token_expires_in: 184 * 24 * 60 * 60,
            token_type: "bearer",
            scope: "",
          });
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
    if (
      pathname === "/user" &&
      sent.headers.get("authorization") === `Bearer ${GITHUB_FIXTURE_AUTHORIZED_TOKEN}`
    ) {
      return Response.json(
        userJson({ id: Number(GITHUB_FIXTURE_MEMBER.ID), login: GITHUB_FIXTURE_MEMBER.LOGIN }),
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

export const connectWorkspaceGitHub = (organizationId: string, installation: InstallationFixture) =>
  linkInstallation(organizationId, {
    installationId: installation.id,
    accountId: installation.accountId ?? 50_000 + installation.id,
    accountLogin: installation.login,
    accountType: installation.accountType ?? "User",
    suspended: installation.suspendedAt !== undefined,
  });

const sealed = (token: string): Effect.Effect<string> =>
  Effect.promise(() => symmetricEncrypt({ key: GITHUB_FIXTURE.SESSION_SECRET, data: token }));

export interface GitHubAccountRow {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly accessTokenExpiresAt: Date | null;
  readonly refreshTokenExpiresAt: Date | null;
}

export const standingGithubRow = (now: number): GitHubAccountRow => ({
  accessToken: "ghu_standing",
  refreshToken: "ghr_standing",
  accessTokenExpiresAt: new Date(now + 7 * GITHUB_FIXTURE.HOUR_MS),
  refreshTokenExpiresAt: new Date(now + 170 * 24 * GITHUB_FIXTURE.HOUR_MS),
});

export const openGithubUser = (standing?: GitHubAccountRow) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
    yield* signInWithGitHub(userId, standing);
    return userId;
  });

export const signInWithGitHub = (userId: string, standing?: GitHubAccountRow) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const now = yield* Clock.currentTimeMillis;
    const row = standing ?? standingGithubRow(now);
    yield* db.insert(account).values({
      id: `account-${randomUUID()}`,
      accountId: GITHUB_FIXTURE_MEMBER.ID,
      providerId: GITHUB_PROVIDER_ID,
      userId,
      accessToken: yield* sealed(row.accessToken),
      refreshToken: row.refreshToken === null ? null : yield* sealed(row.refreshToken),
      accessTokenExpiresAt: row.accessTokenExpiresAt,
      refreshTokenExpiresAt: row.refreshTokenExpiresAt,
      scope: "",
      updatedAt: new Date(now - GITHUB_FIXTURE.HOUR_MS),
    });
  });

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
