/**
 * github-app.ts -- the Luke GitHub App as the server speaks for it: its own JWT, its installations, and a signed-in user's token.
 *
 * Signing in with GitHub is a user's authorization of the App, so the token
 * Better Auth leaves on the `account` row is a GitHub App user token: it
 * reaches only the repositories where the App is installed and the user has
 * access, and it expires in hours, with a refresh token that lasts months.
 * This is the one place either token is read back. The App itself speaks
 * with a JWT signed by its private key, which is how an installation GitHub
 * hands the Setup URL is confirmed as this App's own. What the user token
 * reads is the user's installations and the repositories each reaches,
 * which is both the list the desktop offers and the check a plan's
 * repository passes before it is kept: a repository is reachable only
 * through an installation, and a public repository the token could read
 * without one is deliberately not. The tokens the App mints are
 * installation tokens for one repository: with contents read alone for the
 * planning sandbox's checkout, and with contents and pull requests write for
 * a coding agent's branch and pull request; each is minted only where that
 * check passes. The user token also reads the user's own record and the
 * App's bot's, which is what a coding agent's commits are attributed under.
 *
 * Nothing here holds a client: the GitHub reads run on the ambient
 * `HttpClient` and the account row is read on the ambient `SqlClient`, so a
 * test stands a fake at the GitHub boundary and a throwaway database beneath
 * it, and the edge serving a request is the one place either is provided. A
 * token leaves only as a `Redacted`, and a failure carries a status or a
 * kind and never the request that carried the bearer.
 */

import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  Clock,
  Config,
  ConfigProvider,
  Context,
  Data,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import { AUTH_SECRET_ENVIRONMENT, GITHUB_APP_ENVIRONMENT } from "../auth-deployment.js";
import { type GitHubRepository, text } from "../core.js";
import { account } from "../db/auth-schema.js";
import { db } from "../db/query.js";
import { InstantColumnSchema } from "../hosted/store/database.js";
import type { StoreFailure } from "../hosted/store-failure.js";

const GITHUB_API = "https://api.github.com";
const GITHUB_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const GITHUB_APPS = "https://github.com/apps";
const GITHUB_HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "luke-github-app",
} as const;

/** Better Auth's id for the GitHub social provider, which is the `provider_id` of the account row. */
export const GITHUB_PROVIDER_ID = "github";

/**
 * The App JWT's window. GitHub refuses an `iat` in the future and an `exp`
 * more than ten minutes out, so the issue instant is set a minute back for
 * clock drift and the expiry well inside the cap.
 */
const APP_JWT = {
  ISSUED_BACK_SECONDS: 60,
  LIFETIME_SECONDS: 8 * 60,
  ALGORITHM: "RS256",
  SIGNATURE: "RSA-SHA256",
} as const;

/**
 * How close to its expiry a stored user token is refreshed rather than
 * handed out: a token good for less than this is refreshed first, so the
 * request it is handed to does not watch it expire mid-flight.
 */
const USER_TOKEN_REFRESH_MARGIN_MS = 60_000;

const GRANT_TYPE = { REFRESH_TOKEN: "refresh_token" } as const;

/**
 * What the App asks of an installation token, by what the token is for:
 * contents read alone, which is what a checkout needs, or contents and pull
 * requests write, which is what a coding agent's push and pull request need.
 */
const INSTALLATION_TOKEN_PERMISSIONS = {
  READ: { contents: "read" },
  WRITE: { contents: "write", pull_requests: "write" },
} as const;

type InstallationTokenPermissions =
  (typeof INSTALLATION_TOKEN_PERMISSIONS)[keyof typeof INSTALLATION_TOKEN_PERMISSIONS];

/** The mint as GitHub takes it: the repositories by name, and the permissions the token is cut to. */
interface InstallationTokenRequest {
  readonly repositories: readonly string[];
  readonly permissions: InstallationTokenPermissions;
}

/** The statuses the reads here decide on by name; any other is answered as the status it is. */
export const GITHUB_HTTP_STATUS = { UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404 } as const;

/** The domain of the address GitHub links to an account while keeping the account's own private. */
const GITHUB_NOREPLY_DOMAIN = "users.noreply.github.com";

/** The suffix GitHub gives the login of an App's own bot user. */
const BOT_LOGIN_SUFFIX = "[bot]";

/**
 * GitHub pages a listing at most a hundred to a page. A listing is read page
 * by page until one comes back short, or until the caller has what it came
 * for, and never past this many pages: a GitHub still answering full pages
 * at the bound is a listing that did not end, and is answered as unreadable
 * rather than as the part of it that was read, so a repository past the
 * bound is never refused as one the user cannot reach.
 */
const PAGING = { PER_PAGE: 100, MAX_PAGES: 50 } as const;

export interface GitHubAppSettings {
  /** The App's numeric id, which is the JWT's issuer. */
  readonly appId: string;
  /** The App's URL slug: `https://github.com/apps/<slug>`. */
  readonly slug: string;
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted;
  /** The App's private key, PEM. */
  readonly privateKey: Redacted.Redacted;
  /** The secret Better Auth sealed the account row's tokens under: `BETTER_AUTH_SECRET`. */
  readonly sessionSecret: Redacted.Redacted;
}

/** One installation of the App, as much of it as Luke reads. */
interface GitHubInstallation {
  readonly id: number;
  /** The user or organization the App is installed on; absent for an enterprise install, which has no login. */
  readonly accountLogin: string | undefined;
  readonly repositorySelection: GitHubRepositorySelection;
}

/** One GitHub account as a commit names it: its id and login, which together make its noreply address, and the name it set, if any. */
export interface GitHubUser {
  readonly id: number;
  readonly login: string;
  /** The display name the account set; absent where it set none. */
  readonly name: string | undefined;
}

export const GITHUB_REPOSITORY_SELECTION = {
  ALL: "all",
  SELECTED: "selected",
} as const;
type GitHubRepositorySelection =
  (typeof GITHUB_REPOSITORY_SELECTION)[keyof typeof GITHUB_REPOSITORY_SELECTION];

/** The deployment holds no App, or not all of it: every read answers this and the routes answer unavailable. */
class GitHubAppNotConfigured extends Data.TaggedError("GitHubAppNotConfigured")<{
  /** The variables that were missing or unreadable, by name alone. */
  readonly missing: readonly string[];
}> {
  override get message(): string {
    return `The GitHub App is not configured on this deployment: ${this.missing.join(", ")}`;
  }
}

/** Why GitHub's answer could not be used; the status or the kind alone, never the request that carried a bearer. */
export const GITHUB_FAILURE = {
  /** The request never got an answer. */
  TRANSPORT: "transport",
  /** GitHub answered with a status the read did not expect. */
  STATUS: "status",
  /** GitHub answered, but not in the shape the read declares. */
  UNREADABLE: "unreadable",
  /** GitHub was still answering full pages of a listing at the bound, so the listing did not end. */
  UNBOUNDED: "unbounded",
} as const;
type GitHubFailure = (typeof GITHUB_FAILURE)[keyof typeof GITHUB_FAILURE];

export class GitHubUnavailable extends Data.TaggedError("GitHubUnavailable")<{
  readonly reason: GitHubFailure;
  readonly status: number | undefined;
}> {
  override get message(): string {
    return this.status === undefined
      ? `GitHub could not be read: ${this.reason}`
      : `GitHub answered ${this.status}`;
  }
}

/** Why a user token could not be had, every case of which the user mends by signing in with GitHub again. */
export const SIGN_IN_REQUIRED = {
  /** The user has no GitHub account row: they signed in with Google alone. */
  NO_GITHUB_ACCOUNT: "no-github-account",
  /** The row holds the OAuth App's token from before the GitHub App, which reaches no installation and cannot be refreshed. */
  BEFORE_THE_APP: "before-the-app",
  /** The refresh token has expired, or GitHub refused it. */
  REFRESH_REFUSED: "refresh-refused",
  /** The sealed token would not open under this deployment's secret. */
  UNREADABLE_TOKEN: "unreadable-token",
  /** GitHub refused a token that had not reached its expiry: the user revoked the App's authorization. */
  TOKEN_REVOKED: "token-revoked",
} as const;
type SignInRequiredReason = (typeof SIGN_IN_REQUIRED)[keyof typeof SIGN_IN_REQUIRED];

export class GitHubSignInRequired extends Data.TaggedError("GitHubSignInRequired")<{
  readonly reason: SignInRequiredReason;
}> {
  override get message(): string {
    return `The account must sign in with GitHub again: ${this.reason}`;
  }
}

/** What a read of GitHub can fail with, apart from the account row. */
export type GitHubReadFailure = GitHubAppNotConfigured | GitHubUnavailable;
/** What a read on the user's own token can fail with. */
export type GitHubUserReadFailure = GitHubReadFailure | GitHubSignInRequired | StoreFailure;

/** What the App reaches for a user, read on the user's own token. */
interface GitHubUserRepositories {
  /** Whether the user reaches any installation of the App at all; false is "Install Luke on GitHub". */
  readonly installed: boolean;
  /** Every repository those installations reach for the user, most recently updated first. */
  readonly repositories: readonly GitHubRepository[];
}

/** A token the App minted for one repository: the repository as GitHub spells it, and the token, sealed. */
interface GitHubRepositoryToken {
  readonly repository: GitHubRepository;
  /** An installation token limited to this one repository, good for an hour from its mint. */
  readonly token: Redacted.Redacted;
}

export interface GitHubAppService {
  /** Where a user installs the App, or changes which repositories it sees; GitHub returns them to the App's Setup URL. */
  readonly installUrl: Effect.Effect<string, GitHubAppNotConfigured>;
  /** A JWT the App speaks as itself with, good for a few minutes from now. */
  readonly appJwt: Effect.Effect<Redacted.Redacted, GitHubAppNotConfigured>;
  /** One installation of this App by the id GitHub hands the Setup URL; none for an id that is not this App's. */
  readonly installation: (
    installationId: number,
  ) => Effect.Effect<Option.Option<GitHubInstallation>, GitHubReadFailure, HttpClient.HttpClient>;
  /** The installations the signed-in user can reach, read on the user's own token. */
  readonly userInstallations: (
    userId: string,
  ) => Effect.Effect<
    readonly GitHubInstallation[],
    GitHubUserReadFailure,
    HttpClient.HttpClient | SqlClient.SqlClient
  >;
  /** The repositories the signed-in user reaches through the App, read on the user's own token: every installation they reach, each paged through. */
  readonly userRepositories: (
    userId: string,
  ) => Effect.Effect<
    GitHubUserRepositories,
    GitHubUserReadFailure,
    HttpClient.HttpClient | SqlClient.SqlClient
  >;
  /**
   * One repository by `owner/name`, where the user reaches it through the
   * App, spelled as GitHub spells it; none where they do not, which is also
   * what an App installed nowhere answers. Only the installation on the
   * owner can reach it, so only that one is read, and only as far as the
   * repository.
   */
  readonly userRepository: (
    userId: string,
    fullName: string,
  ) => Effect.Effect<
    Option.Option<GitHubRepository>,
    GitHubUserReadFailure,
    HttpClient.HttpClient | SqlClient.SqlClient
  >;
  /**
   * A token for one repository the user reaches through the App, minted by
   * the App itself for that installation (`POST
   * /app/installations/{id}/access_tokens`), limited to the one repository
   * and to contents read; none where the user does not reach it, on the same
   * terms as `userRepository`. The user's own reach is what admits the mint,
   * and the token is the App's, so what the checkout reads is bounded by
   * both.
   */
  readonly repositoryReadToken: (
    userId: string,
    fullName: string,
  ) => Effect.Effect<
    Option.Option<GitHubRepositoryToken>,
    GitHubUserReadFailure,
    HttpClient.HttpClient | SqlClient.SqlClient
  >;
  /**
   * The same mint with contents and pull requests write, which is what a
   * coding agent's push to its branch and its pull request need, on the same
   * terms: the user's own reach admits it, and the token reaches that one
   * repository and no other.
   */
  readonly repositoryWriteToken: (
    userId: string,
    fullName: string,
  ) => Effect.Effect<
    Option.Option<GitHubRepositoryToken>,
    GitHubUserReadFailure,
    HttpClient.HttpClient | SqlClient.SqlClient
  >;
  /**
   * The signed-in user as GitHub records them, read on their own token
   * (`GET /user`): what a commit of theirs is authored as.
   */
  readonly signedInUser: (
    userId: string,
  ) => Effect.Effect<
    GitHubUser,
    GitHubUserReadFailure,
    HttpClient.HttpClient | SqlClient.SqlClient
  >;
  /**
   * The App's own bot user, the account GitHub attributes the App's actions
   * to, read on the signed-in user's token (`GET /users/<slug>[bot]`) since
   * the App's JWT reaches no user endpoint; none where GitHub knows no bot
   * by the App's slug, which is a deployment whose slug is mis-set.
   */
  readonly appBot: (
    userId: string,
  ) => Effect.Effect<
    Option.Option<GitHubUser>,
    GitHubUserReadFailure,
    HttpClient.HttpClient | SqlClient.SqlClient
  >;
  /**
   * The user's GitHub App token, refreshed and re-sealed on its row when it
   * is about to expire. The read and the refresh run under a lock on the
   * row, because GitHub retires a refresh token the moment it is used: two
   * requests refreshing at once would leave the second holding a token
   * GitHub no longer knows.
   */
  readonly userToken: (
    userId: string,
  ) => Effect.Effect<
    Redacted.Redacted,
    GitHubUserReadFailure,
    HttpClient.HttpClient | SqlClient.SqlClient
  >;
}

export class GitHubApp extends Context.Service<GitHubApp, GitHubAppService>()("GitHubApp") {
  /** The service over fixed settings, or over none, which is a deployment without the App. */
  static layer(
    settings: GitHubAppSettings | undefined,
    missing: readonly string[] = [],
  ): Layer.Layer<GitHubApp> {
    return Layer.succeed(GitHubApp, githubAppService(settings, missing));
  }
}

/** The settings with the private key parsed once; a key that will not parse is the App unconfigured. */
interface ReadySettings extends GitHubAppSettings {
  readonly signingKey: KeyObject;
}

const InstallationSchema = Schema.Struct({
  id: Schema.Number,
  account: Schema.NullOr(Schema.Struct({ login: Schema.optional(Schema.String) })),
  repository_selection: Schema.Literals(Object.values(GITHUB_REPOSITORY_SELECTION)),
});
type InstallationRecord = typeof InstallationSchema.Type;

const UserInstallationsSchema = Schema.Struct({ installations: Schema.Array(InstallationSchema) });

const RepositorySchema = Schema.Struct({
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

/** GitHub's refresh answer, which arrives with status 200 whether it is tokens or a refusal. */
const RefreshedTokensSchema = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Number,
  refresh_token: Schema.String,
  refresh_token_expires_in: Schema.Number,
});
const TokenRefusalSchema = Schema.Struct({ error: Schema.String });
const RefreshAnswerSchema = Schema.Union([RefreshedTokensSchema, TokenRefusalSchema]);

/** GitHub's answer to a token mint, read for the token alone. */
const InstallationTokenSchema = Schema.Struct({ token: Schema.String });

/** A user as GitHub records one, read as far as a commit identity goes; the name is null where the account set none. */
const UserSchema = Schema.Struct({
  id: Schema.Number,
  login: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
});
type UserRecord = typeof UserSchema.Type;

const AccountTokenRowSchema = Schema.Struct({
  id: Schema.String,
  accessToken: Schema.NullOr(Schema.String),
  refreshToken: Schema.NullOr(Schema.String),
  accessTokenExpiresAt: Schema.NullOr(InstantColumnSchema),
  refreshTokenExpiresAt: Schema.NullOr(InstantColumnSchema),
});
type AccountTokenRow = typeof AccountTokenRowSchema.Type;

/** The user's GitHub row, locked for the transaction around it; the newest where a user somehow has two. */
const lockGithubAccount = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: AccountTokenRowSchema,
  execute: (userId) =>
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
});

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** The App's JWT at one instant: RS256 over the issuer and the window above, which is all GitHub reads of it. */
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

/** A PEM as the environment holds it, with the newlines a dashboard paste may have flattened to `\n` restored. */
function privateKeyOf(pem: Redacted.Redacted): KeyObject | undefined {
  try {
    return createPrivateKey(Redacted.value(pem).replaceAll("\\n", "\n"));
  } catch {
    return undefined;
  }
}

function installationOf(record: InstallationRecord): GitHubInstallation {
  return {
    id: record.id,
    accountLogin: record.account?.login,
    repositorySelection: record.repository_selection,
  };
}

/** A blank name is one the account never set. */
function userOf(record: UserRecord): GitHubUser {
  return { id: record.id, login: record.login, name: text(record.name ?? undefined) };
}

/**
 * The address GitHub links to the account while keeping the account's own
 * private: `<id>+<login>@users.noreply.github.com`, which is what a commit
 * by the account is attributed through.
 */
export function noreplyAddress(user: GitHubUser): string {
  return `${user.id}+${user.login}@${GITHUB_NOREPLY_DOMAIN}`;
}

/** A repository GitHub never dated reads as older than any it did. */
function repositoryOf(record: RepositoryRecord): GitHubRepository {
  return {
    owner: record.owner.login,
    name: record.name,
    fullName: record.full_name,
    defaultBranch: record.default_branch,
    private: record.private,
    updatedAt: record.updated_at?.getTime() ?? 0,
  };
}

/** Most recently updated first, and by name among those updated at once, so two reads of one GitHub answer in one order. */
function byMostRecentlyUpdated(left: GitHubRepository, right: GitHubRepository): number {
  return right.updatedAt - left.updatedAt || left.fullName.localeCompare(right.fullName);
}

/** GitHub folds case in logins and repository names, so a name is the same name however it is spelled. */
export function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** A transport failure as the kind alone: the request it carries holds the bearer, and is left behind. */
function unavailable(error: HttpClientError.HttpClientError): GitHubUnavailable {
  const status = error.response?.status;
  return new GitHubUnavailable({
    reason: status === undefined ? GITHUB_FAILURE.TRANSPORT : GITHUB_FAILURE.STATUS,
    status,
  });
}

function unreadable(status: number): GitHubUnavailable {
  return new GitHubUnavailable({ reason: GITHUB_FAILURE.UNREADABLE, status });
}

/** One read of the API under the bearer given, the path rooted at the API's origin. */
export function githubRead(
  path: string,
  bearer: Redacted.Redacted,
): HttpClientRequest.HttpClientRequest {
  return HttpClientRequest.get(`${GITHUB_API}${path}`).pipe(
    HttpClientRequest.bearerToken(bearer),
    HttpClientRequest.setHeaders(GITHUB_HEADERS),
  );
}

/** The one write the App makes as itself: a token mint, its JSON body under the App's own JWT. */
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

/** One request sent, its answer still open for the caller to read and close. */
function send(
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<HttpClientResponse.HttpClientResponse, GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.flatMap(HttpClient.HttpClient, (client) =>
    Effect.mapError(client.execute(request), unavailable),
  );
}

/**
 * A read on the user's token sent, its answer still open for the caller to
 * read and close. A 401 here is not an outage: the token has not reached its
 * stored expiry, so GitHub refusing it means the user revoked the App's
 * authorization, which a new sign-in mends.
 */
export function sendAsUser(
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  GitHubUnavailable | GitHubSignInRequired,
  HttpClient.HttpClient
> {
  return Effect.flatMap(send(request), (response) =>
    response.status === GITHUB_HTTP_STATUS.UNAUTHORIZED
      ? Effect.fail(new GitHubSignInRequired({ reason: SIGN_IN_REQUIRED.TOKEN_REVOKED }))
      : Effect.succeed(response),
  );
}

/** Whether a listing read so far holds what the caller came for, so no further page is asked. */
type Enough<A> = (items: readonly A[]) => boolean;

const WHOLE_LISTING: Enough<unknown> = () => false;

/**
 * A paged listing on the user's token, read a hundred at a time until a
 * page comes back short or the items read are enough, and never past
 * `PAGING.MAX_PAGES`, where a listing still going is unbounded. Each page's
 * answer is read and closed before the next is asked for.
 */
function readPages<A>(
  path: string,
  token: Redacted.Redacted,
  readPage: (
    response: HttpClientResponse.HttpClientResponse,
  ) => Effect.Effect<readonly A[], GitHubUnavailable | GitHubSignInRequired>,
  enough: Enough<A> = WHOLE_LISTING,
): Effect.Effect<readonly A[], GitHubUnavailable | GitHubSignInRequired, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const items: A[] = [];
    for (let page = 1; page <= PAGING.MAX_PAGES; page += 1) {
      const request = githubRead(path, token).pipe(
        HttpClientRequest.setUrlParams({ per_page: String(PAGING.PER_PAGE), page: String(page) }),
      );
      const read = yield* Effect.scoped(Effect.flatMap(sendAsUser(request), readPage));
      items.push(...read);
      if (read.length < PAGING.PER_PAGE || enough(items)) return items;
    }
    return yield* new GitHubUnavailable({ reason: GITHUB_FAILURE.UNBOUNDED, status: undefined });
  });
}

/** The installations the token reaches, every page of them. */
function installationsOnToken(
  token: Redacted.Redacted,
): Effect.Effect<
  readonly GitHubInstallation[],
  GitHubUnavailable | GitHubSignInRequired,
  HttpClient.HttpClient
> {
  return readPages("/user/installations", token, (response) =>
    Effect.map(readBody(response, UserInstallationsSchema), (answer) =>
      answer.installations.map(installationOf),
    ),
  );
}

/**
 * The repositories one installation reaches for the token's user, every page
 * of them or as many as are enough. An installation GitHub no longer knows,
 * uninstalled between the listing that named it and this read, reaches
 * nothing rather than failing the whole.
 */
function repositoriesOfInstallation(
  token: Redacted.Redacted,
  installationId: number,
  enough: Enough<GitHubRepository> = WHOLE_LISTING,
): Effect.Effect<
  readonly GitHubRepository[],
  GitHubUnavailable | GitHubSignInRequired,
  HttpClient.HttpClient
> {
  return readPages(
    `/user/installations/${installationId}/repositories`,
    token,
    (response) =>
      response.status === GITHUB_HTTP_STATUS.NOT_FOUND
        ? Effect.succeed([])
        : Effect.map(readBody(response, InstallationRepositoriesSchema), (answer) =>
            answer.repositories.map(repositoryOf),
          ),
    enough,
  );
}

/** An OK answer's body under its schema; any other status is the status, and a body off the schema is unreadable. */
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

/** A token or a refresh token opened from the row, or the sign-in the row's state calls for. */
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

/**
 * GitHub's token endpoint asked for a fresh pair. The answer is 200 either
 * way, so a refusal is read out of the body: a retired or expired refresh
 * token is the user's to mend by signing in again, not an outage.
 */
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

/**
 * The row's token, or a refreshed one written back in its place. Runs inside
 * the caller's transaction, on the locked row.
 */
const tokenOfRow = /* @__PURE__ */ Effect.fn("web/githubTokenOfRow")(function* (
  settings: ReadySettings,
  row: AccountTokenRow,
): Effect.fn.Return<
  Redacted.Redacted,
  GitHubUnavailable | GitHubSignInRequired | StoreFailure,
  HttpClient.HttpClient | SqlClient.SqlClient
> {
  // A row without a refresh token is the OAuth App's from before the GitHub
  // App: its token reaches no installation, and only a new sign-in replaces it.
  if (row.accessToken === null || row.refreshToken === null || row.accessTokenExpiresAt === null) {
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

function githubAppService(
  settings: GitHubAppSettings | undefined,
  missing: readonly string[],
): GitHubAppService {
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

  /**
   * The repository and the installation it is reached through, where the
   * user reaches it: only the installation on the owner can, so only that
   * one is read, and only as far as the page the repository is on.
   */
  const reachableRepository = (userId: string, fullName: string) =>
    Effect.gen(function* () {
      const [owner] = fullName.split("/");
      const token = yield* userToken(userId);
      const installations = yield* installationsOnToken(token);
      const onOwner = installations.find(
        (installation) =>
          installation.accountLogin !== undefined &&
          sameName(installation.accountLogin, owner ?? ""),
      );
      if (onOwner === undefined) return Option.none();
      const isNamed = (repository: GitHubRepository) => sameName(repository.fullName, fullName);
      const repositories = yield* repositoriesOfInstallation(token, onOwner.id, (read) =>
        read.some(isNamed),
      );
      return Option.map(Option.fromNullishOr(repositories.find(isNamed)), (repository) => ({
        installation: onOwner,
        repository,
      }));
    });

  /** A token minted as the App for the one repository the user reaches, cut to the permissions given; none where they do not reach it. */
  const repositoryToken = (
    userId: string,
    fullName: string,
    permissions: InstallationTokenPermissions,
  ) =>
    Effect.gen(function* () {
      const reached = yield* reachableRepository(userId, fullName);
      if (Option.isNone(reached)) return Option.none();
      const { installation, repository } = reached.value;
      const jwt = yield* appJwt;
      const minted = yield* Effect.scoped(
        Effect.flatMap(
          send(
            githubMintAsApp(`/app/installations/${installation.id}/access_tokens`, jwt, {
              repositories: [repository.name],
              permissions,
            }),
          ),
          (response) => readBody(response, InstallationTokenSchema),
        ),
      );
      return Option.some({ repository, token: Redacted.make(minted.token) });
    });

  return {
    installUrl: Effect.map(ready, (app) => `${GITHUB_APPS}/${app.slug}/installations/new`),
    appJwt,
    installation: (installationId) =>
      Effect.gen(function* () {
        const jwt = yield* appJwt;
        const response = yield* send(githubRead(`/app/installations/${installationId}`, jwt));
        if (response.status === GITHUB_HTTP_STATUS.NOT_FOUND) return Option.none();
        const record = yield* readBody(response, InstallationSchema);
        return Option.some(installationOf(record));
      }).pipe(Effect.scoped),
    userInstallations: (userId) => Effect.flatMap(userToken(userId), installationsOnToken),
    userRepositories: (userId) =>
      Effect.gen(function* () {
        const token = yield* userToken(userId);
        const installations = yield* installationsOnToken(token);
        const repositories: GitHubRepository[] = [];
        for (const installation of installations) {
          repositories.push(...(yield* repositoriesOfInstallation(token, installation.id)));
        }
        return {
          installed: installations.length > 0,
          repositories: repositories.sort(byMostRecentlyUpdated),
        };
      }),
    userRepository: (userId, fullName) =>
      Effect.map(
        reachableRepository(userId, fullName),
        Option.map((reached) => reached.repository),
      ),
    repositoryReadToken: (userId, fullName) =>
      repositoryToken(userId, fullName, INSTALLATION_TOKEN_PERMISSIONS.READ),
    repositoryWriteToken: (userId, fullName) =>
      repositoryToken(userId, fullName, INSTALLATION_TOKEN_PERMISSIONS.WRITE),
    signedInUser: (userId) =>
      Effect.gen(function* () {
        const token = yield* userToken(userId);
        const response = yield* sendAsUser(githubRead("/user", token));
        return userOf(yield* readBody(response, UserSchema));
      }).pipe(Effect.scoped),
    appBot: (userId) =>
      Effect.gen(function* () {
        const app = yield* ready;
        const token = yield* userToken(userId);
        const response = yield* sendAsUser(
          githubRead(`/users/${app.slug}${BOT_LOGIN_SUFFIX}`, token),
        );
        if (response.status === GITHUB_HTTP_STATUS.NOT_FOUND) return Option.none();
        return Option.some(userOf(yield* readBody(response, UserSchema)));
      }).pipe(Effect.scoped),
    userToken,
  };
}

/** A value under the same rule as `HostedEnvironment`'s: trimmed, and a blank one is absent. */
function present(value: Option.Option<string>): string | undefined {
  return text(Option.getOrUndefined(value));
}

function presentRedacted(value: Option.Option<Redacted.Redacted>): Redacted.Redacted | undefined {
  const named = text(Option.getOrUndefined(Option.map(value, Redacted.value)));
  return named === undefined ? undefined : Redacted.make(named);
}

/**
 * The App as this deployment's environment configures it, read as the
 * services are built and not at each invocation, on the same terms as
 * `hostedEnvironment`. A deployment missing any of the six values builds the
 * service all the same and every read of it answers `GitHubAppNotConfigured`
 * naming what was missing, because every function bundle loads this layer
 * and a bundle must load with nothing configured.
 */
export const githubAppFromEnvironment: Layer.Layer<GitHubApp, Config.ConfigError> = Layer.effect(
  GitHubApp,
  Effect.map(
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
      return githubAppService(settings, missing);
    },
  ).pipe(
    Effect.provideServiceEffect(
      ConfigProvider.ConfigProvider,
      Effect.sync(() => ConfigProvider.fromEnv()),
    ),
  ),
);
