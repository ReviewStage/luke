import type { TerminalSummary } from "@repo/features/terminal-wire";
import { readEither } from "@repo/wire/effect";
import { Result } from "effect";
import { unparsedWire, wireUuidSchema } from "../../core.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import type { CommandAsk, CommandRun } from "../vercel-sandbox-api.js";

export const TMUX = {
  SESSION_PREFIX: "terminal-",
  TITLE_OPTION: "@terminal_title",
  START_DIRECTORY: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
  SOCKET: "terminal",
} as const;

const SHELLS: ReadonlySet<string> = new Set(["bash", "zsh", "sh", "dash", "fish"]);

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

function fieldOf(encoded: string | undefined): string {
  return Buffer.from(encoded ?? "", "base64")
    .toString("utf8")
    .replace(/\n$/, "");
}

const readId = readEither(wireUuidSchema);

function sessionOf(terminalId: string): string {
  return `${TMUX.SESSION_PREFIX}${terminalId}`;
}

function targetOf(terminalId: string): string {
  return `=${sessionOf(terminalId)}`;
}

function optionTargetOf(terminalId: string): string {
  return `${targetOf(terminalId)}:`;
}

function script(text: string, args: readonly string[] = []): CommandAsk {
  return {
    command: "sh",
    args: ["-c", `tmux() { command tmux -L ${TMUX.SOCKET} "$@"; }\n${text}`, "sh", ...args],
  };
}

function tmux(args: readonly string[]): CommandAsk {
  return script(`exec tmux -L ${TMUX.SOCKET} "$@"`, args);
}

export function listTerminals(): CommandAsk {
  return script(LIST_SCRIPT);
}

export function startTerminal(terminalId: string, title: string | undefined): CommandAsk {
  const start = ["new-session", "-d", "-s", sessionOf(terminalId), "-c", TMUX.START_DIRECTORY];
  return tmux(
    title === undefined
      ? start
      : [...start, ";", "set-option", "-t", optionTargetOf(terminalId), TMUX.TITLE_OPTION, title],
  );
}

export function attachTerminal(terminalId: string): CommandAsk {
  return tmux(["attach-session", "-t", targetOf(terminalId)]);
}

export const TMUX_EXIT = { NO_SESSION: 3 } as const;

export function holdsTerminal(terminalId: string): CommandAsk {
  return script(`tmux has-session -t "$1" 2>/dev/null || exit ${TMUX_EXIT.NO_SESSION}`, [
    targetOf(terminalId),
  ]);
}

export function renameTerminal(terminalId: string, title: string): CommandAsk {
  return tmux(["set-option", "-t", optionTargetOf(terminalId), TMUX.TITLE_OPTION, title]);
}

export function killTerminal(terminalId: string): CommandAsk {
  return tmux(["kill-session", "-t", targetOf(terminalId)]);
}

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
