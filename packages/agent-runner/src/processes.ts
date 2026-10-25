/**
 * processes.ts -- whether a process the agent started still runs beside the runner, so ending the launch, and stopping the sandbox under it, would end it.
 *
 * Luke starts the runner under `setpriv` with its capability bounding set
 * emptied (the service's `runner-sessions.ts`), as it starts every command
 * a person or a model drives in an agent's sandbox. The bounding set is
 * inherited across `fork` and kept across `execve`, and a process can only
 * drop from it (https://man7.org/linux/man-pages/man7/capabilities.7.html),
 * so the runner, the CLI it spawns, and everything the CLI's commands
 * started carry an empty one, a server that detached from its shell
 * included, while the sandbox's own processes keep theirs. A process with an
 * empty set that is neither the runner, nor one it spawned itself, the
 * harness, nor the harness's command-sandbox bridge, is the agent's.
 *
 * The bridge is the `socat` Claude Code starts beside itself when its command
 * sandbox is on, as the runner always asks (`runner.ts`): it listens on a
 * socket under `/tmp` named `claude-http-<id>.sock` and forwards to the
 * CLI's own proxy for as long as the CLI runs. It is told apart narrowly, as
 * a child of the harness running `socat` on exactly that socket, so a
 * `socat` or a server of the agent's own still reads as the agent's. Counted
 * as the agent's, it held every wait the whole launch, and the sandbox under
 * it, until the wakeup came.
 *
 * Where `/proc` cannot be read, the answer is that one runs, so a wait is
 * never released on a guess; so is a process whose command line cannot be
 * read, which is never taken for the bridge.
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { Context, Effect, Layer } from "effect";

export interface ProcessTableShape {
  /** Whether a process of the agent's, beside the runner and the harness it spawned, still runs; yes where it cannot be told. */
  readonly agentProcessRuns: Effect.Effect<boolean>;
}

export class ProcessTable extends Context.Service<ProcessTable, ProcessTableShape>()(
  "@luke/agent-runner/ProcessTable",
) {}

/** The program and the listening address of Claude Code's command-sandbox bridge, as its command line spells them. */
const HARNESS_BRIDGE = {
  PROGRAM: "socat",
  LISTEN: /^UNIX-LISTEN:\/tmp\/claude-http-[0-9a-f]+\.sock(,|$)/,
} as const;

/** One process as its `status` names it: its parent, and whether its bounding set is empty. */
interface Status {
  readonly parent: number;
  readonly emptied: boolean;
}

/** A process's `status` read, or none where it ended before its read. */
function statusOf(root: string, pid: string): Status | undefined {
  let text: string;
  try {
    text = readFileSync(`${root}/${pid}/status`, "utf8");
  } catch {
    return undefined;
  }
  const parent = /^PPid:\s+(\d+)$/m.exec(text)?.[1];
  const bounding = /^CapBnd:\s+([0-9a-f]+)$/m.exec(text)?.[1];
  if (parent === undefined || bounding === undefined) return undefined;
  return { parent: Number(parent), emptied: /^0+$/.test(bounding) };
}

/** Whether a process's command line, read from its `cmdline`, is the bridge's; no where it cannot be read. */
function runsBridge(root: string, pid: number): boolean {
  let argv: string[];
  try {
    argv = readFileSync(`${root}/${pid}/cmdline`, "utf8").split("\0");
  } catch {
    return false;
  }
  const [program, listen] = argv;
  return (
    program !== undefined &&
    basename(program) === HARNESS_BRIDGE.PROGRAM &&
    listen !== undefined &&
    HARNESS_BRIDGE.LISTEN.test(listen)
  );
}

/**
 * Whether a process with an emptied bounding set runs under `root`, a
 * `/proc`, beside the runner (`self`), the processes it spawned, and the
 * harness's bridge; yes where no process at all could be read.
 */
function agentProcessRunsUnder(root: string, self: number): boolean {
  let pids: string[];
  try {
    pids = readdirSync(root).filter((name) => /^\d+$/.test(name));
  } catch {
    return true;
  }
  const statuses = new Map<number, Status>();
  for (const pid of pids) {
    const status = statusOf(root, pid);
    if (status !== undefined) statuses.set(Number(pid), status);
  }
  if (statuses.size === 0) return true;
  for (const [pid, status] of statuses) {
    if (!status.emptied || pid === self || status.parent === self) continue;
    // Note that the bridge is the harness's only where the harness, a child of the runner, spawned it.
    if (statuses.get(status.parent)?.parent === self && runsBridge(root, pid)) continue;
    return true;
  }
  return false;
}

/** The processes under `root`, a `/proc`, as the runner `self` reads them: the sandbox's own `/proc` and the runner's pid in production. */
export function processTable(root: string, self: number): Layer.Layer<ProcessTable> {
  return Layer.succeed(ProcessTable, {
    agentProcessRuns: Effect.sync(() => agentProcessRunsUnder(root, self)),
  });
}
