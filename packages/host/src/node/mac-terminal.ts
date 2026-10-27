import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Deferred, Effect } from "effect";

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
 * terminal still open. A close is an Effect whose reads and hang-up are
 * processes it waits on rather than blocks for, so the process that serves
 * every window goes on answering while a terminal closes. What the terminal prints is handed to `onOutput` and
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
  close(): Effect.Effect<void>;
}

/** How long a closed terminal's processes have to end before they are killed. */
const STOP_GRACE_MS = 5_000;

/** How long a command a close runs has before it is killed and what it printed is taken as it stands. */
const STEP_TIMEOUT_MS = 2_000;

/**
 * What a command printed, waited on rather than blocked for; whatever it
 * printed before it failed or its timeout, and nothing where it could not
 * start. Note that an interrupted wait kills the command.
 */
function printed(command: string, args: readonly string[]): Effect.Effect<string> {
  return Effect.callback<string>((resume) => {
    const child = execFile(
      command,
      [...args],
      { encoding: "utf8", timeout: STEP_TIMEOUT_MS },
      (_error, stdout) => resume(Effect.succeed(stdout ?? "")),
    );
    return Effect.sync(() => {
      child.kill();
    });
  });
}

/** The id of every process on the terminal at `tty`; none where they cannot be read. */
function processesOn(tools: MacTerminalTools, tty: string): Effect.Effect<readonly number[]> {
  const [command, args] = tools.processes(tty);
  return Effect.map(printed(command, args), (listed) =>
    listed
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  );
}

/** When each process started, by its id, as one `ps` says it, which no later process given the same id shares; none for one that has ended. */
const startTimes = Effect.fnUntraced(function* (pids: readonly number[]) {
  const times = new Map<number, string>();
  if (pids.length === 0) return times;
  const listed = yield* printed("ps", ["-o", "pid=,lstart=", "-p", pids.join(",")]);
  for (const line of listed.split("\n")) {
    const [pid, ...started] = line.trim().split(/\s+/u);
    if (pid !== undefined && started.length > 0) times.set(Number(pid), started.join(" "));
  }
  return times;
});

/** Every terminal standing, which a quit closes. */
const standing = new Set<MacTerminal>();

/** How many terminals stand open, which a quit names before it closes them. */
export function openMacTerminals(): number {
  return standing.size;
}

/** Closes every terminal still open, as Luke quits, all at once, so the quit waits on the slowest close rather than their sum. */
export const closeEveryMacTerminal: Effect.Effect<void> = Effect.suspend(() =>
  Effect.forEach([...standing], (terminal) => terminal.close(), {
    concurrency: "unbounded",
    discard: true,
  }),
);

/**
 * A terminal running the script `build` makes, given the file it writes the
 * terminal's device to. Output and the end are handed to the callbacks.
 */
export function startMacTerminal(options: {
  readonly build: (ttyFile: string) => string;
  readonly onOutput: (bytes: Uint8Array) => void;
  readonly onExit: (code: number | null) => void;
  /** macOS's own tools, any of them replaced by another system's in a test. */
  readonly tools?: Partial<MacTerminalTools> | undefined;
  /** How long a close waits before it kills what still runs; five seconds unless a test names its own. */
  readonly stopGraceMs?: number | undefined;
}): MacTerminal {
  const tools: MacTerminalTools = { ...MACOS_TERMINAL_TOOLS, ...options.tools };
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
  /** The close under way, which every later close joins. */
  let closing: Deferred.Deferred<void> | undefined;
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
    close: () =>
      Effect.suspend(() => {
        // Note that a close already under way is the one close, which a later one waits on, so a quit just after Stop waits for Stop's hang-up rather than passing it by.
        if (closing !== undefined) return Deferred.await(closing);
        if (ended) return Effect.void;
        const done = Deferred.makeUnsafe<void>();
        closing = done;
        return Effect.ensuring(hungUp, Deferred.succeed(done, undefined));
      }),
  };
  /** Every process on the terminal hung up, the terminal ended, and what still runs after the grace killed by a process of its own. */
  const hungUp = Effect.gen(function* () {
    // Every process on the tty is hung up first, and waited for, so a job in a
    // process group of its own is reached before the wrapper's end takes the tty away.
    const device = tty();
    // Note that what runs on the terminal is noted before the hang-up, since a job that outlives it no longer names the terminal once it is gone.
    const running = device === undefined ? [] : yield* processesOn(tools, device);
    // Note that each process is named with when it started, and the terminal's own process group by its id, both before any signal, so the kill after the grace reaches what was running then and nothing the system started since under an id it gave again.
    // Note that the times are read in one `ps`, so Stop's signals are not held up by a read per process.
    const started = yield* startTimes(running);
    const targets = [
      ...running.flatMap((pid) => {
        const time = started.get(pid);
        return time === undefined ? [] : [String(pid), time];
      }),
      ...(child.pid === undefined ? [] : [String(-child.pid), "group"]),
    ];
    if (device !== undefined) {
      const [command, hangUpArgs] = tools.hangUp(device);
      yield* printed(command, hangUpArgs);
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
  });
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
