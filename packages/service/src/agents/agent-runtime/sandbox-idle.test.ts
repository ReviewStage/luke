import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import type { RepositorySandbox } from "../repository-shell.js";
import { sandboxIdle } from "./sandbox-idle.js";

/**
 * Whether a coding agent's sandbox runs no process the agent started, as
 * the probe reads it from each process's capability bounding set: every
 * command a person or a model drives starts with that set emptied, and
 * nothing else in the sandbox has it so. Where the probe cannot tell, the
 * sandbox reads as busy, so a stop for a long pause leaves it up.
 *
 * The probe runs in a real bash. The sandbox's `/proc` is a temporary
 * directory of `status` files written as the kernel writes them, which the
 * stand-in sandbox puts in place of `/proc` in the probe's words, so the
 * test reads the processes it wrote rather than the test machine's own.
 */

/** The whole capability set, as a process the sandbox's API starts holds it. */
const FULL_SET = "000001ffffffffff";
/** The emptied set every command a person or a model drives runs under. */
const EMPTIED = "0000000000000000";

/** One process as `/proc/<pid>/status` names it: its name and its bounding set. */
interface Process {
  readonly pid: number;
  readonly name: string;
  readonly bounding: string;
}

/** `/proc/<pid>/status` as the kernel writes it, cut to the lines around the two the probe reads. */
function statusFile({ pid, name, bounding }: Process): string {
  return [
    `Name:\t${name}`,
    "State:\tS (sleeping)",
    `Pid:\t${pid}`,
    "PPid:\t1",
    "CapInh:\t0000000000000000",
    "CapPrm:\t0000000000000000",
    "CapEff:\t0000000000000000",
    `CapBnd:\t${bounding}`,
    "CapAmb:\t0000000000000000",
    "",
  ].join("\n");
}

/** A temporary `/proc` holding the processes given, gone when the test's scope closes. */
const procOf = (processes: readonly Process[]) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const root = mkdtempSync(join(tmpdir(), "luke-proc-"));
      for (const process of processes) {
        mkdirSync(join(root, String(process.pid)));
        writeFileSync(join(root, String(process.pid), "status"), statusFile(process));
      }
      return root;
    }),
    (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
  );

/** A sandbox whose commands run in a real bash, reading the temporary `/proc` in place of its own. */
function sandboxOver(proc: string): RepositorySandbox {
  // SAFETY: the probe calls `run` with a command and a working directory alone, and reads its exit code and outputs.
  return {
    run: ({ command }) =>
      new Promise((resolve) => {
        execFile(
          "bash",
          ["-c", command.replaceAll("/proc/", `${proc}/`)],
          (error, stdout, stderr) => {
            resolve({
              exitCode: typeof error?.code === "number" ? error.code : error === null ? 0 : 1,
              stdout,
              stderr,
            });
          },
        );
      }),
  } as RepositorySandbox;
}

const SANDBOX_INIT: Process = { pid: 1, name: "sandbox-init", bounding: FULL_SET };
const API_SHELL: Process = { pid: 1298, name: "bash", bounding: FULL_SET };

it.effect("a sandbox running only what the sandbox's API started is idle", () =>
  Effect.gen(function* () {
    const proc = yield* procOf([SANDBOX_INIT, API_SHELL]);
    assert.equal(yield* sandboxIdle(sandboxOver(proc)), true);
  }).pipe(Effect.scoped),
);

it.effect("a sandbox where a process the agent started still runs is busy, whatever it is", () =>
  Effect.gen(function* () {
    for (const name of ["next-server", "gh", "chromium", "tmux: server"]) {
      const proc = yield* procOf([SANDBOX_INIT, API_SHELL, { pid: 2001, name, bounding: EMPTIED }]);
      assert.equal(yield* sandboxIdle(sandboxOver(proc)), false, name);
    }
  }).pipe(Effect.scoped),
);

it.effect("a sandbox whose processes cannot be read is busy, so it is left up", () =>
  Effect.gen(function* () {
    const proc = yield* procOf([]);
    assert.equal(yield* sandboxIdle(sandboxOver(proc)), false);
  }).pipe(Effect.scoped),
);

it.effect("a sandbox that would not run the probe, or whose probe failed, is busy", () =>
  Effect.gen(function* () {
    // SAFETY: the probe reads `run`'s outcome alone.
    const refusing = {
      run: () => Promise.reject(new Error("Vercel Sandbox not found")),
    } as unknown as RepositorySandbox;
    assert.equal(yield* sandboxIdle(refusing), false);
    // SAFETY: the probe reads `run`'s exit code and outputs alone.
    const failing = {
      run: () => Promise.resolve({ exitCode: 137, stdout: "", stderr: "Killed" }),
    } as unknown as RepositorySandbox;
    assert.equal(yield* sandboxIdle(failing), false);
  }),
);
