import { bundleAtom } from "../bundle-loader";
import { TERMINAL_ASSET } from "../terminal/contract";

/**
 * terminal-bundle.ts -- the terminal bundle, loaded once per window by the first Terminal tab shown, and kept for the window's life.
 */

/** What a Terminal tab says where the bundle failed to load. */
export const TERMINAL_LOAD_FAILED = "The terminal could not be shown.";

export const terminalModuleAtom = bundleAtom(
  { script: TERMINAL_ASSET.SCRIPT, stylesheet: TERMINAL_ASSET.STYLESHEET },
  () => window.lukeTerminal,
  TERMINAL_LOAD_FAILED,
);
