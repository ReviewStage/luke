import type { StoredAccount } from "@sidecar/credentials";
import { HostedDeviceClient } from "@sidecar/hosted";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { DeviceRegistration, deviceStateFile } from "./device-registration.js";
import type { HostKernel } from "./host-kernel.js";

export interface DevicesComposer extends Composer {
  /**
   * Registers this installation with the service and arms the heartbeat. A
   * no-op while the account gate is closed or the run sends nothing, and
   * idempotent while a registration stands.
   */
  register: () => Promise<void>;
  /**
   * Disarms the heartbeat. Handed the departing account, it also asks the
   * service to forget the row, on that account's own token, before the
   * credential is cleared; handed nothing, the row stands for the next launch.
   */
  release: (departing: StoredAccount | undefined) => Promise<void>;
}

export interface DevicesDependencies {
  kernel: HostKernel;
  account: AccountComposer;
}

/**
 * This Mac's device row on the service: one row per installation, registered
 * at sign-in, kept warm by a heartbeat, and forgotten at sign-out. The
 * installation id lives in the host's own state root beside the onboarding
 * record, and a fixture or evidence run, which sends nothing, registers
 * nothing.
 */
export function composeDevices(dependencies: DevicesDependencies): DevicesComposer {
  const { kernel, account } = dependencies;
  const { runMode, report } = kernel;

  const registration = new DeviceRegistration({
    client: new HostedDeviceClient({
      serviceBaseUrl: kernel.hostedServiceBaseUrl,
      ...account.token,
    }),
    state: deviceStateFile(() => kernel.stateRoot, report),
    mintInstallationId: kernel.createId,
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    // SAFETY: every timer handed back here was armed by the setTimeout beside it.
    cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });

  async function register(): Promise<void> {
    if (!runMode.sendsNetwork || !account.capabilitiesActive()) return;
    await registration.start();
  }

  async function release(departing: StoredAccount | undefined): Promise<void> {
    await registration.stop({
      forget:
        departing !== undefined && runMode.sendsNetwork
          ? { accessToken: departing.accessToken }
          : false,
    });
  }

  return {
    methods: {},
    register,
    release,
    start: async () => undefined,
    // A quit is not a sign-out: the beat stops and the row stands for the next launch.
    stop: () => release(undefined),
  };
}
