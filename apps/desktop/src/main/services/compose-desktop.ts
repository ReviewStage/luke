import {
  type DuplicateGatewayMethod,
  HostAssemblyTag,
  type HostTag,
  hostStandingLayer,
  layersInOrder,
} from "@sidecar/host/effect";
import { Context, Effect, Layer, Stream } from "effect";
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
import { effectServiceLayer, serviceLayer } from "./service-layer";
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
   * Every act's Effect, run here rather than under a context of its own: the
   * desktop's own `ManagedRuntime` is what `main.ts` disposes, and these are
   * that runtime's own services, read back out of the fiber that is building
   * this layer rather than assembled apart from it.
   */
  readonly run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}

/** The desktop client as it stands once every step of the launch has run. */
export class DesktopTag extends Context.Service<DesktopTag, DesktopServices>()(
  "@luke/desktop/Desktop",
) {}

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
 * their own bootstrap. The updater's own scope is not one of these steps —
 * `createUpdateServiceHost` already forked its fibers into the assembly's own
 * scope and registered its stop as that scope's finalizer — only the one
 * `start()` call the version mark's ordering still needs is here.
 */
const launchSteps = (services: DesktopServices): Layer.Layer<HostTag, never, HostAssemblyTag> => {
  const { config, state, telemetry, native, operator, updates, windows } = services;
  const { report } = config;
  const channels = Layer.effectDiscard(Effect.sync(() => registerDesktopIpc(services)));
  const machine = layersInOrder([
    effectServiceLayer(telemetry, report),
    serviceLayer(native, report),
  ]).pipe(Layer.provideMerge(channels));
  // The one place the document becomes a push. Every window reads its state
  // on one channel, so what a window is told and what `app:state-request`
  // answers it are the same document read twice, and a window's own write is
  // not raced against a broadcast: the version it is handed only ever rises.
  // Forked after the windows service has started, so nothing publishes to a
  // window that is not yet there to receive it. A push that throws is
  // reported rather than left to end the fiber: a `Stream.runForEach` that
  // failed once would never resume, and every later write would then reach
  // no window for the rest of the session.
  const stateBroadcast = Layer.effectDiscard(
    Effect.forkScoped(
      Stream.runForEach(state.changes, () =>
        Effect.catchDefect(
          Effect.sync(() => windows.publishAppState()),
          (defect) =>
            Effect.sync(() => {
              report(
                `the app-state push to windows failed: ${defect instanceof Error ? defect.message : String(defect)}`,
              );
            }),
        ),
      ),
    ),
  );
  const throughWindows = layersInOrder([
    effectServiceLayer(operator, report),
    Layer.effectDiscard(Effect.sync(() => updates.start())),
    serviceLayer(windows, report),
  ]).pipe(Layer.provideMerge(hostStandingLayer), Layer.provideMerge(machine));
  return stateBroadcast.pipe(Layer.provideMerge(throughWindows));
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
      // The services this launch stands on, read back out of the fiber
      // building it rather than assembled again: every act's Effect runs
      // under them, never under a context of act-router's own.
      const services: Context.Context<never> = yield* Effect.context();
      const run = <A>(effect: Effect.Effect<A>): Promise<A> =>
        Effect.runPromiseWith(services)(effect);
      // Nothing to install without a signed build, a network, and the platform
      // Squirrel serves; the row says so rather than offering a press that could
      // not land, and the document says so from its first version.
      const updateEngine =
        config.packaged && config.runMode.sendsNetwork && config.platform === "darwin"
          ? createElectronUpdaterEngine()
          : undefined;
      const state = new AppStateStore(
        initialAppState(config, updateEngine !== undefined),
        services,
      );
      const native = createNativeNode({ config, state });
      const operator = yield* createOperatorClient({
        config,
        gateway: host.gateway,
        node: native.capabilities,
        state,
      });
      const telemetry = createTelemetryService({
        config,
        // A counted event is begun rather than waited on: nothing the windows
        // do turns on it, and the host counts it whatever this act answers.
        recordEvent: (name, properties) => {
          void run(operator.host.recordEvent(name, properties));
        },
      });
      const windows = createWindowService({
        config,
        state,
        native,
        telemetry,
        operator,
        run,
        launchStanding: quit.launchStanding,
      });
      const updates = yield* createUpdateServiceHost({
        config,
        recordProductEvent: telemetry.recordProductEvent,
        engine: updateEngine,
        beforeRestart: quit.teardown,
        state,
      });

      // The one edge no service could take as a constructor argument, because
      // it is a cycle the concerns genuinely have: the windows draw what the
      // operator hears while the operator is reached over the host's own
      // server. Reading it before this has run throws by name rather than
      // answering nothing.
      operator.link({
        sendToVoice: (channel, payload) => windows.sendToVoice(channel, payload),
        reapplyTalkHotkey: () => windows.reapplyTalkHotkey(),
        recycleVoiceWindow: () => windows.recycleVoiceWindow(),
        introductionOwedChanged: () => windows.reconcileIntroduction(),
      });

      return { config, state, telemetry, native, updates, operator, windows, run };
    }),
  );

  return Layer.unwrap(Effect.map(DesktopTag, launchSteps)).pipe(
    Layer.provideMerge(assembly),
    Layer.provideMerge(hostAssembly),
    // The keychain and the machine's presence are the two services nothing
    // else is built over: the host takes their readings as seams, so they are
    // constructed before the assembly and begin before it.
    Layer.provideMerge(
      layersInOrder([
        effectServiceLayer(keychain, config.report),
        effectServiceLayer(presence, config.report),
      ]),
    ),
  );
}
