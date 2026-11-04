/**
 * operator-client.ts -- the one operator a client is: the host's events written into the document, and the bootstrap every later decision is read from.
 */
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import type { GatewayHost, NodeRegistry } from "@repo/gateway";
import type { AppSettings } from "@repo/settings/wire";
import { Effect, Option, type Scope } from "effect";
import type { HostBootstrap, HostOperator } from "../host-operator.js";
import { type AppStateStore, bootstrapPatch } from "./app-state-store.js";
import { type GatewayWiringDependencies, wireGateway } from "./gateway-wiring.js";

export interface OperatorClient {
  /** Names this concern in a failure report and in the order the set starts and stops in. */
  readonly name: string;
  /** The host's own method vocabulary, as this client calls it. */
  readonly host: HostOperator;
  settings: () => AppSettings | undefined;
  /** The settings this launch decides its windows from, read from the host once and written down. */
  ensureSettings: () => Effect.Effect<AppSettings | undefined>;
  signedIn: () => boolean;
  /** One host bootstrap, adopted into the document every window is answered from. */
  readBootstrap: () => Effect.Effect<HostBootstrap | undefined>;
  /** Stops recording now, ahead of an action that ends the account it is filed under; the host's next replay event re-answers. */
  haltSessionReplay: () => void;
  resumeSessionReplay: () => void;
  /**
   * Reads the host's bootstrap into the document. An effect the composer runs
   * in the launch's own scope, never a promise this file built for itself.
   */
  start: () => Effect.Effect<void>;
  /** Gives back what `start` began: every subscription this client holds. */
  stop: () => Effect.Effect<void>;
}

export interface OperatorClientDependencies {
  report: (message: string) => void;
  /** The host this client operates. */
  gateway: GatewayHost;
  /** The host's node registry, where this process's native capabilities are offered. */
  nodes: NodeRegistry;
  node: GatewayWiringDependencies["node"];
  /** Everything the host says, written down once; the windows are told from it. */
  state: AppStateStore;
}

/**
 * The one operator this process is. It relays the host's events to the
 * windows that draw them, remembers what a synchronous answer needs, and
 * offers this machine's native capabilities as one node. The runtime itself
 * stands behind the host; nothing here composes a store or a brain.
 */
export const createOperatorClient = /* @__PURE__ */ Effect.fn("client/createOperatorClient")(
  function* (
    dependencies: OperatorClientDependencies,
  ): Effect.fn.Return<OperatorClient, never, Scope.Scope> {
    const { report, state } = dependencies;

    const unsubscribers: (() => void)[] = [];

    const gateway = yield* wireGateway({
      gateway: dependencies.gateway,
      nodes: dependencies.nodes,
      report,
      state,
      node: dependencies.node,
    });

    function adoptBootstrap(boot: HostBootstrap): void {
      state.update(bootstrapPatch(state.snapshot(), boot));
    }

    // Everything the host says is written to the document.
    unsubscribers.push(
      gateway.host.onSettingsChanged((change) => {
        state.update({ settings: change.settings });
      }),
      gateway.host.onAccountChanged((account) => {
        state.update({ account });
      }),
      gateway.host.onAccountAccessChanged((access) => {
        state.update({ access });
      }),
      gateway.host.onMacCommandAsksChanged((asks) => {
        state.update({ macCommands: { asks } });
      }),
      gateway.host.onOfflineRefusedChanged((offlineRefused) => {
        state.update({ network: { ...state.snapshot().network, offlineRefused } });
      }),
      gateway.host.onAgentOriginsChanged((held) => {
        state.update({ [LIVE_READ.AGENT_ORIGINS]: held });
      }),
      gateway.host.onInboxItemsChanged((read) => {
        state.update({ [LIVE_READ.INBOX_ITEMS]: read });
      }),
      gateway.host.onHolderInboxesChanged((held) => {
        state.update({ [LIVE_READ.HOLDER_INBOX]: held });
      }),
      gateway.host.onInstalledSkillsChanged((held) => {
        state.update({ [LIVE_READ.INSTALLED_SKILLS]: held });
      }),
      gateway.host.onIntegrationsChanged((held) => {
        state.update({ [LIVE_READ.INTEGRATIONS]: held });
      }),
      gateway.host.onIntegrationToolsChanged((held) => {
        state.update({ [LIVE_READ.INTEGRATION_TOOLS]: held });
      }),
      gateway.host.onLinkStandingsChanged((held) => {
        state.update({ [LIVE_READ.LINK_STANDINGS]: held });
      }),
      gateway.host.onMemoriesChanged((held) => {
        state.update({ [LIVE_READ.MEMORIES]: held });
      }),
      gateway.host.onPagesChanged((held) => {
        state.update({ [LIVE_READ.PAGES]: held });
      }),
      gateway.host.onProviderKeysChanged((held) => {
        state.update({ [LIVE_READ.PROVIDER_KEYS]: held });
      }),
      gateway.host.onRepositoryListsChanged((held) => {
        state.update({ [LIVE_READ.REPOSITORY_LISTS]: held });
      }),
      gateway.host.onGitHubTokenChanged((held) => {
        state.update({ [LIVE_READ.GITHUB_TOKEN]: held });
      }),
      gateway.host.onChaptersChanged((held) => {
        state.update({ [LIVE_READ.PULL_REQUEST_CHAPTERS]: held });
      }),
      gateway.host.onBrowserTabsChanged((held) => {
        state.update({ [LIVE_READ.BROWSER_TABS]: held });
      }),
      gateway.host.onPullRequestPartsChanged((held) => {
        state.update(held);
      }),
      gateway.host.onDevicePresenceChanged((held) => {
        state.update({ [LIVE_READ.DEVICE_PRESENCE]: held });
      }),
      gateway.host.onWorkspaceInvitationsChanged((held) => {
        state.update({ [LIVE_READ.WORKSPACE_INVITATIONS]: held });
      }),
      gateway.host.onThisMacHostChanged((held) => {
        state.update({ [LIVE_READ.THIS_MAC_HOST]: held });
      }),
      gateway.host.onWorkspaceMembersChanged((held) => {
        state.update({ [LIVE_READ.WORKSPACE_MEMBERS]: held });
      }),
      gateway.host.onTokenRepositoriesChanged((held) => {
        state.update({ [LIVE_READ.TOKEN_REPOSITORIES]: held });
      }),
      gateway.host.onWorkspacePhotosChanged((held) => {
        state.update({ [LIVE_READ.WORKSPACE_PHOTOS]: held });
      }),
      gateway.host.onWorkspaceToolsChanged((held) => {
        state.update({ [LIVE_READ.WORKSPACE_TOOLS]: held });
      }),
      gateway.host.onMcpClientsChanged((held) => {
        state.update({ [LIVE_READ.MCP_CLIENTS]: held });
      }),
      gateway.host.onAutomationsChanged((held) => {
        state.update(held);
      }),
      gateway.host.onPlanCommentsChanged((held) => {
        state.update({ [LIVE_READ.PLAN_COMMENTS]: held });
      }),
      gateway.host.onHistoriesChanged((held) => {
        state.update({ [LIVE_READ.HISTORY]: held });
      }),
      gateway.host.onPlanDocumentsChanged((held) => {
        state.update({ [LIVE_READ.PLAN_DOCUMENT]: held });
      }),
      // The host's own answer about recording stands the halt down: it is the
      // account transition the halt was waiting on.
      gateway.host.onSessionReplayChanged((replay) => {
        state.update({ sessionReplay: { ...replay, halted: false } });
      }),
    );

    function setSessionReplayHalted(halted: boolean): void {
      state.update({ sessionReplay: { ...state.snapshot().sessionReplay, halted } });
    }

    return {
      name: "operator",
      host: gateway.host,
      settings: () => state.snapshot().settings,
      ensureSettings: () =>
        Effect.gen(function* () {
          const held = state.snapshot().settings;
          if (held) return held;
          const settings = yield* gateway.host.settingsSnapshot();
          if (Option.isSome(settings)) state.update({ settings: settings.value });
          return Option.getOrUndefined(settings);
        }),
      signedIn: () => state.snapshot().account.status === ACCOUNT_STATUS.SIGNED_IN,
      readBootstrap: () =>
        Effect.gen(function* () {
          const boot = yield* gateway.host.bootstrap();
          if (Option.isSome(boot)) adoptBootstrap(boot.value);
          return Option.getOrUndefined(boot);
        }),
      haltSessionReplay: () => setSessionReplayHalted(true),
      resumeSessionReplay: () => setSessionReplayHalted(false),
      /** The one bootstrap the launch reads: a host composed in this process is attached once and never goes away. */
      start: () =>
        Effect.gen(function* () {
          const boot = yield* gateway.host.bootstrap();
          if (Option.isNone(boot))
            return yield* Effect.die(new Error("the host answered no bootstrap"));
          adoptBootstrap(boot.value);
        }),
      stop: () =>
        Effect.sync(() => {
          while (unsubscribers.length > 0) unsubscribers.pop()?.();
        }),
    };
  },
);
