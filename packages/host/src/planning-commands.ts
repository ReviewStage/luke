import { type ExecFileException, execFile } from "node:child_process";
import type { HostedPlanClient } from "@sidecar/hosted";
import {
  PLAN_COMMAND_OUTPUT_MAX_CHARS,
  type PlanCommand,
  type PlanCommandResult,
} from "@sidecar/hosted/plan-wire";
import { Duration, Effect, Schema, type Scope } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

/**
 * planning-commands.ts -- the Mac's side of the planning model's `run_in_repository`: claim the open plan's next command, run it in the plan's folder, post what it answered.
 *
 * The planning model runs on the service and the plan's folder is here, and
 * only this side can call the other. So while a plan is open in the Plans
 * panel, one loop holds a claim open on the service
 * (`apps/web/server/hosted/repository-shell.ts`), runs each command it is
 * handed with the folder as its working directory, and settles it. Nothing
 * here limits what a command may do: the folder is the developer's own.
 */

const PLANNING_COMMANDS = {
  /** How long one command may run before it is killed. */
  TIMEOUT_MS: 30_000,
  /** The most bytes of output a command may write before it is killed. */
  MAX_BUFFER_BYTES: 16 * 1024 * 1024,
  /** The exit code a command answers when bash itself could not be started. */
  SPAWN_FAILED_EXIT_CODE: 127,
  /** How long the loop waits when no plan is open, or the service did not answer. */
  IDLE: Duration.seconds(1),
  RETRY: Duration.seconds(2),
} as const;

/** What the loop needs: the service's command calls, and the plan open now. */
export interface PlanningCommandsDependencies {
  readonly client: Pick<HostedPlanClient, "claimCommand" | "settleCommand">;
  /** The open plan, when commands may be claimed for it now. */
  readonly openPlanId: () => string | undefined;
}

/** An output cut to what one result may carry. */
function bounded(output: string): string {
  return output.slice(0, PLAN_COMMAND_OUTPUT_MAX_CHARS);
}

const isExitCode = Schema.is(Schema.Int);

/**
 * What one run answered. Note that a run with no exit code of its own, bash
 * never started or the run killed at its timeout, answers the spawn failure's
 * code with the error's words as stderr, so the model reads why.
 */
function resultOf(
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
): PlanCommandResult {
  if (error === null) return { exitCode: 0, stdout: bounded(stdout), stderr: bounded(stderr) };
  const exitCode = isExitCode(error.code) ? error.code : PLANNING_COMMANDS.SPAWN_FAILED_EXIT_CODE;
  const diagnostics = stderr === "" ? error.message : stderr;
  return { exitCode, stdout: bounded(stdout), stderr: bounded(diagnostics) };
}

/** One command run with bash in its folder; every outcome is a result, and an interrupted run is killed. */
function runPlanCommand(
  command: Pick<PlanCommand, "command" | "cwd">,
): Effect.Effect<PlanCommandResult> {
  return Effect.callback<PlanCommandResult>((resume) => {
    const child = execFile(
      "/bin/bash",
      ["-lc", command.command],
      {
        cwd: command.cwd,
        encoding: "utf8",
        timeout: PLANNING_COMMANDS.TIMEOUT_MS,
        maxBuffer: PLANNING_COMMANDS.MAX_BUFFER_BYTES,
      },
      (error, stdout, stderr) => resume(Effect.succeed(resultOf(error, stdout, stderr))),
    );
    return Effect.sync(() => void child.kill());
  });
}

/** One turn of the loop: claim for the open plan, run what was handed, settle it. */
function serveOnce(dependencies: PlanningCommandsDependencies): Effect.Effect<void> {
  return Effect.gen(function* () {
    const planId = dependencies.openPlanId();
    if (planId === undefined) return yield* Effect.sleep(PLANNING_COMMANDS.IDLE);
    const claimed = yield* dependencies.client.claimCommand(planId);
    if (claimed === undefined) return yield* Effect.sleep(PLANNING_COMMANDS.RETRY);
    if (claimed === null) return;
    const result = yield* runPlanCommand(claimed);
    yield* dependencies.client.settleCommand(planId, claimed.id, result);
  }).pipe(Effect.provide(FetchHttpClient.layer));
}

/** The loop, forked into the scope it runs for, so closing the scope stops it. */
export function servePlanningCommands(
  dependencies: PlanningCommandsDependencies,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.asVoid(Effect.forkScoped(Effect.forever(serveOnce(dependencies))));
}
