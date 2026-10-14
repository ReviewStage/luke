/**
 * tmux.ts -- a Terminal tab's shells as tmux sessions in the agent's sandbox: the commands that start, name, end, and list them, and the list read back.
 *
 * Each shell a developer opens is a tmux session named for its id, so it
 * outlives any connection to it: a dropped socket, the relay's bound, or a
 * sleeping laptop reattaches to the same process. A session's name carries
 * the id alone, its developer-given name rides as a session option, and
 * every command names its session exactly (`=`), since tmux would otherwise
 * take a prefix of one for another. Every command is an argv Luke writes;
 * nothing a developer typed is spliced into shell text. The sandbox's own
 * tmux settings, written as its image is prepared, keep tmux out of sight:
 * no status line, no mouse, and its output scrolling into the terminal's
 * own scrollback (`agent-runtime/sandbox.ts`).
 */

import type { TerminalSummary } from "@sidecar/features/terminal-wire";
import { readEither } from "@sidecar/wire/effect";
import { Result } from "effect";
import { unparsedWire, wireUuidSchema } from "../../core.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-shell.js";
import type { CommandAsk, CommandRun } from "../vercel-sandbox-api.js";

export const TMUX = {
  /** What a Terminal tab's session names start with; the rest is the shell's id. */
  SESSION_PREFIX: "luke-",
  /** The session option a developer-given name rides in. */
  TITLE_OPTION: "@luke_title",
  /** Where a new shell stands: the agent's checkout. */
  START_DIRECTORY: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
} as const;

/**
 * The sandbox's own tmux settings, written to `/etc/tmux.conf` as its image
 * is prepared (`agent-runtime/sandbox.ts`): tmux kept out of sight, with no
 * status line and no mouse, so the terminal's own selection and scrollback
 * work, its output scrolling into that scrollback rather than an alternate
 * screen; the newest window's size, so two windows on one shell size it to
 * the last one used; and no shell history written to a file the agent could
 * read, since what a developer types is theirs.
 */
export const TMUX_SETTINGS: readonly string[] = [
  "set -g status off",
  "set -g mouse off",
  "set -sg escape-time 0",
  "set -g history-limit 50000",
  "set -g window-size latest",
  'set -g default-terminal "tmux-256color"',
  'set -ga terminal-overrides ",xterm*:smcup@:rmcup@"',
  "set-environment -g HISTFILE /dev/null",
];

/** The foreground commands that are a shell at its prompt, so nothing else runs there. */
const SHELLS: ReadonlySet<string> = new Set(["bash", "zsh", "sh", "dash", "fish"]);

/** The unit separator, between a listed session's fields: no name tmux prints and no printable title carries it. */
const FIELD = "\u001f";

/** What `list-sessions` prints for each session, in this order. */
const LIST_FORMAT = [
  "#{session_name}",
  "#{session_created}",
  `#{${TMUX.TITLE_OPTION}}`,
  "#{pane_current_command}",
  "#{pane_current_path}",
].join(FIELD);

const readId = readEither(wireUuidSchema);

/** The session a shell is, by its id. */
function sessionOf(terminalId: string): string {
  return `${TMUX.SESSION_PREFIX}${terminalId}`;
}

/** The exact target of a shell's session, which tmux matches whole rather than by prefix. */
function targetOf(terminalId: string): string {
  return `=${sessionOf(terminalId)}`;
}

function tmux(args: readonly string[]): CommandAsk {
  return { command: "tmux", args };
}

/** Lists every session tmux holds, in the fields `terminalsOf` reads. */
export function listTerminals(): CommandAsk {
  return tmux(["list-sessions", "-F", LIST_FORMAT]);
}

/** Starts a shell detached in the agent's checkout, under its id, named where the developer named it. */
export function startTerminal(terminalId: string, title: string | undefined): CommandAsk {
  const start = ["new-session", "-d", "-s", sessionOf(terminalId), "-c", TMUX.START_DIRECTORY];
  return tmux(
    title === undefined
      ? start
      : [...start, ";", "set-option", "-t", targetOf(terminalId), TMUX.TITLE_OPTION, title],
  );
}

/** Names a shell anew. */
export function renameTerminal(terminalId: string, title: string): CommandAsk {
  return tmux(["set-option", "-t", targetOf(terminalId), TMUX.TITLE_OPTION, title]);
}

/** Ends a shell, and whatever it was running. */
export function killTerminal(terminalId: string): CommandAsk {
  return tmux(["kill-session", "-t", targetOf(terminalId)]);
}

/**
 * The shells a list printed, oldest first: only the sessions a Terminal tab
 * started, each named as the developer named it or as its foreground
 * command is, and running where that command is not the shell at its
 * prompt. A tmux with no session left exits nonzero with nothing listed,
 * which is no shells.
 */
export function terminalsOf(run: CommandRun): readonly TerminalSummary[] {
  if (run.exitCode !== 0) return [];
  const listed = run.stdout.split("\n").flatMap((line) => {
    const [name, created, title, command, cwd] = line.split(FIELD);
    if (name === undefined || !name.startsWith(TMUX.SESSION_PREFIX)) return [];
    const id = readId(unparsedWire(name.slice(TMUX.SESSION_PREFIX.length)));
    if (Result.isFailure(id)) return [];
    const foreground = command ?? "";
    return [
      {
        created: Number(created ?? 0),
        terminal: {
          id: id.success,
          title: title === undefined || title === "" ? foreground : title,
          command: foreground,
          cwd: cwd ?? "",
          running: foreground !== "" && !SHELLS.has(foreground),
        },
      },
    ];
  });
  return listed.sort((a, b) => a.created - b.created).map((row) => row.terminal);
}
