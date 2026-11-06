import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

export const UNREAD_PROC = "/nonexistent/agent-proc";

const UID = { AGENT: 1002, SANDBOX: 1000 } as const;

export interface FakeProcess {
  readonly pid: number;
  readonly parent: number;
  readonly agents: boolean;
  readonly argv?: readonly string[];
}

function statusFile({ pid, parent, agents }: FakeProcess): string {
  const uid = agents ? UID.AGENT : UID.SANDBOX;
  return [
    "Name:\tprocess",
    "State:\tS (sleeping)",
    `Pid:\t${pid}`,
    `PPid:\t${parent}`,
    `Uid:\t${uid}\t${uid}\t${uid}\t${uid}`,
    `NSsid:\t${pid}`,
    "CapBnd:\t000001ffffffffff",
    "",
  ].join("\n");
}

export const fakeProc = (processes: readonly FakeProcess[]) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const root = mkdtempSync(join(tmpdir(), "agent-proc-"));
      for (const process of processes) {
        mkdirSync(join(root, String(process.pid)));
        writeFileSync(join(root, String(process.pid), "status"), statusFile(process));
        if (process.argv !== undefined) {
          writeFileSync(join(root, String(process.pid), "cmdline"), `${process.argv.join("\0")}\0`);
        }
      }
      return root;
    }),
    (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
  );
