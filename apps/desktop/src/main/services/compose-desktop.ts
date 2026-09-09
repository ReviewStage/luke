import { AppStateStore, initialAppState } from "../app-state";
import { createElectronUpdaterEngine } from "../update-installer";
import type { DesktopConfig } from "./desktop-config";
import { createHostService } from "./host-service";
import { createKeychainService } from "./keychain-service";
import { stopInReverse } from "./lifecycle";
import { createNativeNode, type NativeNode } from "./native-node";
import { createOperatorClient, type OperatorClient } from "./operator-client";
import type { DesktopService } from "./service";
import { createTelemetryService, type TelemetryService } from "./telemetry-service";
import { createUpdateServiceHost, type UpdateServiceHost } from "./update-service-host";
import { createWindowService, type WindowService } from "./window-service";

/**
 * The composition, as the bridge registration and the entry read it. The
 * keychain and the host are not named here because nothing outside reaches
 * them: the cipher is the host's, the server is the operator's, and the
 * drain is one of the steps `stop` runs.
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
  start: () => Promise<void>;
  /**
   * Everything owed, given back once: the windows, the operator, the host's
   * drain, the machine's own watchers. Asked for by the explicit Quit, by a
   * launch that could not stand up, and by the updater before it lets
   * Squirrel replace this binary.
   */
  stop: () => Promise<void>;
  /**
   * Whether a stop has run to its end. The entry reads it to decide whether
   * to hold a quit back: the first ask is held so the teardown can finish,
   * and every quit after it — including the installer's own — is let
   * through, because a prevented `before-quit` aborts an update.
   */
  stopped: () => boolean;
}

/**
 * The desktop client, composed once and started once. Constructing performs
 * no side effect and reads no fact of the process the launch has not already
 * established: every `app` read is in the config `main` was handed, so the
 * launch's order is the order in `main` rather than the order these modules
 * happened to be evaluated in.
 *
 * The client is one operator over the Gateway and one node offering this
 * machine's capabilities back; the host it operates is one of its services.
 */
export function composeDesktop(config: DesktopConfig): DesktopServices {
  /**
   * Whether a Quit has been asked for. It is set the moment `stop` is called
   * rather than when the drain is reached, because the drain is several
   * awaited stops behind that ask: a launch suspended on one of its own waits
   * would otherwise resume after the teardown and open a window, claim the
   * keys, and re-attach the listeners the teardown just released.
   */
  let quitting = false;
  const keychain = createKeychainService();
  const host = createHostService({ config, cipher: keychain.cipher });
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
    launchStanding: () => !quitting,
  });
  const updates = createUpdateServiceHost({
    config,
    recordProductEvent: telemetry.recordProductEvent,
    engine: updateEngine,
    beforeRestart: () => teardown(),
    state,
  });

  // The three edges no service could take as a constructor argument, because
  // each is a cycle the concerns genuinely have: the windows are built over
  // the machine's own duck and carry the actions its node performs, they draw
  // what the operator hears and the operator is reached over the host's own
  // server, and the host's standup is what the operator's first attach rides
  // inside. Reading one before this has run throws by name rather than
  // answering nothing.
  host.link({ attach: () => operator.start() });
  native.link({
    sendToPrimaryPanel: (channel, payload) => windows.sendToPrimaryPanel(channel, payload),
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

  /**
   * The order the launch begins them in, which a quit reverses. What this
   * machine itself answers comes first, so nothing that draws waits on it;
   * then the host, whose standup carries the operator's first attach and the
   * bootstrap every later decision is made from — which is why the operator
   * sits here and starts nowhere else; then the updater, which reads and
   * spends the last-run-version mark, so a standup that failed or was quit
   * must not have spent it; then the windows, which are what a bootstrap that
   * never arrived must not be drawn over, and which read the updater's
   * snapshot in their own bootstrap.
   */
  const machine = [keychain, telemetry, native] as const;
  const all: readonly DesktopService[] = [...machine, host, operator, updates, windows];
  let stopping: Promise<void> | undefined;
  let stopped = false;

  // Two paths ask for the teardown — the explicit Quit, a launch that could
  // not stand up — and the updater asks for it before the install. All three
  // are handed the one under way rather than a second pass over services
  // already stopped.
  function teardown(): Promise<void> {
    quitting = true;
    // An action still waiting on a panel is refused before the host drains: the
    // panels are going, so nothing can answer one, and the drain would
    // otherwise wait out the action's own clock for a promise that was never
    // going to settle.
    native.refusePendingActions();
    if (!stopping) {
      stopping = stopInReverse(all, config.report).finally(() => {
        stopping = undefined;
        stopped = true;
      });
    }
    return stopping;
  }

  return {
    config,
    state,
    telemetry,
    native,
    updates,
    operator,
    windows,
    start: async () => {
      for (const service of machine) await service.start();
      await host.start();
      // A Quit that landed during the standup is already tearing this process
      // down; the launch must not go on to spend the update mark or draw
      // windows over it, which would also abort the quit it interrupted.
      if (quitting) return;
      await updates.start();
      await windows.start();
    },
    stop: teardown,
    stopped: () => stopped,
  };
}
