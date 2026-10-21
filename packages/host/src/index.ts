/**
 * Luke's runtime as one host: everything that executes, persists, schedules,
 * observes, or holds an account, composed once over an explicit state root
 * and reached only through the Gateway methods it answers. It draws nothing
 * and imports no Electron: what a window must learn leaves as a host event,
 * and what only the machine a client runs on can do arrives as a capability
 * asked of the native node by name. The desktop composes this in its own
 * process and calls it directly.
 *
 * This package's modules are not all public, which is what the hand-listed
 * barrel says: every name here has a client that reaches it, and a name a
 * client does not reach yet is added when one arrives.
 */
export { type RunMode, runModeFor, sentryReportingEnabled } from "./run-mode.js";
export type { SecretCipher } from "./settings-store.js";
export { highlightSnippet } from "./task-code.js";
