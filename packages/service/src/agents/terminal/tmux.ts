/**
 * tmux.ts -- a Terminal tab's shells as tmux sessions in the agent's sandbox: the commands that start, name, end, and list them, and the list read back.
 *
 * Each shell a developer opens is a tmux session named for its id, so it
 * outlives any connection to it: a dropped socket, the relay's bound, or a
 * sleeping laptop reattaches to the same process. A session's name carries
 * the id alone, its developer-given name rides as a session option, and
 * every command names its session exactly (`=`), since tmux would otherwise
 * take a prefix of one for another. Every command is a script Luke writes,
 * and what a developer typed reaches it only as a positional argument, never
 * spliced into its text. Each script first installs tmux where the sandbox
 * was prepared before its image carried it, so an older agent's sandbox
 * opens shells too. The sandbox's own tmux settings, written as its image is
 * prepared or as tmux is installed, keep tmux out of sight: no status line,
 * no mouse, and its output scrolling into the terminal's own scrollback
 * (`agent-runtime/sandbox.ts`).
 *
 * tmux prints a control character in a format's value as `_`, so a list
 * cannot separate its fields with one; each free-text field is read on its
 * own and travels in base64, which no name, title, or path can break.
 */

import type { TerminalSummary } from "@luke/features/terminal-wire";
import { readEither } from "@luke/wire/effect";
import { Result } from "effect";
import { unparsedWire, wireUuidSchema } from "../../core.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
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
const TMUX_SETTINGS: readonly string[] = [
  "set -g status off",
  "set -g mouse off",
  "set -sg escape-time 0",
  "set -g history-limit 50000",
  "set -g window-size latest",
  'set -g default-terminal "tmux-256color"',
  'set -ga terminal-overrides ",xterm*:smcup@:rmcup@"',
  "set-environment -g HISTFILE /dev/null",
];

/** `sudo` where the sandbox's user is not root, so an install and the settings file reach the system. */
const SUDO_LINE = 'SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo -n"';

/** Installs tmux with the system's own package manager, `$SUDO` as `SUDO_LINE` set it. */
const INSTALL_TMUX =
  "if command -v dnf >/dev/null 2>&1; then $SUDO dnf install -y tmux; else $SUDO apt-get update && $SUDO apt-get install -y tmux; fi";

/** Writes `TMUX_SETTINGS` to `/etc/tmux.conf`, `$SUDO` as `SUDO_LINE` set it. */
const CONFIGURE_TMUX = `printf '%s\\n' ${TMUX_SETTINGS.map((line) => `'${line}'`).join(" ")} | $SUDO tee /etc/tmux.conf >/dev/null`;

/** What the image's preparation runs: tmux installed where it is missing, and its settings written. */
export const PREPARE_TMUX: readonly string[] = [
  SUDO_LINE,
  "if ! command -v tmux >/dev/null 2>&1; then",
  `  ${INSTALL_TMUX}`,
  "fi",
  CONFIGURE_TMUX,
  "tmux -V",
];

/** What every command runs first: tmux and its settings, where a sandbox prepared before its image carried tmux has neither. */
const ENSURE_TMUX = [
  "if ! command -v tmux >/dev/null 2>&1; then",
  `  ${SUDO_LINE}`,
  `  ${INSTALL_TMUX} >&2 || exit 1`,
  `  ${CONFIGURE_TMUX}`,
  "fi",
].join("\n");

/** The foreground commands that are a shell at its prompt, so nothing else runs there. */
const SHELLS: ReadonlySet<string> = new Set(["bash", "zsh", "sh", "dash", "fish"]);

/**
 * Lists the tab's sessions, one line each: the session's name, when it was
 * created, then its title, foreground command, and folder, each in base64.
 * A tmux with no server holds no session, which is an empty list; any other
 * failure exits nonzero.
 */
const LIST_SCRIPT = [
  ENSURE_TMUX,
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

/** A script run with its arguments as positional parameters, so none of them is ever read as shell text. */
function script(text: string, args: readonly string[] = []): CommandAsk {
  return { command: "sh", args: ["-c", text, "sh", ...args] };
}

/** One tmux command, once tmux is there. */
function tmux(args: readonly string[]): CommandAsk {
  return script(`${ENSURE_TMUX}\nexec tmux "$@"`, args);
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

/** How the shell check exits where tmux ran and holds no such session: apart from tmux's own 1, which a failed install also exits with. */
export const TMUX_EXIT = { NO_SESSION: 3 } as const;

/** Whether a shell stands: exit 0 where its session does, `TMUX_EXIT.NO_SESSION` where tmux holds none by that name, and anything else where tmux could not be asked. */
export function holdsTerminal(terminalId: string): CommandAsk {
  return script(
    `${ENSURE_TMUX}\ntmux has-session -t "$1" 2>/dev/null || exit ${TMUX_EXIT.NO_SESSION}`,
    [targetOf(terminalId)],
  );
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
