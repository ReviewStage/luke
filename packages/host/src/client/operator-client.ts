import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import type { GatewayHost, NodeRegistry } from "@repo/gateway";
import type { AppSettings } from "@repo/settings/wire";
import { Effect, Option, type Scope } from "effect";
import type { HostBootstrap, HostOperator } from "../host-operator.js";
import { type AppStateStore, bootstrapPatch } from "./app-state-store.js";
import { type GatewayWiringDependencies, wireGateway } from "./gateway-wiring.js";

export interface OperatorClient {
  readonly name: string;
  readonly host: HostOperator;
  settings: () => AppSettings | undefined;
  ensureSettings: () => Effect.Effect<AppSettings | undefined>;
  signedIn: () => boolean;
  readBootstrap: () => Effect.Effect<HostBootstrap | undefined>;
  haltSessionReplay: () => void;
  resumeSessionReplay: () => void;
  start: () => Effect.Effect<void>;
  stop: () => Effect.Effect<void>;
}

export interface OperatorClientDependencies {
  report: (message: string) => void;
  gateway: GatewayHost;
  nodes: NodeRegistry;
  node: GatewayWiringDependencies["node"];
  state: AppStateStore;
}

export const createOperatorClient = Effect.fn("client/createOperatorClient")(function* (
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
    gateway.host.onAccountPreferencesChanged((held) => {
      state.update({ [LIVE_READ.ACCOUNT_PREFERENCES]: held });
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
    gateway.host.onModelsChanged((held) => {
      state.update({ [LIVE_READ.MODELS]: held });
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
    gateway.host.onHostsChanged((held) => {
      state.update({ [LIVE_READ.HOSTS]: held });
    }),
    gateway.host.onWorkspaceInvitationsChanged((held) => {
      state.update({ [LIVE_READ.WORKSPACE_INVITATIONS]: held });
    }),
    gateway.host.onThisMacHostChanged((held) => {
      state.update({ [LIVE_READ.THIS_MAC_HOST]: held });
    }),
    gateway.host.onTranscriptsChanged((held) => {
      state.update({ [LIVE_READ.TRANSCRIPT]: held });
    }),
    gateway.host.onWorkspaceMembersChanged((held) => {
      state.update({ [LIVE_READ.WORKSPACE_MEMBERS]: held });
    }),
    gateway.host.onWorkspaceIntegrationsChanged((held) => {
      state.update({ [LIVE_READ.WORKSPACE_INTEGRATIONS]: held });
    }),
    gateway.host.onSlackChannelsChanged((held) => {
      state.update({ [LIVE_READ.SLACK_CHANNELS]: held });
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
    gateway.host.onDescriptionCommentsChanged((held) => {
      state.update({ [LIVE_READ.DESCRIPTION_COMMENTS]: held });
    }),
    gateway.host.onHistoriesChanged((held) => {
      state.update({ [LIVE_READ.HISTORY]: held });
    }),
    gateway.host.onDescriptionDocumentsChanged((held) => {
      state.update({ [LIVE_READ.DESCRIPTION_DOCUMENT]: held });
    }),
    gateway.host.onPortForwardingChanged((portForwarding) => {
      state.update({ portForwarding });
    }),
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
});
