/**
 * contract.ts -- what a terminal session and the terminal bundle say to each other: the one call that makes a screen, and the handle a session writes a shell's output through and shows the screen by.
 *
 * A Terminal tab's screen is drawn by xterm.js (`@xterm/xterm`) and its
 * addons, which are too large for the bundle every window parses, so they
 * ship as a bundle of their own (`terminal.js` and `terminal.css`, built from
 * `./index.ts` and `./index.css`) that the tab loads the first time a
 * terminal is shown, as a File tab loads its tree. That bundle exports one
 * module, `terminal`, and this file is the whole of what the two
 * share: no xterm type crosses, only text, bytes, and sizes, and nothing here
 * imports anything, so the bundle carries none of the panel's libraries.
 *
 * Note that what crosses here is a shell's own bytes, which go to the screen
 * and nowhere else: never into app state, a trace, or a counted event
 * (AGENTS.md's Never list).
 */

/** A terminal's size in character cells, as a shell is told it. */
export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

/** What the session hands the terminal when it makes it. */
export interface TerminalProps {
  /** What the user typed or pasted, as the shell is to read it. */
  readonly onInput: (data: string) => void;
  /**
   * The size the terminal fits its box at: first once it has been fitted to
   * a box with room, then each time that changes. A box with no room, as a
   * hidden tab's, is never fitted to.
   */
  readonly onResize: (size: TerminalSize) => void;
  /** A link in the output pressed with ⌘ held, as a terminal on a Mac opens one. */
  readonly onLink: (url: string) => void;
}

/** Which way a find over the scrollback goes: to the next match, the one before, or the query as typed, keeping to the match it was at. */
export const TERMINAL_FIND = {
  NEXT: "next",
  PREVIOUS: "previous",
  TYPED: "typed",
} as const;

export type TerminalFindWay = (typeof TERMINAL_FIND)[keyof typeof TERMINAL_FIND];

/** What a find over the scrollback says of its matches: how many, and which the find is at, -1 for none. */
interface TerminalFindTally {
  readonly count: number;
  readonly at: number;
  /** Whether there are more matches than the find counts. */
  readonly more: boolean;
}

/** A find over the terminal's scrollback, every match tinted where it stands and the one it is at brought into view. */
export interface TerminalFind {
  readonly find: (query: string, way: TerminalFindWay) => void;
  /** Takes every match's tint away, as the find closes. */
  readonly clear: () => void;
  /** Hears the tally each time a find changes it, until the answer is called. */
  readonly onTally: (listener: (tally: TerminalFindTally) => void) => () => void;
  /** The words selected on the screen, which ⌘F seeds a find with; empty with none. */
  readonly selection: () => string;
}

/**
 * One terminal's screen, made once for a terminal's whole life and shown in
 * whichever box its tab draws, as a terminal keeps its screen while its tab
 * is hidden. Out of a box it goes on drawing what its shell prints, so its
 * scrollback and its acks keep up.
 */
export interface TerminalHandle {
  /**
   * Draws a shell's output, calling `written` once it is on the screen, which
   * is what a sender holding back on unacknowledged output waits for.
   */
  readonly write: (data: string | Uint8Array, written: () => void) => void;
  /** Shows the screen in `host`, fitted to it, until `detach`. */
  readonly attach: (host: HTMLElement) => void;
  /** Takes the screen out of its box, keeping everything it holds. */
  readonly detach: () => void;
  /** Dims the output, as while no shell is connected. */
  readonly dim: (dimmed: boolean) => void;
  readonly focus: () => void;
  readonly find: TerminalFind;
  readonly dispose: () => void;
}

/** What the terminal bundle's entry exports, which the panel imports the first time it is needed (`../bundle-loader.ts`). */
export interface TerminalModule {
  readonly create: (props: TerminalProps) => TerminalHandle;
}
