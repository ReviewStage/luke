import type {
  IntegrationAccountView,
  IntegrationConnectView,
  IntegrationProviderParams,
  IntegrationRenameParams,
  IntegrationStatusesView,
  IntegrationStatusView,
} from "@repo/features/integration-view";
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
 * in, and the address it sent it to never crosses into a window. A
 * server's tools are held at the host while a panel holds their stream open,
 * and what it holds reaches every panel on app state, never down the stream;
 * how many streams stand open of each is all that is held here.
 */
export interface IntegrationProceduresDependencies {
  host: {
    integrationsStatus(): Effect.Effect<IntegrationStatusesView>;
    integrationsConnect(params: IntegrationProviderParams): Effect.Effect<IntegrationConnectView>;
    integrationsCancel(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
    integrationsDisconnect(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
    /** One server's tools held at the host while any stream of them stands; what it holds reaches the panel on app state. */
    integrationsToolsFollow(params: IntegrationProviderParams): Effect.Effect<void>;
    integrationsToolsUnfollow(params: IntegrationProviderParams): Effect.Effect<void>;
    /** One server's held tools asked again at once, as Try again asks; done once the ask has landed. */
    integrationsToolsRetry(params: IntegrationProviderParams): Effect.Effect<void>;
    integrationsRename(params: IntegrationRenameParams): Effect.Effect<IntegrationAccountView>;
  };
}

/** The refusal a window that draws no Settings hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function integrationProcedures(dependencies: IntegrationProceduresDependencies) {
  const { host } = dependencies;
  /** Every server's tools a window holds a stream open of, by the server's name, so the host lets them go only with the last. */
  const openTools: OpenFollows<never> = MutableHashMap.empty();
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
  };
}
