import type { TerminalModule } from "./contract";
import { mountTerminal } from "./terminal-surface";

/**
 * index.ts -- the terminal bundle: xterm.js and its addons, set on `window` for a Terminal tab to mount (`./contract.ts`).
 */

window.lukeTerminal = { mount: mountTerminal } satisfies TerminalModule;
