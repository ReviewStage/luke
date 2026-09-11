import type { StoredAccount } from "@sidecar/credentials";
import { HostedChangesClient, HostedDeviceClient } from "@sidecar/hosted";
import type { AccountComposer } from "./compose-account.js";
import type { CalendarsComposer } from "./compose-calendars.js";
import type { Composer } from "./composer.js";
import { activeUntilFrom } from "./device-presence.js";
import { DeviceRegistration, deviceStateFile } from "./device-registration.js";
import type { HostKernel } from "./host-kernel.js";

export interface DevicesComposer extends Composer {
  /**
   * Registers this installation with the service and arms the poll. A
   * no-op while the account gate is closed or the run sends nothing, and
   * idempotent while a registration stands.
   */
  register: () => Promise<void>;
  /**
   * Disarms the poll. Handed the departing account, it also asks the
   * service to forget the row, on that account's own token, before the
   * credential is cleared; handed nothing, the row stands for the next launch.
   */
  release: (departing: StoredAccount | undefined) => Promise<void>;
  /** The row's id as the service last answered it, or nothing before a registration lands. */
  deviceId: () => string | undefined;
}

export interface DevicesDependencies {
  kernel: HostKernel;
  account: AccountComposer;
  calendars: CalendarsComposer;
}

/**
 * This Mac's device row on the service: one row per installation, registered
 * at sign-in, kept warm by the change-signal poll, and forgotten at sign-out.
 * Each poll carries the two facts this machine reports of itself — the
 * instant its presence holds until, from the idle time and lock state the
 * client reads off the machine, and the instant the calendar's meeting hold
 * ends — and decides nothing from either. The installation id lives in the
 * host's own state root beside the onboarding record, and a fixture or
 * evidence run, which sends nothing, registers nothing.
 */
export function composeDevices(dependencies: DevicesDependencies): DevicesComposer {
  const { kernel, account, calendars } = dependencies;
  const { runMode, report, now } = kernel;

  const credential = { serviceBaseUrl: kernel.hostedServiceBaseUrl, ...account.token };
  const devices = new HostedDeviceClient(credential);
  const changes = new HostedChangesClient(credential);

  const registration = new DeviceRegistration({
    client: {
      register: (request) => devices.register(request),
      poll: (request) => changes.poll(request),
      forget: (request, departing) => devices.forget(request, departing),
    },
    state: deviceStateFile(() => kernel.stateRoot, report),
    mintInstallationId: kernel.createId,
    presence: async () => {
      const at = now();
      return {
        activeUntil: activeUntilFrom(kernel.options.machinePresence?.(), at),
        quietUntil: (await calendars.meetingQuietUntil(at)) ?? null,
      };
    },
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    // SAFETY: every timer handed back here was armed by the setTimeout beside it.
    cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    report,
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
    deviceId: () => registration.deviceId(),
    start: async () => undefined,
    // A quit is not a sign-out: the poll stops and the row stands for the next launch.
    stop: () => release(undefined),
  };
}
