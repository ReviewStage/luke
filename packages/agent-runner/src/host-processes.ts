import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { Effect, Layer } from "effect";
import { ProcessTable } from "./processes.js";

export const MAC_PS = "/bin/ps";

const PS_ARGS = ["-A", "-o", "pid=,ppid=,pgid=,command="] as const;

const PS_TIMEOUT_MS = 5_000;

const HARNESS_BRIDGE = {
  PROGRAM: "socat",
  LISTEN: /^UNIX-LISTEN:\/tmp\/claude-http-[0-9a-f]+\.sock(,|$)/,
} as const;

interface Listed {
  readonly parent: number;
  readonly group: number;
  readonly argv: readonly string[];
}

interface ProcessSources {
  readonly proc: string;
  readonly ps: string;
}

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

function cmdlineOf(root: string, pid: string): readonly string[] {
  try {
    return readFileSync(`${root}/${pid}/cmdline`, "utf8").split("\0");
  } catch {
    return [];
  }
}

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

function runsBridge(process: Listed): boolean {
  const [program, listen] = process.argv;
  return (
    program !== undefined &&
    basename(program) === HARNESS_BRIDGE.PROGRAM &&
    listen !== undefined &&
    HARNESS_BRIDGE.LISTEN.test(listen)
  );
}

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

function agentProcessRunsIn(listed: ReadonlyMap<number, Listed>, self: number): boolean {
  const runner = listed.get(self);
  if (runner === undefined) return true;
  const leads = runner.group === self;
  for (const [pid, process] of listed) {
    if (pid === self || process.parent === self) continue;
    if (!descends(listed, pid, self) && !(leads && process.group === self)) continue;
    if (listed.get(process.parent)?.parent === self && runsBridge(process)) continue;
    return true;
  }
  return false;
}

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
