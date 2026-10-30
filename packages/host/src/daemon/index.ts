/**
 * index.ts -- a host's door (`@luke/host/daemon`): what a host's daemon (`apps/host`) composes on every OS, each OS's description, the platform, the box's device record and its enroll, and the daemon run on them, kept out of the main barrel and every door a browser loads.
 */

export { readHostDevice } from "../host-device-record.js";
export { hostDaemon } from "./host-daemon.js";
export { enrollHostDevice } from "./host-device.js";
export {
  DARWIN_HOST,
  type HostRuntime,
  hostArch,
  hostRuntime,
  LINUX_HOST,
} from "./host-os.js";
export { type HostPlatformOptions, hostPlatform } from "./host-platform.js";
export { hostSmolvmLeft } from "./host-smolvm.js";
