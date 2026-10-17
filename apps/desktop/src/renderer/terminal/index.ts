import type { TerminalModule } from "./contract";
import "./index.css";
import { mountTerminal } from "./terminal-surface";

/**
 * index.ts -- the terminal bundle: xterm.js and its addons, and their stylesheet, imported by a Terminal tab to mount (`./contract.ts`).
 */

export const terminal: TerminalModule = { mount: mountTerminal };
