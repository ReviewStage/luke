import {
  type DuplicateGatewayMethod,
  HostAssemblyTag,
  type HostTag,
  hostStandingLayer,
  layersInOrder,
} from "@sidecar/host/effect";
import { Context, Effect, Layer, Runtime } from "effect";
import { powerMonitor } from "electron";
import { AppStateStore, initialAppState } from "../app-state";
import { registerDesktopIpc } from "../ipc/register-desktop-ipc";
import { createElectronUpdaterEngine } from "../update-installer";
import type { DesktopConfig } from "./desktop-config";
import { hostAssemblyLayerFor } from "./host-layer";
import { createKeychainService } from "./keychain-service";
import { createMachinePresence } from "./machine-presence";
import { createNativeNode, type NativeNode } from "./native-node";
import { createOperatorClient, type OperatorClient } from "./operator-client";
import type { DesktopQuit } from "./quit";
import { serviceLayer } from "./service-layer";
import { createTelemetryService, type TelemetryService } from "./telemetry-service";
import { createUpdateServiceHost, type UpdateServiceHost } from "./update-service-host";
import { createWindowService, type WindowService } from "./window-service";

/**
 * The composition, as the bridge registration reads it. The keychain and the
 * host are not named here because nothing outside reaches them: the cipher is
 * the host's, the server is the operator's, and the drain is one of the steps
 * the scope's close runs.
 */
export interface DesktopServices {
  readonly config: DesktopConfig;
  /**
   * Everything main keeps of what the host tells it and what this machine
   * answers for itself, in one document. Every window's bootstrap is read
   * from it and every push to a window leaves from it.
   */
  readonly state: AppStateStore;
  readonly telemetry: TelemetryService;
  readonly native: NativeNode;
  readonly updates: UpdateServiceHost;
  readonly operator: OperatorClient;
  readonly windows: WindowService;
  /**
   * Every act's Effect, run here rather than a second runtime: the desktop's
   * own `ManagedRuntime` is what `main.ts` disposes, and this is the same
   * runtime read back out of the fiber that is building this layer, never one
   * built apart from it.
   */
  readonly run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}

/** The desktop client as it stands once every step of the launch has run. */
export class DesktopTag extends Context.Tag("@luke/desktop/Desktop")<
  DesktopTag,
  DesktopServices
>() {}

/**
 * The steps of the launch, in the order it has to keep, each one built into
 * the same scope so the quit is this list closed in reverse.
 *
 * The channels come first: a window that loaded before its channels were
 * registered would meet an unhandled invoke. Then what this machine itself
 * answers, so nothing that draws waits on it; then the host, whose standing
 * layer is what the operator's attach rides behind and what the drain
 * registers its last finalizer in, so the close runs the drain before any
 * composer stops; then the operator, which is what carries the bootstrap
 * every later decision is made from; then the updater, which reads and spends
 * the last-run-version mark, so a standup that failed or was quit must not
 * have spent it; then the windows, which are what a bootstrap that never
 * arrived must not be drawn over, and which read the updater's snapshot in
 * their own bootstrap.
 */
const launchSteps = (services: DesktopServices): Layer.Layer<HostTag, never, HostAssemblyTag> => {
  const { config, telemetry, native, operator, updates, windows } = services;
  const { report } = config;
  const channels = Layer.effectDiscard(Effect.sync(() => registerDesktopIpc(services)));
  const machine = layersInOrder([
    serviceLayer(telemetry, report),
    serviceLayer(native, report),
  ]).pipe(Layer.provideMerge(channels));
  return layersInOrder([
    serviceLayer(operator, report),
    serviceLayer(updates, report),
    serviceLayer(windows, report),
  ]).pipe(Layer.provideMerge(hostStandingLayer), Layer.provideMerge(machine));
};

/**
 * The desktop client, composed once and started once. Constructing performs
 * no side effect and reads no fact of the process the launch has not already
 * established: every `app` read is in the config `main` was handed, so the
 * launch's order is the order this layer builds in rather than the order
 * these modules happened to be evaluated in.
 *
 * The client is one operator over the Gateway and one node offering this
 * machine's capabilities back; the host it operates is built into the same
 * scope, which is why disposing the one runtime is the whole quit.
 */
export function composeDesktop(
  config: DesktopConfig,
  quit: DesktopQuit,
): Layer.Layer<DesktopTag | HostTag, DuplicateGatewayMethod> {
  const keychain = createKeychainService();
  const presence = createMachinePresence(powerMonitor);
  const hostAssembly = hostAssemblyLayerFor({
    config,
    cipher: keychain.cipher,
    machinePresence: presence.read,
  });

  const assembly = Layer.effect(
    DesktopTag,
    Effect.gen(function* () {
      const host = yield* HostAssemblyTag;
      // The one runtime this launch has, read back out of the fiber building
      // it rather than built again: every act's Effect runs on it, never on a
      // runtime of act-router's own.
      const runtime: Runtime.Runtime<never> = yield* Effect.runtime();
      const run = <A>(effect: Effect.Effect<A>): Promise<A> => Runtime.runPromise(runtime)(effect);
      // Nothing to install without a signed build, a network, and the platform
      // Squirrel serves; the row says so rather than offering a press that could
      // not land, and the document says so from its first version.
      const updateEngine =
        config.packaged && config.runMode.sendsNetwork && config.platform === "darwin"
          ? createElectronUpdaterEngine()
          : undefined;
      const state = new AppStateStore(initialAppState(config, updateEngine !== undefined));
      const native = createNativeNode({ config, state });
      const operator = createOperatorClient({
        config,
        server: host.server,
        node: native.capabilities,
        state,
      });
      const telemetry = createTelemetryService({
        config,
        recordEvent: (name, properties) => operator.host.recordEvent(name, properties),
      });
      const windows = createWindowService({
        config,
        state,
        native,
        telemetry,
        operator,
        launchStanding: quit.launchStanding,
      });
      const updates = createUpdateServiceHost({
        config,
        recordProductEvent: telemetry.recordProductEvent,
        engine: updateEngine,
        beforeRestart: quit.teardown,
        state,
      });

      // The two edges no service could take as a constructor argument, because
      // each is a cycle the concerns genuinely have: the windows are built over
      // the machine's own duck and carry the actions its node performs, and they
      // draw what the operator hears while the operator is reached over the
      // host's own server. Reading one before this has run throws by name rather
      // than answering nothing.
      native.link({
        sendToPrimaryPanel: (channel, payload) => windows.sendToPrimaryPanel(channel, payload),
        standPanelsDown: () => windows.panels.standDown(),
      });
      operator.link({
        sendToVoice: (channel, payload) => windows.sendToVoice(channel, payload),
        reapplyTalkHotkey: () => windows.reapplyTalkHotkey(),
        recycleVoiceWindow: () => windows.recycleVoiceWindow(),
      });

      /**
       * The one place the document becomes a push. Every window reads its state
       * on one channel, so what a window is told and what `app:state-request`
       * answers it are the same document read twice, and a window's own write is
       * not raced against a broadcast: the version it is handed only ever rises.
       */
      state.subscribe(() => windows.publishAppState());

      // An action still waiting on a panel is refused before anything stops:
      // the panels are going, so nothing can answer one, and the drain would
      // otherwise wait out the action's own clock for a promise that was never
      // going to settle.
      quit.beforeTeardown(() => native.refusePendingActions());

      return { config, state, telemetry, native, updates, operator, windows, run };
    }),
  );

  return Layer.unwrapEffect(Effect.map(DesktopTag, launchSteps)).pipe(
    Layer.provideMerge(assembly),
    Layer.provideMerge(hostAssembly),
    // The keychain and the machine's presence are the two services nothing
    // else is built over: the host takes their readings as seams, so they are
    // constructed before the assembly and begin before it.
    Layer.provideMerge(
      layersInOrder([serviceLayer(keychain, config.report), serviceLayer(presence, config.report)]),
    ),
  );
}
