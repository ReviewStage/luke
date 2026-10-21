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
 * empty set that is neither the runner nor one it spawned itself, the
 * harness, is the agent's.
 *
 * Where `/proc` cannot be read, the answer is that one runs, so a wait is
 * never released on a guess.
 */

import { readdirSync, readFileSync } from "node:fs";
import { Context, Effect, Layer } from "effect";

export interface ProcessTableShape {
  /** Whether a process of the agent's, beside the runner and the harness it spawned, still runs; yes where it cannot be told. */
  readonly agentProcessRuns: Effect.Effect<boolean>;
}

export class ProcessTable extends Context.Service<ProcessTable, ProcessTableShape>()(
  "@luke/agent-runner/ProcessTable",
) {}

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

/**
 * Whether a process with an emptied bounding set runs under `root`, a
 * `/proc`, beside the runner (`self`) and the processes it spawned; yes
 * where no process at all could be read.
 */
function agentProcessRunsUnder(root: string, self: number): boolean {
  let pids: string[];
  try {
    pids = readdirSync(root).filter((name) => /^\d+$/.test(name));
  } catch {
    return true;
  }
  let read = 0;
  for (const pid of pids) {
    const status = statusOf(root, pid);
    if (status === undefined) continue;
    read += 1;
    if (!status.emptied || Number(pid) === self || status.parent === self) continue;
    return true;
  }
  return read === 0;
}

/** The processes under `root`, a `/proc`, as the runner `self` reads them: the sandbox's own `/proc` and the runner's pid in production. */
export function processTable(root: string, self: number): Layer.Layer<ProcessTable> {
  return Layer.succeed(ProcessTable, {
    agentProcessRuns: Effect.sync(() => agentProcessRunsUnder(root, self)),
  });
}
