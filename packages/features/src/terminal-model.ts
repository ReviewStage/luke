/**
 * terminal-model.ts -- where a Terminal tab's connection stands, and what the tab says of it, the way a terminal says it.
 *
 * A state the developer should know of is one slim bar over the screen, with
 * one text action and its key where it has something to do; nothing is ever
 * written into the shell's own screen. The scrollback stays under the bar,
 * dimmed while no shell is connected. The bar beside the agent's name says
 * the state in a word or two. There are no cards, icons, or pills.
 *
 * Most states are the host's, said on the shell's port
 * (`TERMINAL_CONNECTION`); "resuming" is the tab's own, between the click on
 * Resume and its answer, and "unreachable" is the tab's own too, for a read
 * the service could not answer or a relay the deployment does not serve. Its
 * bar names which it was, where that is known, so a developer knows whether
 * to wait, retry, or tell whoever runs the deployment.
 */

import {
  MIRROR_FAILURE,
  MIRROR_STANDING,
  type MirrorFailure,
  type MirrorStanding,
} from "./mirror-steps.js";
import { SHELL_EXITED_WORDS } from "./words.js";

/** Where a Terminal tab's connection stands. */
export const TERMINAL_STATE = {
  /** The tab is finding its shell, or the socket is opening. */
  CONNECTING: "connecting",
  ATTACHED: "attached",
  /** The socket dropped and the host is reconnecting by itself. */
  RECONNECTING: "reconnecting",
  /** Ended after ten minutes with nothing typed, printed, or shown, or by the host as a sign-out ends it; a key reconnects. */
  IDLE: "idle",
  /** The sandbox is stopped; the tab resumes it once it is shown. */
  STOPPED: "stopped",
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
  /** Our service could not be reached, or did not answer. */
  SERVICE: "service",
  /** The service answered, and the agent's sandbox did not: Vercel Sandbox's API, or tmux in the sandbox. */
  SANDBOX: "sandbox",
  /** The agent's sandbox can never resume: its snapshot is gone, its saved files with it. */
  SNAPSHOT_GONE: "snapshot-gone",
  /** The service holds no such agent or shell for this account. */
  NOT_FOUND: "not-found",
  /** The deployment serves no terminal relay. */
  RELAY: "relay",
  /** A Local tab's: the agent's files could not be mirrored on this Mac. */
  MIRROR: "mirror",
  /** A Local tab's: no shell could be opened in the mirror. */
  SHELL: "shell",
} as const;

type TerminalUnreached = (typeof TERMINAL_UNREACHED)[keyof typeof TERMINAL_UNREACHED];

export type TerminalState =
  | {
      readonly kind: Exclude<
        TerminalStateKind,
        typeof TERMINAL_STATE.EXITED | typeof TERMINAL_STATE.UNREACHABLE
      >;
    }
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

/** What the tab says of a state: its word beside the agent's name, its bar, and whether the scrollback is dimmed. */
export interface TerminalLook {
  readonly words: string;
  readonly bar: TerminalBar | undefined;
  /** The bar a phone draws where the wide layout's title bar is the only place that says the state; the wide layout leaves it out. */
  readonly phoneBar: TerminalBar | undefined;
  readonly dim: boolean;
}

const RETRY = { kind: TERMINAL_ACTION.RETRY, label: "Retry now" } as const;

/** What the unreachable bar says, by why. */
const UNREACHED_WORDS = {
  [TERMINAL_UNREACHED.SERVICE]: "The service did not answer.",
  [TERMINAL_UNREACHED.SANDBOX]: "The agent’s sandbox didn’t answer.",
  [TERMINAL_UNREACHED.SNAPSHOT_GONE]:
    "This sandbox shut down after being idle. Send the agent a message to start a fresh one.",
  [TERMINAL_UNREACHED.NOT_FOUND]: "Could not find this agent’s shell.",
  [TERMINAL_UNREACHED.RELAY]: "The terminal service isn’t set up on this deployment.",
  [TERMINAL_UNREACHED.MIRROR]: "Could not mirror this agent’s files on this Mac.",
  [TERMINAL_UNREACHED.SHELL]: "Could not open a shell in this agent’s files.",
} as const satisfies Record<TerminalUnreached, string>;

/** The bar a shell that ended leaves, its status where the host said it. */
function exitedBar(code: number | undefined): TerminalBar {
  const status = code === undefined ? "" : ` with code ${code}`;
  return {
    words: `Process exited${status}. Press any key for a new shell.`,
    busy: false,
    late: false,
  };
}

/** Why a Local tab's mirror failed, as its bar says it before it tries again. */
const MIRROR_FAILURE_WORDS = {
  [MIRROR_FAILURE.UNREACHABLE]: "The service did not answer",
  [MIRROR_FAILURE.REFUSED]: "The service refused the mirror",
  [MIRROR_FAILURE.NOT_RUNNING]: "The agent’s sandbox is not running",
  [MIRROR_FAILURE.UNAVAILABLE]: "The agent’s sandbox did not answer",
  [MIRROR_FAILURE.CLOSED]: "The connection to the agent’s sandbox closed",
  [MIRROR_FAILURE.NO_REPOSITORY]: "The agent has no repository",
  [MIRROR_FAILURE.EXITED]: "Git failed",
  [MIRROR_FAILURE.TIMED_OUT]: "Git took too long",
} as const satisfies Record<MirrorFailure, string>;

/** A Local tab's connecting look, saying which step of its mirror it waits on. */
function mirrorLook(standing: MirrorStanding): TerminalLook {
  const look = (words: string, sentence: string): TerminalLook => {
    const bar = { words: sentence, busy: true, late: true };
    return { words, bar, phoneBar: bar, dim: false };
  };
  switch (standing.kind) {
    case MIRROR_STANDING.WAITING:
      return look("waiting for sandbox", "Waiting for the agent’s sandbox…");
    case MIRROR_STANDING.CLONING:
      return look("cloning repository", "Cloning the repository on this Mac…");
    case MIRROR_STANDING.PREPARING:
      return look("preparing files", "Preparing the agent’s files on this Mac…");
    case MIRROR_STANDING.FAILED: {
      const code = standing.code === undefined ? "" : ` (code ${standing.code})`;
      return look("retrying", `${MIRROR_FAILURE_WORDS[standing.failure]}${code}. Trying again…`);
    }
  }
}

/** What the tab says of the state; a Local tab that is connecting says which step of its mirror it waits on, where the host said. */
export function terminalLook(state: TerminalState, mirror?: MirrorStanding): TerminalLook {
  switch (state.kind) {
    case TERMINAL_STATE.CONNECTING:
      if (mirror !== undefined) return mirrorLook(mirror);
      return {
        words: "connecting…",
        bar: undefined,
        // Note that it is late, so a connect that lands at once draws no bar, and the screen does not jump for it.
        phoneBar: { words: "Connecting…", busy: true, late: true },
        dim: false,
      };
    case TERMINAL_STATE.ATTACHED:
      return {
        words: "connected",
        bar: undefined,
        phoneBar: undefined,
        dim: false,
      };
    case TERMINAL_STATE.RECONNECTING:
      return {
        words: "reconnecting…",
        bar: { words: "Connection lost. Reconnecting…", action: RETRY, busy: true, late: true },
        phoneBar: undefined,
        dim: true,
      };
    case TERMINAL_STATE.IDLE:
      return {
        words: "disconnected",
        bar: {
          words: "Disconnected. Press any key to reconnect.",
          busy: false,
          late: false,
        },
        phoneBar: undefined,
        dim: true,
      };
    case TERMINAL_STATE.STOPPED:
      // Note that it draws no bar, because a tab shown is resuming it already, and a hidden tab draws nothing.
      return {
        words: "sandbox stopped",
        bar: undefined,
        phoneBar: undefined,
        dim: true,
      };
    case TERMINAL_STATE.STARTING:
      return {
        words: "waiting for sandbox",
        bar: { words: "Waiting for the agent to open its sandbox…", busy: true, late: false },
        phoneBar: undefined,
        dim: false,
      };
    case TERMINAL_STATE.EXITED:
      return {
        words: SHELL_EXITED_WORDS,
        bar: exitedBar(state.code),
        phoneBar: undefined,
        dim: false,
      };
    case TERMINAL_STATE.UNREACHABLE:
      return {
        words: "unreachable",
        bar: { words: UNREACHED_WORDS[state.why], action: RETRY, busy: false, late: false },
        phoneBar: undefined,
        dim: true,
      };
  }
}
