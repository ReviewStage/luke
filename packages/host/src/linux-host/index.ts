/**
 * index.ts -- a host's door (`@luke/host/linux-host`): what the Linux daemon (`apps/host`) composes, the Linux platform, the box's device record and its enroll, and the daemon run on them, kept out of the main barrel and every door a browser loads.
 */
export { hostDaemon } from "./host-daemon.js";
export { enrollHostDevice, readHostDevice } from "./host-device.js";
export { hostArch, linuxPlatform } from "./linux-platform.js";
