import type {
  IntegrationAccountView,
  IntegrationConnectView,
  IntegrationProviderParams,
  IntegrationRenameParams,
  IntegrationStatusesView,
  IntegrationStatusView,
  IntegrationToolsView,
} from "@repo/features/integration-view";
import type { McpClientRevokeParams, McpClientsView } from "@repo/features/mcp-client-view";
import { Effect, MutableHashMap, Option, Stream } from "effect";
import { INTEGRATION_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

/**
 * integration-procedures.ts -- Settings' integration rows: the panel's asks of the host about the account's integrations.
 *
 * The one check these procedures make is who asked: only a panel draws
 * Settings, so every one refuses the takeover and any other window,
 * in its own sentence. What the service answers comes back as the panel's
 * own answer; a Connect answers whether the host sent the browser to sign
 * in, and the address it sent it to never crosses into a window. Nothing is
 * held here but the windows' holds on the outside MCP clients, one follow
 * of the host's for all of them, whose clients reach the panel on app state.
 */
export interface IntegrationProceduresDependencies {
  host: {
    integrationsStatus(): Effect.Effect<IntegrationStatusesView>;
    integrationsConnect(params: IntegrationProviderParams): Effect.Effect<IntegrationConnectView>;
    integrationsCancel(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
    integrationsDisconnect(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
    integrationsTools(params: IntegrationProviderParams): Effect.Effect<IntegrationToolsView>;
    integrationsRename(params: IntegrationRenameParams): Effect.Effect<IntegrationAccountView>;
    mcpClientsFollow(): Effect.Effect<void>;
    mcpClientsUnfollow(): Effect.Effect<void>;
    mcpClientsRetry(): Effect.Effect<void>;
    mcpClientsRevoke(params: McpClientRevokeParams): Effect.Effect<McpClientsView>;
  };
}

/** The refusal a window that draws no Settings hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function integrationProcedures(dependencies: IntegrationProceduresDependencies) {
  const { host } = dependencies;
  /** The windows' holds on the outside MCP clients, one follow of the host's for all of them. */
  const openClients: OpenFollows<never> = MutableHashMap.empty();
  return {
    [INTEGRATION_ACT_KIND.INTEGRATIONS_STATUS]: actPort[
      INTEGRATION_ACT_KIND.INTEGRATIONS_STATUS
    ].effect(function* ({ context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.integrationsStatus();
    }),
    [INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT]: actPort[
      INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.integrationsConnect(input);
    }),
    [INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS]: actPort[
      INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.integrationsTools(input);
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
      // Note that nothing is heard down the hold, since the held clients reach the panel on app state.
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
