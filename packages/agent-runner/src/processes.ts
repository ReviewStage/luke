/**
 * processes.ts -- whether a process the agent started still runs beside the runner, so ending the launch, and stopping the sandbox under it, would end it.
 *
 * We start the runner as the sandbox's own `agent` user (the service's
 * `vercel-machine.ts`), and every process of the sandbox's own runs as
 * another: its init and the API's commands as root or its default user,
 * and so a Terminal's shells and our own browser (`SANDBOX_BROWSER_PIN`),
 * which stands for as long as the sandbox once the agent opens it. So the
 * runner, the CLI it spawns, and everything the CLI's commands started run
 * as the runner's user, a server that detached from its shell included, and
 * a process of that user that is neither the runner nor one it spawned
 * itself, the harness, is the agent's. A Chromium or an Xvfb of the agent's
 * own runs as that user too, so it still reads as the agent's.
 *
 * On a host, where the runner runs straight on the box beside the host's
 * own processes and every other agent's, every process runs as one user,
 * so the agent's are told apart by descent and process group instead
 * (`host-processes.ts`).
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
  "@repo/agent-runner/ProcessTable",
) {}

/** One process as its `status` names it: its parent, and the user it runs as. */
interface Status {
  readonly parent: number;
  readonly uid: number;
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
  // Note that the first of a process's uids is its real one.
  const uid = /^Uid:\s+(\d+)/m.exec(text)?.[1];
  if (parent === undefined || uid === undefined) return undefined;
  return { parent: Number(parent), uid: Number(uid) };
}

/**
 * Whether a process of the agent's runs under `root`, a `/proc`, beside the
 * runner (`self`) and the processes it spawned: one of the runner's own
 * user; yes where the runner's own process could not be read.
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
  const runner = statuses.get(self);
  if (runner === undefined) return true;
  for (const [pid, status] of statuses) {
    if (status.uid !== runner.uid || pid === self || status.parent === self) continue;
    return true;
  }
  return false;
}

/**
 * The processes under `root`, a `/proc`, as the runner `self` reads them:
 * the sandbox's own `/proc` and the runner's pid in production.
 */
export function processTable(root: string, self: number): Layer.Layer<ProcessTable> {
  return Layer.succeed(ProcessTable, {
    agentProcessRuns: Effect.sync(() => agentProcessRunsUnder(root, self)),
  });
}
