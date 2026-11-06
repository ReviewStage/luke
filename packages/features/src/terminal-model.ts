import { SHELL_EXITED_WORDS } from "./words.js";

export const TERMINAL_STATE = {
  CONNECTING: "connecting",
  ATTACHED: "attached",
  RECONNECTING: "reconnecting",
  IDLE: "idle",
  STOPPED: "stopped",
  RESUMING: "resuming",
  STARTING: "starting",
  EXITED: "exited",
  UNREACHABLE: "unreachable",
} as const;

type TerminalStateKind = (typeof TERMINAL_STATE)[keyof typeof TERMINAL_STATE];

export const TERMINAL_UNREACHED = {
  SERVICE: "service",
  SANDBOX: "sandbox",
  SNAPSHOT_GONE: "snapshot-gone",
  NOT_FOUND: "not-found",
  RELAY: "relay",
  MIRROR: "mirror",
  SHELL: "shell",
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

export const TERMINAL_ACTION = {
  RETRY: "retry",
  RESUME: "resume",
} as const;

export type TerminalAction = (typeof TERMINAL_ACTION)[keyof typeof TERMINAL_ACTION];

export interface TerminalBar {
  readonly words: string;
  readonly note?: string | undefined;
  readonly since?: number | undefined;
  readonly action?: { readonly kind: TerminalAction; readonly label: string } | undefined;
  readonly busy: boolean;
  readonly late: boolean;
}

export interface TerminalLook {
  readonly words: string;
  readonly bar: TerminalBar | undefined;
  readonly phoneBar: TerminalBar | undefined;
  readonly line: string | undefined;
  readonly dim: boolean;
}

const RESUME_TAKES = "~5 s";

const RETRY = { kind: TERMINAL_ACTION.RETRY, label: "Retry now" } as const;
const RESUME = { kind: TERMINAL_ACTION.RESUME, label: "Resume sandbox" } as const;

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

function exitedLine(code: number | undefined): string {
  const status = code === undefined ? "" : ` with code ${code}`;
  return `[Process exited${status}. Press any key for a new shell …]`;
}

export function terminalLook(state: TerminalState): TerminalLook {
  switch (state.kind) {
    case TERMINAL_STATE.CONNECTING:
      return {
        words: "connecting…",
        bar: undefined,
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
    case TERMINAL_STATE.RECONNECTING:
      return {
        words: "reconnecting…",
        bar: { words: "Connection lost. Reconnecting…", action: RETRY, busy: true, late: true },
        phoneBar: undefined,
        line: undefined,
        dim: true,
      };
    case TERMINAL_STATE.IDLE:
      return {
        words: "disconnected",
        bar: undefined,
        phoneBar: undefined,
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
        phoneBar: undefined,
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
        phoneBar: undefined,
        line: undefined,
        dim: true,
      };
    case TERMINAL_STATE.STARTING:
      return {
        words: "waiting for sandbox",
        bar: { words: "Waiting for the agent to open its sandbox…", busy: true, late: false },
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
