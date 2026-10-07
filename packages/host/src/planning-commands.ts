import { type ExecFileException, execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import type { HostedPlanClient } from "@sidecar/hosted";
import { PLAN_COMMAND_OUTPUT_MAX_CHARS, type PlanCommandResult } from "@sidecar/hosted/plan-wire";
import { Duration, Effect, Schema, type Scope } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

/**
 * planning-commands.ts -- the Mac's side of the planning model's `run_in_repository`: claim the open plan's next command, run it in the plan's folder, post what it answered.
 *
 * The planning model runs on the service and the plan's folder is here, and
 * only this side can call the other. So while a plan is open in the Plans
 * panel, one loop holds a claim open on the service
 * (`apps/web/server/hosted/repository-shell.ts`), runs each command it is
 * handed with the folder as its working directory, and settles it.
 *
 * Note that the command comes from the service, so the Mac does not trust it.
 * On macOS each command runs inside a kernel sandbox (`sandbox-exec`) that
 * refuses every network call and every write, and reads only the plan's
 * folder and the system's own programs and libraries, so a command can
 * explore the folder and nothing else. A `.env` file, which is where a
 * folder keeps its secrets, is not read even there. Every platform runs it with an
 * environment of its own, so none of Luke's variables reach its output.
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

/** The kernel sandbox a command runs in on macOS; it names its one folder as the `FOLDER` parameter. */
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
// Note that this follows the shape of Codex's read-only Seatbelt policy (deny by default, children inherit it), and
// that a denied mach-lookup is what keeps a command from asking a system service, such as `open`, to act outside it.
const SANDBOX_PROFILE = `(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* (literal "/"))
(allow file-read*
  (subpath (param "FOLDER"))
  (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/System") (subpath "/Library/Apple")
  (subpath "/Library/Developer") (subpath "/Applications/Xcode.app") (subpath "/opt/homebrew")
  (subpath "/private/etc") (subpath "/private/var/db") (subpath "/private/var/select")
  (subpath "/dev"))
(allow file-map-executable
  (subpath "/usr/lib") (subpath "/System") (subpath "/Library/Apple")
  (subpath "/Library/Developer") (subpath "/Applications/Xcode.app") (subpath "/opt/homebrew"))
(allow file-write-data (literal "/dev/null") (literal "/dev/zero") (subpath "/dev/fd"))
(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo"))
(deny file-read-data (regex #"/\\.env[^/]*$"))`;

/** The whole environment a command sees: a search path, and git told to read no config but the folder's and to take no lock. */
function commandEnvironment(folder: string): NodeJS.ProcessEnv {
  return {
    PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: folder,
    LANG: "en_US.UTF-8",
    PAGER: "cat",
    GIT_PAGER: "cat",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

/** The program and arguments that run `command` in `folder`: in the sandbox on macOS, and bash alone where there is none. */
function commandLine(command: string, folder: string): readonly [string, string[]] {
  if (process.platform !== "darwin") return ["/bin/bash", ["-c", command]];
  return [
    SANDBOX_EXEC,
    ["-D", `FOLDER=${folder}`, "-p", SANDBOX_PROFILE, "/bin/bash", "-c", command],
  ];
}

/** The folder with every link resolved, since the sandbox matches a read against the real path; as given when it cannot be read. */
function realFolder(folder: string): string {
  try {
    return realpathSync(folder);
  } catch {
    return folder;
  }
}

/** The plan open now, and the folder of this Mac it reads, if one is recorded. */
interface OpenPlanFolder {
  readonly planId: string;
  readonly folder: string | undefined;
}

/** What the loop needs: the service's command calls, and the plan open now. */
export interface PlanningCommandsDependencies {
  readonly client: Pick<HostedPlanClient, "claimCommand" | "settleCommand">;
  /** The open plan, when commands may be claimed for it now. */
  readonly openPlan: () => OpenPlanFolder | undefined;
}

/** What a command answers on a Mac that holds no folder for its plan, so the model can say what to do. */
const NO_FOLDER_RESULT: PlanCommandResult = {
  exitCode: 1,
  stdout: "",
  stderr:
    "Not run: no folder is chosen for this plan on this Mac. The developer has to choose one.",
};

/** An output cut to what one result may carry. */
function bounded(output: string, maxChars: number): string {
  return output.slice(0, maxChars);
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
  maxChars: number,
): PlanCommandResult {
  if (error === null) {
    return { exitCode: 0, stdout: bounded(stdout, maxChars), stderr: bounded(stderr, maxChars) };
  }
  const exitCode = isExitCode(error.code) ? error.code : PLANNING_COMMANDS.SPAWN_FAILED_EXIT_CODE;
  const diagnostics = stderr === "" ? error.message : stderr;
  return { exitCode, stdout: bounded(stdout, maxChars), stderr: bounded(diagnostics, maxChars) };
}

/**
 * One command run with bash in `folder`, sandboxed; every outcome is a
 * result, cut to `maxChars` of each output, and an interrupted run is killed.
 */
export function runInPlanFolder(
  command: string,
  folder: string,
  maxChars: number = PLAN_COMMAND_OUTPUT_MAX_CHARS,
): Effect.Effect<PlanCommandResult> {
  return Effect.callback<PlanCommandResult>((resume) => {
    const cwd = realFolder(folder);
    const [program, args] = commandLine(command, cwd);
    const child = execFile(
      program,
      args,
      {
        cwd,
        env: commandEnvironment(cwd),
        encoding: "utf8",
        timeout: PLANNING_COMMANDS.TIMEOUT_MS,
        maxBuffer: PLANNING_COMMANDS.MAX_BUFFER_BYTES,
      },
      (error, stdout, stderr) => resume(Effect.succeed(resultOf(error, stdout, stderr, maxChars))),
    );
    return Effect.sync(() => void child.kill());
  });
}

/** One turn of the loop: claim for the open plan, run what was handed, settle it. */
function serveOnce(dependencies: PlanningCommandsDependencies): Effect.Effect<void> {
  return Effect.gen(function* () {
    const open = dependencies.openPlan();
    if (open === undefined) return yield* Effect.sleep(PLANNING_COMMANDS.IDLE);
    const { planId, folder } = open;
    const claimed = yield* dependencies.client.claimCommand(planId);
    if (claimed === undefined) return yield* Effect.sleep(PLANNING_COMMANDS.RETRY);
    if (claimed === null) return;
    const result =
      folder === undefined ? NO_FOLDER_RESULT : yield* runInPlanFolder(claimed.command, folder);
    yield* dependencies.client.settleCommand(planId, claimed.id, result);
  }).pipe(Effect.provide(FetchHttpClient.layer));
}

/** The loop, forked into the scope it runs for, so closing the scope stops it. */
export function servePlanningCommands(
  dependencies: PlanningCommandsDependencies,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.asVoid(Effect.forkScoped(Effect.forever(serveOnce(dependencies))));
}
