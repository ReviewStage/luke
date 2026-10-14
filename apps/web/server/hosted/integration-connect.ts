/**
 * integration-connect.ts -- Vercel Connect, as Luke asks it about one account's grant at one provider.
 *
 * Vercel Connect holds every account's grant at every provider, encrypted,
 * and refreshes it; Luke names the account by its own user id as the
 * grant's subject and never stores a token. Three things are ever asked of
 * a provider's connector: a browser sign-in for the account to begin, the
 * account's token now, and the grant revoked. Each answers either what was
 * asked or one of three fixed words, never Connect's own message: an error's
 * message is Connect's or the provider's words, which nothing here can vouch
 * for holding no credential, so what a failure keeps is its word and, where
 * it carries them, Connect's machine code and status.
 *
 * Asking Connect for another user's token needs the deployment's own Vercel
 * OIDC token, which the SDK reads from the request or the environment
 * itself; what this deployment configures per provider is the connector's
 * UID and, where it names any, the accounts the provider is offered to,
 * each read from the variable `integrations.ts` names. A provider whose
 * connector variable is unset answers every ask as not configured, and
 * every agent still runs, only without that provider; a provider withheld
 * from an account answers that account the same way
 * (`accountIntegrationConnect`).
 */

import type { DatabaseServices, QueryError } from "@sidecar/database/core/query";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@sidecar/hosted/integration-wire";
import {
  ConnectError,
  ConnectorInstallationRequiredError,
  getTokenResponse,
  NoValidTokenError,
  revokeToken,
  startAuthorization,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
import { Config, Context, Data, Effect, Layer, Option, Redacted, type Schema } from "effect";
import { text } from "../core.js";
import { readAccountPerson } from "./account-person.js";
import { INTEGRATION, type IntegrationDefinition } from "./integrations.js";

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
}

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
  /** Begins a browser sign-in for the account, which Connect returns to `callbackUrl`; answers the address the browser opens. */
  readonly authorize: (
    userId: string,
    callbackUrl: string,
  ) => Effect.Effect<string, IntegrationConnectFailure>;
  /** The account's token now; `fresh` asks Connect itself rather than the SDK's in-process cache. */
  readonly token: (
    userId: string,
    options: { readonly fresh: boolean },
  ) => Effect.Effect<IntegrationToken, IntegrationConnectFailure>;
  /** Revokes the account's grant at Connect, which revokes it at the provider where the provider allows it. */
  readonly revoke: (userId: string) => Effect.Effect<void, IntegrationConnectFailure>;
}

/** Every provider's connector, configured or not. */
export type IntegrationConnectService = Readonly<Record<IntegrationProvider, ConnectorService>>;

export class IntegrationConnect extends Context.Service<
  IntegrationConnect,
  IntegrationConnectService
>()("IntegrationConnect") {}

/** The subject every ask names: Luke's own user id, so a grant is the account's whatever principal a session runs under. */
function subjectOf(userId: string) {
  return { subject: { type: "user", id: userId } } as const;
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
  authorize: () => Effect.fail(NOT_CONFIGURED),
  token: () => Effect.fail(NOT_CONFIGURED),
  revoke: () => Effect.fail(NOT_CONFIGURED),
};

/** The three calls of Vercel Connect's SDK a connector makes, which a test hands a fake Connect for. */
export interface ConnectSdk {
  readonly startAuthorization: typeof startAuthorization;
  readonly getTokenResponse: typeof getTokenResponse;
  readonly revokeToken: typeof revokeToken;
}

const VERCEL_CONNECT_SDK: ConnectSdk = { startAuthorization, getTokenResponse, revokeToken };

/** One connector, asking Vercel Connect itself, or the SDK a test hands it. */
export function vercelConnector(
  connector: string,
  sdk: ConnectSdk = VERCEL_CONNECT_SDK,
): ConnectorService {
  return {
    configured: true,
    authorize: (userId, callbackUrl) =>
      Effect.tryPromise({
        try: () => sdk.startAuthorization(connector, subjectOf(userId), { callbackUrl }),
        catch: failureOf,
      }).pipe(
        Effect.flatMap(({ url }) =>
          isBrowserAddress(url)
            ? Effect.succeed(url)
            : Effect.fail(
                new IntegrationConnectFailure({ reason: INTEGRATION_CONNECT_FAILURE.UNAVAILABLE }),
              ),
        ),
      ),
    token: (userId, { fresh }) =>
      Effect.tryPromise({
        try: () => sdk.getTokenResponse(connector, subjectOf(userId), { forceRefresh: fresh }),
        catch: failureOf,
      }).pipe(
        Effect.map((response) => ({
          token: Redacted.make(response.token),
          expiresAt: response.expiresAt,
        })),
      ),
    revoke: (userId) =>
      Effect.tryPromise({
        try: () => sdk.revokeToken(connector, subjectOf(userId)),
        catch: failureOf,
      }),
  };
}

/**
 * Asks Connect to revoke the account's grant at one provider, where the
 * deployment names its connector at all: a Disconnect asks it, and so does
 * deleting the account. A revoke that fails is logged by its word, code,
 * and status, never Connect's sentence, and answered as done, because
 * whoever asked has already deleted the account's row, so no agent reads a
 * token again whatever Connect answered.
 */
export const revokeIntegrationGrant = /* @__PURE__ */ Effect.fn("web/revokeIntegrationGrant")(
  function* (
    userId: string,
    provider: IntegrationProvider,
  ): Effect.fn.Return<void, never, IntegrationConnect> {
    const connector = (yield* IntegrationConnect)[provider];
    if (!connector.configured) return;
    yield* connector
      .revoke(userId)
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
 * Asks Connect to revoke the account's grant at every provider this
 * deployment names a connector for, which is what deleting the account
 * asks: each on the terms of `revokeIntegrationGrant`, so none can fail it.
 */
export function revokeIntegrationGrants(
  userId: string,
): Effect.Effect<void, never, IntegrationConnect> {
  return Effect.forEach(
    INTEGRATION_PROVIDER_LIST,
    (provider) => revokeIntegrationGrant(userId, provider),
    { discard: true },
  );
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

/** One provider's connector as this deployment's environment configures it: the UID its variable names and the accounts its allowlist does, or none. */
function connectorFromEnvironment(provider: IntegrationProvider) {
  const { CONNECTOR_VARIABLE, ALLOWED_ACCOUNTS_VARIABLE }: IntegrationDefinition =
    INTEGRATION[provider];
  // A provider granted by the account's own sign-in has no connector to read.
  if (CONNECTOR_VARIABLE === undefined || ALLOWED_ACCOUNTS_VARIABLE === undefined) {
    return Effect.succeed(UNCONFIGURED_CONNECTOR);
  }
  return Effect.map(
    Config.all([
      Config.option(Config.String(CONNECTOR_VARIABLE)),
      Config.option(Config.String(ALLOWED_ACCOUNTS_VARIABLE)),
    ]),
    ([connectorRead, allowedRead]): ConnectorService => {
      const connector = text(Option.getOrUndefined(connectorRead));
      if (connector === undefined) return UNCONFIGURED_CONNECTOR;
      const configured = vercelConnector(connector);
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
