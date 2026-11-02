/**
 * host-processes.ts -- `processes.ts`'s question asked on a host, where the runner runs straight on the box: whether a process the agent started still runs beside the runner.
 *
 * On a host the runner runs as the box's own user, beside the host's own
 * process, the developer's, and every other agent's runner, so neither a
 * bounding set nor a user marks the agent's processes. They are told apart
 * by where they came from instead: a process descended from the runner, or
 * one in the runner's own process group where the runner leads one, as the
 * host starts it (`@luke/host`'s `compose-local-agents.ts`), so a server
 * that detached from its shell and was handed to init or `launchd` still
 * counts. The runner itself, the harness it spawned, and the harness's
 * command-sandbox bridge are not the agent's, as in the cloud.
 *
 * Linux's `/proc` is read where it stands, each process's `stat` naming its
 * parent and group; a Mac, which has none, is asked through `ps` for every
 * process's id, parent, group, and command line. Where neither can be read,
 * `ps` fails, or the listing holds no runner, the answer is that one runs,
 * so a wait is never released on a guess.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { Effect, Layer } from "effect";
import { ProcessTable } from "./processes.js";

/** macOS's own `ps`, never one a PATH would find first. */
export const MAC_PS = "/bin/ps";

/** The columns asked of `ps`, each header left empty, so every line is one process. */
const PS_ARGS = ["-A", "-o", "pid=,ppid=,pgid=,command="] as const;

/** How long `ps` has before its answer is taken as none. */
const PS_TIMEOUT_MS = 5_000;

/** The program and the listening address of Claude Code's command-sandbox bridge, as `processes.ts` tells it. */
const HARNESS_BRIDGE = {
  PROGRAM: "socat",
  LISTEN: /^UNIX-LISTEN:\/tmp\/claude-http-[0-9a-f]+\.sock(,|$)/,
} as const;

/** One process as a listing names it. */
interface Listed {
  readonly parent: number;
  readonly group: number;
  readonly argv: readonly string[];
}

/** Where the processes are read from: a `/proc` where the box has one, else `ps`. */
interface ProcessSources {
  readonly proc: string;
  readonly ps: string;
}

/** `ps`'s lines read as processes by their id; a line that is not one is skipped. */
function psListed(output: string): Map<number, Listed> {
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

/** `ps`'s listing, or none where it could not be read. */
function psListing(ps: string): Map<number, Listed> | undefined {
  try {
    return psListed(
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

/** A process's command line from its `cmdline`, none where it cannot be read, which is never taken for the bridge. */
function cmdlineOf(root: string, pid: string): readonly string[] {
  try {
    return readFileSync(`${root}/${pid}/cmdline`, "utf8").split("\0");
  } catch {
    return [];
  }
}

/**
 * One process of a `/proc` as its `stat` names it, its parent and group
 * read past the command's name, which is in parentheses and may hold either;
 * none where it ended before its read.
 */
function procListed(root: string, pid: string): Listed | undefined {
  let stat: string;
  try {
    stat = readFileSync(`${root}/${pid}/stat`, "utf8");
  } catch {
    return undefined;
  }
  const [, parent, group] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  if (parent === undefined || group === undefined) return undefined;
  return { parent: Number(parent), group: Number(group), argv: cmdlineOf(root, pid) };
}

/** A `/proc`'s processes by their id, or none where none could be read. */
function procListing(root: string): Map<number, Listed> | undefined {
  let pids: string[];
  try {
    pids = readdirSync(root).filter((name) => /^\d+$/.test(name));
  } catch {
    return undefined;
  }
  const listed = new Map<number, Listed>();
  for (const pid of pids) {
    const process = procListed(root, pid);
    if (process !== undefined) listed.set(Number(pid), process);
  }
  return listed.size === 0 ? undefined : listed;
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
 * Whether a process of the agent's runs among those listed, beside the
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

/** The processes a host's runner `self` reads beside it: the box's `/proc` where it has one (`/proc` in production), else its `ps` (`MAC_PS`). */
export function hostProcessTable(self: number, sources: ProcessSources): Layer.Layer<ProcessTable> {
  return Layer.succeed(ProcessTable, {
    agentProcessRuns: Effect.sync(() => {
      const listed = existsSync(`${sources.proc}/self/stat`)
        ? procListing(sources.proc)
        : psListing(sources.ps);
      return listed === undefined || agentProcessRunsIn(listed, self);
    }),
  });
}
