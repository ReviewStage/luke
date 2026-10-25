/**
 * fake-proc.ts -- a `/proc` of the test's own, for the runner's process table (`processes.ts`): a temporary directory of `status` and `cmdline` files written as the kernel writes them.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

/** A `/proc` that cannot be read, which reads as a process of the agent's running. */
export const UNREAD_PROC = "/nonexistent/luke-proc";

/** The whole capability set, as the sandbox's own processes hold it. */
const FULL_SET = "000001ffffffffff";
/** The emptied set the runner and everything under it run with. */
const EMPTIED = "0000000000000000";

/** One process: its pid, its parent's, whether its bounding set is emptied, and its command line, where one is written. */
export interface FakeProcess {
  readonly pid: number;
  readonly parent: number;
  readonly emptied: boolean;
  readonly argv?: readonly string[];
}

function statusFile({ pid, parent, emptied }: FakeProcess): string {
  return [
    "Name:\tprocess",
    "State:\tS (sleeping)",
    `Pid:\t${pid}`,
    `PPid:\t${parent}`,
    "CapInh:\t0000000000000000",
    "CapPrm:\t0000000000000000",
    "CapEff:\t0000000000000000",
    `CapBnd:\t${emptied ? EMPTIED : FULL_SET}`,
    "CapAmb:\t0000000000000000",
    "",
  ].join("\n");
}

/** A temporary `/proc` holding the processes given, its path answered and the directory gone when the scope closes. */
export const fakeProc = (processes: readonly FakeProcess[]) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const root = mkdtempSync(join(tmpdir(), "luke-proc-"));
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
