import type { TerminalModule } from "./contract.js";
import "./index.css";
import { createTerminal } from "./terminal-surface.js";

/**
 * index.ts -- the terminal bundle: xterm.js and its addons, and their stylesheet, imported by a terminal session to make its screen (`./contract.ts`).
 */

export const terminal: TerminalModule = { create: createTerminal };
