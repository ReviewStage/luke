import { type ChildProcess, execFile, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

/**
 * mac-terminal.ts -- a terminal of this Mac that Luke draws in a tab of its own: a real pseudo-terminal running a script, its output handed out and its input taken in.
 *
 * The pseudo-terminal is the system's own `script`, so the shell sees a real
 * terminal (colours, prompts, line editing, Ctrl-C) and Luke links no native
 * code. The script is written to a folder only this user may open, and its
 * first line writes the terminal's device there, which a resize sets the
 * size of with `stty`. Closing a terminal hangs up every process on its
 * device and ends the `script` around them, and kills what is still
 * running five seconds later; quitting Luke closes every
 * terminal still open. What the terminal prints is handed to `onOutput` and
 * nothing else keeps it.
 */

/** The programs a terminal is made with: macOS's by default, another system's in a test. */
export interface MacTerminalTools {
  /** The `script` that makes the pseudo-terminal, and its arguments for running a file under bash. */
  readonly script: (file: string) => readonly [string, readonly string[]];
  /** The `stty` arguments that set the size of the terminal at `tty`. */
  readonly resize: (
    tty: string,
    cols: number,
    rows: number,
  ) => readonly [string, readonly string[]];
  /** The command that hangs up every process on the terminal at `tty`. */
  readonly hangUp: (tty: string) => readonly [string, readonly string[]];
  /** The command that prints the id of every process on the terminal at `tty`, one a line. */
  readonly processes: (tty: string) => readonly [string, readonly string[]];
}

/**
 * How macOS's `script` is started under Luke. Note that it refuses a socket
 * for its input ("tcgetattr/ioctl: Operation not supported on socket"), and
 * Node hands a child's input over a socket on macOS, a FIFO's included, so
 * `cat` relays it through a real pipe; once `script` ends, its `cat` is ended
 * too, so the wrapper ends with the terminal and says its exit code.
 */
const MACOS_SCRIPT_WRAPPER =
  'cat | { /usr/bin/script -q /dev/null /bin/bash "$1"; code=$?; pkill -P $$ -x cat; exit "$code"; }';

const MACOS_TERMINAL_TOOLS: MacTerminalTools = {
  script: (file) => ["/bin/sh", ["-c", MACOS_SCRIPT_WRAPPER, "sh", file]],
  resize: (tty, cols, rows) => [
    "/bin/stty",
    ["-f", tty, "rows", String(rows), "cols", String(cols)],
  ],
  // Note that macOS's `pkill -t` matches no process on a pseudo-terminal, while `ps -t` lists every one.
  hangUp: (tty) => [
    "/bin/sh",
    [
      "-c",
      'ps -o pid= -t "$1" | xargs kill -HUP 2>/dev/null; true',
      "sh",
      tty.replace(/^\/dev\//u, ""),
    ],
  ],
  processes: (tty) => ["/bin/ps", ["-o", "pid=", "-t", tty.replace(/^\/dev\//u, "")]],
};

export interface MacTerminal {
  /** What was typed, written to the terminal. */
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Every process on the terminal hung up, and the terminal ended; what still runs five seconds later is killed. */
  close(): void;
}

/** How long a closed terminal's processes have to end before they are killed. */
const STOP_GRACE_MS = 5_000;

/** The id of every process on the terminal at `tty`; none where they cannot be read. */
function processesOn(tools: MacTerminalTools, tty: string): readonly number[] {
  const [command, args] = tools.processes(tty);
  const listed = spawnSync(command, [...args], { encoding: "utf8", timeout: 2_000 });
  return (listed.stdout ?? "")
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/** When a process started, as `ps` says it, which no later process given the same id shares; none where it has ended. */
function startedAt(pid: number): string | undefined {
  const listed = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    timeout: 2_000,
  });
  const folded = listed.stdout?.trim().replace(/\s+/gu, " ") ?? "";
  return listed.status === 0 && folded !== "" ? folded : undefined;
}

/** Every terminal standing, which a quit closes. */
const standing = new Set<MacTerminal>();

/** Closes every terminal still open, as Luke quits. */
export function closeEveryMacTerminal(): void {
  for (const terminal of [...standing]) terminal.close();
}

/**
 * A terminal running the script `build` makes, given the file it writes the
 * terminal's device to. Output and the end are handed to the callbacks.
 */
export function startMacTerminal(options: {
  readonly build: (ttyFile: string) => string;
  readonly onOutput: (bytes: Uint8Array) => void;
  readonly onExit: (code: number | null) => void;
  readonly tools?: MacTerminalTools | undefined;
  /** How long a close waits before it kills what still runs; five seconds unless a test names its own. */
  readonly stopGraceMs?: number | undefined;
}): MacTerminal {
  const tools = options.tools ?? MACOS_TERMINAL_TOOLS;
  const folder = mkdtempSync(path.join(tmpdir(), "luke-terminal-"));
  const ttyFile = path.join(folder, "tty");
  const file = path.join(folder, "open.sh");
  writeFileSync(file, options.build(ttyFile), { mode: 0o700 });
  const [program, args] = tools.script(file);
  const child: ChildProcess = spawn(program, [...args], {
    cwd: homedir(),
    detached: true,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let ended = false;
  const tty = (): string | undefined => {
    try {
      return readFileSync(ttyFile, "utf8").trim() || undefined;
    } catch {
      return undefined;
    }
  };
  const forward = (chunk: Buffer) => options.onOutput(new Uint8Array(chunk));
  child.stdout?.on("data", forward);
  child.stderr?.on("data", forward);
  // A write after the terminal ended has nowhere to go, and is let go.
  child.stdin?.on("error", () => undefined);
  const terminal: MacTerminal = {
    write: (data) => {
      if (!ended) child.stdin?.write(data);
    },
    resize: (cols, rows) => {
      const device = tty();
      if (ended || device === undefined) return;
      const [command, resizeArgs] = tools.resize(device, cols, rows);
      execFile(command, [...resizeArgs], () => undefined);
    },
    close: () => {
      if (ended) return;
      // Every process on the tty is hung up first, and waited for, so a job in a
      // process group of its own is reached before the wrapper's end takes the tty away.
      const device = tty();
      // Note that what runs on the terminal is noted before the hang-up, since a job that outlives it no longer names the terminal once it is gone.
      const running = device === undefined ? [] : processesOn(tools, device);
      // Note that each process is named with when it started, and the terminal's own process group by its id, both before any signal, so the kill after the grace reaches what was running then and nothing the system started since under an id it gave again.
      const targets = [
        ...running.flatMap((pid) => {
          const started = startedAt(pid);
          return started === undefined ? [] : [String(pid), started];
        }),
        ...(child.pid === undefined ? [] : [String(-child.pid), "group"]),
      ];
      if (device !== undefined) {
        const [command, hangUpArgs] = tools.hangUp(device);
        spawnSync(command, [...hangUpArgs], { stdio: "ignore", timeout: 2_000 });
      }
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
      } catch {
        // The terminal ended on its own between the check and the signal.
      }
      // Note that a process that ignores the hang-up and the terminate, as a dev server shutting down slowly may, is killed after the grace; the kill is left to a process of its own, so it reaches a job that ignored the hang-up and outlived the `script` around it, and is done even when Luke quits within the grace.
      spawn(
        "/bin/sh",
        [
          "-c",
          [
            'sleep "$1"; shift',
            'while [ "$#" -ge 2 ]; do',
            '  target="$1"; was="$2"; shift 2',
            // Note that a group is killed while any process is still in it, since its id is given to no other while it has one; a process only while it started when it was noted, its time read with spaces folded, as `ps` pads it.
            '  if [ "$was" = group ]; then',
            "    ps -A -o pgid= | awk -v g=\"${target#-}\" '$1 == g { found = 1 } END { exit !found }' &&",
            '      kill -s KILL -- "$target" 2>/dev/null',
            "  else",
            '    now="$(echo $(ps -o lstart= -p "$target" 2>/dev/null))"',
            '    [ "$now" = "$was" ] && kill -s KILL -- "$target" 2>/dev/null',
            "  fi",
            "done",
            "true",
          ].join("\n"),
          "sh",
          String((options.stopGraceMs ?? STOP_GRACE_MS) / 1_000),
          ...targets,
        ],
        { detached: true, stdio: "ignore" },
      ).unref();
    },
  };
  standing.add(terminal);
  const finish = (code: number | null) => {
    if (ended) return;
    ended = true;
    standing.delete(terminal);
    rmSync(folder, { recursive: true, force: true });
    options.onExit(code);
  };
  child.on("exit", finish);
  // A terminal that could not be started says why on its screen, and ends.
  child.on("error", (error) => {
    options.onOutput(new TextEncoder().encode(`Could not start a terminal: ${error.message}\r\n`));
    finish(null);
  });
  return terminal;
}
