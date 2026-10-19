/**
 * integration-connect.ts -- Vercel Connect, as Luke asks it about one account's grant at one provider.
 *
 * Vercel Connect holds every account's grant at every provider, encrypted,
 * and refreshes it; Luke names each account by the subject its row keeps
 * (`integration-store.ts`): its own user id for the first account at a
 * provider, a minted id for another, so two accounts at one provider are two
 * grants. Luke never stores a token. Four things are ever asked of
 * a provider's connector: a browser sign-in for the account to begin, how
 * a sign-in it began stands, the account's token now, and the grant
 * revoked. Each answers either what was asked or one of three fixed words,
 * never Connect's own message: an error's message is Connect's or the
 * provider's words, which nothing here can vouch for holding no
 * credential, so what a failure keeps is its word and, where it carries
 * them, Connect's machine code and status. The one sentence kept is a
 * failed sign-in's own line, and only where it is shaped like no
 * credential, because it is what tells the developer why.
 *
 * Asking Connect for any subject's token needs the deployment's own Vercel
 * OIDC token, which the SDK reads from the request or the environment
 * itself; what this deployment configures per provider is the connector's
 * UID and, where it names any, the accounts the provider is offered to,
 * each read from the variable `integrations.ts` names. A provider whose
 * connector variable is unset answers every ask as not configured, and
 * every agent still runs, only without that provider; a provider withheld
 * from an account answers that account the same way
 * (`accountIntegrationConnect`).
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@luke/features/integration-wire";
import {
  ConnectError,
  ConnectorInstallationRequiredError,
  type ConnectTokenResponse,
  getTokenResponse,
  NoValidTokenError,
  revokeToken,
  startAuthorization,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
import { getVercelOidcToken } from "@vercel/oidc";
import { Config, Context, Data, Effect, Layer, Option, Redacted, Schema } from "effect";
import { readAccountPerson } from "../accounts/account-person.js";
import { text } from "../core.js";
import { INTEGRATION, type IntegrationDefinition } from "./integrations.js";
import { credentialFreeLine } from "./mcp-tools.js";

/** Why Connect answered nothing usable. */
export const INTEGRATION_CONNECT_FAILURE = {
  /** The deployment names no connector, or Connect says the connector is not installed for it. */
  NOT_CONFIGURED: "not-configured",
  /** Connect holds no grant it can turn into a token for the account: never signed in, declined, or revoked at the provider. */
  NOT_AUTHORIZED: "not-authorized",
  /** Connect could not be asked, or refused for a reason of its own. */
  UNAVAILABLE: "unavailable",
} as const;

export type IntegrationConnectFailureReason =
  (typeof INTEGRATION_CONNECT_FAILURE)[keyof typeof INTEGRATION_CONNECT_FAILURE];

/** Connect's machine code as a failure may keep it: a lower-case slug, and nothing shaped like a sentence or a token. */
const CONNECT_CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,62}$/;

export class IntegrationConnectFailure extends Data.TaggedError("IntegrationConnectFailure")<{
  readonly reason: IntegrationConnectFailureReason;
  /** Connect's own code, where it sent one of the fixed shape above. */
  readonly code?: string;
  readonly status?: number;
}> {
  override get message(): string {
    const words: string[] = [`Vercel Connect answered ${this.reason}`];
    if (this.code !== undefined) words.push(this.code);
    if (this.status !== undefined) words.push(String(this.status));
    return words.join(" ");
  }
}

/** One account's token as Connect issued it; the token itself travels sealed until the one place that hands it to eve. */
export interface IntegrationToken {
  readonly token: Redacted.Redacted;
  /** When it stops being good, in milliseconds since the epoch. */
  readonly expiresAt: number;
  /** The account's name at the provider, where Connect's grant names one shaped like no credential: a label, never logged. */
  readonly accountName?: string;
}

/** A browser sign-in Connect began: the address the browser opens, and the handle that asks Connect how it ended. */
interface IntegrationAuthorization {
  readonly url: string;
  readonly verifier: Redacted.Redacted;
}

/** Where a sign-in Connect began stands, as Connect itself answers it. */
export const CONNECT_SIGN_IN_RESULT = {
  /** Still under way, or no word yet. */
  PENDING: "pending",
  /** Connect holds a grant from it. */
  SUCCEEDED: "succeeded",
  /** The developer cancelled it on Connect's own page. */
  CANCELED: "canceled",
  /** Connect or the provider refused it. */
  FAILED: "failed",
} as const;

export type ConnectSignInResult =
  | {
      readonly kind:
        | typeof CONNECT_SIGN_IN_RESULT.PENDING
        | typeof CONNECT_SIGN_IN_RESULT.SUCCEEDED
        | typeof CONNECT_SIGN_IN_RESULT.CANCELED;
    }
  | {
      readonly kind: typeof CONNECT_SIGN_IN_RESULT.FAILED;
      /** Connect's own line on why, where it carried nothing shaped like a credential. */
      readonly message?: string;
    };

/** The accounts a provider is offered to, each entry lower-cased: whole email domains, each with its `@`, and single emails. */
interface AllowedAccounts {
  readonly domains: readonly string[];
  readonly emails: readonly string[];
}

/** What Luke asks of one provider's connector. */
export interface ConnectorService {
  /** Whether the deployment names this connector at all; a deployment without it never asks Connect anything. */
  readonly configured: boolean;
  /** The accounts the deployment offers this provider to; absent, it is offered to every account. */
  readonly allowedAccounts?: AllowedAccounts;
  /** Whether a Luke account may hold more than one account at this provider (`integrations.ts`). */
  readonly multipleAccounts: boolean;
  /** The OAuth `prompt` a sign-in for another account asks the provider for, where the provider documents one. */
  readonly addAccountPrompt?: string;
  /** Begins a browser sign-in for the account under `subject`, which Connect returns to `callbackUrl`; answers the address the browser opens and Connect's handle on it. */
  readonly authorize: (
    subject: string,
    callbackUrl: string,
    options?: { readonly prompt?: string },
  ) => Effect.Effect<IntegrationAuthorization, IntegrationConnectFailure>;
  /** How the sign-in Connect answered this handle for stands now, which is all Luke hears of one that never came back. */
  readonly signInResult: (
    verifier: Redacted.Redacted,
  ) => Effect.Effect<ConnectSignInResult, IntegrationConnectFailure>;
  /** The token of the account under `subject` now; `fresh` asks Connect itself rather than the SDK's in-process cache. */
  readonly token: (
    subject: string,
    options: { readonly fresh: boolean },
  ) => Effect.Effect<IntegrationToken, IntegrationConnectFailure>;
  /** Revokes the grant of the account under `subject` at Connect, which revokes it at the provider where the provider allows it. */
  readonly revoke: (subject: string) => Effect.Effect<void, IntegrationConnectFailure>;
}

/** Every provider's connector, configured or not. */
export type IntegrationConnectService = Readonly<Record<IntegrationProvider, ConnectorService>>;

export class IntegrationConnect extends Context.Service<
  IntegrationConnect,
  IntegrationConnectService
>()("IntegrationConnect") {}

/**
 * The connector a workspace's own Linear grant is held on, apart from the
 * accounts' Linear connector. Note that the two cannot be one, because the
 * accounts' connector signs in through Linear's MCP server, whose tokens
 * only that server takes, while the workspace's issues are read from
 * Linear's GraphQL API, which refuses them; a Linear API OAuth token, as
 * Connect's own Linear connector issues, is taken by both.
 */
export class WorkspaceLinearConnect extends Context.Service<
  WorkspaceLinearConnect,
  ConnectorService
>()("WorkspaceLinearConnect") {}

/** The variable naming the workspace Linear connector's UID. */
export const WORKSPACE_LINEAR_CONNECTOR_VARIABLE = "LINEAR_WORKSPACE_CONNECTOR_UID";

/** The subject every ask names: the one the account's row keeps, so a grant is that account's whatever principal a session runs under. */
function subjectOf(subject: string) {
  return { subject: { type: "user", id: subject } } as const;
}

/** Connect's failure as the word it amounts to, keeping only its code and status. */
function failureOf(cause: unknown): IntegrationConnectFailure {
  if (!(cause instanceof ConnectError)) {
    return new IntegrationConnectFailure({ reason: INTEGRATION_CONNECT_FAILURE.UNAVAILABLE });
  }
  const reason =
    cause instanceof UserAuthorizationRequiredError || cause instanceof NoValidTokenError
      ? INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED
      : cause instanceof ConnectorInstallationRequiredError
        ? INTEGRATION_CONNECT_FAILURE.NOT_CONFIGURED
        : INTEGRATION_CONNECT_FAILURE.UNAVAILABLE;
  const code =
    cause.code !== undefined && CONNECT_CODE_PATTERN.test(cause.code) ? cause.code : undefined;
  return new IntegrationConnectFailure({
    reason,
    ...(code !== undefined ? { code } : undefined),
    ...(cause.status !== undefined ? { status: cause.status } : undefined),
  });
}

/** Whether a sign-in address is one a browser may be sent to: https, and nothing else. */
function isBrowserAddress(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

const NOT_CONFIGURED = new IntegrationConnectFailure({
  reason: INTEGRATION_CONNECT_FAILURE.NOT_CONFIGURED,
});

/** The connector of a provider this deployment names none for: nothing is ever asked. */
const UNCONFIGURED_CONNECTOR: ConnectorService = {
  configured: false,
  multipleAccounts: false,
  authorize: () => Effect.fail(NOT_CONFIGURED),
  signInResult: () => Effect.fail(NOT_CONFIGURED),
  token: () => Effect.fail(NOT_CONFIGURED),
  revoke: () => Effect.fail(NOT_CONFIGURED),
};

/** What Connect answered a result read: its HTTP status, and its body where it was JSON. */
export interface ConnectResultAnswer {
  readonly status: number;
  readonly body: unknown;
}

/**
 * The calls of Vercel Connect a connector makes, which a test hands a fake
 * Connect for: three of its SDK, and the result read its CLI polls, which
 * the SDK does not wrap.
 */
export interface ConnectSdk {
  readonly startAuthorization: typeof startAuthorization;
  readonly getTokenResponse: typeof getTokenResponse;
  readonly revokeToken: typeof revokeToken;
  readonly readAuthorizationResult: (verifier: string) => Promise<ConnectResultAnswer>;
}

/** The Vercel API, as the SDK reaches it from a deployment with no region pinned. */
const VERCEL_API = "https://api.vercel.com";

/**
 * GET /v1/connect/result/{verifier}, under the deployment's own OIDC token
 * as every SDK call is: Connect's word on a sign-in it began, which its
 * CLI polls for its own setup flows. Note that the verifier travels in the
 * path, so the address is never logged.
 */
async function readAuthorizationResult(verifier: string): Promise<ConnectResultAnswer> {
  const token = await getVercelOidcToken();
  const response = await fetch(`${VERCEL_API}/v1/connect/result/${encodeURIComponent(verifier)}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

const VERCEL_CONNECT_SDK: ConnectSdk = {
  startAuthorization,
  getTokenResponse,
  revokeToken,
  readAuthorizationResult,
};

/** Connect's result answer, as much of it as a sign-in's end needs: its status word, and its error's own line. */
const ConnectResultSchema = Schema.Struct({
  status: Schema.String,
  error: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ message: Schema.optionalKey(Schema.String) })),
  ),
});

/** Connect's status words for a request that ended, as its CLI reads them; any other is still under way. */
const CONNECT_RESULT_STATUS = {
  SUCCESS: "success",
  CANCELED: "canceled",
  ERROR: "error",
} as const;

/** HTTP 404: Connect knows no request by the handle yet, or no longer; either way nothing ended that Luke can say. */
const CONNECT_RESULT_UNKNOWN = 404;

const PENDING_RESULT: ConnectSignInResult = { kind: CONNECT_SIGN_IN_RESULT.PENDING };

/** A result answer as the sign-in's end it names, with nothing of Connect's sentence kept that could carry a credential. */
function signInResultOf(
  answer: ConnectResultAnswer,
): Effect.Effect<ConnectSignInResult, IntegrationConnectFailure> {
  if (answer.status === CONNECT_RESULT_UNKNOWN) return Effect.succeed(PENDING_RESULT);
  const read = Schema.decodeUnknownOption(ConnectResultSchema)(answer.body);
  if (answer.status < 200 || answer.status >= 300 || Option.isNone(read)) {
    return Effect.fail(
      new IntegrationConnectFailure({
        reason: INTEGRATION_CONNECT_FAILURE.UNAVAILABLE,
        status: answer.status,
      }),
    );
  }
  switch (read.value.status) {
    case CONNECT_RESULT_STATUS.SUCCESS:
      return Effect.succeed({ kind: CONNECT_SIGN_IN_RESULT.SUCCEEDED });
    case CONNECT_RESULT_STATUS.CANCELED:
      return Effect.succeed({ kind: CONNECT_SIGN_IN_RESULT.CANCELED });
    case CONNECT_RESULT_STATUS.ERROR: {
      const message = credentialFreeLine(read.value.error?.message);
      return Effect.succeed({
        kind: CONNECT_SIGN_IN_RESULT.FAILED,
        ...(message !== undefined ? { message } : undefined),
      });
    }
    default:
      return Effect.succeed(PENDING_RESULT);
  }
}

/** The longest account name a grant's fields are read as a label for. */
const ACCOUNT_NAME_MAX = 64;

/** Where in a grant's metadata an account's name may stand, each read alone so one of the wrong shape hides none of the others. */
const GRANT_NAME_READS = [
  (response: ConnectTokenResponse) =>
    Option.map(
      Schema.decodeUnknownOption(Schema.Struct({ workspace_name: Schema.String }))(
        response.metadata,
      ),
      (read) => read.workspace_name,
    ),
  (response: ConnectTokenResponse) =>
    Option.map(
      Schema.decodeUnknownOption(Schema.Struct({ team: Schema.Struct({ name: Schema.String }) }))(
        response.metadata,
      ),
      (read) => read.team.name,
    ),
  (response: ConnectTokenResponse) =>
    Option.map(
      Schema.decodeUnknownOption(
        Schema.Struct({ organization: Schema.Struct({ name: Schema.String }) }),
      )(response.metadata),
      (read) => read.organization.name,
    ),
  (response: ConnectTokenResponse) =>
    Option.map(
      Schema.decodeUnknownOption(Schema.Struct({ organization_name: Schema.String }))(
        response.metadata,
      ),
      (read) => read.organization_name,
    ),
] as const;

/**
 * The account's name at the provider as Connect's grant carries it, for an
 * account's label: Notion's `workspace_name`, Slack's team, an
 * organization's name, or the grant's own `name` where it is not the
 * connector's id. Note that each field is read only where it is a short line
 * shaped like no credential, because what Connect's driver stores is no
 * contract Luke can vouch for.
 */
function grantAccountName(response: ConnectTokenResponse): string | undefined {
  const candidates = [
    ...GRANT_NAME_READS.flatMap((read) => Option.toArray(read(response))),
    ...(response.name !== undefined ? [response.name] : []),
  ];
  for (const candidate of candidates) {
    const line = credentialFreeLine(candidate);
    if (line === undefined || line.length > ACCOUNT_NAME_MAX) continue;
    if (line === response.connector.uid || line === response.connector.id) continue;
    return line;
  }
  return undefined;
}

/** One connector, asking Vercel Connect itself, or the SDK a test hands it. */
export function vercelConnector(
  connector: string,
  sdk: ConnectSdk = VERCEL_CONNECT_SDK,
): ConnectorService {
  return {
    configured: true,
    multipleAccounts: false,
    authorize: (subject, callbackUrl, options) =>
      Effect.tryPromise({
        try: () =>
          sdk.startAuthorization(connector, subjectOf(subject), {
            callbackUrl,
            ...(options?.prompt !== undefined ? { prompt: options.prompt } : undefined),
          }),
        catch: failureOf,
      }).pipe(
        Effect.flatMap(({ url, verifier }) =>
          isBrowserAddress(url)
            ? Effect.succeed({ url, verifier: Redacted.make(verifier) })
            : Effect.fail(
                new IntegrationConnectFailure({ reason: INTEGRATION_CONNECT_FAILURE.UNAVAILABLE }),
              ),
        ),
      ),
    signInResult: (verifier) =>
      Effect.tryPromise({
        try: () => sdk.readAuthorizationResult(Redacted.value(verifier)),
        catch: failureOf,
      }).pipe(Effect.flatMap(signInResultOf)),
    token: (subject, { fresh }) =>
      Effect.tryPromise({
        try: () => sdk.getTokenResponse(connector, subjectOf(subject), { forceRefresh: fresh }),
        catch: failureOf,
      }).pipe(
        Effect.map((response): IntegrationToken => {
          const accountName = grantAccountName(response);
          return {
            token: Redacted.make(response.token),
            expiresAt: response.expiresAt,
            ...(accountName !== undefined ? { accountName } : undefined),
          };
        }),
      ),
    revoke: (subject) =>
      Effect.tryPromise({
        try: () => sdk.revokeToken(connector, subjectOf(subject)),
        catch: failureOf,
      }),
  };
}

/** One account's grant as a revoke names it: its provider and the subject Connect holds it under. */
export interface IntegrationGrantKey {
  readonly provider: IntegrationProvider;
  readonly connectSubject: string;
}

/**
 * Asks Connect to revoke one account's grant, where the deployment names
 * its provider's connector at all: a Disconnect asks it, and so does
 * deleting the account. A revoke that fails is logged by its word, code,
 * and status, never Connect's sentence, and answered as done, because
 * whoever asked has already deleted the account's row, so no agent reads a
 * token again whatever Connect answered.
 */
export const revokeIntegrationGrant = /* @__PURE__ */ Effect.fn("web/revokeIntegrationGrant")(
  function* ({
    provider,
    connectSubject,
  }: IntegrationGrantKey): Effect.fn.Return<void, never, IntegrationConnect> {
    const connector = (yield* IntegrationConnect)[provider];
    if (!connector.configured) return;
    yield* connector
      .revoke(connectSubject)
      .pipe(
        Effect.catch((failure) =>
          Effect.logWarning(
            `Vercel Connect could not revoke a ${INTEGRATION_NAME[provider]} grant`,
            failure.message,
          ),
        ),
      );
  },
);

/**
 * Asks Connect to revoke every grant the account may hold, which is what
 * deleting the account asks once its rows are gone: the first account's at
 * every provider this deployment names a connector for, under the
 * account's own user id, whether or not a row still named it, because a
 * sign-in cancelled after Connect took its grant, or a Disconnect whose
 * revoke failed, leaves a grant no row names; and every other account's
 * the rows named, under its own subject. Each is asked on the terms of
 * `revokeIntegrationGrant`, so none can fail it.
 */
export function revokeIntegrationGrants(
  userId: string,
  grants: readonly IntegrationGrantKey[],
): Effect.Effect<void, never, IntegrationConnect> {
  const firsts = INTEGRATION_PROVIDER_LIST.map((provider) => ({
    provider,
    connectSubject: userId,
  }));
  const others = grants.filter((grant) => grant.connectSubject !== userId);
  return Effect.forEach([...firsts, ...others], revokeIntegrationGrant, { discard: true });
}

/** An allowlist entry for every email at one domain: `@`, then a host name of at least two labels. */
const DOMAIN_ENTRY_PATTERN = /^@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** An allowlist entry for one email: a local part, `@`, then a domain as above. */
const EMAIL_ENTRY_PATTERN = /^[^@\s]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * The accounts an allowlist variable names: comma-separated entries, each
 * `@domain.com` for every email at that domain or one exact email, matched
 * without regard to case. Note that the list fails closed, because it is
 * what keeps an internal app from strangers: an unset variable names no
 * list, which offers the provider to every account, but one set to
 * nothing but blanks names an empty list, and an entry of neither shape
 * (a bare `@`, say, which every email ends in) is dropped rather than read
 * as matching anything.
 */
function allowedAccountsOf(value: string): AllowedAccounts {
  const entries = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
  return {
    domains: entries.filter((entry) => DOMAIN_ENTRY_PATTERN.test(entry)),
    emails: entries.filter((entry) => EMAIL_ENTRY_PATTERN.test(entry)),
  };
}

/** Whether a connector is one the account with this email may use: configured, and offered to it. */
function offeredTo(connector: ConnectorService, email: string | undefined): boolean {
  if (!connector.configured) return false;
  const allowed = connector.allowedAccounts;
  if (allowed === undefined) return true;
  if (email === undefined) return false;
  const address = email.trim().toLowerCase();
  return (
    allowed.emails.includes(address) || allowed.domains.some((domain) => address.endsWith(domain))
  );
}

/**
 * Every provider's connector as one account may use it: the deployment's
 * own where the provider is offered to the account, and the connector of a
 * provider the deployment names none for where it is not, so every route
 * and every agent answers a provider withheld from the account exactly as
 * it answers one this deployment never set up. The account's email is read
 * from its user row only when some provider names the accounts it is
 * offered to; an id no row holds is offered none of those.
 */
export const accountIntegrationConnect = /* @__PURE__ */ Effect.fn("web/accountIntegrationConnect")(
  function* (
    userId: string,
  ): Effect.fn.Return<
    IntegrationConnectService,
    QueryError | Schema.SchemaError,
    IntegrationConnect | DatabaseServices
  > {
    const connect = yield* IntegrationConnect;
    const restricted = INTEGRATION_PROVIDER_LIST.some(
      (provider) => connect[provider].allowedAccounts !== undefined,
    );
    if (!restricted) return connect;
    const email = (yield* readAccountPerson(userId))?.email;
    // SAFETY: one entry per provider of INTEGRATION_PROVIDER_LIST, which is every provider.
    return Object.fromEntries(
      INTEGRATION_PROVIDER_LIST.map((provider) => [
        provider,
        offeredTo(connect[provider], email) ? connect[provider] : UNCONFIGURED_CONNECTOR,
      ]),
    ) as IntegrationConnectService;
  },
);

/** The words that hold a provider to one account where its multiple-accounts variable is set. */
const SINGLE_ACCOUNT_WORDS: ReadonlySet<string> = new Set(["off", "false", "0"]);

/**
 * One provider's connector as this deployment's environment configures it:
 * the UID its variable names, the accounts its allowlist does, and whether
 * it offers more than one account, which a provider with a multiple-accounts
 * variable does unless that variable holds it to one.
 */
function connectorFromEnvironment(provider: IntegrationProvider) {
  const {
    CONNECTOR_VARIABLE,
    ALLOWED_ACCOUNTS_VARIABLE,
    MULTIPLE_ACCOUNTS_VARIABLE,
    ADD_ACCOUNT_PROMPT,
  }: IntegrationDefinition = INTEGRATION[provider];
  // A provider granted by the account's own sign-in has no connector to read.
  if (CONNECTOR_VARIABLE === undefined || ALLOWED_ACCOUNTS_VARIABLE === undefined) {
    return Effect.succeed(UNCONFIGURED_CONNECTOR);
  }
  return Effect.map(
    Config.all([
      Config.option(Config.String(CONNECTOR_VARIABLE)),
      Config.option(Config.String(ALLOWED_ACCOUNTS_VARIABLE)),
      MULTIPLE_ACCOUNTS_VARIABLE === undefined
        ? Config.succeed(Option.none<string>())
        : Config.option(Config.String(MULTIPLE_ACCOUNTS_VARIABLE)),
    ]),
    ([connectorRead, allowedRead, multipleRead]): ConnectorService => {
      const connector = text(Option.getOrUndefined(connectorRead));
      if (connector === undefined) return UNCONFIGURED_CONNECTOR;
      const multipleAccounts =
        MULTIPLE_ACCOUNTS_VARIABLE !== undefined &&
        !Option.exists(multipleRead, (word) => SINGLE_ACCOUNT_WORDS.has(word.trim().toLowerCase()));
      const configured: ConnectorService = {
        ...vercelConnector(connector),
        multipleAccounts,
        ...(ADD_ACCOUNT_PROMPT !== undefined
          ? { addAccountPrompt: ADD_ACCOUNT_PROMPT }
          : undefined),
      };
      return Option.match(allowedRead, {
        onNone: () => configured,
        onSome: (listed) => ({ ...configured, allowedAccounts: allowedAccountsOf(listed) }),
      });
    },
  );
}

/** Every provider's connector as this deployment's environment configures it. */
export const integrationConnectFromEnvironment: Layer.Layer<
  IntegrationConnect,
  Config.ConfigError
> = Layer.effect(
  IntegrationConnect,
  Effect.map(
    Effect.forEach(INTEGRATION_PROVIDER_LIST, (provider) =>
      Effect.map(connectorFromEnvironment(provider), (connector) => [provider, connector] as const),
    ),
    // SAFETY: the entries are one per provider of INTEGRATION_PROVIDER_LIST, which is every provider.
    (entries) => Object.fromEntries(entries) as IntegrationConnectService,
  ),
);

/**
 * The workspace Linear connector as this deployment's environment names it;
 * unset, no workspace connects Linear, and one connected before reads as
 * not connected.
 */
export const workspaceLinearConnectFromEnvironment: Layer.Layer<
  WorkspaceLinearConnect,
  Config.ConfigError
> = Layer.effect(
  WorkspaceLinearConnect,
  Effect.map(Config.option(Config.String(WORKSPACE_LINEAR_CONNECTOR_VARIABLE)), (read) => {
    const connector = text(Option.getOrUndefined(read));
    return connector === undefined ? UNCONFIGURED_CONNECTOR : vercelConnector(connector);
  }),
);
