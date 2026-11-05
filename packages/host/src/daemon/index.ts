/**
 * index.ts -- a host's door (`@repo/host/daemon`): what a host's daemon (`apps/host`) composes on every OS, each OS's description, the platform, the box's device record, its connect with a code and its leave, the service that runs it, and the daemon run on them, kept out of the main barrel and every door a browser loads.
 */

export { readHostDevice, writeHostDevice } from "../host-device-record.js";
export { HOST_DAEMON_END, hostDaemon, hostRefusedRest } from "./host-daemon.js";
export { HOST_LEAVE_OUTCOME, leaveHostDevice } from "./host-leave.js";
export {
  DARWIN_HOST,
  type HostRuntime,
  hostArch,
  hostRuntime,
  LINUX_HOST,
} from "./host-os.js";
export {
  connectHostDevice,
  HOST_CONNECT_OUTCOME,
  type HostPairingCode,
} from "./host-pairing.js";
export { hostPlatform } from "./host-platform.js";
export { HOST_SERVICE, type HostService, hostServiceOf } from "./host-service.js";
export type { HostReleases } from "./host-update.js";
