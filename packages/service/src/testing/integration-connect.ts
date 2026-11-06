import {
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@repo/features/integration-wire";
import { type Config, ConfigProvider, Effect, Layer, Redacted } from "effect";
import {
  type ConnectorService,
  INTEGRATION_CONNECT_FAILURE,
  IntegrationConnect,
  IntegrationConnectFailure,
  type IntegrationConnectService,
  integrationConnectFromEnvironment,
} from "../integrations/integration-connect.js";
import type { IntegrationAccountKey } from "../integrations/integration-store.js";

export function firstIntegrationAccount(
  userId: string,
  provider: IntegrationProvider,
): IntegrationAccountKey {
  return { provider, connectionName: provider, connectSubject: userId };
}

export function integrationConnectOf(
  connectorOf: (provider: IntegrationProvider) => ConnectorService,
): Layer.Layer<IntegrationConnect> {
  const service = Object.fromEntries(
    INTEGRATION_PROVIDER_LIST.map((provider) => [provider, connectorOf(provider)]),
  ) as IntegrationConnectService;
  return Layer.succeed(IntegrationConnect, service);
}

export const CONNECTOR_ASKED_NOTHING: ConnectorService = {
  configured: true,
  multipleAccounts: false,
  authorize: () => Effect.die(new Error("this suite asks Connect nothing")),
  token: () => Effect.die(new Error("this suite asks Connect nothing")),
  revoke: () => Effect.die(new Error("this suite asks Connect nothing")),
  evict: () => Effect.void,
};

export const GRANTING_SIGN_IN_URL = "https://vercel.com/connect/authorize/fixture";

const NOT_AUTHORIZED = new IntegrationConnectFailure({
  reason: INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED,
});

export function integrationConnectOver(
  variables: Readonly<Record<string, string>>,
  {
    declines = false,
    names = () => undefined,
    grantsOnce = false,
  }: {
    readonly declines?: boolean;
    readonly names?: (subject: string) => string | undefined;
    readonly grantsOnce?: boolean;
  } = {},
): Layer.Layer<IntegrationConnect, Config.ConfigError> {
  let issued = 0;
  const granting = (connector: ConnectorService): ConnectorService =>
    connector.configured
      ? {
          ...connector,
          authorize: () => Effect.succeed({ url: GRANTING_SIGN_IN_URL }),
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
        }
      : connector;
  const providers = Effect.gen(function* () {
    const deployment = yield* IntegrationConnect;
    return Object.fromEntries(
      INTEGRATION_PROVIDER_LIST.map((provider) => [provider, granting(deployment[provider])]),
    ) as IntegrationConnectService;
  });
  return Layer.effect(IntegrationConnect, providers).pipe(
    Layer.provide(integrationConnectFromEnvironment),
    Layer.provide(
      Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord(variables)),
    ),
  );
}
