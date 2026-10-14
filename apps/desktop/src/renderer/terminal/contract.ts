/**
 * contract.ts -- what a Terminal tab and the terminal bundle say to each other: the one mount call, and the handle a tab writes a shell's output through.
 *
 * A Terminal tab's screen is drawn by xterm.js (`@xterm/xterm`) and its
 * addons, which are too large for the bundle every window parses, so they
 * ship as a bundle of their own (`terminal.js` and `terminal.css`, built from
 * `./index.ts` and `./index.css`) that the tab loads the first time a
 * terminal is shown, as a File tab loads its tree. That bundle sets one
 * global, `window.lukeTerminal`, and this file is the whole of what the two
 * share: no xterm type crosses, only text, bytes, and sizes, and nothing here
 * imports anything, so the bundle carries none of the panel's libraries.
 *
 * Note that what crosses here is a shell's own bytes, which go to the screen
 * and nowhere else: never into app state, a trace, a counted event, or the
 * voice window (AGENTS.md's Never list).
 */

/** A terminal's size in character cells, as a shell is told it. */
interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

/** What the tab hands the terminal when it mounts it. */
export interface TerminalProps {
  /** What the user typed or pasted, as the shell is to read it. */
  readonly onInput: (data: string) => void;
  /** The size the terminal fits its box at, each time that changes. */
  readonly onResize: (size: TerminalSize) => void;
  /** A link in the output pressed with ⌘ held, as a terminal on a Mac opens one. */
  readonly onLink: (url: string) => void;
}

/** The terminal as mounted. */
export interface TerminalHandle {
  /**
   * Draws a shell's output, calling `written` once it is on the screen, which
   * is what a sender holding back on unacknowledged output waits for.
   */
  readonly write: (data: string | Uint8Array, written: () => void) => void;
  /** The size the terminal stands at now, which a shell attaching is told first. */
  readonly size: () => TerminalSize;
  readonly focus: () => void;
  /** Clears the screen and its scrollback, as another shell is about to draw on it. */
  readonly reset: () => void;
  readonly unmount: () => void;
}

/** What the terminal bundle sets on `window` once it has loaded. */
export interface TerminalModule {
  readonly mount: (host: HTMLElement, props: TerminalProps) => TerminalHandle;
}

declare global {
  interface Window {
    lukeTerminal?: TerminalModule;
  }
}

/** The files the terminal bundle is, beside `index.html`. */
export const TERMINAL_ASSET = {
  SCRIPT: "terminal.js",
  STYLESHEET: "terminal.css",
} as const;
