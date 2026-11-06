/**
 * terminal-model.ts -- where a Terminal tab's connection stands, and what the tab says of it, the way a terminal says it.
 *
 * A state that needs nothing from the developer is one dim line the
 * terminal prints at the end of its own scrollback, as a terminal prints
 * "[Process completed]"; a state with something to do is one slim bar over
 * the screen with one text action and its key. The scrollback stays under
 * either, dimmed while no shell is connected, the line itself kept readable. The bar beside the agent's
 * name says the state in a word or two. There are no cards, icons, or pills.
 *
 * The tab's shells run on this Mac, in the agent's mirror: "attached" and
 * "exited" are said on the shell's port (`TERMINAL_CONNECTION`), and
 * "unreachable" is the tab's own, for a mirror or a shell main could not
 * make, its bar naming which, so a developer knows what to retry.
 */

import { SHELL_EXITED_WORDS } from "./words.js";

/** Where a Terminal tab's connection stands. */
export const TERMINAL_STATE = {
  /** The tab is finding the agent's mirror, opening its shell, or attaching. */
  CONNECTING: "connecting",
  ATTACHED: "attached",
  /** The shell ended; a key opens a new one. */
  EXITED: "exited",
  /** The mirror or the shell could not be made; the bar's action asks again. */
  UNREACHABLE: "unreachable",
} as const;

/** Why the tab could not reach its shell. */
export const TERMINAL_UNREACHED = {
  /** The agent's files could not be mirrored on this Mac. */
  MIRROR: "mirror",
  /** No shell could be opened in the mirror. */
  SHELL: "shell",
} as const;

type TerminalUnreached = (typeof TERMINAL_UNREACHED)[keyof typeof TERMINAL_UNREACHED];

export type TerminalState =
  | { readonly kind: typeof TERMINAL_STATE.CONNECTING | typeof TERMINAL_STATE.ATTACHED }
  | { readonly kind: typeof TERMINAL_STATE.EXITED; readonly code: number | undefined }
  | { readonly kind: typeof TERMINAL_STATE.UNREACHABLE; readonly why: TerminalUnreached };

/** What the bar's one action does. */
export const TERMINAL_ACTION = {
  RETRY: "retry",
} as const;

export type TerminalAction = (typeof TERMINAL_ACTION)[keyof typeof TERMINAL_ACTION];

/** The slim bar over the screen: its words, its one action, and whether it is waiting on something. */
export interface TerminalBar {
  readonly words: string;
  readonly action?: { readonly kind: TerminalAction; readonly label: string } | undefined;
  readonly busy: boolean;
  /** Whether it shows only once the state has held a second, so a blip that heals at once is never seen. */
  readonly late: boolean;
}

/** What the tab says of a state: its word beside the agent's name, its bar or its line, and whether the scrollback is dimmed. */
export interface TerminalLook {
  readonly words: string;
  readonly bar: TerminalBar | undefined;
  /** The bar a phone draws where the wide layout's title bar is the only place that says the state; the wide layout leaves it out. */
  readonly phoneBar: TerminalBar | undefined;
  /** The line the terminal prints at the end of its scrollback, as it enters the state. */
  readonly line: string | undefined;
  readonly dim: boolean;
}

const RETRY = { kind: TERMINAL_ACTION.RETRY, label: "Retry now" } as const;

/** What the unreachable bar says, by why. */
const UNREACHED_WORDS = {
  [TERMINAL_UNREACHED.MIRROR]: "Could not mirror this agent’s files on this Mac.",
  [TERMINAL_UNREACHED.SHELL]: "Could not open a shell in this agent’s files.",
} as const satisfies Record<TerminalUnreached, string>;

/** The line a shell that ended leaves, its status where the shell said it. */
function exitedLine(code: number | undefined): string {
  const status = code === undefined ? "" : ` with code ${code}`;
  return `[Process exited${status}. Press any key for a new shell …]`;
}

/** What the tab says of the state. */
export function terminalLook(state: TerminalState): TerminalLook {
  switch (state.kind) {
    case TERMINAL_STATE.CONNECTING:
      return {
        words: "connecting…",
        bar: undefined,
        // Note that it is late, so a connect that lands at once draws no bar, and the screen does not jump for it.
        phoneBar: { words: "Connecting…", busy: true, late: true },
        line: undefined,
        dim: false,
      };
    case TERMINAL_STATE.ATTACHED:
      return {
        words: "connected",
        bar: undefined,
        phoneBar: undefined,
        line: undefined,
        dim: false,
      };
    case TERMINAL_STATE.EXITED:
      return {
        words: SHELL_EXITED_WORDS,
        bar: undefined,
        phoneBar: undefined,
        line: exitedLine(state.code),
        dim: false,
      };
    case TERMINAL_STATE.UNREACHABLE:
      return {
        words: "unreachable",
        bar: { words: UNREACHED_WORDS[state.why], action: RETRY, busy: false, late: false },
        phoneBar: undefined,
        line: undefined,
        dim: true,
      };
  }
}
