import { channels } from "#shared/bridge";
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
  readonly telemetry: TelemetryService;
  readonly native: NativeNode;
  readonly updates: UpdateServiceHost;
  readonly operator: OperatorClient;
  readonly windows: WindowService;
  start: () => Promise<void>;
  stop: () => Promise<void>;
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
  const keychain = createKeychainService();
  const host = createHostService({ config, cipher: keychain.cipher });
  const native = createNativeNode(config);
  const operator = createOperatorClient({
    config,
    server: host.server,
    node: native.capabilities,
  });
  const telemetry = createTelemetryService({
    config,
    recordEvent: (name, properties) => operator.host.recordEvent(name, properties),
  });
  const windows = createWindowService({ config, native, telemetry, operator, host });
  const updates = createUpdateServiceHost({
    config,
    recordProductEvent: telemetry.recordProductEvent,
    // Nothing to install without a signed build, a network, and the platform
    // Squirrel serves; the row says so rather than offering a press that
    // could not land.
    engine:
      config.packaged && config.runMode.sendsNetwork && config.platform === "darwin"
        ? createElectronUpdaterEngine()
        : undefined,
    drainHost: () => host.drain(),
    broadcastUpdate: (update) => windows.broadcast(channels.onUpdateChanged, update),
  });

  // The three edges no service could take as a constructor argument, because
  // each is a cycle the concerns genuinely have: the windows are built over
  // the machine's own duck and carry the acts its node performs, they draw
  // what the operator hears and the operator is reached over the host's own
  // server, and the host's standup is what the operator's first attach rides
  // inside. Reading one before this has run throws by name rather than
  // answering nothing.
  host.link({ attach: () => operator.start() });
  native.link({
    broadcast: (channel, payload) => windows.broadcast(channel, payload),
    sendToPrimaryPanel: (channel, payload) => windows.sendToPrimaryPanel(channel, payload),
  });
  operator.link({
    broadcast: (channel, payload, except) => windows.broadcast(channel, payload, except),
    sendToVoice: (channel, payload) => windows.sendToVoice(channel, payload),
    webContentsByReporter: (reporter) => windows.webContentsByReporter(reporter),
    reapplyTalkHotkey: () => windows.reapplyTalkHotkey(),
    recycleVoiceWindow: () => windows.recycleVoiceWindow(),
  });

  /**
   * The order the launch begins them in, which a quit reverses. What this
   * machine itself answers comes first, so nothing that draws waits on it;
   * then the host, whose standup carries the operator's first attach and the
   * bootstrap every later decision is made from — which is why the operator
   * sits here and starts nowhere else; then the windows, which are what a
   * bootstrap that never arrived must not be drawn over.
   */
  const machine = [keychain, telemetry, native, updates] as const;
  const all: readonly DesktopService[] = [...machine, host, operator, windows];
  let stopping: Promise<void> | undefined;

  return {
    config,
    telemetry,
    native,
    updates,
    operator,
    windows,
    start: async () => {
      for (const service of machine) await service.start();
      await host.start();
      // A Quit that landed during the standup drained the host and took it
      // down; the launch must not go on to draw windows over it, which would
      // also abort the quit it interrupted.
      if (!host.standingUp()) return;
      await windows.start();
    },
    // Two paths ask for the quit's teardown — the explicit Quit and a launch
    // that could not stand up — and both are handed the one under way rather
    // than a second pass over services already stopped.
    stop: () =>
      (stopping ??= stopInReverse(all, config.report).finally(() => {
        stopping = undefined;
      })),
  };
}
