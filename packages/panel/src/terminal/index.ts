import type { TerminalModule } from "./contract.js";
import "./index.css";
import { mountTerminal } from "./terminal-surface.js";

/**
 * index.ts -- the terminal bundle: xterm.js and its addons, and their stylesheet, imported by a Terminal tab to mount (`./contract.ts`).
 */

export const terminal: TerminalModule = { mount: mountTerminal };
