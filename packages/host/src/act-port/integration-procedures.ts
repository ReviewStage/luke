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

/**
 * integration-procedures.ts -- Settings' integration rows: the panel's asks of the host about the account's integrations.
 *
 * The one check these procedures make is who asked: only a panel draws
 * Settings, so every one refuses the takeover and any other window,
 * in its own sentence. What the service answers comes back as the panel's
 * own answer; a Connect answers whether the host sent the browser to sign
 * in, and the address it sent it to never crosses into a window. Where the
 * integrations stand, each server's tools, and the outside MCP clients the
 * account allowed are held at the host while a panel holds their stream
 * open, and what it holds reaches every panel on app state, never down the
 * stream; how many streams stand open of each is all that is held here.
 */
export interface IntegrationProceduresDependencies {
  host: {
    /** Where the account's integrations stand, held at the host while any stream of it stands; what it holds reaches the panel on app state. */
    integrationsFollow(): Effect.Effect<void>;
    integrationsUnfollow(): Effect.Effect<void>;
    /** The held integrations read again at once, as Try again asks. */
    integrationsRetry(): Effect.Effect<void>;
    integrationsConnect(params: IntegrationProviderParams): Effect.Effect<IntegrationConnectView>;
    integrationsCancel(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
    integrationsDisconnect(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
    /** One server's tools held at the host while any stream of them stands; what it holds reaches the panel on app state. */
    integrationsToolsFollow(params: IntegrationProviderParams): Effect.Effect<void>;
    integrationsToolsUnfollow(params: IntegrationProviderParams): Effect.Effect<void>;
    /** One server's held tools asked again at once, as Try again asks; done once the ask has landed. */
    integrationsToolsRetry(params: IntegrationProviderParams): Effect.Effect<void>;
    integrationsRename(params: IntegrationRenameParams): Effect.Effect<IntegrationAccountView>;
    /** The outside MCP clients held at the host while any stream of them stands; what it holds reaches the panel on app state. */
    mcpClientsFollow(): Effect.Effect<void>;
    mcpClientsUnfollow(): Effect.Effect<void>;
    /** The held outside MCP clients asked again at once, as Try again asks; done once the ask has landed. */
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
  /** The account's integrations while a window holds a stream open of them, so the host lets them go only with the last. */
  const openHolds: OpenFollows<never> = MutableHashMap.empty();
  /** Every server's tools a window holds a stream open of, by the server's name, so the host lets them go only with the last. */
  const openTools: OpenFollows<never> = MutableHashMap.empty();
  /** The windows' streams on the outside MCP clients, so the host lets them go only with the last. */
  const openClients: OpenFollows<never> = MutableHashMap.empty();
  return {
    [INTEGRATION_ACT_KIND.INTEGRATIONS_FOLLOW]: actPort[
      INTEGRATION_ACT_KIND.INTEGRATIONS_FOLLOW
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      // Note that nothing is heard down the hold, since the held integrations reach the panel on app state.
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
      // Note that nothing is heard down the hold, since the held tools reach the panel on app state.
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
