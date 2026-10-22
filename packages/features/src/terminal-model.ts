/**
 * terminal-model.ts -- where a Terminal tab's connection stands, and what the tab says of it, the way a terminal says it.
 *
 * A state that needs nothing from the developer is one dim line the
 * terminal prints at the end of its own scrollback, as a terminal prints
 * "[Process completed]"; a state with something to do is one slim bar over
 * the screen with one text action and its key. The scrollback stays under
 * either, dimmed while no shell is connected. The bar beside the agent's
 * name says the state in a word or two. There are no cards, icons, or pills.
 *
 * Most states are the host's, said on the shell's port
 * (`TERMINAL_CONNECTION`); "resuming" is the tab's own, between the click on
 * Resume and its answer, and "unreachable" is the tab's own too, for a read
 * the service could not answer or a relay the deployment does not serve. Its
 * bar names which it was, where that is known, so a developer knows whether
 * to wait, retry, or tell whoever runs the deployment.
 */

/** Where a Terminal tab's connection stands. */
export const TERMINAL_STATE = {
  /** The tab is finding its shell, or the socket is opening. */
  CONNECTING: "connecting",
  ATTACHED: "attached",
  /** The socket dropped and the host is reconnecting by itself. */
  RECONNECTING: "reconnecting",
  /** Closed after five minutes without typing; a key reconnects. */
  IDLE: "idle",
  /** The sandbox is stopped; only the developer's click resumes it. */
  STOPPED: "stopped",
  /** Resume was asked for and has not answered. */
  RESUMING: "resuming",
  /** The agent has not opened its sandbox yet. */
  STARTING: "starting",
  /** The shell ended; a key opens a new one. */
  EXITED: "exited",
  /** The service could not be reached; the bar's action asks again. */
  UNREACHABLE: "unreachable",
} as const;

type TerminalStateKind = (typeof TERMINAL_STATE)[keyof typeof TERMINAL_STATE];

/** Why the tab could not reach its shell. */
export const TERMINAL_UNREACHED = {
  /** Luke's service could not be reached, or did not answer. */
  SERVICE: "service",
  /** The service answered, and the agent's sandbox did not: Vercel Sandbox's API, or tmux in the sandbox. */
  SANDBOX: "sandbox",
  /** The service holds no such agent or shell for this account. */
  NOT_FOUND: "not-found",
  /** The deployment serves no terminal relay. */
  RELAY: "relay",
} as const;

type TerminalUnreached = (typeof TERMINAL_UNREACHED)[keyof typeof TERMINAL_UNREACHED];

export type TerminalState =
  | {
      readonly kind: Exclude<
        TerminalStateKind,
        | typeof TERMINAL_STATE.EXITED
        | typeof TERMINAL_STATE.RESUMING
        | typeof TERMINAL_STATE.UNREACHABLE
      >;
    }
  | { readonly kind: typeof TERMINAL_STATE.EXITED; readonly code: number | undefined }
  | { readonly kind: typeof TERMINAL_STATE.RESUMING; readonly since: number }
  | { readonly kind: typeof TERMINAL_STATE.UNREACHABLE; readonly why: TerminalUnreached };

/** What the bar's one action does. */
export const TERMINAL_ACTION = {
  RETRY: "retry",
  RESUME: "resume",
} as const;

export type TerminalAction = (typeof TERMINAL_ACTION)[keyof typeof TERMINAL_ACTION];

/** The slim bar over the screen: its words, a note after them, its one action, and whether it is waiting on something. */
export interface TerminalBar {
  readonly words: string;
  readonly note?: string | undefined;
  /** When what the bar waits on began, which its note counts from in place of words. */
  readonly since?: number | undefined;
  readonly action?: { readonly kind: TerminalAction; readonly label: string } | undefined;
  readonly busy: boolean;
  /** Whether it shows only once the state has held a second, so a blip that heals at once is never seen. */
  readonly late: boolean;
}

/** What the tab says of a state: its word beside the agent's name, its bar or its line, and whether the scrollback is dimmed. */
export interface TerminalLook {
  readonly words: string;
  readonly bar: TerminalBar | undefined;
  /** The line the terminal prints at the end of its scrollback, as it enters the state. */
  readonly line: string | undefined;
  readonly dim: boolean;
}

/** About how long a stopped sandbox takes to resume from its snapshot, which the stopped bar says before the click. */
const RESUME_TAKES = "~5 s";

const RETRY = { kind: TERMINAL_ACTION.RETRY, label: "Retry now" } as const;
const RESUME = { kind: TERMINAL_ACTION.RESUME, label: "Resume sandbox" } as const;

/** What the unreachable bar says, by why. */
const UNREACHED_WORDS = {
  [TERMINAL_UNREACHED.SERVICE]: "Luke's service did not answer.",
  [TERMINAL_UNREACHED.SANDBOX]: "The agent’s sandbox didn’t answer.",
  [TERMINAL_UNREACHED.NOT_FOUND]: "Couldn’t find this agent’s shell.",
  [TERMINAL_UNREACHED.RELAY]: "The terminal service isn’t set up on this deployment.",
} as const satisfies Record<TerminalUnreached, string>;

/** The line a shell that ended leaves, its status where the host said it. */
function exitedLine(code: number | undefined): string {
  const status = code === undefined ? "" : ` with code ${code}`;
  return `[Process exited${status}. Press any key for a new shell …]`;
}

/** What the tab says of the state. */
export function terminalLook(state: TerminalState): TerminalLook {
  switch (state.kind) {
    case TERMINAL_STATE.CONNECTING:
      return { words: "connecting…", bar: undefined, line: undefined, dim: false };
    case TERMINAL_STATE.ATTACHED:
      return { words: "connected", bar: undefined, line: undefined, dim: false };
    case TERMINAL_STATE.RECONNECTING:
      return {
        words: "reconnecting…",
        bar: { words: "Connection lost. Reconnecting…", action: RETRY, busy: true, late: true },
        line: undefined,
        dim: true,
      };
    case TERMINAL_STATE.IDLE:
      return {
        words: "disconnected",
        bar: undefined,
        line: "[Disconnected after 5 min without typing. Press any key to reconnect.]",
        dim: true,
      };
    case TERMINAL_STATE.STOPPED:
      return {
        words: "sandbox stopped",
        bar: {
          words: "Sandbox stopped.",
          note: RESUME_TAKES,
          action: RESUME,
          busy: false,
          late: false,
        },
        line: undefined,
        dim: true,
      };
    case TERMINAL_STATE.RESUMING:
      return {
        words: "resuming…",
        bar: {
          words: "Resuming sandbox… restoring snapshot",
          since: state.since,
          busy: true,
          late: false,
        },
        line: undefined,
        dim: true,
      };
    case TERMINAL_STATE.STARTING:
      return {
        words: "waiting for sandbox",
        bar: { words: "Waiting for the agent to open its sandbox…", busy: true, late: false },
        line: undefined,
        dim: false,
      };
    case TERMINAL_STATE.EXITED:
      return { words: "connected", bar: undefined, line: exitedLine(state.code), dim: false };
    case TERMINAL_STATE.UNREACHABLE:
      return {
        words: "unreachable",
        bar: { words: UNREACHED_WORDS[state.why], action: RETRY, busy: false, late: false },
        line: undefined,
        dim: true,
      };
  }
}
