/**
 * github-app.ts -- the Luke GitHub App as the server speaks for it: its own JWT, its installations, and a signed-in user's token.
 *
 * Signing in with GitHub is a user's authorization of the App, so the token
 * Better Auth leaves on the `account` row is a GitHub App user token: it
 * reaches only the repositories where the App is installed and the user has
 * access, and it expires in hours, with a refresh token that lasts months.
 * This is the one place either token is read back. The App itself speaks
 * with a JWT signed by its private key, which is how an installation GitHub
 * hands the Setup URL is confirmed as this App's own.
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
import { text } from "../core.js";
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

const HTTP_STATUS = { NOT_FOUND: 404 } as const;

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
} as const;
type GitHubFailure = (typeof GITHUB_FAILURE)[keyof typeof GITHUB_FAILURE];

class GitHubUnavailable extends Data.TaggedError("GitHubUnavailable")<{
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
} as const;
type SignInRequiredReason = (typeof SIGN_IN_REQUIRED)[keyof typeof SIGN_IN_REQUIRED];

class GitHubSignInRequired extends Data.TaggedError("GitHubSignInRequired")<{
  readonly reason: SignInRequiredReason;
}> {
  override get message(): string {
    return `The account must sign in with GitHub again: ${this.reason}`;
  }
}

/** What a read of GitHub can fail with, apart from the account row. */
export type GitHubReadFailure = GitHubAppNotConfigured | GitHubUnavailable;
/** What a read on the user's own token can fail with. */
type GitHubUserReadFailure = GitHubReadFailure | GitHubSignInRequired | StoreFailure;

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

/** GitHub's refresh answer, which arrives with status 200 whether it is tokens or a refusal. */
const RefreshedTokensSchema = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Number,
  refresh_token: Schema.String,
  refresh_token_expires_in: Schema.Number,
});
const TokenRefusalSchema = Schema.Struct({ error: Schema.String });
const RefreshAnswerSchema = Schema.Union([RefreshedTokensSchema, TokenRefusalSchema]);

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

function githubRead(path: string, bearer: Redacted.Redacted): HttpClientRequest.HttpClientRequest {
  return HttpClientRequest.get(`${GITHUB_API}${path}`).pipe(
    HttpClientRequest.bearerToken(bearer),
    HttpClientRequest.setHeaders(GITHUB_HEADERS),
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

/** An OK answer's body under its schema; any other status is the status, and a body off the schema is unreadable. */
function readBody<A>(
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

  return {
    installUrl: Effect.map(ready, (app) => `${GITHUB_APPS}/${app.slug}/installations/new`),
    appJwt,
    installation: (installationId) =>
      Effect.gen(function* () {
        const jwt = yield* appJwt;
        const response = yield* send(githubRead(`/app/installations/${installationId}`, jwt));
        if (response.status === HTTP_STATUS.NOT_FOUND) return Option.none();
        const record = yield* readBody(response, InstallationSchema);
        return Option.some(installationOf(record));
      }).pipe(Effect.scoped),
    userInstallations: (userId) =>
      Effect.gen(function* () {
        const token = yield* userToken(userId);
        const response = yield* send(githubRead("/user/installations", token));
        const answer = yield* readBody(response, UserInstallationsSchema);
        return answer.installations.map(installationOf);
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
