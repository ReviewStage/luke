/**
 * fake-proc.ts -- a `/proc` of the test's own, for the runner's process table (`processes.ts`): a temporary directory of `status` and `cmdline` files written as the kernel writes them.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

/** A `/proc` that cannot be read, which reads as a process of the agent's running. */
export const UNREAD_PROC = "/nonexistent/agent-proc";

/** The users a sandbox's processes run as: the agent's, which the runner runs as, and the sandbox's own default user. */
const UID = { AGENT: 1002, SANDBOX: 1000 } as const;

/** One process: its pid, its parent's, whether it runs as the agent's user, and its command line, where one is written. */
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

/** A temporary `/proc` holding the processes given, its path answered and the directory gone when the scope closes. */
export const fakeProc = (processes: readonly FakeProcess[]) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const root = mkdtempSync(join(tmpdir(), "agent-proc-"));
      for (const process of processes) {
        mkdirSync(join(root, String(process.pid)));
        writeFileSync(join(root, String(process.pid), "status"), statusFile(process));
        if (process.argv !== undefined) {
          // Note that the kernel ends each argument with a NUL, the last one included.
          writeFileSync(join(root, String(process.pid), "cmdline"), `${process.argv.join("\0")}\0`);
        }
      }
      return root;
    }),
    (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
  );
