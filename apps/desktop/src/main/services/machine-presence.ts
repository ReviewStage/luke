import type { MachinePresence } from "@sidecar/host";
import type { DesktopService } from "./service";

/**
 * The two facts of the machine the presence report is read from, as
 * Electron's power monitor gives them. The listener methods are overloaded
 * per event name because that is how Electron types them.
 */
export interface PresenceMonitor {
  getSystemIdleTime(): number;
  on(event: "lock-screen", listener: () => void): void;
  on(event: "unlock-screen", listener: () => void): void;
  removeListener(event: "lock-screen", listener: () => void): void;
  removeListener(event: "unlock-screen", listener: () => void): void;
}

export interface MachinePresenceService extends DesktopService {
  /** The machine's idle time and lock state as they stand now; the host reads this at each poll. */
  read: () => MachinePresence;
}

/**
 * Where the developer's presence is read from: the operating system's own
 * idle time, and whether the screen is locked, which the power monitor only
 * reports as a pair of edges, so the state is kept from those edges and
 * starts unlocked, since a launch happens at an unlocked screen. Nothing here
 * decides what presence means; the host turns these two facts into the one
 * instant the device row reports, and the service decides from it.
 */
export function createMachinePresence(monitor: PresenceMonitor): MachinePresenceService {
  let screenLocked = false;
  const lock = () => {
    screenLocked = true;
  };
  const unlock = () => {
    screenLocked = false;
  };
  return {
    name: "machine-presence",
    read: () => ({ idleSeconds: monitor.getSystemIdleTime(), screenLocked }),
    start: async () => {
      monitor.on("lock-screen", lock);
      monitor.on("unlock-screen", unlock);
    },
    stop: async () => {
      monitor.removeListener("lock-screen", lock);
      monitor.removeListener("unlock-screen", unlock);
      screenLocked = false;
    },
  };
}
