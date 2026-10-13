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
 * itself; the one thing this deployment configures per provider is the
 * connector's UID, read from the variable `integrations.ts` names. A
 * provider whose variable is unset answers every ask as not configured, and
 * every agent still runs, only without that provider.
 */

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
import { Config, Context, Data, Effect, Layer, Option, Redacted } from "effect";
import { text } from "../core.js";
import { INTEGRATION } from "./integrations.js";

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
interface IntegrationToken {
  readonly token: Redacted.Redacted;
  /** When it stops being good, in milliseconds since the epoch. */
  readonly expiresAt: number;
}

/** What Luke asks of one provider's connector. */
export interface ConnectorService {
  /** Whether the deployment names this connector at all; a deployment without it never asks Connect anything. */
  readonly configured: boolean;
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

/** One provider's connector as this deployment's environment configures it: the UID its variable names, or none. */
function connectorFromEnvironment(provider: IntegrationProvider) {
  return Effect.map(
    Config.option(Config.String(INTEGRATION[provider].CONNECTOR_VARIABLE)),
    (read): ConnectorService => {
      const connector = text(Option.getOrUndefined(read));
      return connector === undefined ? UNCONFIGURED_CONNECTOR : vercelConnector(connector);
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
