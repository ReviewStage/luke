/**
 * github-app.ts -- the Luke GitHub App as the server speaks for it: its own JWT, the installations a workspace connected, and the tokens it mints there.
 *
 * A workspace's repositories are the repositories of the installations of
 * the App connected to it (`@luke/service/github/github-installations`), one
 * per GitHub account: nobody's own GitHub sign-in is asked what it reaches,
 * and a repository is reached through the workspace's installation on its
 * owner, or, below, on a member's own token. The App speaks
 * with a JWT signed by its private key, which reads an installation
 * (`GET /app/installations/{id}`) and mints its tokens (`POST
 * /app/installations/{id}/access_tokens`). A listing is read on a token
 * minted for the listing alone (`GET /installation/repositories`); a
 * repository is the workspace's only where that listing holds it, and only
 * then is a token minted for it: contents read for a checkout or a file,
 * contents and pull requests read for what a coding agent published, and
 * contents and pull requests write for its branch and pull request, with
 * what reads its pull request's CI beside the last two where the
 * installation grants it. So what a member of the workspace reaches through
 * the App is what the installation reaches, whoever they are on GitHub, and
 * what an agent pushes through it is pushed as the App.
 *
 * A function instance keeps what it reached and minted, so a tab reading
 * one pull request a few times a minute does not read the installation,
 * list its repositories, and mint a token for every request: a repository a
 * workspace's installation reaches is kept for `KEPT.REACH_TTL` under the
 * workspace and the repository as asked, and a token minted for one
 * repository under the workspace, the installation, the repository, and
 * the permissions it is cut to, until shortly before GitHub expires it. A
 * token is still minted for the one repository alone, with the permissions
 * it always had, and a reach is kept only under the workspace that reached
 * it, so nothing kept crosses workspaces. A kept reach is used only while
 * the store still links its installation to the workspace, running, so a
 * disconnect, or a removal GitHub's webhook reported, stops it at once; and
 * GitHub itself ends a token's access to a repository removed from its
 * installation. A failure, and a repository not reached, are never kept. A write token leaves for a sandbox's whole run
 * rather than for one request, so it is minted afresh with its whole hour
 * every time it is asked for.
 *
 * A member who saved their own classic personal access token
 * (`./github-token.ts`) reaches, beside that, a repository no installation
 * of the workspace reaches on that token, where GitHub answers the token
 * with push to it. The installation is always asked first and always wins. A reach and a
 * token are kept under the member who asked as well as the workspace, so
 * nothing kept crosses members either, and the member's token itself is
 * read afresh at every use rather than kept. An automation asks as no
 * member, so it reaches through the installation alone.
 *
 * A connect is confirmed once on the installer's own say: GitHub's guidance
 * for the Setup URL is that its `installation_id` is not to be trusted
 * alone, and that the installation is to be checked against the user who
 * installed it on a user access token
 * (https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url).
 * That token comes from GitHub's web application flow with PKCE
 * (https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app):
 * the code is exchanged, `GET /user/installations` read on the token once,
 * and the token revoked (`DELETE /applications/{client_id}/token`,
 * https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-token);
 * nothing of it is stored.
 *
 * Signing in with GitHub is also an authorization of the App, and the token
 * Better Auth leaves on the `account` row is read here, refreshed when it is
 * about to expire and re-sealed in place, for two readers: GitHub's MCP
 * server (`integrations/github-integration.ts`), and a coding agent that
 * writes as the developer who started it (`agents/coder-host/checkout.ts`),
 * which reads on it whether the developer may push to the agent's
 * repository and opens its pull request on it. No read of what a
 * workspace reaches takes it.
 *
 * Nothing here holds a client: the GitHub reads run on the ambient
 * `HttpClient` and the rows are read on the ambient `SqlClient`, so a test
 * stands a fake at the GitHub boundary and a throwaway database beneath it,
 * and the edge serving a request is the one place either is provided. A
 * token leaves only as a `Redacted`, and a failure carries a status or a
 * kind and never the request that carried the bearer.
 */

import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
  type GitHubAccountType,
  type GitHubInstallationStatus,
} from "@luke/database/github-installation-vocabulary";
import { InstantColumnSchema } from "@luke/database/models/columns";
import { account } from "@luke/database/schemas/auth";
import { GITHUB_ACCESS, type GitHubAccess } from "@luke/features/github-repositories-wire";
import {
  REPOSITORY_UNREACHED,
  type RepositoryUnreached,
} from "@luke/features/repository-reach-wire";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
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
import { GITHUB_TOKEN_ABSENCE, openMemberGitHubToken } from "./github-token.js";

const GITHUB_API = "https://api.github.com";
const GITHUB_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const GITHUB_AUTHORIZE_ENDPOINT = "https://github.com/login/oauth/authorize";
const GITHUB_APPS = "https://github.com/apps";
const GITHUB_WEB = "https://github.com";
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
export const USER_TOKEN_REFRESH_MARGIN_MS = 60_000;

const GRANT_TYPE = { REFRESH_TOKEN: "refresh_token" } as const;

/** PKCE as GitHub's web flow takes it: the SHA-256 of the verifier, base64url. */
const PKCE_METHOD = "S256";

/**
 * What reads a pull request's CI: its check runs, its commit statuses, and
 * the workflow runs behind them. An installation grants a permission the App
 * added after it was installed only once its owner accepts it on GitHub, and
 * a mint naming one the installation never granted fails whole, so these are
 * asked only of an installation that grants them all.
 */
const CI_READ_PERMISSIONS = { checks: "read", statuses: "read", actions: "read" } as const;

/**
 * What reads an issue. The App asks for issues write, but an installation
 * made before it asked grants it only once its owner accepts, so an issue is
 * read only on an installation that grants it, for the same reason as CI.
 */
const ISSUES_PERMISSION = "issues";

/**
 * What the App asks of an installation token, by what the token is for:
 * metadata alone, which lists the installation's repositories; contents read
 * alone, which is what a checkout needs; issues read alone, which reads an
 * issue a link names; contents and pull requests read, which reads what a
 * coding agent published; or contents and pull requests write, which is what
 * its push and pull request need. CI read stands beside the last two where
 * the installation grants it.
 */
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

/**
 * What one function instance keeps of what the App reached and minted. A
 * reach is kept briefly, since an installation's repositories change on
 * GitHub without a word to the instance; an installation token lives an
 * hour from its mint
 * (https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app),
 * and is kept until `TOKEN_MARGIN` before GitHub's `expires_at` for it, and
 * never past the hour, so a request handed one does not watch it expire
 * mid-flight.
 */
const KEPT = {
  CAPACITY: 1_024,
  REACH_TTL: Duration.minutes(5),
  TOKEN_LIFETIME: Duration.hours(1),
  TOKEN_MARGIN: Duration.minutes(10),
} as const;

/** Whether a repository token is kept for the instance's later asks, or minted afresh for each, as a write token leaving for a sandbox's whole run is. */
const TOKEN_KEEPING = { KEPT: "kept", FRESH: "fresh" } as const;
type TokenKeeping = (typeof TOKEN_KEEPING)[keyof typeof TOKEN_KEEPING];

/** The mint as GitHub takes it: the repositories by name, none for every one, and the permissions the token is cut to. */
interface InstallationTokenRequest {
  readonly repositories?: readonly string[];
  readonly permissions: InstallationTokenPermissions;
}

/** The statuses the reads here decide on by name; any other is answered as the status it is. */
export const GITHUB_HTTP_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  /** What a repository with its issues turned off answers on its issues path. */
  GONE: 410,
  UNPROCESSABLE: 422,
} as const;

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

/** The kinds of account an installation's workspace is made for; an enterprise's is none of them. */
const ACCOUNT_TYPES: readonly GitHubAccountType[] = Object.values(GITHUB_ACCOUNT_TYPE);

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
  /** GitHub's own id for that account, which a workspace is keyed on; absent where the login is. */
  readonly accountId: number | undefined;
  /** Whether that account is a user or an organization; absent for any other kind. */
  readonly accountType: GitHubAccountType | undefined;
  readonly repositorySelection: GitHubRepositorySelection;
  /** Whether the installation grants the App every permission that reads a pull request's CI (`CI_READ_PERMISSIONS`). */
  readonly ciReadable: boolean;
  /** Whether the installation grants the App issues, at read or write, which an issue's read is minted with. */
  readonly issuesReadable: boolean;
  /** Whether the account it is on suspended it, which leaves it minting nothing until it is brought back. */
  readonly suspended: boolean;
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
const SIGN_IN_REQUIRED = {
  /** The user holds no GitHub authorization: they signed in with Google alone, or revoked the App's and has not signed in with GitHub since. */
  NO_GITHUB_ACCOUNT: "no-github-account",
  /** The row holds the OAuth App's token from before the GitHub App, which reaches no installation and cannot be refreshed. */
  BEFORE_THE_APP: "before-the-app",
  /** The refresh token has expired, or GitHub refused it. */
  REFRESH_REFUSED: "refresh-refused",
  /** The sealed token would not open under this deployment's secret. */
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

/** What a read of GitHub can fail with, apart from the store. */
export type GitHubReadFailure = GitHubAppNotConfigured | GitHubUnavailable;
/** What a read of a workspace's installation can fail with: GitHub, or the store that names the installation. */
export type GitHubWorkspaceReadFailure = GitHubReadFailure | StoreFailure;
/** What a read on the user's own token can fail with. */
export type GitHubUserReadFailure = GitHubReadFailure | GitHubSignInRequired | StoreFailure;

/** Why the workspace's installation does not reach a repository, as GitHub says it; another workspace's reach is the store's to say. */
type GitHubRepositoryUnreached = Exclude<
  RepositoryUnreached,
  { readonly reason: typeof REPOSITORY_UNREACHED.OTHER_WORKSPACE }
>;

/** A repository as reached, spelled as GitHub spells it, and how: what a caller records on the rows it writes. */
export interface ReachedRepository {
  readonly repository: GitHubRepository;
  readonly access: GitHubAccess;
}

/** A repository the workspace's installation or the member's token reaches, or why neither does. */
type GitHubRepositoryReach = Result.Result<ReachedRepository, GitHubRepositoryUnreached>;

/** Why the member's own token does not reach a repository. */
type TokenUnreached =
  | typeof REPOSITORY_UNREACHED.NO_TOKEN
  | typeof REPOSITORY_UNREACHED.TOKEN_INVALID
  | typeof REPOSITORY_UNREACHED.TOKEN_NO_ACCESS
  | typeof REPOSITORY_UNREACHED.TOKEN_CANNOT_PUSH;

/** A repository reached through the workspace's installation, with the installation. */
interface ReachedThroughApp {
  readonly access: typeof GITHUB_ACCESS.APP;
  readonly installation: GitHubInstallation;
  readonly repository: GitHubRepository;
}

/** A repository reached on the member's own token, with whose token it is; the token itself is read again at each use. */
interface ReachedOnToken {
  readonly access: typeof GITHUB_ACCESS.TOKEN;
  readonly member: string;
  readonly repository: GitHubRepository;
}

/** A repository reached, and how, or why it is not. */
type ReachResult = Result.Result<ReachedThroughApp | ReachedOnToken, GitHubRepositoryUnreached>;

/** One repository of one workspace as one member asked, which is what a reach is kept under; none for an automation. */
class ReachKey extends Data.Class<{
  readonly organizationId: string;
  readonly fullName: string;
  readonly member: string | undefined;
}> {}

/** One repository token as minted: for which workspace and member, through which installation, for which repository, cut to what. */
class TokenKey extends Data.Class<{
  readonly organizationId: string;
  readonly member: string | undefined;
  readonly installationId: number;
  readonly repository: string;
  readonly permissions: InstallationTokenPermissions;
}> {}

/** A token as minted, and how long it is kept: until the margin before its expiry, or no time where it is that near already. */
interface KeptToken {
  readonly token: Redacted.Redacted;
  readonly keepFor: Duration.Duration;
}

/**
 * Whose a repository token is: an installation token the App minted, or the
 * member's own, with the GitHub account it belongs to, whose login git over
 * HTTPS takes as the username beside a personal access token
 * (https://docs.github.com/en/get-started/git-basics/about-remote-repositories#cloning-with-https-urls).
 */
export type GitHubTokenAccess =
  | { readonly kind: typeof GITHUB_ACCESS.APP }
  | {
      readonly kind: typeof GITHUB_ACCESS.TOKEN;
      readonly githubLogin: string;
      readonly githubUserId: string;
    };

/** A token for one repository: the repository as GitHub spells it, the token, sealed, and whose it is. */
export interface GitHubRepositoryToken {
  readonly repository: GitHubRepository;
  /** An installation token limited to this one repository, good for an hour from its mint; or the member's own token. */
  readonly token: Redacted.Redacted;
  readonly access: GitHubTokenAccess;
}

/** What the browser is sent to GitHub with to authorize the App once, so the installer is confirmed. */
interface GitHubAuthorizeRequest {
  /** The callback GitHub returns the browser to, one of the App's registered callback URLs. */
  readonly redirectUri: string;
  /** What GitHub hands back unchanged. */
  readonly state: string;
  /** The PKCE code verifier, whose S256 challenge the address carries. */
  readonly codeVerifier: string;
}

/** What the callback exchanges: GitHub's one-time code, with the verifier and callback the authorization was asked with. */
export interface GitHubAuthorizeReturn {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

export interface GitHubAppService {
  /** Where a user installs the App, or changes which repositories it sees; GitHub returns them to the App's Setup URL. */
  readonly installUrl: Effect.Effect<string, GitHubAppNotConfigured>;
  /** The login the App's own bot acts under on GitHub, `<slug>[bot]`: who Luke's agents are in a delivery. */
  readonly botLogin: Effect.Effect<string, GitHubAppNotConfigured>;
  /** A JWT the App speaks as itself with, good for a few minutes from now. */
  readonly appJwt: Effect.Effect<Redacted.Redacted, GitHubAppNotConfigured>;
  /** One installation of this App by the id GitHub hands the Setup URL; none for an id that is not this App's. */
  readonly installation: (
    installationId: number,
  ) => Effect.Effect<Option.Option<GitHubInstallation>, GitHubReadFailure, HttpClient.HttpClient>;
  /**
   * Where the browser authorizes the App once, on GitHub's web flow with
   * PKCE S256, so the installer of a connect can be confirmed.
   */
  readonly authorizeUrl: (
    request: GitHubAuthorizeRequest,
  ) => Effect.Effect<string, GitHubAppNotConfigured>;
  /**
   * The installations the user who authorized can reach: the code exchanged
   * for a user access token, `GET /user/installations` read on it, and the
   * token revoked; none where GitHub will not exchange the code.
   */
  readonly authorizedInstallations: (
    returned: GitHubAuthorizeReturn,
  ) => Effect.Effect<
    Option.Option<readonly GitHubInstallation[]>,
    GitHubReadFailure,
    HttpClient.HttpClient
  >;
  /**
   * The repositories of every installation connected to the workspace that
   * GitHub still runs, read whole, as one list most recently updated first,
   * each repository once however GitHub spells it; none where it has no
   * running installation. One installation's listing GitHub does not answer
   * fails the whole read rather than answering the others alone.
   */
  readonly workspaceRepositories: (
    organizationId: string,
  ) => Effect.Effect<
    Option.Option<readonly GitHubRepository[]>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  /**
   * The repositories the member's own token may push to, as GitHub lists
   * them for the token's user (`GET /user/repos`), most recently updated
   * first, one page; none where the member keeps no token GitHub accepts.
   */
  readonly memberRepositories: (
    member: string,
  ) => Effect.Effect<
    Option.Option<readonly GitHubRepository[]>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  /**
   * One repository by `owner/name`, spelled as GitHub spells it, where the
   * workspace's installation reaches it, and else where the member's own
   * token does (`member`, none for an automation), with which of the two;
   * or why not. Only an installation on the owner can reach it, and the
   * listing is read only as far as the repository. The installation's why:
   * none connected, one GitHub no longer runs or that was suspended, one on
   * another account than the owner, one on the owner never given the
   * repository, or one given all of the owner's that still does not list
   * it, which a rename, a transfer, or a delete leaves. Where the member
   * keeps a token, the token's why stands in its place.
   */
  readonly repositoryReach: (
    organizationId: string,
    fullName: string,
    member: string | undefined,
  ) => Effect.Effect<
    GitHubRepositoryReach,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  /**
   * A token for one repository the workspace's installation reaches,
   * limited to that repository and to contents read, or the member's own
   * where only their token reaches it; none where neither does, on the same
   * terms as `repositoryReach`.
   */
  readonly repositoryReadToken: (
    organizationId: string,
    fullName: string,
    member: string | undefined,
  ) => Effect.Effect<
    Option.Option<GitHubRepositoryToken>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  /** The same mint with contents and pull requests read, and CI read where the installation grants it: what reads a coding agent's pull request. */
  readonly repositoryPullRequestToken: (
    organizationId: string,
    fullName: string,
    member: string | undefined,
  ) => Effect.Effect<
    Option.Option<GitHubRepositoryToken>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  /**
   * The same mint with issues read alone, which reads an issue a link names;
   * none where the installation does not reach the repository, or does not
   * grant the App issues.
   */
  readonly repositoryIssueToken: (
    organizationId: string,
    fullName: string,
    member: string | undefined,
  ) => Effect.Effect<
    Option.Option<GitHubRepositoryToken>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  /**
   * Whether a write token for the repository will read its pull requests'
   * CI: the workspace's installation grants the App `CI_READ_PERMISSIONS`
   * whole and reaches the repository, or the member's own token reaches it.
   */
  readonly repositoryCiReadable: (
    organizationId: string,
    fullName: string,
    member: string | undefined,
  ) => Effect.Effect<boolean, GitHubWorkspaceReadFailure, HttpClient.HttpClient | DatabaseServices>;
  /**
   * The same mint with contents and pull requests write, which is what a
   * coding agent's push to its branch and its pull request need, and with CI
   * read beside them where the installation grants it.
   */
  readonly repositoryWriteToken: (
    organizationId: string,
    fullName: string,
    member: string | undefined,
  ) => Effect.Effect<
    Option.Option<GitHubRepositoryToken>,
    GitHubWorkspaceReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  /**
   * The App's own bot user, the account GitHub attributes the App's actions
   * to, read on an installation token the caller holds (`GET
   * /users/<slug>[bot]`) since the App's JWT reaches no user endpoint.
   */
  readonly appBot: (
    token: Redacted.Redacted,
  ) => Effect.Effect<GitHubUser, GitHubReadFailure, HttpClient.HttpClient>;
  /**
   * The user's GitHub App token off their sign-in, refreshed and re-sealed on
   * its row when it is about to expire; read for GitHub's MCP server alone.
   * The read and the refresh run under a lock on the row, because GitHub
   * retires a refresh token the moment it is used: two requests refreshing at
   * once would leave the second holding a token GitHub no longer knows.
   */
  readonly userToken: (
    userId: string,
  ) => Effect.Effect<
    Redacted.Redacted,
    GitHubUserReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
  /**
   * The user's own GitHub account, with their token, where that token may
   * push to the repository: read on the token (`GET /user`, then `GET
   * /repos/{owner}/{name}` for its `permissions.push`), which reaches a
   * repository only where the App is installed and the account can see it.
   * None where the repository is out of the token's sight or its push is
   * refused.
   */
  readonly userPusher: (
    userId: string,
    fullName: string,
  ) => Effect.Effect<
    Option.Option<GitHubPusher>,
    GitHubUserReadFailure,
    HttpClient.HttpClient | DatabaseServices
  >;
}

/** A user who may push to a repository through the App: their account as a commit names it, and their token. */
interface GitHubPusher {
  readonly user: GitHubUser;
  readonly token: Redacted.Redacted;
}

export class GitHubApp extends Context.Service<GitHubApp, GitHubAppService>()("GitHubApp") {
  /**
   * The service over fixed settings, or over none, which is a deployment
   * without the App, and over the ring members' own tokens are sealed under
   * (`HostedEnvironment`'s `providerKeyEncryptionKeys`), where none opens no token.
   */
  static layer(
    settings: GitHubAppSettings | undefined,
    missing: readonly string[] = [],
    tokenKeys: Redacted.Redacted | undefined = undefined,
  ): Layer.Layer<GitHubApp> {
    return Layer.effect(GitHubApp, githubAppService(settings, missing, tokenKeys));
  }
}

/** The settings with the private key parsed once; a key that will not parse is the App unconfigured. */
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
  /** What the installation grants the App, by permission name; read for the CI permissions alone. */
  permissions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** When the account suspended it; null or absent while it runs. */
  suspended_at: Schema.optional(Schema.NullOr(Schema.String)),
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

/** GitHub's answer to a code exchange, read for the token alone; a refusal arrives with status 200 too. */
const ExchangedTokenSchema = Schema.Struct({ access_token: Schema.String });
const ExchangeAnswerSchema = Schema.Union([ExchangedTokenSchema, TokenRefusalSchema]);

/** GitHub's answer to a token mint, read for the token and when it expires. */
const InstallationTokenSchema = Schema.Struct({
  token: Schema.String,
  expires_at: Schema.DateFromString,
});

/** A user as GitHub records one, read as far as a commit identity goes; the name is null where the account set none. */
const UserSchema = Schema.Struct({
  id: Schema.Number,
  login: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
});
type UserRecord = typeof UserSchema.Type;

/** A repository as a user's token reads it, for whether the token may push; absent where GitHub says nothing of it. */
const RepositoryPermissionsSchema = Schema.Struct({
  permissions: Schema.optional(Schema.Struct({ push: Schema.Boolean })),
});

/** A repository as a member's own token reads it: the repository, and whether the token may push to it. */
const TokenRepositorySchema = Schema.Struct({
  ...RepositorySchema.fields,
  ...RepositoryPermissionsSchema.fields,
});

/**
 * The one page of the member's own repositories the picker lists, as
 * GitHub's `GET /user/repos` takes it
 * (https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user):
 * the ones they own, collaborate on, and reach as an organization's member,
 * most recently updated first.
 */
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

/** The user's GitHub row, locked for the transaction around it; the newest where a user somehow has two. */
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

/**
 * Clears the tokens on every GitHub row of the GitHub user given, whichever
 * Luke account holds it, at the instant given, and keeps the row. Note that
 * Luke writes Better Auth's own `account` table here, because a webhook
 * carries no session and Better Auth documents no server call that clears a
 * provider account's tokens for a user who is not the one asking
 * (https://www.better-auth.com/docs/concepts/users-accounts). The row is kept
 * because it is the one link from the GitHub user to the Luke account that
 * survives GitHub's address changing: Better Auth finds a signing-in user by
 * this row first and by address second.
 */
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

/** A permission is granted at read where the installation names it at any level: write grants read. */
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

/** Where on GitHub the account the installation is on chooses which repositories it reaches. */
function installationSettingsUrl(installation: GitHubInstallation): string {
  return installation.accountType === GITHUB_ACCOUNT_TYPE.ORGANIZATION &&
    installation.accountLogin !== undefined
    ? `${GITHUB_WEB}/organizations/${installation.accountLogin}/settings/installations/${installation.id}`
    : `${GITHUB_WEB}/settings/installations/${installation.id}`;
}

/** A blank name is one the account never set. */
function userOf(record: UserRecord): GitHubUser {
  return { id: record.id, login: record.login, name: text(record.name ?? undefined) };
}

/**
 * Clears a GitHub user's authorization of the App, as GitHub's
 * `github_app_authorization` delivery reports it revoked
 * (https://docs.github.com/en/webhooks/webhook-events-and-payloads#github_app_authorization):
 * the sealed tokens that no longer reach anything go, and the account row
 * stays without them, so every read on the user's token asks for a new
 * sign-in. The Luke account keeps every way it signs in; the next GitHub
 * sign-in finds it through the kept row, whatever address GitHub then holds,
 * and writes fresh tokens onto it.
 */
export function clearRevokedAuthorization(
  githubUserId: number,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    clearGithubTokensOf({ githubUserId: String(githubUserId), updatedAt: new Date(now) }),
  );
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

/**
 * Several installations' repositories as one list, most recently updated
 * first, each repository once: the first of any two GitHub spells as one
 * name in different case, which a transfer between two of them can leave.
 */
function combinedRepositories(repositories: readonly GitHubRepository[]): GitHubRepository[] {
  const seen = new Set<string>();
  return [...repositories].sort(byMostRecentlyUpdated).filter((repository) => {
    const folded = repository.fullName.toLowerCase();
    if (seen.has(folded)) return false;
    seen.add(folded);
    return true;
  });
}

/** GitHub folds case in logins and repository names, so a name is the same name however it is spelled. */
function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** The API path of one repository by `owner/name`, each part encoded. */
function repositoryPath(fullName: string): string {
  const [owner = "", name = ""] = fullName.split("/");
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
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

/** One write of the API under the bearer given, its JSON body as given, the path rooted at the API's origin. */
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

/** One write of the API under the bearer given by the method given, its JSON body where one is given, the path rooted at the API's origin. */
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
export function send(
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<HttpClientResponse.HttpClientResponse, GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.flatMap(HttpClient.HttpClient, (client) =>
    Effect.mapError(client.execute(request), unavailable),
  );
}

/** Whether a listing read so far holds what the caller came for, so no further page is asked. */
type Enough<A> = (items: readonly A[]) => boolean;

const WHOLE_LISTING: Enough<unknown> = () => false;

/**
 * A paged listing under the bearer given, read a hundred at a time until a
 * page comes back short or the items read are enough, and never past
 * `PAGING.MAX_PAGES`, where a listing still going is unbounded. Each page's
 * answer is read and closed before the next is asked for.
 */
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

/** The installations a user access token reaches, every page of them. */
function installationsOnToken(
  token: Redacted.Redacted,
): Effect.Effect<readonly GitHubInstallation[], GitHubUnavailable, HttpClient.HttpClient> {
  return readPages("/user/installations", token, (response) =>
    Effect.map(readBody(response, UserInstallationsSchema), (answer) =>
      answer.installations.map(installationOf),
    ),
  );
}

/** The repositories an installation token reaches, every page of them or as many as are enough. */
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
  HttpClient.HttpClient | DatabaseServices
> {
  // A row without an access token is one whose authorization was revoked: the
  // user holds no GitHub authorization until a new sign-in writes one.
  if (row.accessToken === null) {
    return yield* new GitHubSignInRequired({ reason: SIGN_IN_REQUIRED.NO_GITHUB_ACCOUNT });
  }
  // A row without a refresh token is the OAuth App's from before the GitHub
  // App: its token reaches no installation, and only a new sign-in replaces it.
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

  /** The member's own token, opened under the deployment's ring, where they keep one GitHub has not refused. */
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

  /** A token minted as the App on the installation, cut as asked, with the instant GitHub expires it. */
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

  /**
   * The workspace's connected installation as GitHub holds it now, its
   * stored status written to match where the two differ. Note that we mend
   * the status on every read, because GitHub never redelivers a failed
   * installation delivery on its own, and Settings reads the stored status:
   * a missed removal or suspension, or a missed return, is set right by the
   * next chip opened or agent started rather than never. A row a webhook
   * or a connect moved while GitHub was being asked is left as it stands.
   */
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

  /**
   * The installations connected to the workspace that GitHub still runs, as
   * GitHub holds them now, the first linked first: each one the workspace
   * holds is read, its status mended, and one GitHub no longer knows or its
   * account suspended is left out, since GitHub mints a suspended
   * installation no token to list with.
   */
  const liveWorkspaceInstallations = (organizationId: string) =>
    Effect.gen(function* () {
      const connected = yield* installationsOfWorkspace(organizationId);
      const read = yield* Effect.forEach(connected, connectedInstallation);
      return read.flatMap((one) => (Option.isSome(one) && !one.value.suspended ? [one.value] : []));
    });

  /**
   * The workspace's installation on the owner as GitHub holds it now, found
   * among those connected to the workspace alone: the ones whose stored
   * login names the owner are read first, then the rest, since an account
   * renamed on GitHub keeps its old login in the store. Each one read has
   * its status mended. Answers too every installation read that GitHub
   * still runs, and whether the one the store names on the owner lapsed.
   */
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

  /** The installation's repositories, every one or as many as are enough, read on a token minted for the listing alone. */
  const repositoriesOf = (
    reached: GitHubInstallation,
    enough: Enough<GitHubRepository> = WHOLE_LISTING,
  ) =>
    Effect.flatMap(
      mint(reached.id, { permissions: INSTALLATION_TOKEN_PERMISSIONS.LIST }),
      (minted) => repositoriesOnInstallationToken(minted.token, enough),
    );

  /**
   * The repository and the installation it is reached through, where the
   * workspace's installation on its owner reaches it, or why it does not:
   * only an installation of this workspace on the owner can reach it, never
   * another workspace's, and the listing is read only as far as the page the
   * repository is on. With none on the owner, the workspace's connection
   * lapsed where the one on the owner or every one it holds no longer runs,
   * and is on another account otherwise, named where it holds one alone.
   */
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
        const reachedThrough: ReachResult = Result.succeed({
          access: GITHUB_ACCESS.APP,
          installation: onOwner,
          repository,
        });
        return reachedThrough;
      }
      // Note that an installation given only some repositories cannot tell one it was never given from one renamed or deleted, so it asks for the one GitHub can mend.
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

  /**
   * The repository as the member's own token reads it
   * (`GET /repos/{owner}/{repo}`,
   * https://docs.github.com/en/rest/repos/repos#get-a-repository), reached
   * only where GitHub answers the token with push to it
   * (`permissions.push`), or why not: one GitHub refused before, one the
   * deployment cannot open, no access to the repository, or no push; or
   * the installation's own why, `throughApp`, for a member who keeps no
   * token, since they never chose one. A 401 is GitHub refusing the token,
   * which marks it invalid; the 403 and 404 that page lists are a
   * repository the token does not reach.
   */
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
      if (
        response.status === GITHUB_HTTP_STATUS.NOT_FOUND ||
        response.status === GITHUB_HTTP_STATUS.FORBIDDEN
      ) {
        return unreached(REPOSITORY_UNREACHED.TOKEN_NO_ACCESS);
      }
      const record = yield* readBody(response, TokenRepositorySchema);
      if (record.permissions?.push !== true)
        return unreached(REPOSITORY_UNREACHED.TOKEN_CANNOT_PUSH);
      const reachedOn: ReachResult = Result.succeed({
        access: GITHUB_ACCESS.TOKEN,
        member,
        repository: repositoryOf(record),
      });
      return reachedOn;
    }).pipe(Effect.scoped);

  /**
   * The repository as the workspace's installation reaches it, which always
   * wins; else as the member's own token reaches it, the token's why
   * standing where they keep one and it does not.
   */
  const reach = (organizationId: string, fullName: string, member: string | undefined) =>
    Effect.gen(function* () {
      const throughApp = yield* installationReach(organizationId, fullName);
      if (Result.isSuccess(throughApp) || member === undefined) return throughApp;
      return yield* tokenReach(member, fullName, throughApp);
    });

  /** The repository as `reach` reads it, and how, none where it does not reach it. */
  const reachableRepository = (
    organizationId: string,
    fullName: string,
    member: string | undefined,
  ) => Effect.map(reach(organizationId, fullName, member), Result.getSuccess);

  /**
   * A token minted for the key's one repository, by its name, which is one
   * repository on the installation's one account, and how long it is kept:
   * until `KEPT.TOKEN_MARGIN` before GitHub expires it, and never past its
   * hour, whatever clock GitHub's `expires_at` was read against.
   */
  const repositoryTokenOf = (key: TokenKey) =>
    Effect.gen(function* () {
      const minted = yield* mint(key.installationId, {
        repositories: [key.repository],
        permissions: key.permissions,
      });
      const now = yield* Clock.currentTimeMillis;
      const lasts = Math.min(minted.expiresAt - now, Duration.toMillis(KEPT.TOKEN_LIFETIME));
      const keepFor = Duration.millis(Math.max(lasts - Duration.toMillis(KEPT.TOKEN_MARGIN), 0));
      const kept: KeptToken = { token: minted.token, keepFor };
      return kept;
    });

  /**
   * GitHub's token endpoint asked to exchange a web flow's code, on the same
   * terms as a refresh: the answer is 200 either way, so a refusal is read
   * out of the body, and is none.
   */
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
      return "error" in answer ? Option.none() : Option.some(Redacted.make(answer.access_token));
    });

  /** The user access token revoked, under the App's client credentials. */
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

  /**
   * The kept reads of one instance, and what answers through them. Note
   * that only a mint reads the kept reach: what answers a member whether a
   * repository is reached, and why not, reads GitHub afresh.
   */
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

    /**
     * The kept reach of the repository, where the store still links its
     * installation to the workspace and running; a reach afresh otherwise.
     * Note that we read the links on every ask, because an installation the
     * workspace disconnected, or one GitHub replaced, removed, or suspended
     * as a webhook told the store, must stop minting at once rather than
     * when the kept reach lapses. A reach on the member's token stands as
     * kept, since the token it names is read afresh at each use.
     */
    const standingReach = (key: ReachKey) =>
      Effect.gen(function* () {
        const kept = yield* Cache.get(reaches, key);
        if (Result.isFailure(kept) || kept.success.access === GITHUB_ACCESS.TOKEN) return kept;
        // Note that the links are read after the reach, because a reach afresh mends a stale status first.
        const linked = yield* installationsOfWorkspace(key.organizationId);
        const throughId = kept.success.installation.id;
        const stands = linked.some(
          (one) =>
            one.installationId === throughId && one.status === GITHUB_INSTALLATION_STATUS.ACTIVE,
        );
        if (stands) return kept;
        yield* Cache.invalidate(reaches, key);
        return yield* Cache.get(reaches, key);
      });

    /** The member's own token for a repository reached on it, read afresh; none where they no longer keep one GitHub accepts. */
    const memberRepositoryToken = (reached: ReachedOnToken) =>
      Effect.map(memberToken(reached.member), (held) =>
        Result.isFailure(held)
          ? Option.none<GitHubRepositoryToken>()
          : Option.some<GitHubRepositoryToken>({
              repository: reached.repository,
              token: held.success.token,
              access: {
                kind: GITHUB_ACCESS.TOKEN,
                githubLogin: held.success.githubLogin,
                githubUserId: held.success.githubUserId,
              },
            }),
      );

    /**
     * A token for the one repository the workspace or the member reaches:
     * minted as the App, cut to the permissions chosen for its installation
     * and kept as asked, where the installation reaches it, or the member's
     * own where only their token does; none where neither reaches it, or
     * where its installation grants none of what the token is for, since
     * GitHub refuses a mint naming a permission not granted.
     */
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
      authorizedInstallations: (returned) =>
        Effect.gen(function* () {
          const app = yield* ready;
          const token = yield* exchangeCode(app, returned);
          if (Option.isNone(token)) return Option.none();
          const installations = yield* installationsOnToken(token.value);
          yield* revokeToken(app, token.value);
          return Option.some(installations);
        }),
      workspaceRepositories: (organizationId) =>
        Effect.gen(function* () {
          const live = yield* liveWorkspaceInstallations(organizationId);
          if (live.length === 0) return Option.none();
          const listed = yield* Effect.forEach(live, (one) => repositoriesOf(one));
          return Option.some(combinedRepositories(listed.flat()));
        }),
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
      userToken,
    };
    return service;
  });
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
 * and a bundle must load with nothing configured. Members' own tokens open
 * under the ring `HostedEnvironment` read.
 */
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
