import type { DatabaseServices, QueryError } from "@repo/database/core/query";
import {
  INTEGRATION_LABEL_MAX,
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@repo/features/integration-wire";
import {
  ConnectError,
  ConnectorInstallationRequiredError,
  type ConnectTokenResponse,
  deleteTokenCacheEntry,
  getTokenResponse,
  NoValidTokenError,
  revokeToken,
  startAuthorization,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
import { Config, Context, Data, Effect, Layer, Option, Redacted, Schema } from "effect";
import { readAccountPerson } from "../accounts/account-person.js";
import { text } from "../core.js";
import { INTEGRATION, type IntegrationDefinition } from "./integrations.js";
import { credentialFreeLine, namesSecret } from "./mcp-tools.js";

export const INTEGRATION_CONNECT_FAILURE = {
  NOT_CONFIGURED: "not-configured",
  NOT_AUTHORIZED: "not-authorized",
  UNAVAILABLE: "unavailable",
} as const;

export type IntegrationConnectFailureReason =
  (typeof INTEGRATION_CONNECT_FAILURE)[keyof typeof INTEGRATION_CONNECT_FAILURE];

const CONNECT_CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,62}$/;

export class IntegrationConnectFailure extends Data.TaggedError("IntegrationConnectFailure")<{
  readonly reason: IntegrationConnectFailureReason;
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

export interface IntegrationToken {
  readonly token: Redacted.Redacted;
  readonly expiresAt: number;
  readonly accountName?: string;
}

interface IntegrationAuthorization {
  readonly url: string;
}

interface AllowedAccounts {
  readonly domains: readonly string[];
  readonly emails: readonly string[];
}

export interface ConnectorService {
  readonly configured: boolean;
  readonly allowedAccounts?: AllowedAccounts;
  readonly multipleAccounts: boolean;
  readonly addAccountPrompt?: string;
  readonly authorize: (
    subject: string,
    callbackUrl: string,
    options?: { readonly prompt?: string },
  ) => Effect.Effect<IntegrationAuthorization, IntegrationConnectFailure>;
  readonly token: (
    subject: string,
    options: { readonly fresh: boolean },
  ) => Effect.Effect<IntegrationToken, IntegrationConnectFailure>;
  readonly revoke: (subject: string) => Effect.Effect<void, IntegrationConnectFailure>;
  readonly evict: (subject: string) => Effect.Effect<void>;
}

export type IntegrationConnectService = Readonly<Record<IntegrationProvider, ConnectorService>>;

export class IntegrationConnect extends Context.Service<
  IntegrationConnect,
  IntegrationConnectService
>()("IntegrationConnect") {}

function subjectOf(subject: string) {
  return { subject: { type: "user", id: subject } } as const;
}

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

const UNCONFIGURED_CONNECTOR: ConnectorService = {
  configured: false,
  multipleAccounts: false,
  authorize: () => Effect.fail(NOT_CONFIGURED),
  token: () => Effect.fail(NOT_CONFIGURED),
  revoke: () => Effect.fail(NOT_CONFIGURED),
  evict: () => Effect.void,
};

export interface ConnectSdk {
  readonly startAuthorization: typeof startAuthorization;
  readonly getTokenResponse: typeof getTokenResponse;
  readonly revokeToken: typeof revokeToken;
  readonly deleteTokenCacheEntry: typeof deleteTokenCacheEntry;
}

const VERCEL_CONNECT_SDK: ConnectSdk = {
  startAuthorization,
  getTokenResponse,
  revokeToken,
  deleteTokenCacheEntry,
};

const ACCOUNT_NAME_MAX = INTEGRATION_LABEL_MAX;

const ACCOUNT_EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export function accountNameLine(candidate: string): string | undefined {
  const name = candidate.trim();
  const line =
    ACCOUNT_EMAIL_PATTERN.test(name) && !namesSecret(name) ? name : credentialFreeLine(name);
  return line === undefined || line.length > ACCOUNT_NAME_MAX ? undefined : line;
}

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

function grantAccountName(response: ConnectTokenResponse): string | undefined {
  const candidates = [
    ...GRANT_NAME_READS.flatMap((read) => Option.toArray(read(response))),
    ...(response.name !== undefined ? [response.name] : []),
  ];
  for (const candidate of candidates) {
    const line = accountNameLine(candidate);
    if (line === undefined) continue;
    if (line === response.connector.uid || line === response.connector.id) continue;
    return line;
  }
  return undefined;
}

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
        Effect.flatMap(({ url }) =>
          isBrowserAddress(url)
            ? Effect.succeed({ url })
            : Effect.fail(
                new IntegrationConnectFailure({ reason: INTEGRATION_CONNECT_FAILURE.UNAVAILABLE }),
              ),
        ),
      ),
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
    evict: (subject) => Effect.sync(() => sdk.deleteTokenCacheEntry(connector, subjectOf(subject))),
  };
}

export interface IntegrationGrantKey {
  readonly provider: IntegrationProvider;
  readonly connectSubject: string;
}

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

const DOMAIN_ENTRY_PATTERN = /^@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const EMAIL_ENTRY_PATTERN = /^[^@\s]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

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
    return Object.fromEntries(
      INTEGRATION_PROVIDER_LIST.map((provider) => [
        provider,
        offeredTo(connect[provider], email) ? connect[provider] : UNCONFIGURED_CONNECTOR,
      ]),
    ) as IntegrationConnectService;
  },
);

const SINGLE_ACCOUNT_WORDS: ReadonlySet<string> = new Set(["off", "false", "0"]);

function connectorFromEnvironment(provider: IntegrationProvider) {
  const {
    CONNECTOR_VARIABLE,
    ALLOWED_ACCOUNTS_VARIABLE,
    MULTIPLE_ACCOUNTS_VARIABLE,
    ADD_ACCOUNT_PROMPT,
  }: IntegrationDefinition = INTEGRATION[provider];
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

export const integrationConnectFromEnvironment: Layer.Layer<
  IntegrationConnect,
  Config.ConfigError
> = Layer.effect(
  IntegrationConnect,
  Effect.map(
    Effect.forEach(INTEGRATION_PROVIDER_LIST, (provider) =>
      Effect.map(connectorFromEnvironment(provider), (connector) => [provider, connector] as const),
    ),
    (entries) => Object.fromEntries(entries) as IntegrationConnectService,
  ),
);
