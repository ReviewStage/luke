import { readdirSync, readFileSync } from "node:fs";
import { Context, Effect, Layer } from "effect";

export interface ProcessTableShape {
  readonly agentProcessRuns: Effect.Effect<boolean>;
}

export class ProcessTable extends Context.Service<ProcessTable, ProcessTableShape>()(
  "@repo/agent-runner/ProcessTable",
) {}

interface Status {
  readonly parent: number;
  readonly uid: number;
}

function statusOf(root: string, pid: string): Status | undefined {
  let text: string;
  try {
    text = readFileSync(`${root}/${pid}/status`, "utf8");
  } catch {
    return undefined;
  }
  const parent = /^PPid:\s+(\d+)$/m.exec(text)?.[1];
  const uid = /^Uid:\s+(\d+)/m.exec(text)?.[1];
  if (parent === undefined || uid === undefined) return undefined;
  return { parent: Number(parent), uid: Number(uid) };
}

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

export function processTable(root: string, self: number): Layer.Layer<ProcessTable> {
  return Layer.succeed(ProcessTable, {
    agentProcessRuns: Effect.sync(() => agentProcessRunsUnder(root, self)),
  });
}
