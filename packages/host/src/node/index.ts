/**
 * index.ts -- the host's Node-only door: what runs only where Node does (`node:` modules, `ws`, the process's own stderr), kept out of the main barrel and `@luke/host/effect` so those load in a browser.
 *
 * Each name here is handed to the host as a seam or used beside it by a
 * Node process that composes the host, such as the desktop's main process.
 */
export { jsonStateFile } from "./json-state-file.js";
export { closeEveryMacTerminal, type MacTerminal, startMacTerminal } from "./mac-terminal.js";
export { cloneFolder, openOnMacScript, worktreeFolder } from "./open-on-mac.js";
export { reportToStderr, tolerateClosedStderr } from "./stderr-report.js";
export { openTerminalSocketOverWs } from "./terminal-socket-over-ws.js";
export { openVoiceSocketOverWs } from "./voice-socket-over-ws.js";
