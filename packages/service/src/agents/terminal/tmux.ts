/**
 * tmux.ts -- a Terminal tab's shells as tmux sessions in the agent's sandbox: the commands that start, name, end, and list them, and the list read back.
 *
 * Each shell a developer opens is a tmux session named for its id, so it
 * outlives any connection to it: a dropped socket, the relay's bound, or a
 * sleeping laptop reattaches to the same process. A session's name carries
 * the id alone, its developer-given name rides as a session option, and
 * every command names its session exactly (`=`), since tmux would otherwise
 * take a prefix of one for another. Every command is a script we write,
 * and what a developer typed reaches it only as a positional argument, never
 * spliced into its text. tmux and its settings come with the image
 * (`apps/web/agent-image/tmux.conf`), and nothing here installs them: the
 * settings keep tmux out of sight, with no status line, no mouse, and its
 * output scrolling into the terminal's own scrollback. Every command runs as
 * the sandbox's default user, on a server of its own (`TMUX.SOCKET`).
 *
 * tmux prints a control character in a format's value as `_`, so a list
 * cannot separate its fields with one; each free-text field is read on its
 * own and travels in base64, which no name, title, or path can break.
 */

import type { TerminalSummary } from "@repo/features/terminal-wire";
import { readEither } from "@repo/wire/effect";
import { Result } from "effect";
import { unparsedWire, wireUuidSchema } from "../../core.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import type { CommandAsk, CommandRun } from "../vercel-sandbox-api.js";

export const TMUX = {
  /** What a Terminal tab's session names start with; the rest is the shell's id. */
  SESSION_PREFIX: "terminal-",
  /** The session option a developer-given name rides in. */
  TITLE_OPTION: "@terminal_title",
  /** Where a new shell stands: the agent's checkout. */
  START_DIRECTORY: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
  /**
   * The socket every command names its server by. Note that it is a name of
   * its own rather than tmux's default, so a sandbox's old server on the
   * default, from before shells ran on this one, is never the one attached to.
   */
  SOCKET: "terminal",
} as const;

/** The foreground commands that are a shell at its prompt, so nothing else runs there. */
const SHELLS: ReadonlySet<string> = new Set(["bash", "zsh", "sh", "dash", "fish"]);

/**
 * Lists the tab's sessions, one line each: the session's name, when it was
 * created, then its title, foreground command, and folder, each in base64.
 * A tmux with no server holds no session, which is an empty list; any other
 * failure exits nonzero.
 */
const LIST_SCRIPT = [
  "listed=$(tmux list-sessions -F '#{session_name} #{session_created}' 2>&1) || {",
  '  case "$listed" in *"no server running"*|*"rror connecting to"*) exit 0 ;; esac',
  `  printf '%s\\n' "$listed" >&2`,
  "  exit 1",
  "}",
  `field() { tmux display-message -p -t "=$1:" "$2" | base64 | tr -d '\\n'; }`,
  `printf '%s\\n' "$listed" | while read -r name created; do`,
  `  case "$name" in ${TMUX.SESSION_PREFIX}*) ;; *) continue ;; esac`,
  `  printf '%s %s %s %s %s\\n' "$name" "$created" "$(field "$name" '#{${TMUX.TITLE_OPTION}}')" "$(field "$name" '#{pane_current_command}')" "$(field "$name" '#{pane_current_path}')"`,
  "done",
].join("\n");

/** One listed field read back from base64, less the newline tmux printed after it. */
function fieldOf(encoded: string | undefined): string {
  return Buffer.from(encoded ?? "", "base64")
    .toString("utf8")
    .replace(/\n$/, "");
}

const readId = readEither(wireUuidSchema);

/** The session a shell is, by its id. */
function sessionOf(terminalId: string): string {
  return `${TMUX.SESSION_PREFIX}${terminalId}`;
}

/** The exact target of a shell's session, which tmux matches whole rather than by prefix. */
function targetOf(terminalId: string): string {
  return `=${sessionOf(terminalId)}`;
}

/** The exact target of a shell's session as an option command takes it: the session's own pane, never a window of another's. */
function optionTargetOf(terminalId: string): string {
  return `${targetOf(terminalId)}:`;
}

/** A script, its arguments as positional parameters, so none of them is ever read as shell text. */
function script(text: string, args: readonly string[] = []): CommandAsk {
  return {
    command: "sh",
    args: ["-c", `tmux() { command tmux -L ${TMUX.SOCKET} "$@"; }\n${text}`, "sh", ...args],
  };
}

/** One tmux command, in place of the script's shell. */
function tmux(args: readonly string[]): CommandAsk {
  return script(`exec tmux -L ${TMUX.SOCKET} "$@"`, args);
}

/** Lists the tab's sessions, in the lines `terminalsOf` reads. */
export function listTerminals(): CommandAsk {
  return script(LIST_SCRIPT);
}

/** Starts a shell detached in the agent's checkout, under its id, named where the developer named it. */
export function startTerminal(terminalId: string, title: string | undefined): CommandAsk {
  const start = ["new-session", "-d", "-s", sessionOf(terminalId), "-c", TMUX.START_DIRECTORY];
  return tmux(
    title === undefined
      ? start
      : [...start, ";", "set-option", "-t", optionTargetOf(terminalId), TMUX.TITLE_OPTION, title],
  );
}

/** Attaches a terminal's PTY to a shell that stands; one that does not is never started here, which only the shell route does. */
export function attachTerminal(terminalId: string): CommandAsk {
  return tmux(["attach-session", "-t", targetOf(terminalId)]);
}

/** How the shell check exits where tmux ran and holds no such session: apart from tmux's own 1, and the 127 of a tmux missing. */
export const TMUX_EXIT = { NO_SESSION: 3 } as const;

/** Whether a shell stands: exit 0 where its session does, `TMUX_EXIT.NO_SESSION` where tmux holds none by that name, and anything else where tmux could not be asked. */
export function holdsTerminal(terminalId: string): CommandAsk {
  return script(`tmux has-session -t "$1" 2>/dev/null || exit ${TMUX_EXIT.NO_SESSION}`, [
    targetOf(terminalId),
  ]);
}

/** Names a shell anew. */
export function renameTerminal(terminalId: string, title: string): CommandAsk {
  return tmux(["set-option", "-t", optionTargetOf(terminalId), TMUX.TITLE_OPTION, title]);
}

/** Ends a shell, and whatever it was running. */
export function killTerminal(terminalId: string): CommandAsk {
  return tmux(["kill-session", "-t", targetOf(terminalId)]);
}

/**
 * The shells a list printed, oldest first: only the sessions a Terminal tab
 * started, each named as the developer named it or as its foreground
 * command is, and running where that command is not the shell at its
 * prompt. A list that failed is none at all, never an empty one.
 */
export function terminalsOf(run: CommandRun): readonly TerminalSummary[] | undefined {
  if (run.exitCode !== 0) return undefined;
  const listed = run.stdout.split("\n").flatMap((line) => {
    const [name, created, title, command, cwd] = line.split(" ");
    if (name === undefined || !name.startsWith(TMUX.SESSION_PREFIX)) return [];
    const id = readId(unparsedWire(name.slice(TMUX.SESSION_PREFIX.length)));
    if (Result.isFailure(id)) return [];
    const foreground = fieldOf(command);
    const named = fieldOf(title);
    return [
      {
        created: Number(created ?? 0),
        terminal: {
          id: id.success,
          title: named === "" ? foreground : named,
          command: foreground,
          cwd: fieldOf(cwd),
          running: foreground !== "" && !SHELLS.has(foreground),
        },
      },
    ];
  });
  return listed.sort((a, b) => a.created - b.created).map((row) => row.terminal);
}
