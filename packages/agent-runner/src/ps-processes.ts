/**
 * ps-processes.ts -- `processes.ts`'s question asked of `ps` on a Mac, which has no `/proc`: whether a process the agent started still runs beside the runner.
 *
 * On a Mac the runner runs as the developer, beside everything else of
 * theirs, so no bounding set marks the agent's processes as the sandbox's
 * `setpriv` does. They are told apart by where they came from instead: a
 * process descended from the runner, or one in the runner's own process
 * group where the runner leads one, as Luke's desktop starts it
 * (`@luke/host`'s `compose-local-agents.ts`), so a server that detached from
 * its shell and was handed to `launchd` still counts. The runner itself, the
 * harness it spawned, and the harness's command-sandbox bridge are not the
 * agent's, as on Linux.
 *
 * `ps` is asked for every process's id, parent, group, and command line.
 * Where it cannot be run, exits with a failure, or lists no runner, the
 * answer is that one runs, so a wait is never released on a guess.
 */

import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { Effect, Layer } from "effect";
import { ProcessTable } from "./processes.js";

/** macOS's own `ps`, never one a PATH would find first. */
export const MAC_PS = "/bin/ps";

/** The columns asked for, each header left empty, so every line is one process. */
const PS_ARGS = ["-A", "-o", "pid=,ppid=,pgid=,command="] as const;

/** How long `ps` has before its answer is taken as none. */
const PS_TIMEOUT_MS = 5_000;

/** The program and the listening address of Claude Code's command-sandbox bridge, as `processes.ts` tells it. */
const HARNESS_BRIDGE = {
  PROGRAM: "socat",
  LISTEN: /^UNIX-LISTEN:\/tmp\/claude-http-[0-9a-f]+\.sock(,|$)/,
} as const;

/** One process as `ps` lists it. */
interface Listed {
  readonly parent: number;
  readonly group: number;
  readonly argv: readonly string[];
}

/** `ps`'s lines read as processes by their id; a line that is not one is skipped. */
function listedOf(output: string): Map<number, Listed> {
  const listed = new Map<number, Listed>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match === null) continue;
    const [, pid, parent, group, command = ""] = match;
    listed.set(Number(pid), {
      parent: Number(parent),
      group: Number(group),
      argv: command.trim().split(/\s+/),
    });
  }
  return listed;
}

/** Whether a process's command line is the bridge's. */
function runsBridge(process: Listed): boolean {
  const [program, listen] = process.argv;
  return (
    program !== undefined &&
    basename(program) === HARNESS_BRIDGE.PROGRAM &&
    listen !== undefined &&
    HARNESS_BRIDGE.LISTEN.test(listen)
  );
}

/** Whether `pid` descends from `self`, read up its parents until one is `self` or the chain ends. */
function descends(listed: ReadonlyMap<number, Listed>, pid: number, self: number): boolean {
  const seen = new Set<number>();
  let current = listed.get(pid)?.parent;
  while (current !== undefined && current > 1 && !seen.has(current)) {
    if (current === self) return true;
    seen.add(current);
    current = listed.get(current)?.parent;
  }
  return false;
}

/**
 * Whether a process of the agent's runs among those `ps` listed, beside the
 * runner `self`, the processes it spawned, and the harness's bridge; yes
 * where the listing holds no runner.
 */
function agentProcessRunsIn(listed: ReadonlyMap<number, Listed>, self: number): boolean {
  const runner = listed.get(self);
  if (runner === undefined) return true;
  // Note that a group counts only where the runner leads it, since a runner in its starter's group would count the starter's.
  const leads = runner.group === self;
  for (const [pid, process] of listed) {
    if (pid === self || process.parent === self) continue;
    if (!descends(listed, pid, self) && !(leads && process.group === self)) continue;
    // Note that the bridge is the harness's only where the harness, a child of the runner, spawned it.
    if (listed.get(process.parent)?.parent === self && runsBridge(process)) continue;
    return true;
  }
  return false;
}

/** `ps`'s listing, or none where it could not be read. */
function listing(ps: string): Map<number, Listed> | undefined {
  try {
    return listedOf(
      execFileSync(ps, PS_ARGS, {
        encoding: "utf8",
        timeout: PS_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return undefined;
  }
}

/** The processes `ps` (`MAC_PS` in production) lists, as the runner `self` reads them. */
export function psProcessTable(ps: string, self: number): Layer.Layer<ProcessTable> {
  return Layer.succeed(ProcessTable, {
    agentProcessRuns: Effect.sync(() => {
      const listed = listing(ps);
      return listed === undefined || agentProcessRunsIn(listed, self);
    }),
  });
}
