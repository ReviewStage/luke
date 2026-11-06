import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import { Database, type DatabaseServices } from "@repo/database/core/query";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
  type GitHubAccountType,
  type GitHubInstallationStatus,
} from "@repo/database/github-installation-vocabulary";
import { InstantColumnSchema } from "@repo/database/models/columns";
import {
  noteGitHubRepository,
  type RepositorySighting,
} from "@repo/database/models/github-repositories";
import { account } from "@repo/database/schemas/auth";
import {
  GITHUB_ACCESS,
  GITHUB_REPOSITORY_SELECTION,
  type GitHubAccess,
  type GitHubRepositorySelection,
} from "@repo/features/github-repositories-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  GITHUB_SSO_URL_PATTERN,
  REPOSITORY_UNREACHED,
  type RepositoryUnreached,
} from "@repo/features/repository-reach-wire";
import { generateRandomString, symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { generateCodeChallenge } from "better-auth/oauth2";
import { and, desc, eq } from "drizzle-orm";
import {
  Cache,
  Clock,
  Config,
  ConfigProvider,
  Context,
  Data,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect";
import * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { SqlClient, SqlSchema } from "effect/sql";
import { AUTH_SECRET_ENVIRONMENT, GITHUB_APP_ENVIRONMENT } from "../auth/auth-deployment.js";
import { type GitHubRepository, text } from "../core.js";
import { HostedEnvironment } from "../environment.js";
import type { StoreFailure } from "../http/store-failure.js";
import {
  installationsOfWorkspace,
  mendInstallationStatus,
  type WorkspaceInstallation,
} from "./github-installations.js";
import {
  GITHUB_TOKEN_ABSENCE,
  type MemberGitHubToken,
  openMemberGitHubToken,
} from "./github-token.js";

const GITHUB_API = "https://api.github.com";
const GITHUB_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const GITHUB_AUTHORIZE_ENDPOINT = "https://github.com/login/oauth/authorize";
const GITHUB_APPS = "https://github.com/apps";
const GITHUB_WEB = "https://github.com";
export const GITHUB_USER_AGENT = `${PRODUCT_NAME.toLowerCase()}-github-app`;
const GITHUB_HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": GITHUB_USER_AGENT,
} as const;

export const GITHUB_PROVIDER_ID = "github";

const APP_JWT = {
  ISSUED_BACK_SECONDS: 60,
  LIFETIME_SECONDS: 8 * 60,
  ALGORITHM: "RS256",
  SIGNATURE: "RSA-SHA256",
} as const;

export const USER_TOKEN_REFRESH_MARGIN_MS = 60_000;

const GRANT_TYPE = { REFRESH_TOKEN: "refresh_token" } as const;

const ACCOUNT_ID_LENGTH = 32;

const GITHUB_APP_SCOPE = "";

const PKCE_METHOD = "S256";

const CI_READ_PERMISSIONS = { checks: "read", statuses: "read", actions: "read" } as const;

const ISSUES_PERMISSION = "issues";

const INSTALLATION_TOKEN_PERMISSIONS = {
  LIST: { metadata: "read" },
  READ: { contents: "read" },
  ISSUES: { issues: "read" },
  PULL_REQUESTS: { contents: "read", pull_requests: "read" },
  PULL_REQUESTS_READING_CI: { contents: "read", pull_requests: "read", ...CI_READ_PERMISSIONS },
  WRITE: { contents: "write", pull_requests: "write" },
  WRITE_READING_CI: { contents: "write", pull_requests: "write", ...CI_READ_PERMISSIONS },
} as const;

type InstallationTokenPermissions =
  (typeof INSTALLATION_TOKEN_PERMISSIONS)[keyof typeof INSTALLATION_TOKEN_PERMISSIONS];

const KEPT = {
  CAPACITY: 1_024,
  REACH_TTL: Duration.minutes(5),
  TOKEN_LIFETIME: Duration.hours(1),
  TOKEN_MARGIN: Duration.minutes(10),
} as const;

const TOKEN_KEEPING = { KEPT: "kept", FRESH: "fresh" } as const;
type TokenKeeping = (typeof TOKEN_KEEPING)[keyof typeof TOKEN_KEEPING];

interface InstallationTokenRequest {
  readonly repositories?: readonly string[];
  readonly permissions: InstallationTokenPermissions;
}

export const GITHUB_HTTP_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  GONE: 410,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
} as const;

const GITHUB_NOREPLY_DOMAIN = "users.noreply.github.com";

const BOT_LOGIN_SUFFIX = "[bot]";

const PAGING = { PER_PAGE: 100, MAX_PAGES: 50 } as const;

const ACCOUNT_TYPES: readonly GitHubAccountType[] = Object.values(GITHUB_ACCOUNT_TYPE);

export interface GitHubAppSettings {
  readonly appId: string;
  readonly slug: string;
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted;
  readonly privateKey: Redacted.Redacted;
  readonly sessionSecret: Redacted.Redacted;
}

interface GitHubInstallation {
  readonly id: number;
  readonly accountLogin: string | undefined;
  readonly accountId: number | undefined;
  readonly accountType: GitHubAccountType | undefined;
  readonly repositorySelection: GitHubRepositorySelection;
  readonly ciReadable: boolean;
  readonly issuesReadable: boolean;
  readonly suspended: boolean;
}

export interface WorkspaceListing {
  readonly repositories: readonly GitHubRepository[];
  readonly installations: readonly {
    readonly installationId: number;
    readonly login?: string;
    readonly repositorySelection: GitHubRepositorySelection;
  }[];
}

export interface GitHubUser {
  readonly id: number;
  readonly login: string;
  readonly name: string | undefined;
}

class GitHubAppNotConfigured extends Data.TaggedError("GitHubAppNotConfigured")<{
  readonly missing: readonly string[];
}> {
  override get message(): string {
    return `The GitHub App is not configured on this deployment: ${this.missing.join(", ")}`;
  }
}

export const GITHUB_FAILURE = {
  TRANSPORT: "transport",
  STATUS: "status",
  UNREADABLE: "unreadable",
  UNBOUNDED: "unbounded",
} as const;
type GitHubFailure = (typeof GITHUB_FAILURE)[keyof typeof GITHUB_FAILURE];

export class GitHubUnavailable extends Data.TaggedError("GitHubUnavailable")<{
  readonly reason: GitHubFailure;
  readonly status: number | undefined;
  readonly retryAfter?: Duration.Duration;
}> {
  override get message(): string {
    return this.status === undefined
      ? `GitHub could not be read: ${this.reason}`
      : `GitHub answered ${this.status}`;
  }
}

const SIGN_IN_REQUIRED = {
  NO_GITHUB_ACCOUNT: "no-github-account",
  BEFORE_THE_APP: "before-the-app",
  REFRESH_REFUSED: "refresh-refused",
  UNREADABLE_TOKEN: "unreadable-token",
} as const;
type SignInRequiredReason = (typeof SIGN_IN_REQUIRED)[keyof typeof SIGN_IN_REQUIRED];

class GitHubSignInRequired extends Data.TaggedError("GitHubSignInRequired")<{
  readonly reason: SignInRequiredReason;
}> {
  override get message(): string {
    return `The account must sign in with GitHub again: ${this.reason}`;
  }
}

export type GitHubReadFailure = GitHubAppNotConfigured | GitHubUnavailable;
export type GitHubWorkspaceReadFailure = GitHubReadFailure | StoreFailure;
export type GitHubUserReadFailure = GitHubReadFailure | GitHubSignInRequired | StoreFailure;

type GitHubRepositoryUnreached = Exclude<
  RepositoryUnreached,
  { readonly reason: typeof REPOSITORY_UNREACHED.OTHER_WORKSPACE }
>;

export interface ReachedRepository {
  readonly repository: GitHubRepository;
  readonly access: GitHubAccess;
}

type GitHubRepositoryReach = Result.Result<ReachedRepository, GitHubRepositoryUnreached>;

type TokenUnreached =
  | typeof REPOSITORY_UNREACHED.NO_TOKEN
  | typeof REPOSITORY_UNREACHED.TOKEN_INVALID
  | typeof REPOSITORY_UNREACHED.TOKEN_NO_ACCESS
  | typeof REPOSITORY_UNREACHED.TOKEN_CANNOT_PUSH;

const GITHUB_SSO_HEADER = "x-github-sso";

function ssoAuthorizeUrl(header: string | undefined): string | undefined {
  const url = header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("url="))
    ?.slice("url=".length);
  return url !== undefined && GITHUB_SSO_URL_PATTERN.test(url) ? url : undefined;
}

interface ReachedThroughApp {
  readonly access: typeof GITHUB_ACCESS.APP;
  readonly installation: GitHubInstallation;
  readonly repository: GitHubRepository;
}

interface ReachedOnToken {
  readonly access: typeof GITHUB_ACCESS.TOKEN;
  readonly member: string;
  readonly repository: GitHubRepository;
}

type ReachResult = Result.Result<ReachedThroughApp | ReachedOnToken, GitHubRepositoryUnreached>;

class ReachKey extends Data.Class<{
  readonly organizationId: string;
  readonly fullName: string;
  readonly member: string | undefined;
}> {}

class TokenKey extends Data.Class<{
  readonly organizationId: string;
  readonly member: string | undefined;
  readonly installationId: number;
  readonly repository: string | undefined;
  readonly permissions: InstallationTokenPermissions;
}> {}

interface KeptToken {
  readonly token: Redacted.Redacted;
  readonly keepFor: Duration.Duration;
}

export type GitHubTokenAccess =
  | { readonly kind: typeof GITHUB_ACCESS.APP }
  | {
      readonly kind: typeof GITHUB_ACCESS.TOKEN;
      readonly githubLogin: string;
      readonly githubUserId: string;
      readonly markInvalid: MemberGitHubToken["markInvalid"];
    };

export interface GitHubRepositoryToken {
  readonly repository: GitHubRepository;
  readonly token: Redacted.Redacted;
  readonly access: GitHubTokenAccess;
}

export const REPOSITORY_SET_UNREACHED = {
  UNREACHED: "unreached",
  TOKEN: "token",
  OTHER_INSTALLATION: "other-installation",
} as const;

export type RepositorySetUnreached =
  | {
      readonly why: typeof REPOSITORY_SET_UNREACHED.UNREACHED;
      readonly unreached: GitHubRepositoryUnreached;
    }
  | {
      readonly why:
        | typeof REPOSITORY_SET_UNREACHED.TOKEN
        | typeof REPOSITORY_SET_UNREACHED.OTHER_INSTALLATION;
      readonly repository: string;
    };

export interface GitHubRepositoriesToken {
  readonly repositories: readonly GitHubRepository[];
  readonly token: Redacted.Redacted;
  readonly access: { readonly kind: typeof GITHUB_ACCESS.APP };
}

type HeldToken = Omit<GitHubRepositoryToken, "repository">;

interface GitHubAuthorizeRequest {
  readonly redirectUri: string;
  readonly state: string;
  readonly codeVerifier: string;
}

export interface GitHubAuthorizeReturn {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

export interface GitHubAppService {
  readonly installUrl: Effect.Effect<string, GitHubAppNotConfigured>;
  readonly botLogin: Effect.Effect<string, GitHubAppNotConfigured>;
  readonly appJwt: Effect.Effect<Redacted.Redacted, GitHubAppNotConfigured>;
  readonly installation: (
    installationId: number,
  ) => Effect.Effect<Option.Option<GitHubInstallation>, GitHubReadFailure, HttpClient.HttpClient>;
  readonly authorizeUrl: (
    request: GitHubAuthorizeRequest,
  ) => Effect.Effect<string, GitHubAppNotConfigured>;
  readonly authorizedInstallations: (
    returned: GitHubAuthorizeReturn,
    installer: Option.Option<string>,
  ) => Effect.Effect<
    Option.Option<readonly GitHubInstallation[]>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  readonly workspaceRepositories: (
    organizationId: string,
  ) => Effect.Effect<
    Option.Option<readonly GitHubRepository[]>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  readonly workspaceListing: (
    organizationId: string,
  ) => Effect.Effect<
    Option.Option<WorkspaceListing>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  readonly memberRepositories: (
    member: string,
  ) => Effect.Effect<
    Option.Option<readonly GitHubRepository[]>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  readonly memberRepositoryReadable: (
    member: string,
    fullName: string,
  ) => Effect.Effect<
    Option.Option<boolean>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  readonly repositoryReach: (
    organizationId: string,
    fullName: string,
    member: string | undefined,
  ) => Effect.Effect<
    GitHubRepositoryReach,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  readonly repositoryReadToken: (
    organizationId: string,
    fullName: string,
    member: string | undefined,
  ) => Effect.Effect<
    Option.Option<GitHubRepositoryToken>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  readonly repositoryPullRequestToken: (
    organizationId: string,
    fullName: string,
    member: string | undefined,
  ) => Effect.Effect<
    Option.Option<GitHubRepositoryToken>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  readonly repositoryIssueToken: (
    organizationId: string,
    fullName: string,
    member: string | undefined,
  ) => Effect.Effect<
    Option.Option<GitHubRepositoryToken>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  readonly repositoryCiReadable: (
    organizationId: string,
    fullName: string,
    member: string | undefined,
  ) => Effect.Effect<boolean, GitHubWorkspaceReadFailure, HttpClient.HttpClient | DatabaseServices>;
  readonly repositoryWriteToken: (
    organizationId: string,
    fullName: string,
    member: string | undefined,
  ) => Effect.Effect<
    Option.Option<GitHubRepositoryToken>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  readonly repositorySetReach: (
    organizationId: string,
    fullNames: readonly string[],
    member: string | undefined,
  ) => Effect.Effect<
    Result.Result<readonly GitHubRepository[], RepositorySetUnreached>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  readonly repositoriesWriteToken: (
    organizationId: string,
    fullNames: readonly string[],
    member: string | undefined,
  ) => Effect.Effect<
    Result.Result<GitHubRepositoriesToken, RepositorySetUnreached>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  readonly appBot: (
    token: Redacted.Redacted,
  ) => Effect.Effect<GitHubUser, GitHubReadFailure, HttpClient.HttpClient>;
  readonly tokenUser: (
    token: Redacted.Redacted,
  ) => Effect.Effect<GitHubUser, GitHubReadFailure, HttpClient.HttpClient>;
  readonly userToken: (
    userId: string,
  ) => Effect.Effect<
    Redacted.Redacted,
    GitHubUserReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  readonly userPusher: (
    userId: string,
    fullName: string,
  ) => Effect.Effect<
    Option.Option<GitHubPusher>,
    GitHubUserReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
}

interface GitHubPusher {
  readonly user: GitHubUser;
  readonly token: Redacted.Redacted;
}

export class GitHubApp extends Context.Service<GitHubApp, GitHubAppService>()("GitHubApp") {
  static layer(
    settings: GitHubAppSettings | undefined,
    missing: readonly string[] = [],
    tokenKeys: Redacted.Redacted | undefined = undefined,
  ): Layer.Layer<GitHubApp> {
    return Layer.effect(GitHubApp, githubAppService(settings, missing, tokenKeys));
  }
}

interface ReadySettings extends GitHubAppSettings {
  readonly signingKey: KeyObject;
}

const InstallationSchema = Schema.Struct({
  id: Schema.Number,
  account: Schema.NullOr(
    Schema.Struct({
      login: Schema.optional(Schema.String),
      id: Schema.optional(Schema.Number),
      type: Schema.optional(Schema.String),
    }),
  ),
  repository_selection: Schema.Literals(Object.values(GITHUB_REPOSITORY_SELECTION)),
  permissions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  suspended_at: Schema.optional(Schema.NullOr(Schema.String)),
});
type InstallationRecord = typeof InstallationSchema.Type;

const UserInstallationsSchema = Schema.Struct({ installations: Schema.Array(InstallationSchema) });

const RepositorySchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  full_name: Schema.String,
  owner: Schema.Struct({ login: Schema.String }),
  private: Schema.Boolean,
  default_branch: Schema.String,
  updated_at: Schema.NullOr(Schema.DateFromString),
});
type RepositoryRecord = typeof RepositorySchema.Type;

const InstallationRepositoriesSchema = Schema.Struct({
  repositories: Schema.Array(RepositorySchema),
});

const RefreshedTokensSchema = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Number,
  refresh_token: Schema.String,
  refresh_token_expires_in: Schema.Number,
});
const TokenRefusalSchema = Schema.Struct({ error: Schema.String });
const RefreshAnswerSchema = Schema.Union([RefreshedTokensSchema, TokenRefusalSchema]);

const ExchangedTokenSchema = Schema.Struct({ access_token: Schema.String });
const ExchangeAnswerSchema = Schema.Union([
  RefreshedTokensSchema,
  ExchangedTokenSchema,
  TokenRefusalSchema,
]);

const InstallationTokenSchema = Schema.Struct({
  token: Schema.String,
  expires_at: Schema.DateFromString,
});

const UserSchema = Schema.Struct({
  id: Schema.Number,
  login: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
});
type UserRecord = typeof UserSchema.Type;

const RepositoryPermissionsSchema = Schema.Struct({
  permissions: Schema.optional(Schema.Struct({ push: Schema.Boolean })),
});

const TokenRepositorySchema = Schema.Struct({
  ...RepositorySchema.fields,
  ...RepositoryPermissionsSchema.fields,
});

const MEMBER_REPOSITORIES_QUERY = {
  affiliation: "owner,collaborator,organization_member",
  sort: "updated",
  per_page: String(PAGING.PER_PAGE),
} as const;

const AccountTokenRowSchema = Schema.Struct({
  id: Schema.String,
  accessToken: Schema.NullOr(Schema.String),
  refreshToken: Schema.NullOr(Schema.String),
  accessTokenExpiresAt: Schema.NullOr(InstantColumnSchema),
  refreshTokenExpiresAt: Schema.NullOr(InstantColumnSchema),
});
type AccountTokenRow = typeof AccountTokenRowSchema.Type;

const lockGithubAccount = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: AccountTokenRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          id: account.id,
          accessToken: account.accessToken,
          refreshToken: account.refreshToken,
          accessTokenExpiresAt: account.accessTokenExpiresAt,
          refreshTokenExpiresAt: account.refreshTokenExpiresAt,
        })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, GITHUB_PROVIDER_ID)))
        .orderBy(desc(account.updatedAt))
        .limit(1)
        .for("update"),
    ),
});

const SealedTokensSchema = Schema.Struct({
  id: Schema.String,
  accessToken: Schema.String,
  refreshToken: Schema.String,
  accessTokenExpiresAt: Schema.Date,
  refreshTokenExpiresAt: Schema.Date,
  updatedAt: Schema.Date,
});

const writeSealedTokens = SqlSchema.void({
  Request: SealedTokensSchema,
  execute: (sealed) =>
    Database.use((db) =>
      db
        .update(account)
        .set({
          accessToken: sealed.accessToken,
          refreshToken: sealed.refreshToken,
          accessTokenExpiresAt: sealed.accessTokenExpiresAt,
          refreshTokenExpiresAt: sealed.refreshTokenExpiresAt,
          updatedAt: sealed.updatedAt,
        })
        .where(eq(account.id, sealed.id)),
    ),
});

const GithubHolderSchema = Schema.Struct({ id: Schema.String, userId: Schema.String });

const lockGithubHolders = SqlSchema.findAll({
  Request: Schema.String,
  Result: GithubHolderSchema,
  execute: (githubUserId) =>
    Database.use((db) =>
      db
        .select({ id: account.id, userId: account.userId })
        .from(account)
        .where(and(eq(account.providerId, GITHUB_PROVIDER_ID), eq(account.accountId, githubUserId)))
        .orderBy(desc(account.updatedAt))
        .for("update"),
    ),
});

const insertGithubAccount = SqlSchema.void({
  Request: Schema.Struct({
    ...SealedTokensSchema.fields,
    userId: Schema.String,
    githubUserId: Schema.String,
  }),
  execute: (row) =>
    Database.use((db) =>
      db.insert(account).values({
        id: row.id,
        accountId: row.githubUserId,
        providerId: GITHUB_PROVIDER_ID,
        userId: row.userId,
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        accessTokenExpiresAt: row.accessTokenExpiresAt,
        refreshTokenExpiresAt: row.refreshTokenExpiresAt,
        scope: GITHUB_APP_SCOPE,
        createdAt: row.updatedAt,
        updatedAt: row.updatedAt,
      }),
    ),
});

const clearGithubTokensOf = SqlSchema.void({
  Request: Schema.Struct({ githubUserId: Schema.String, updatedAt: Schema.Date }),
  execute: ({ githubUserId, updatedAt }) =>
    Database.use((db) =>
      db
        .update(account)
        .set({
          accessToken: null,
          refreshToken: null,
          idToken: null,
          accessTokenExpiresAt: null,
          refreshTokenExpiresAt: null,
          updatedAt,
        })
        .where(
          and(eq(account.providerId, GITHUB_PROVIDER_ID), eq(account.accountId, githubUserId)),
        ),
    ),
});

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signAppJwt(settings: ReadySettings, nowMs: number): string {
  const issuedAt = Math.floor(nowMs / 1000) - APP_JWT.ISSUED_BACK_SECONDS;
  const header = base64url(JSON.stringify({ alg: APP_JWT.ALGORITHM, typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iat: issuedAt,
      exp: issuedAt + APP_JWT.ISSUED_BACK_SECONDS + APP_JWT.LIFETIME_SECONDS,
      iss: settings.appId,
    }),
  );
  const signature = createSign(APP_JWT.SIGNATURE)
    .update(`${header}.${payload}`)
    .end()
    .sign(settings.signingKey, "base64url");
  return `${header}.${payload}.${signature}`;
}

function privateKeyOf(pem: Redacted.Redacted): KeyObject | undefined {
  try {
    return createPrivateKey(Redacted.value(pem).replaceAll("\\n", "\n"));
  } catch {
    return undefined;
  }
}

function installationOf(record: InstallationRecord): GitHubInstallation {
  const granted = record.permissions ?? {};
  return {
    id: record.id,
    accountLogin: record.account?.login,
    accountId: record.account?.id,
    accountType: ACCOUNT_TYPES.find((type) => type === record.account?.type),
    repositorySelection: record.repository_selection,
    ciReadable: Object.keys(CI_READ_PERMISSIONS).every((permission) => permission in granted),
    issuesReadable: ISSUES_PERMISSION in granted,
    suspended: record.suspended_at !== undefined && record.suspended_at !== null,
  };
}

function installationSettingsUrl(installation: GitHubInstallation): string {
  return installation.accountType === GITHUB_ACCOUNT_TYPE.ORGANIZATION &&
    installation.accountLogin !== undefined
    ? `${GITHUB_WEB}/organizations/${installation.accountLogin}/settings/installations/${installation.id}`
    : `${GITHUB_WEB}/settings/installations/${installation.id}`;
}

function userOf(record: UserRecord): GitHubUser {
  return { id: record.id, login: record.login, name: text(record.name ?? undefined) };
}

export function clearRevokedAuthorization(
  githubUserId: number,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    clearGithubTokensOf({ githubUserId: String(githubUserId), updatedAt: new Date(now) }),
  );
}

export function noreplyAddress(user: GitHubUser): string {
  return `${user.id}+${user.login}@${GITHUB_NOREPLY_DOMAIN}`;
}

function repositoryOf(record: RepositoryRecord): GitHubRepository {
  return {
    id: record.id,
    owner: record.owner.login,
    name: record.name,
    fullName: record.full_name,
    defaultBranch: record.default_branch,
    private: record.private,
    updatedAt: record.updated_at?.getTime() ?? 0,
  };
}

function sightingOf(record: RepositoryRecord): RepositorySighting {
  return { id: record.id, fullName: record.full_name, updatedAt: record.updated_at ?? new Date(0) };
}

function byMostRecentlyUpdated(left: GitHubRepository, right: GitHubRepository): number {
  return right.updatedAt - left.updatedAt || left.fullName.localeCompare(right.fullName);
}

function combinedRepositories(repositories: readonly GitHubRepository[]): GitHubRepository[] {
  const seen = new Set<string>();
  return [...repositories].sort(byMostRecentlyUpdated).filter((repository) => {
    const folded = repository.fullName.toLowerCase();
    if (seen.has(folded)) return false;
    seen.add(folded);
    return true;
  });
}

function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function repositoryPath(fullName: string): string {
  const [owner = "", name = ""] = fullName.split("/");
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function retryAfterOf(
  response: HttpClientResponse.HttpClientResponse,
): Duration.Duration | undefined {
  const spelled = Option.getOrUndefined(Headers.get(response.headers, "retry-after"));
  if (spelled === undefined || !/^\d+$/u.test(spelled.trim())) return undefined;
  return Duration.seconds(Number(spelled.trim()));
}

function unavailable(error: HttpClientError.HttpClientError): GitHubUnavailable {
  const response = error.response;
  const retryAfter = response === undefined ? undefined : retryAfterOf(response);
  return new GitHubUnavailable({
    reason: response === undefined ? GITHUB_FAILURE.TRANSPORT : GITHUB_FAILURE.STATUS,
    status: response?.status,
    ...(retryAfter === undefined ? undefined : { retryAfter }),
  });
}

function unreadable(status: number): GitHubUnavailable {
  return new GitHubUnavailable({ reason: GITHUB_FAILURE.UNREADABLE, status });
}

export function githubRead(
  path: string,
  bearer: Redacted.Redacted | null,
): HttpClientRequest.HttpClientRequest {
  const request = HttpClientRequest.get(`${GITHUB_API}${path}`).pipe(
    HttpClientRequest.setHeaders(GITHUB_HEADERS),
  );
  return bearer === null ? request : HttpClientRequest.bearerToken(request, bearer);
}

export function githubPost<Body extends object>(
  path: string,
  bearer: Redacted.Redacted,
  body: Body,
): HttpClientRequest.HttpClientRequest {
  return HttpClientRequest.post(`${GITHUB_API}${path}`).pipe(
    HttpClientRequest.bearerToken(bearer),
    HttpClientRequest.setHeaders(GITHUB_HEADERS),
    HttpClientRequest.bodyJsonUnsafe(body),
  );
}

export function githubSendRequest<Body extends object>(
  method: "POST" | "DELETE",
  path: string,
  bearer: Redacted.Redacted,
  body?: Body,
): HttpClientRequest.HttpClientRequest {
  const request = HttpClientRequest.make(method)(`${GITHUB_API}${path}`).pipe(
    HttpClientRequest.bearerToken(bearer),
    HttpClientRequest.setHeaders(GITHUB_HEADERS),
  );
  return body === undefined ? request : HttpClientRequest.bodyJsonUnsafe(request, body);
}

function githubMintAsApp(
  path: string,
  jwt: Redacted.Redacted,
  body: InstallationTokenRequest,
): HttpClientRequest.HttpClientRequest {
  return HttpClientRequest.post(`${GITHUB_API}${path}`).pipe(
    HttpClientRequest.bearerToken(jwt),
    HttpClientRequest.setHeaders(GITHUB_HEADERS),
    HttpClientRequest.bodyJsonUnsafe(body),
  );
}

export function send(
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<HttpClientResponse.HttpClientResponse, GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.flatMap(HttpClient.HttpClient, (client) =>
    Effect.mapError(client.execute(request), unavailable),
  );
}

type Enough<A> = (items: readonly A[]) => boolean;

const WHOLE_LISTING: Enough<unknown> = () => false;

function readPages<A>(
  path: string,
  token: Redacted.Redacted,
  readPage: (
    response: HttpClientResponse.HttpClientResponse,
  ) => Effect.Effect<readonly A[], GitHubUnavailable>,
  enough: Enough<A> = WHOLE_LISTING,
): Effect.Effect<readonly A[], GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const items: A[] = [];
    for (let page = 1; page <= PAGING.MAX_PAGES; page += 1) {
      const request = githubRead(path, token).pipe(
        HttpClientRequest.setUrlParams({ per_page: String(PAGING.PER_PAGE), page: String(page) }),
      );
      const read = yield* Effect.scoped(Effect.flatMap(send(request), readPage));
      items.push(...read);
      if (read.length < PAGING.PER_PAGE || enough(items)) return items;
    }
    return yield* new GitHubUnavailable({ reason: GITHUB_FAILURE.UNBOUNDED, status: undefined });
  });
}

function installationsOnToken(
  token: Redacted.Redacted,
): Effect.Effect<readonly GitHubInstallation[], GitHubUnavailable, HttpClient.HttpClient> {
  return readPages("/user/installations", token, (response) =>
    Effect.map(readBody(response, UserInstallationsSchema), (answer) =>
      answer.installations.map(installationOf),
    ),
  );
}

function repositoriesOnInstallationToken(
  token: Redacted.Redacted,
  enough: Enough<GitHubRepository> = WHOLE_LISTING,
): Effect.Effect<readonly GitHubRepository[], GitHubUnavailable, HttpClient.HttpClient> {
  return readPages(
    "/installation/repositories",
    token,
    (response) =>
      Effect.map(readBody(response, InstallationRepositoriesSchema), (answer) =>
        answer.repositories.map(repositoryOf),
      ),
    enough,
  );
}

export function readBody<A>(
  response: HttpClientResponse.HttpClientResponse,
  schema: Schema.Codec<A, unknown>,
): Effect.Effect<A, GitHubUnavailable> {
  return HttpClientResponse.filterStatusOk(response).pipe(
    Effect.mapError(unavailable),
    Effect.flatMap((ok) =>
      Effect.mapError(HttpClientResponse.schemaBodyJson(schema)(ok), () =>
        unreadable(response.status),
      ),
    ),
  );
}

export function readText(
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<string, GitHubUnavailable> {
  return HttpClientResponse.filterStatusOk(response).pipe(
    Effect.mapError(unavailable),
    Effect.flatMap((ok) => Effect.mapError(ok.text, () => unreadable(response.status))),
  );
}

export function markRefusedToken(access: GitHubTokenAccess) {
  return <A, E, R>(read: Effect.Effect<A, E, R>): Effect.Effect<A, E, R | DatabaseServices> =>
    access.kind === GITHUB_ACCESS.APP
      ? read
      : Effect.tapError(read, (failure) =>
          failure instanceof GitHubUnavailable && failure.status === GITHUB_HTTP_STATUS.UNAUTHORIZED
            ? Effect.ignore(access.markInvalid)
            : Effect.void,
        );
}

function unseal(
  sealed: string,
  secret: Redacted.Redacted,
): Effect.Effect<Redacted.Redacted, GitHubSignInRequired> {
  return Effect.tryPromise({
    try: () => symmetricDecrypt({ key: Redacted.value(secret), data: sealed }),
    catch: () => new GitHubSignInRequired({ reason: SIGN_IN_REQUIRED.UNREADABLE_TOKEN }),
  }).pipe(Effect.map(Redacted.make));
}

function seal(token: string, secret: Redacted.Redacted): Effect.Effect<string> {
  return Effect.promise(() => symmetricEncrypt({ key: Redacted.value(secret), data: token }));
}

const refreshTokens = /* @__PURE__ */ Effect.fn("web/githubRefreshTokens")(function* (
  settings: ReadySettings,
  refreshToken: Redacted.Redacted,
): Effect.fn.Return<
  typeof RefreshedTokensSchema.Type,
  GitHubUnavailable | GitHubSignInRequired,
  HttpClient.HttpClient
> {
  const request = HttpClientRequest.post(GITHUB_TOKEN_ENDPOINT).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bodyUrlParams({
      client_id: settings.clientId,
      client_secret: Redacted.value(settings.clientSecret),
      grant_type: GRANT_TYPE.REFRESH_TOKEN,
      refresh_token: Redacted.value(refreshToken),
    }),
  );
  const answer = yield* Effect.scoped(
    Effect.flatMap(send(request), (response) => readBody(response, RefreshAnswerSchema)),
  );
  if ("error" in answer) {
    return yield* new GitHubSignInRequired({ reason: SIGN_IN_REQUIRED.REFRESH_REFUSED });
  }
  return answer;
});

const tokenOfRow = /* @__PURE__ */ Effect.fn("web/githubTokenOfRow")(function* (
  settings: ReadySettings,
  row: AccountTokenRow,
): Effect.fn.Return<
  Redacted.Redacted,
  GitHubUnavailable | GitHubSignInRequired | StoreFailure,
  HttpClient.HttpClient | DatabaseServices
> {
  if (row.accessToken === null) {
    return yield* new GitHubSignInRequired({ reason: SIGN_IN_REQUIRED.NO_GITHUB_ACCOUNT });
  }
  if (row.refreshToken === null || row.accessTokenExpiresAt === null) {
    return yield* new GitHubSignInRequired({ reason: SIGN_IN_REQUIRED.BEFORE_THE_APP });
  }
  const now = yield* Clock.currentTimeMillis;
  if (row.accessTokenExpiresAt.getTime() - now > USER_TOKEN_REFRESH_MARGIN_MS) {
    return yield* unseal(row.accessToken, settings.sessionSecret);
  }
  if (row.refreshTokenExpiresAt !== null && row.refreshTokenExpiresAt.getTime() <= now) {
    return yield* new GitHubSignInRequired({ reason: SIGN_IN_REQUIRED.REFRESH_REFUSED });
  }
  const refreshToken = yield* unseal(row.refreshToken, settings.sessionSecret);
  const fresh = yield* refreshTokens(settings, refreshToken);
  const written = yield* Clock.currentTimeMillis;
  yield* writeSealedTokens({
    id: row.id,
    accessToken: yield* seal(fresh.access_token, settings.sessionSecret),
    refreshToken: yield* seal(fresh.refresh_token, settings.sessionSecret),
    accessTokenExpiresAt: new Date(written + fresh.expires_in * 1000),
    refreshTokenExpiresAt: new Date(written + fresh.refresh_token_expires_in * 1000),
    updatedAt: new Date(written),
  });
  return Redacted.make(fresh.access_token);
});

const keepInstallerTokens = /* @__PURE__ */ Effect.fn("web/githubKeepInstallerTokens")(function* (
  settings: ReadySettings,
  userId: string,
  tokens: typeof RefreshedTokensSchema.Type,
): Effect.fn.Return<
  boolean,
  GitHubUnavailable | StoreFailure,
  HttpClient.HttpClient | DatabaseServices
> {
  const githubUser = yield* Effect.scoped(
    Effect.flatMap(send(githubRead("/user", Redacted.make(tokens.access_token))), (response) =>
      readBody(response, UserSchema),
    ),
  );
  const githubUserId = String(githubUser.id);
  const now = yield* Clock.currentTimeMillis;
  const sealed = {
    accessToken: yield* seal(tokens.access_token, settings.sessionSecret),
    refreshToken: yield* seal(tokens.refresh_token, settings.sessionSecret),
    accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000),
    refreshTokenExpiresAt: new Date(now + tokens.refresh_token_expires_in * 1000),
    updatedAt: new Date(now),
  };
  const client = yield* SqlClient.SqlClient;
  return yield* client.withTransaction(
    Effect.gen(function* () {
      const holders = yield* lockGithubHolders(githubUserId);
      if (holders.some((holder) => holder.userId !== userId)) return false;
      const [own] = holders;
      if (own === undefined) {
        const id = generateRandomString(ACCOUNT_ID_LENGTH, "a-z", "A-Z", "0-9");
        yield* insertGithubAccount({ id, userId, githubUserId, ...sealed });
      } else {
        yield* writeSealedTokens({ id: own.id, ...sealed });
      }
      return true;
    }),
  );
});

function githubAppService(
  settings: GitHubAppSettings | undefined,
  missing: readonly string[],
  tokenKeys: Redacted.Redacted | undefined,
): Effect.Effect<GitHubAppService> {
  const signingKey = settings === undefined ? undefined : privateKeyOf(settings.privateKey);
  const ready: Effect.Effect<ReadySettings, GitHubAppNotConfigured> =
    settings === undefined || signingKey === undefined
      ? Effect.fail(
          new GitHubAppNotConfigured({
            missing:
              signingKey === undefined && settings !== undefined
                ? [GITHUB_APP_ENVIRONMENT.PRIVATE_KEY]
                : missing,
          }),
        )
      : Effect.succeed({ ...settings, signingKey });

  const appJwt = Effect.gen(function* () {
    const app = yield* ready;
    const now = yield* Clock.currentTimeMillis;
    return Redacted.make(signAppJwt(app, now));
  });

  const memberToken = (member: string) => openMemberGitHubToken(tokenKeys, member);

  const userToken = (userId: string) =>
    Effect.gen(function* () {
      const app = yield* ready;
      const client = yield* SqlClient.SqlClient;
      return yield* client.withTransaction(
        Effect.gen(function* () {
          const row = yield* lockGithubAccount(userId);
          if (Option.isNone(row)) {
            return yield* new GitHubSignInRequired({ reason: SIGN_IN_REQUIRED.NO_GITHUB_ACCOUNT });
          }
          return yield* tokenOfRow(app, row.value);
        }),
      );
    });

  const installation = (installationId: number) =>
    Effect.gen(function* () {
      const jwt = yield* appJwt;
      const response = yield* send(githubRead(`/app/installations/${installationId}`, jwt));
      if (response.status === GITHUB_HTTP_STATUS.NOT_FOUND) return Option.none();
      const record = yield* readBody(response, InstallationSchema);
      return Option.some(installationOf(record));
    }).pipe(Effect.scoped);

  const mint = (installationId: number, request: InstallationTokenRequest) =>
    Effect.gen(function* () {
      const jwt = yield* appJwt;
      const minted = yield* Effect.scoped(
        Effect.flatMap(
          send(githubMintAsApp(`/app/installations/${installationId}/access_tokens`, jwt, request)),
          (response) => readBody(response, InstallationTokenSchema),
        ),
      );
      return { token: Redacted.make(minted.token), expiresAt: minted.expires_at.getTime() };
    });

  const connectedInstallation = (connected: WorkspaceInstallation) =>
    Effect.gen(function* () {
      const reached = yield* installation(connected.installationId);
      const status: GitHubInstallationStatus = Option.match(reached, {
        onNone: () => GITHUB_INSTALLATION_STATUS.DELETED,
        onSome: (on) =>
          on.suspended ? GITHUB_INSTALLATION_STATUS.SUSPENDED : GITHUB_INSTALLATION_STATUS.ACTIVE,
      });
      if (status !== connected.status) yield* mendInstallationStatus(connected, status);
      return reached;
    });

  const liveWorkspaceInstallations = (organizationId: string) =>
    Effect.gen(function* () {
      const connected = yield* installationsOfWorkspace(organizationId);
      const read = yield* Effect.forEach(connected, connectedInstallation);
      return read.flatMap((one) => (Option.isSome(one) && !one.value.suspended ? [one.value] : []));
    });

  const installationOnOwner = (connected: readonly WorkspaceInstallation[], owner: string) =>
    Effect.gen(function* () {
      const named = connected.filter((one) => sameName(one.accountLogin, owner));
      const others = connected.filter((one) => !sameName(one.accountLogin, owner));
      const running: GitHubInstallation[] = [];
      let lapsedOnOwner = false;
      for (const one of [...named, ...others]) {
        const read = yield* connectedInstallation(one);
        if (Option.isNone(read) || read.value.suspended) {
          lapsedOnOwner ||= sameName(one.accountLogin, owner);
          continue;
        }
        const login = read.value.accountLogin;
        if (login !== undefined && sameName(login, owner)) {
          return { onOwner: Option.some(read.value), running, lapsedOnOwner };
        }
        running.push(read.value);
      }
      return { onOwner: Option.none<GitHubInstallation>(), running, lapsedOnOwner };
    });

  const repositoriesOf = (
    reached: GitHubInstallation,
    enough: Enough<GitHubRepository> = WHOLE_LISTING,
  ) =>
    Effect.flatMap(
      mint(reached.id, { permissions: INSTALLATION_TOKEN_PERMISSIONS.LIST }),
      (minted) => repositoriesOnInstallationToken(minted.token, enough),
    );

  const workspaceListing = (organizationId: string) =>
    Effect.gen(function* () {
      const live = yield* liveWorkspaceInstallations(organizationId);
      if (live.length === 0) return Option.none<WorkspaceListing>();
      const listed = yield* Effect.forEach(live, (one) => repositoriesOf(one));
      return Option.some<WorkspaceListing>({
        repositories: combinedRepositories(listed.flat()),
        installations: live.map((one) => ({
          installationId: one.id,
          ...(one.accountLogin === undefined ? {} : { login: one.accountLogin }),
          repositorySelection: one.repositorySelection,
        })),
      });
    });

  const movedOnInstallation = (reached: GitHubInstallation, fullName: string) =>
    Effect.gen(function* () {
      const minted = yield* mint(reached.id, { permissions: INSTALLATION_TOKEN_PERMISSIONS.LIST });
      const response = yield* send(githubRead(repositoryPath(fullName), minted.token));
      if (
        response.status === GITHUB_HTTP_STATUS.NOT_FOUND ||
        response.status === GITHUB_HTTP_STATUS.FORBIDDEN
      ) {
        return Option.none<GitHubRepository>();
      }
      const record = yield* readBody(response, RepositorySchema);
      if (record.full_name === fullName) return Option.none<GitHubRepository>();
      yield* noteGitHubRepository({ ...sightingOf(record), formerly: fullName });
      return Option.some(repositoryOf(record));
    }).pipe(Effect.scoped);

  const reachMoved = (installations: readonly GitHubInstallation[], fullName: string) =>
    Effect.gen(function* () {
      for (const installation of installations) {
        const moved = yield* movedOnInstallation(installation, fullName);
        if (Option.isSome(moved)) {
          const reachedMoved: ReachResult = Result.succeed({
            access: GITHUB_ACCESS.APP,
            installation,
            repository: moved.value,
          });
          return Option.some(reachedMoved);
        }
      }
      return Option.none<ReachResult>();
    });

  const installationReach = (organizationId: string, fullName: string) =>
    Effect.gen(function* () {
      const [owner = ""] = fullName.split("/");
      const unreached = (failure: GitHubRepositoryUnreached): ReachResult => Result.fail(failure);
      const connected = yield* installationsOfWorkspace(organizationId);
      if (connected.length === 0) {
        return unreached({ reason: REPOSITORY_UNREACHED.NOT_CONNECTED, repository: fullName });
      }
      const found = yield* installationOnOwner(connected, owner);
      if (Option.isNone(found.onOwner)) {
        if (found.lapsedOnOwner || found.running.length === 0) {
          return unreached({
            reason: REPOSITORY_UNREACHED.CONNECTION_LAPSED,
            repository: fullName,
          });
        }
        const transferred = yield* reachMoved(found.running, fullName);
        if (Option.isSome(transferred)) return transferred.value;
        const [only] = found.running;
        const connectedTo = found.running.length === 1 ? only?.accountLogin : undefined;
        return unreached({
          reason: REPOSITORY_UNREACHED.OTHER_OWNER,
          repository: fullName,
          ...(connectedTo === undefined ? undefined : { connectedTo }),
        });
      }
      const onOwner = found.onOwner.value;
      const isNamed = (repository: GitHubRepository) => sameName(repository.fullName, fullName);
      const repositories = yield* repositoriesOf(onOwner, (read) => read.some(isNamed));
      const repository = repositories.find(isNamed);
      if (repository !== undefined) {
        if (repository.id !== undefined) {
          yield* noteGitHubRepository({
            id: repository.id,
            fullName: repository.fullName,
            updatedAt: new Date(repository.updatedAt),
          });
        }
        const reachedThrough: ReachResult = Result.succeed({
          access: GITHUB_ACCESS.APP,
          installation: onOwner,
          repository,
        });
        return reachedThrough;
      }
      const renamed = yield* reachMoved([onOwner], fullName);
      if (Option.isSome(renamed)) return renamed.value;
      const others = (yield* liveWorkspaceInstallations(organizationId)).filter(
        (one) => one.id !== onOwner.id,
      );
      const transferred = yield* reachMoved(others, fullName);
      if (Option.isSome(transferred)) return transferred.value;
      return unreached(
        onOwner.repositorySelection === GITHUB_REPOSITORY_SELECTION.SELECTED
          ? {
              reason: REPOSITORY_UNREACHED.NOT_SELECTED,
              repository: fullName,
              settingsUrl: installationSettingsUrl(onOwner),
            }
          : { reason: REPOSITORY_UNREACHED.GONE, repository: fullName },
      );
    });

  const tokenReach = (member: string, fullName: string, throughApp: ReachResult) =>
    Effect.gen(function* () {
      const unreached = (reason: TokenUnreached): ReachResult =>
        Result.fail({ reason, repository: fullName });
      const held = yield* memberToken(member);
      if (Result.isFailure(held)) {
        if (held.failure === GITHUB_TOKEN_ABSENCE.NONE) return throughApp;
        return unreached(
          held.failure === GITHUB_TOKEN_ABSENCE.INVALID
            ? REPOSITORY_UNREACHED.TOKEN_INVALID
            : REPOSITORY_UNREACHED.NO_TOKEN,
        );
      }
      const response = yield* send(githubRead(repositoryPath(fullName), held.success.token));
      if (response.status === GITHUB_HTTP_STATUS.UNAUTHORIZED) {
        yield* held.success.markInvalid;
        return unreached(REPOSITORY_UNREACHED.TOKEN_INVALID);
      }
      if (response.status === GITHUB_HTTP_STATUS.FORBIDDEN) {
        const authorizeUrl = ssoAuthorizeUrl(response.headers[GITHUB_SSO_HEADER]);
        if (authorizeUrl !== undefined) {
          const unauthorized: ReachResult = Result.fail({
            reason: REPOSITORY_UNREACHED.TOKEN_SSO,
            repository: fullName,
            authorizeUrl,
          });
          return unauthorized;
        }
      }
      if (
        response.status === GITHUB_HTTP_STATUS.NOT_FOUND ||
        response.status === GITHUB_HTTP_STATUS.FORBIDDEN
      ) {
        return unreached(REPOSITORY_UNREACHED.TOKEN_NO_ACCESS);
      }
      const record = yield* readBody(response, TokenRepositorySchema);
      yield* noteGitHubRepository({
        ...sightingOf(record),
        formerly: record.full_name === fullName ? undefined : fullName,
      });
      if (record.permissions?.push !== true)
        return unreached(REPOSITORY_UNREACHED.TOKEN_CANNOT_PUSH);
      const reachedOn: ReachResult = Result.succeed({
        access: GITHUB_ACCESS.TOKEN,
        member,
        repository: repositoryOf(record),
      });
      return reachedOn;
    }).pipe(Effect.scoped);

  const reach = (organizationId: string, fullName: string, member: string | undefined) =>
    Effect.gen(function* () {
      const throughApp = yield* installationReach(organizationId, fullName);
      if (Result.isSuccess(throughApp) || member === undefined) return throughApp;
      return yield* tokenReach(member, fullName, throughApp);
    });

  const reachableRepository = (
    organizationId: string,
    fullName: string,
    member: string | undefined,
  ) => Effect.map(reach(organizationId, fullName, member), Result.getSuccess);

  const repositoryTokenOf = (key: TokenKey) =>
    Effect.gen(function* () {
      const minted = yield* mint(key.installationId, {
        ...(key.repository === undefined ? undefined : { repositories: [key.repository] }),
        permissions: key.permissions,
      });
      const now = yield* Clock.currentTimeMillis;
      const lasts = Math.min(minted.expiresAt - now, Duration.toMillis(KEPT.TOKEN_LIFETIME));
      const keepFor = Duration.millis(Math.max(lasts - Duration.toMillis(KEPT.TOKEN_MARGIN), 0));
      const kept: KeptToken = { token: minted.token, keepFor };
      return kept;
    });

  const exchangeCode = (app: ReadySettings, returned: GitHubAuthorizeReturn) =>
    Effect.gen(function* () {
      const request = HttpClientRequest.post(GITHUB_TOKEN_ENDPOINT).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyUrlParams({
          client_id: app.clientId,
          client_secret: Redacted.value(app.clientSecret),
          code: returned.code,
          redirect_uri: returned.redirectUri,
          code_verifier: returned.codeVerifier,
        }),
      );
      const answer = yield* Effect.scoped(
        Effect.flatMap(send(request), (response) => readBody(response, ExchangeAnswerSchema)),
      );
      return "error" in answer ? Option.none() : Option.some(answer);
    });

  const revokeToken = (app: ReadySettings, token: Redacted.Redacted) =>
    Effect.scoped(
      Effect.flatMap(
        send(
          HttpClientRequest.delete(`${GITHUB_API}/applications/${app.clientId}/token`).pipe(
            HttpClientRequest.basicAuth(app.clientId, Redacted.value(app.clientSecret)),
            HttpClientRequest.setHeaders(GITHUB_HEADERS),
            HttpClientRequest.bodyJsonUnsafe({ access_token: Redacted.value(token) }),
          ),
        ),
        (response) => Effect.mapError(HttpClientResponse.filterStatusOk(response), unavailable),
      ),
    );

  return Effect.gen(function* () {
    const reaches = yield* Cache.makeWith(
      (key: ReachKey) => reach(key.organizationId, key.fullName, key.member),
      {
        capacity: KEPT.CAPACITY,
        requireServicesAt: "lookup",
        timeToLive: (exit) =>
          Exit.isSuccess(exit) && Result.isSuccess(exit.value) ? KEPT.REACH_TTL : Duration.zero,
      },
    );
    const tokens = yield* Cache.makeWith(repositoryTokenOf, {
      capacity: KEPT.CAPACITY,
      requireServicesAt: "lookup",
      timeToLive: (exit) => (Exit.isSuccess(exit) ? exit.value.keepFor : Duration.zero),
    });

    const standingReach = (key: ReachKey) =>
      Effect.gen(function* () {
        const kept = yield* Cache.get(reaches, key);
        if (Result.isFailure(kept)) return kept;
        const linked = yield* installationsOfWorkspace(key.organizationId);
        const running = linked.filter((one) => one.status === GITHUB_INSTALLATION_STATUS.ACTIVE);
        const [owner = ""] = key.fullName.split("/");
        const reached = kept.success;
        const stands =
          reached.access === GITHUB_ACCESS.TOKEN
            ? !running.some((one) => sameName(one.accountLogin, owner))
            : running.some((one) => one.installationId === reached.installation.id);
        if (stands) return kept;
        yield* Cache.invalidate(reaches, key);
        return yield* Cache.get(reaches, key);
      });

    const memberReadToken = (member: string) =>
      Effect.map(memberToken(member), (held) =>
        Result.isFailure(held)
          ? Option.none<HeldToken>()
          : Option.some<HeldToken>({
              token: held.success.token,
              access: {
                kind: GITHUB_ACCESS.TOKEN,
                githubLogin: held.success.githubLogin,
                githubUserId: held.success.githubUserId,
                markInvalid: held.success.markInvalid,
              },
            }),
      );

    const memberRepositoryToken = (reached: ReachedOnToken) =>
      Effect.map(
        memberReadToken(reached.member),
        Option.map((held): GitHubRepositoryToken => ({ repository: reached.repository, ...held })),
      );

    const repositoryToken = (
      organizationId: string,
      fullName: string,
      member: string | undefined,
      permissionsOn: (installation: GitHubInstallation) => InstallationTokenPermissions | undefined,
      keeping: TokenKeeping = TOKEN_KEEPING.KEPT,
    ) =>
      Effect.gen(function* () {
        const reached = yield* standingReach(new ReachKey({ organizationId, fullName, member }));
        if (Result.isFailure(reached)) return Option.none<GitHubRepositoryToken>();
        if (reached.success.access === GITHUB_ACCESS.TOKEN) {
          return yield* memberRepositoryToken(reached.success);
        }
        const { installation: on, repository } = reached.success;
        const permissions = permissionsOn(on);
        if (permissions === undefined) return Option.none<GitHubRepositoryToken>();
        const key = new TokenKey({
          organizationId,
          member,
          installationId: on.id,
          repository: repository.name,
          permissions,
        });
        const { token } =
          keeping === TOKEN_KEEPING.KEPT
            ? yield* Cache.get(tokens, key)
            : yield* repositoryTokenOf(key);
        return Option.some<GitHubRepositoryToken>({
          repository,
          token,
          access: { kind: GITHUB_ACCESS.APP },
        });
      });

    const setReach = <R>(
      fullNames: readonly string[],
      reachOf: (fullName: string) => Effect.Effect<ReachResult, GitHubWorkspaceReadFailure, R>,
    ) =>
      Effect.gen(function* () {
        type SetReach = Result.Result<readonly ReachedThroughApp[], RepositorySetUnreached>;
        const reached: ReachedThroughApp[] = [];
        for (const fullName of fullNames) {
          const one = yield* reachOf(fullName);
          if (Result.isFailure(one)) {
            const unreached: SetReach = Result.fail({
              why: REPOSITORY_SET_UNREACHED.UNREACHED,
              unreached: one.failure,
            });
            return unreached;
          }
          const onApp = one.success;
          const [first] = reached;
          if (onApp.access === GITHUB_ACCESS.TOKEN) {
            const onToken: SetReach = Result.fail({
              why: REPOSITORY_SET_UNREACHED.TOKEN,
              repository: fullName,
            });
            return onToken;
          }
          if (first !== undefined && first.installation.id !== onApp.installation.id) {
            const elsewhere: SetReach = Result.fail({
              why: REPOSITORY_SET_UNREACHED.OTHER_INSTALLATION,
              repository: fullName,
            });
            return elsewhere;
          }
          reached.push(onApp);
        }
        const together: SetReach = Result.succeed(reached);
        return together;
      });

    const service: GitHubAppService = {
      installUrl: Effect.map(ready, (app) => `${GITHUB_APPS}/${app.slug}/installations/new`),
      botLogin: Effect.map(ready, (app) => `${app.slug}${BOT_LOGIN_SUFFIX}`),
      appJwt,
      installation,
      authorizeUrl: (request) =>
        Effect.gen(function* () {
          const app = yield* ready;
          const challenge = yield* Effect.promise(() =>
            generateCodeChallenge(request.codeVerifier),
          );
          const url = new URL(GITHUB_AUTHORIZE_ENDPOINT);
          url.searchParams.set("client_id", app.clientId);
          url.searchParams.set("redirect_uri", request.redirectUri);
          url.searchParams.set("state", request.state);
          url.searchParams.set("code_challenge", challenge);
          url.searchParams.set("code_challenge_method", PKCE_METHOD);
          return url.toString();
        }),
      authorizedInstallations: (returned, installer) =>
        Effect.gen(function* () {
          const app = yield* ready;
          const exchanged = yield* exchangeCode(app, returned);
          if (Option.isNone(exchanged)) return Option.none();
          const tokens = exchanged.value;
          const token = Redacted.make(tokens.access_token);
          const installations = yield* installationsOnToken(token);
          const kept =
            Option.isSome(installer) && "refresh_token" in tokens
              ? yield* keepInstallerTokens(app, installer.value, tokens)
              : false;
          if (!kept) yield* revokeToken(app, token);
          return Option.some(installations);
        }),
      workspaceRepositories: (organizationId) =>
        Effect.map(
          workspaceListing(organizationId),
          Option.map((listing) => listing.repositories),
        ),
      workspaceListing,
      memberRepositories: (member) =>
        Effect.gen(function* () {
          const held = yield* memberToken(member);
          if (Result.isFailure(held)) return Option.none();
          const response = yield* send(
            githubRead("/user/repos", held.success.token).pipe(
              HttpClientRequest.setUrlParams(MEMBER_REPOSITORIES_QUERY),
            ),
          );
          if (response.status === GITHUB_HTTP_STATUS.UNAUTHORIZED) {
            yield* held.success.markInvalid;
            return Option.none();
          }
          const listed = yield* readBody(response, Schema.Array(TokenRepositorySchema));
          const pushed = listed.filter((one) => one.permissions?.push === true);
          return Option.some(pushed.map(repositoryOf));
        }).pipe(Effect.scoped),
      memberRepositoryReadable: (member, fullName) =>
        Effect.gen(function* () {
          const held = yield* memberToken(member);
          if (Result.isFailure(held)) return Option.none<boolean>();
          const response = yield* send(githubRead(repositoryPath(fullName), held.success.token));
          if (response.status === GITHUB_HTTP_STATUS.UNAUTHORIZED) {
            yield* held.success.markInvalid;
            return Option.none<boolean>();
          }
          if (response.status >= 200 && response.status < 300) return Option.some(true);
          const refused =
            response.status === GITHUB_HTTP_STATUS.FORBIDDEN ||
            response.status === GITHUB_HTTP_STATUS.NOT_FOUND;
          return refused ? Option.some(false) : Option.none<boolean>();
        }).pipe(Effect.scoped),
      repositoryReach: (organizationId, fullName, member) =>
        Effect.map(
          reach(organizationId, fullName, member),
          Result.map((reached) => ({ repository: reached.repository, access: reached.access })),
        ),
      repositoryReadToken: (organizationId, fullName, member) =>
        repositoryToken(
          organizationId,
          fullName,
          member,
          () => INSTALLATION_TOKEN_PERMISSIONS.READ,
        ),
      repositoryPullRequestToken: (organizationId, fullName, member) =>
        repositoryToken(organizationId, fullName, member, (on) =>
          on.ciReadable
            ? INSTALLATION_TOKEN_PERMISSIONS.PULL_REQUESTS_READING_CI
            : INSTALLATION_TOKEN_PERMISSIONS.PULL_REQUESTS,
        ),
      repositoryIssueToken: (organizationId, fullName, member) =>
        repositoryToken(organizationId, fullName, member, (on) =>
          on.issuesReadable ? INSTALLATION_TOKEN_PERMISSIONS.ISSUES : undefined,
        ),
      repositoryCiReadable: (organizationId, fullName, member) =>
        Effect.map(reachableRepository(organizationId, fullName, member), (reached) =>
          Option.match(reached, {
            onNone: () => false,
            onSome: (on) => on.access === GITHUB_ACCESS.TOKEN || on.installation.ciReadable,
          }),
        ),
      repositoryWriteToken: (organizationId, fullName, member) =>
        repositoryToken(
          organizationId,
          fullName,
          member,
          (on) =>
            on.ciReadable
              ? INSTALLATION_TOKEN_PERMISSIONS.WRITE_READING_CI
              : INSTALLATION_TOKEN_PERMISSIONS.WRITE,
          TOKEN_KEEPING.FRESH,
        ),
      repositorySetReach: (organizationId, fullNames, member) =>
        Effect.map(
          setReach(fullNames, (fullName) => reach(organizationId, fullName, member)),
          Result.map((reached) => reached.map((one) => one.repository)),
        ),
      repositoriesWriteToken: (organizationId, fullNames, member) =>
        Effect.gen(function* () {
          const reached = yield* setReach(fullNames, (fullName) =>
            standingReach(new ReachKey({ organizationId, fullName, member })),
          );
          if (Result.isFailure(reached)) return Result.fail(reached.failure);
          const [first] = reached.success;
          if (first === undefined) return yield* Effect.die("a set of repositories names none");
          const on = first.installation;
          const minted = yield* mint(on.id, {
            repositories: reached.success.map((one) => one.repository.name),
            permissions: on.ciReadable
              ? INSTALLATION_TOKEN_PERMISSIONS.WRITE_READING_CI
              : INSTALLATION_TOKEN_PERMISSIONS.WRITE,
          });
          const token: GitHubRepositoriesToken = {
            repositories: reached.success.map((one) => one.repository),
            token: minted.token,
            access: { kind: GITHUB_ACCESS.APP },
          };
          return Result.succeed(token);
        }),
      userPusher: (userId, fullName) =>
        Effect.gen(function* () {
          const token = yield* userToken(userId);
          const account = yield* Effect.scoped(
            Effect.flatMap(send(githubRead("/user", token)), (response) =>
              readBody(response, UserSchema),
            ),
          );
          const repository = yield* Effect.scoped(
            Effect.flatMap(send(githubRead(repositoryPath(fullName), token)), (response) =>
              response.status === GITHUB_HTTP_STATUS.NOT_FOUND
                ? Effect.succeed(Option.none())
                : Effect.map(readBody(response, RepositoryPermissionsSchema), Option.some),
            ),
          );
          const pushes = Option.isSome(repository) && repository.value.permissions?.push === true;
          return pushes ? Option.some({ user: userOf(account), token }) : Option.none();
        }),
      appBot: (token) =>
        Effect.gen(function* () {
          const app = yield* ready;
          const response = yield* send(githubRead(`/users/${app.slug}${BOT_LOGIN_SUFFIX}`, token));
          return userOf(yield* readBody(response, UserSchema));
        }).pipe(Effect.scoped),
      tokenUser: (token) =>
        Effect.gen(function* () {
          const response = yield* send(githubRead("/user", token));
          return userOf(yield* readBody(response, UserSchema));
        }).pipe(Effect.scoped),
      userToken,
    };
    return service;
  });
}

function present(value: Option.Option<string>): string | undefined {
  return text(Option.getOrUndefined(value));
}

function presentRedacted(value: Option.Option<Redacted.Redacted>): Redacted.Redacted | undefined {
  const named = text(Option.getOrUndefined(Option.map(value, Redacted.value)));
  return named === undefined ? undefined : Redacted.make(named);
}

export const githubAppFromEnvironment: Layer.Layer<
  GitHubApp,
  Config.ConfigError,
  HostedEnvironment
> = Layer.effect(
  GitHubApp,
  Effect.flatMap(
    Config.all({
      appId: Config.option(Config.String(GITHUB_APP_ENVIRONMENT.APP_ID)),
      slug: Config.option(Config.String(GITHUB_APP_ENVIRONMENT.SLUG)),
      clientId: Config.option(Config.String(GITHUB_APP_ENVIRONMENT.CLIENT_ID)),
      clientSecret: Config.option(Config.Redacted(GITHUB_APP_ENVIRONMENT.CLIENT_SECRET)),
      privateKey: Config.option(Config.Redacted(GITHUB_APP_ENVIRONMENT.PRIVATE_KEY)),
      sessionSecret: Config.option(Config.Redacted(AUTH_SECRET_ENVIRONMENT.SESSION_SECRET)),
    }),
    (read) => {
      const values = {
        appId: present(read.appId),
        slug: present(read.slug),
        clientId: present(read.clientId),
        clientSecret: presentRedacted(read.clientSecret),
        privateKey: presentRedacted(read.privateKey),
        sessionSecret: presentRedacted(read.sessionSecret),
      };
      const missing = [
        [GITHUB_APP_ENVIRONMENT.APP_ID, values.appId],
        [GITHUB_APP_ENVIRONMENT.SLUG, values.slug],
        [GITHUB_APP_ENVIRONMENT.CLIENT_ID, values.clientId],
        [GITHUB_APP_ENVIRONMENT.CLIENT_SECRET, values.clientSecret],
        [GITHUB_APP_ENVIRONMENT.PRIVATE_KEY, values.privateKey],
        [AUTH_SECRET_ENVIRONMENT.SESSION_SECRET, values.sessionSecret],
      ]
        .filter(([, value]) => value === undefined)
        .map(([name]) => String(name));
      const settings =
        values.appId !== undefined &&
        values.slug !== undefined &&
        values.clientId !== undefined &&
        values.clientSecret !== undefined &&
        values.privateKey !== undefined &&
        values.sessionSecret !== undefined
          ? {
              appId: values.appId,
              slug: values.slug,
              clientId: values.clientId,
              clientSecret: values.clientSecret,
              privateKey: values.privateKey,
              sessionSecret: values.sessionSecret,
            }
          : undefined;
      return Effect.flatMap(HostedEnvironment, (environment) =>
        githubAppService(settings, missing, environment.providerKeyEncryptionKeys),
      );
    },
  ).pipe(
    Effect.provideServiceEffect(
      ConfigProvider.ConfigProvider,
      Effect.sync(() => ConfigProvider.fromEnv()),
    ),
  ),
);
