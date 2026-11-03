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
 * (`agent-runtime/sandbox-image.ts`), and nothing here installs them, since a
 * Terminal's shell reaches no root: the settings keep tmux out of sight, with
 * no status line, no mouse, and its output scrolling into the terminal's own
 * scrollback. Every command runs with every capability dropped
 * (`sandbox-capabilities.ts`), the command that starts tmux's server among
 * them, so the server, on a socket of its own (`TMUX.SOCKET`), and every
 * shell it starts hold none: a shell cannot
 * read another process's environment, a file its mode keeps from the
 * sandbox's user, or reach root through sudo, which the emptied bounding
 * set refuses.
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
import { WITHOUT_CAPABILITIES } from "../sandbox-capabilities.js";
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
   * its own rather than tmux's default, because a server started on the
   * default before shells dropped their capabilities still holds them and
   * would start each new shell with them; this one is only ever started
   * without, and the old one ends as its sandbox next stops.
   */
  SOCKET: "terminal",
} as const;

/**
 * The server, session prefix, and title option a sandbox running since
 * before the product's rename started its shells under, which are still
 * listed and reached there and never started on. Note that a stop ends
 * tmux's server and every shell it holds, so this goes once every sandbox
 * running when the rename deployed has stopped: an hour on, at the
 * sandbox's own timeout (`CODER.SANDBOX_TIMEOUT_MS`).
 */
const TMUX_BEFORE_RENAME = {
  SESSION_PREFIX: "luke-",
  TITLE_OPTION: "@luke_title",
  SOCKET: "luke-unprivileged",
} as const;

/** Each server a shell may stand on, today's first. */
const TMUX_SERVERS = [TMUX, TMUX_BEFORE_RENAME] as const;

/**
 * The sandbox's own tmux settings, written to `/etc/tmux.conf` as its image
 * is prepared (`agent-runtime/sandbox-image.ts`): tmux kept out of sight, with no
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

/** `sudo` where the sandbox's user is not root, so an install and the settings file reach the system as the image is prepared. */
export const SUDO_LINE = 'SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo -n"';

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

/** The foreground commands that are a shell at its prompt, so nothing else runs there. */
const SHELLS: ReadonlySet<string> = new Set(["bash", "zsh", "sh", "dash", "fish"]);

/**
 * Lists the tab's sessions, one line each: the session's name, when it was
 * created, then its title, foreground command, and folder, each in base64.
 * A tmux with no server holds no session, which is an empty list; any other
 * failure exits nonzero.
 */
const LIST_SCRIPT = [
  "list() {",
  `  listed=$(command tmux -L "$1" list-sessions -F '#{session_name} #{session_created}' 2>&1) || {`,
  '    case "$listed" in *"no server running"*|*"rror connecting to"*) return 0 ;; esac',
  `    printf '%s\\n' "$listed" >&2`,
  "    exit 1",
  "  }",
  `  printf '%s\\n' "$listed" | while read -r name created; do`,
  `    case "$name" in "$2"*) ;; *) continue ;; esac`,
  `    printf '%s %s %s %s %s\\n' "$name" "$created" "$(field "$1" "$name" "#{$3}")" "$(field "$1" "$name" '#{pane_current_command}')" "$(field "$1" "$name" '#{pane_current_path}')"`,
  "  done",
  "}",
  `field() { command tmux -L "$1" display-message -p -t "=$2:" "$3" | base64 | tr -d '\\n'; }`,
  ...TMUX_SERVERS.map(
    (server) => `list ${server.SOCKET} ${server.SESSION_PREFIX} ${server.TITLE_OPTION}`,
  ),
].join("\n");

/**
 * Finds the server holding the shell whose id is `$1`, setting `sock`,
 * `session`, and `title` to its socket, the shell's session, and the
 * option its name rides in: today's server's, unless only the server from
 * before the rename holds the shell.
 */
const FIND_SHELL = [
  "found() {",
  `  sock=${TMUX.SOCKET} session="${TMUX.SESSION_PREFIX}$1" title=${TMUX.TITLE_OPTION}`,
  `  if ! command tmux -L ${TMUX.SOCKET} has-session -t "=${TMUX.SESSION_PREFIX}$1" 2>/dev/null && command tmux -L ${TMUX_BEFORE_RENAME.SOCKET} has-session -t "=${TMUX_BEFORE_RENAME.SESSION_PREFIX}$1" 2>/dev/null; then`,
  `    sock=${TMUX_BEFORE_RENAME.SOCKET} session="${TMUX_BEFORE_RENAME.SESSION_PREFIX}$1" title=${TMUX_BEFORE_RENAME.TITLE_OPTION}`,
  "  fi",
  "}",
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

/**
 * A script run with every capability dropped, its arguments as positional
 * parameters, so none of them is ever read as shell text.
 */
function script(text: string, args: readonly string[] = []): CommandAsk {
  return {
    command: WITHOUT_CAPABILITIES.COMMAND,
    args: [
      ...WITHOUT_CAPABILITIES.ARGS,
      "sh",
      "-c",
      `tmux() { command tmux -L ${TMUX.SOCKET} "$@"; }\n${text}`,
      "sh",
      ...args,
    ],
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

/** One command on the shell whose id is the script's first argument, on whichever server holds it (`FIND_SHELL`). */
function onShell(text: string, terminalId: string, args: readonly string[] = []): CommandAsk {
  return script(`${FIND_SHELL}\nfound "$1"\n${text}`, [terminalId, ...args]);
}

/** Attaches a terminal's PTY to a shell that stands; one that does not is never started here, which only the shell route does. */
export function attachTerminal(terminalId: string): CommandAsk {
  return onShell('exec tmux -L "$sock" attach-session -t "=$session"', terminalId);
}

/** How the shell check exits where tmux ran and holds no such session: apart from tmux's own 1, and the 127 of a `setpriv` that could not drop the capabilities or a tmux missing. */
export const TMUX_EXIT = { NO_SESSION: 3 } as const;

/** Whether a shell stands: exit 0 where its session does, `TMUX_EXIT.NO_SESSION` where tmux holds none by that name, and anything else where tmux could not be asked. */
export function holdsTerminal(terminalId: string): CommandAsk {
  return onShell(
    `command tmux -L "$sock" has-session -t "=$session" 2>/dev/null || exit ${TMUX_EXIT.NO_SESSION}`,
    terminalId,
  );
}

/** Names a shell anew. */
export function renameTerminal(terminalId: string, title: string): CommandAsk {
  return onShell('exec tmux -L "$sock" set-option -t "=$session:" "$title" "$2"', terminalId, [
    title,
  ]);
}

/** Ends a shell, and whatever it was running. */
export function killTerminal(terminalId: string): CommandAsk {
  return onShell('exec tmux -L "$sock" kill-session -t "=$session"', terminalId);
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
    const prefix = TMUX_SERVERS.find((server) =>
      name?.startsWith(server.SESSION_PREFIX),
    )?.SESSION_PREFIX;
    if (name === undefined || prefix === undefined) return [];
    const id = readId(unparsedWire(name.slice(prefix.length)));
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
