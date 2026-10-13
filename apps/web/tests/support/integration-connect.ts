/**
 * integration-connect.ts -- Vercel Connect as a suite stands it up: one connector per provider, built by the suite.
 *
 * `IntegrationConnect` is a record over every provider, so a suite that
 * cares about one provider still hands the service all of them; this builds
 * the record from a function of the provider, so a provider added to the
 * vocabulary needs nothing here.
 */

import {
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@sidecar/hosted/integration-wire";
import { Effect, Layer } from "effect";
import {
  type ConnectorService,
  IntegrationConnect,
  type IntegrationConnectService,
} from "../../server/hosted/integration-connect.js";

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
  authorize: () => Effect.die(new Error("this suite asks Connect nothing")),
  token: () => Effect.die(new Error("this suite asks Connect nothing")),
  revoke: () => Effect.die(new Error("this suite asks Connect nothing")),
};
