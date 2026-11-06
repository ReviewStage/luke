import type {
  IntegrationAccountView,
  IntegrationConnectView,
  IntegrationProviderParams,
  IntegrationRenameParams,
  IntegrationStatusView,
} from "@repo/features/integration-view";
import type { McpClientRevokeParams, McpClientsView } from "@repo/features/mcp-client-view";
import { Effect, MutableHashMap, Option, Stream } from "effect";
import { INTEGRATION_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

export interface IntegrationProceduresDependencies {
  host: {
    integrationsFollow(): Effect.Effect<void>;
    integrationsUnfollow(): Effect.Effect<void>;
    integrationsRetry(): Effect.Effect<void>;
    integrationsConnect(params: IntegrationProviderParams): Effect.Effect<IntegrationConnectView>;
    integrationsCancel(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
    integrationsDisconnect(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
    integrationsToolsFollow(params: IntegrationProviderParams): Effect.Effect<void>;
    integrationsToolsUnfollow(params: IntegrationProviderParams): Effect.Effect<void>;
    integrationsToolsRetry(params: IntegrationProviderParams): Effect.Effect<void>;
    integrationsRename(params: IntegrationRenameParams): Effect.Effect<IntegrationAccountView>;
    mcpClientsFollow(): Effect.Effect<void>;
    mcpClientsUnfollow(): Effect.Effect<void>;
    mcpClientsRetry(): Effect.Effect<void>;
    mcpClientsRevoke(params: McpClientRevokeParams): Effect.Effect<McpClientsView>;
  };
}

function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function integrationProcedures(dependencies: IntegrationProceduresDependencies) {
  const { host } = dependencies;
  const openHolds: OpenFollows<never> = MutableHashMap.empty();
  const openTools: OpenFollows<never> = MutableHashMap.empty();
  const openClients: OpenFollows<never> = MutableHashMap.empty();
  return {
    [INTEGRATION_ACT_KIND.INTEGRATIONS_FOLLOW]: actPort[
      INTEGRATION_ACT_KIND.INTEGRATIONS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: () => "integrations",
          follow: () => host.integrationsFollow(),
          unfollow: () => host.integrationsUnfollow(),
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
        },
        openHolds,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [INTEGRATION_ACT_KIND.INTEGRATIONS_RETRY]: actPort[
      INTEGRATION_ACT_KIND.INTEGRATIONS_RETRY
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.integrationsRetry();
    }),
    [INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT]: actPort[
      INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.integrationsConnect(input);
    }),
    [INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS_FOLLOW]: actPort[
      INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: (server: IntegrationProviderParams) => server.connection ?? server.provider,
          follow: host.integrationsToolsFollow,
          unfollow: host.integrationsToolsUnfollow,
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
        },
        openTools,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS_RETRY]: actPort[
      INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS_RETRY
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.integrationsToolsRetry(input);
    }),
    [INTEGRATION_ACT_KIND.INTEGRATIONS_CANCEL]: actPort[
      INTEGRATION_ACT_KIND.INTEGRATIONS_CANCEL
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.integrationsCancel(input);
    }),
    [INTEGRATION_ACT_KIND.INTEGRATIONS_DISCONNECT]: actPort[
      INTEGRATION_ACT_KIND.INTEGRATIONS_DISCONNECT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.integrationsDisconnect(input);
    }),
    [INTEGRATION_ACT_KIND.INTEGRATIONS_RENAME]: actPort[
      INTEGRATION_ACT_KIND.INTEGRATIONS_RENAME
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.integrationsRename(input);
    }),
    [INTEGRATION_ACT_KIND.MCP_CLIENTS_FOLLOW]: actPort[
      INTEGRATION_ACT_KIND.MCP_CLIENTS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const hold = followedStream(
        {
          keyOf: () => "mcpClients",
          follow: () => host.mcpClientsFollow(),
          unfollow: () => host.mcpClientsUnfollow(),
          onChanged: () => () => undefined,
          valueOf: () => Option.none<never>(),
        },
        openClients,
        input,
      );
      return streamed(yield* Stream.toAsyncIterableEffect(hold));
    }),
    [INTEGRATION_ACT_KIND.MCP_CLIENTS_RETRY]: actPort[
      INTEGRATION_ACT_KIND.MCP_CLIENTS_RETRY
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.mcpClientsRetry();
    }),
    [INTEGRATION_ACT_KIND.MCP_CLIENTS_REVOKE]: actPort[
      INTEGRATION_ACT_KIND.MCP_CLIENTS_REVOKE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.mcpClientsRevoke(input);
    }),
  };
}
