/**
 * integration-connect.ts -- Vercel Connect as a suite stands it up: one connector per provider, built by the suite.
 *
 * `IntegrationConnect` is a record over every provider, so a suite that
 * cares about one provider still hands the service all of them; this builds
 * the record from a function of the provider, so a provider added to the
 * vocabulary needs nothing here. `integrationConnectOver` builds it instead
 * from a deployment's variables, through the production read, so a suite
 * holds the connectors and allowlists exactly as that environment configures
 * them, each asking a Connect that holds every account's grant.
 */

import {
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@luke/features/integration-wire";
import { type Config, ConfigProvider, Effect, Layer, Redacted } from "effect";
import {
  CONNECT_SIGN_IN_RESULT,
  type ConnectorService,
  type ConnectSignInResult,
  INTEGRATION_CONNECT_FAILURE,
  IntegrationConnect,
  IntegrationConnectFailure,
  type IntegrationConnectService,
  integrationConnectFromEnvironment,
} from "../integrations/integration-connect.js";
import type { IntegrationAccountKey } from "../integrations/integration-store.js";

/** The first account a Luke account holds at a provider, as its first sign-in begins it: named after the provider, under the account's own user id. */
export function firstIntegrationAccount(
  userId: string,
  provider: IntegrationProvider,
): IntegrationAccountKey {
  return { provider, connectionName: provider, connectSubject: userId };
}

/** Every provider's connector, as the suite builds each one. */
export function integrationConnectOf(
  connectorOf: (provider: IntegrationProvider) => ConnectorService,
): Layer.Layer<IntegrationConnect> {
  // SAFETY: one entry per provider of INTEGRATION_PROVIDER_LIST, which is every provider.
  const service = Object.fromEntries(
    INTEGRATION_PROVIDER_LIST.map((provider) => [provider, connectorOf(provider)]),
  ) as IntegrationConnectService;
  return Layer.succeed(IntegrationConnect, service);
}

/** A connector a suite that asks Connect nothing stands up: every ask is a defect. */
export const CONNECTOR_ASKED_NOTHING: ConnectorService = {
  configured: true,
  multipleAccounts: false,
  authorize: () => Effect.die(new Error("this suite asks Connect nothing")),
  signInResult: () => Effect.die(new Error("this suite asks Connect nothing")),
  token: () => Effect.die(new Error("this suite asks Connect nothing")),
  revoke: () => Effect.die(new Error("this suite asks Connect nothing")),
};

/** A sign-in address as the granting Connect below answers one. */
export const GRANTING_SIGN_IN_URL = "https://vercel.com/connect/authorize/fixture";

/** The handle the granting Connect below answers every sign-in with. */
export const GRANTING_SIGN_IN_VERIFIER = "connect-verifier-fixture";

/** A Connect that holds no account's grant, as one answers a sign-in the developer declined or never finished. */
const NOT_AUTHORIZED = new IntegrationConnectFailure({
  reason: INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED,
});

/**
 * Every provider's connector as a deployment with these variables
 * configures it, read by the production layer: a provider whose connector
 * variable is set keeps the accounts its allowlist names, and asks a Connect
 * that begins every sign-in, issues every account a token, and revokes
 * anything, or, where it `declines`, holds no grant at all; one unset stays
 * unconfigured. Asked how a sign-in it began stands, it answers `ends` of
 * the handle it began it with, and under way otherwise. Each token it
 * issues carries the account's name at the provider where `names` gives one
 * for its subject, as a grant's fields carry a workspace's name; where it
 * `grantsOnce`, every token read after the first refuses, as a grant revoked
 * at the provider meanwhile would.
 */
export function integrationConnectOver(
  variables: Readonly<Record<string, string>>,
  {
    declines = false,
    ends = { kind: CONNECT_SIGN_IN_RESULT.PENDING },
    names = () => undefined,
    grantsOnce = false,
  }: {
    readonly declines?: boolean;
    readonly ends?: ConnectSignInResult;
    readonly names?: (subject: string) => string | undefined;
    readonly grantsOnce?: boolean;
  } = {},
): Layer.Layer<IntegrationConnect, Config.ConfigError> {
  // How many tokens the granting Connect below has issued, which `grantsOnce` refuses past the first.
  let issued = 0;
  const granting = Effect.gen(function* () {
    const deployment = yield* IntegrationConnect;
    // SAFETY: one entry per provider of INTEGRATION_PROVIDER_LIST, which is every provider.
    return Object.fromEntries(
      INTEGRATION_PROVIDER_LIST.map((provider): [IntegrationProvider, ConnectorService] => {
        const connector = deployment[provider];
        if (!connector.configured) return [provider, connector];
        return [
          provider,
          {
            ...connector,
            authorize: () =>
              Effect.succeed({
                url: GRANTING_SIGN_IN_URL,
                verifier: Redacted.make(GRANTING_SIGN_IN_VERIFIER),
              }),
            signInResult: (verifier) =>
              Effect.succeed(
                Redacted.value(verifier) === GRANTING_SIGN_IN_VERIFIER
                  ? ends
                  : { kind: CONNECT_SIGN_IN_RESULT.PENDING },
              ),
            token: (subject) => {
              if (declines || (grantsOnce && issued > 0)) return Effect.fail(NOT_AUTHORIZED);
              issued += 1;
              const accountName = names(subject);
              return Effect.succeed({
                token: Redacted.make(`token_${subject}`),
                expiresAt: Infinity,
                ...(accountName !== undefined ? { accountName } : undefined),
              });
            },
            revoke: () => Effect.void,
          },
        ];
      }),
    ) as IntegrationConnectService;
  });
  return Layer.effect(IntegrationConnect, granting).pipe(
    Layer.provide(integrationConnectFromEnvironment),
    Layer.provide(
      Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord(variables)),
    ),
  );
}
