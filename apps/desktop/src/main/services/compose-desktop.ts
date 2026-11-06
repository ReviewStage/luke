import { CLI_RELEASE } from "@repo/features/cli-release";
import { workingAgentCount } from "@repo/features/tasks-view";
import { AgentNoticeDoors, type AgentNotices } from "@repo/host/agent-notices";
import {
  AppStateStore,
  createOperatorClient,
  initialAppState,
  linkClientNotices,
  linkNetworkWatch,
  type OperatorClient,
  publishAppStateChanges,
} from "@repo/host/client";
import {
  ALL_CLIENT_CAPABILITIES,
  type DuplicateGatewayMethod,
  HostAssemblyTag,
  type HostTag,
  hostCapabilities,
  hostStandingLayer,
  layersInOrder,
} from "@repo/host/effect";
import {
  confirmingHold,
  type DesktopQuit,
  LEAVE,
  type Leave,
  leaveGate,
  leaveQuestion,
  reloadGate,
  type UnsavedWorkHolders,
  unsavedWorkHolders,
} from "@repo/host/quit";
import { effectServiceLayer, serviceLayer } from "@repo/host/service-layer";
import type { ColorCode } from "@repo/host/task-code-remote";
import { HOST_CAPABILITY, NO_EXPERIMENTS } from "@repo/settings";
import { Context, Effect, Layer } from "effect";
import { BrowserWindow, net, type WebContents } from "electron";
import { registerDesktopIpc } from "../ipc/register-desktop-ipc";
import { moveToApplications } from "../move-to-applications";
import { createElectronUpdaterEngine } from "../update-installer";
import { type MenuOffers, menuOffers } from "../window/menu-offers";
import { electronNoticeDoors } from "../window/notice-doors";
import { askBeforeLeaving } from "../window/quit-dialog";
import type { DesktopConfig } from "./desktop-config";
import { hostAssemblyLayerFor } from "./host-layer";
import { createKeychainService } from "./keychain-service";
import { createNativeNode, type NativeNode } from "./native-node";
import { colorCodeInUtilityProcess } from "./task-code-coloring";
import {
  createTelemetryService,
  followAccountInReports,
  mainErrorReporting,
  type TelemetryService,
} from "./telemetry-service";
import { createUpdateServiceHost, type UpdateServiceHost } from "./update-service-host";
import { createWindowService, type WindowService } from "./window-service";

function desktopClientCapabilities(fixtureMode: boolean) {
  return ALL_CLIENT_CAPABILITIES.filter(
    (capability) =>
      capability !== HOST_CAPABILITY.CLI_INSTALL || fixtureMode || CLI_RELEASE !== undefined,
  );
}

export interface DesktopServices {
  readonly config: DesktopConfig;
  readonly state: AppStateStore;
  readonly telemetry: TelemetryService;
  readonly native: NativeNode;
  readonly updates: UpdateServiceHost;
  readonly operator: OperatorClient;
  readonly windows: WindowService;
  readonly notices: AgentNotices;
  readonly colorCode: ColorCode;
  readonly run: <A>(effect: Effect.Effect<A>) => Promise<A>;
  readonly services: Context.Context<never>;
  readonly unsavedWork: UnsavedWorkHolders<WebContents>;
  readonly menuOffers: MenuOffers;
  readonly askBeforeLeaving: (leave: Leave) => Promise<boolean>;
}

export class DesktopTag extends Context.Service<DesktopTag, DesktopServices>()(
  "@repo/desktop/Desktop",
) {}

const launchSteps = (services: DesktopServices): Layer.Layer<HostTag, never, HostAssemblyTag> => {
  const { config, state, telemetry, native, operator, updates, windows } = services;
  const { report } = config;
  const channels = Layer.effectDiscard(Effect.sync(() => registerDesktopIpc(services)));
  const machine = layersInOrder([
    effectServiceLayer(telemetry, report),
    serviceLayer(native, report),
  ]).pipe(Layer.provideMerge(channels));
  const stateBroadcast = Layer.effectDiscard(
    publishAppStateChanges(
      state,
      () =>
        Effect.andThen(
          windows.applyAppearance(),
          Effect.sync(() => {
            windows.publishAppState();
            const held = state.snapshot();
            config.showMenuBar({
              experiments: held.settings?.experiments ?? NO_EXPERIMENTS,
              capabilities: held.run.capabilities,
            });
          }),
        ),
      report,
    ),
  );
  const throughWindows = layersInOrder([
    effectServiceLayer(operator, report),
    Layer.effectDiscard(Effect.sync(() => updates.start())),
    serviceLayer(windows, report),
  ]).pipe(Layer.provideMerge(hostStandingLayer), Layer.provideMerge(machine));
  return stateBroadcast.pipe(Layer.provideMerge(throughWindows));
};

export function composeDesktop(
  config: DesktopConfig,
  quit: DesktopQuit,
): Layer.Layer<DesktopTag | HostTag, DuplicateGatewayMethod> {
  const keychain = createKeychainService();
  const hostAssembly = hostAssemblyLayerFor({ config, cipher: keychain.cipher });

  const assembly = Layer.effect(
    DesktopTag,
    Effect.gen(function* () {
      const host = yield* HostAssemblyTag;
      const services: Context.Context<never> = yield* Effect.context();
      const run = <A>(effect: Effect.Effect<A>): Promise<A> =>
        Effect.runPromiseWith(services)(Effect.withErrorReporting(effect, { defectsOnly: true }));
      const updateEngine =
        config.packaged && config.runMode.sendsNetwork && config.platform === "darwin"
          ? createElectronUpdaterEngine()
          : undefined;
      const state = new AppStateStore(
        initialAppState(
          config,
          updateEngine !== undefined,
          hostCapabilities(host.concerns, desktopClientCapabilities(config.launch.fixtureMode)),
        ),
        services,
      );
      yield* followAccountInReports(state);
      const native = createNativeNode({ config, state });
      const operator = yield* createOperatorClient({
        report: config.report,
        gateway: host.gateway,
        nodes: host.nodes,
        node: native.capabilities,
        state,
      });
      const telemetry = createTelemetryService({
        config,
        recordEvent: (name, properties) => {
          void run(operator.host.recordEvent(name, properties));
        },
        workingAgents: () => workingAgentCount(state.snapshot().tasks),
      });
      const windows = createWindowService({
        config,
        state,
        operator,
        run,
        launchStanding: quit.launchStanding,
      });
      const colorCode = yield* colorCodeInUtilityProcess(config.resourceDirectory);
      const unsavedWork = unsavedWorkHolders<WebContents>((sender) => sender.isDestroyed());
      const offers = menuOffers(config.showMenuBar);
      yield* Effect.acquireRelease(
        Effect.sync(() => windows.onPanelFocusChanged(() => offers.focusMoved())),
        (stop) => Effect.sync(stop),
      );
      const atStake = () => ({ unsavedWork: unsavedWork.holding() });
      const askFirst = leaveGate({
        atStake,
        ask: (question) => askBeforeLeaving(windows.panels.primaryPanel(), question),
      });
      const askBeforeReload = reloadGate<BrowserWindow>({
        holds: (window) => unsavedWork.holds(window.webContents),
        ask: askBeforeLeaving,
      });
      config.showMenuBar({
        reload: {
          onReload: (window) => {
            if (!(window instanceof BrowserWindow)) return;
            void askBeforeReload(window).then((reload) => {
              if (reload && !window.isDestroyed()) window.webContents.reload();
            });
          },
        },
      });
      quit.holdWhile(
        confirmingHold({
          standing: () => leaveQuestion(LEAVE.QUIT, atStake()) !== undefined,
          confirm: () => askFirst(LEAVE.QUIT),
          again: () => config.quit(),
        }),
      );
      const noticeDoors = electronNoticeDoors({
        onAnswered: (status) => {
          if (state.snapshot().notifications.status !== status) {
            state.update({ notifications: { status } });
          }
        },
        report: config.report,
      });
      const notices = yield* linkClientNotices({
        state,
        host: operator.host,
        presenter: { openMacCommandAsk: () => windows.panels.focusExpanded() },
        onPanelFocusChanged: windows.onPanelFocusChanged,
        report: config.report,
      }).pipe(Effect.provideService(AgentNoticeDoors, noticeDoors));
      if (config.runMode.sendsNetwork) {
        yield* linkNetworkWatch({
          state,
          isOnline: () => net.isOnline(),
          regained: operator.host.tasksRegained(),
          report: config.report,
        });
      }
      const updates = yield* createUpdateServiceHost({
        config,
        recordProductEvent: telemetry.recordProductEvent,
        engine: updateEngine,
        beforeRestart: quit.teardown,
        askBeforeRestart: () => askFirst(LEAVE.RESTART),
        state,
        showSettings: () => {
          windows.panels.focusExpanded();
          windows.showSettings();
        },
        moveToApplications,
      });

      return {
        config,
        state,
        telemetry,
        native,
        updates,
        operator,
        windows,
        notices,
        colorCode,
        run,
        services,
        unsavedWork,
        menuOffers: offers,
        askBeforeLeaving: askFirst,
      };
    }),
  );

  return Layer.unwrap(Effect.map(DesktopTag, launchSteps)).pipe(
    Layer.provideMerge(assembly),
    Layer.provideMerge(hostAssembly),
    Layer.provideMerge(effectServiceLayer(keychain, config.report)),
    Layer.provideMerge(mainErrorReporting),
  );
}
