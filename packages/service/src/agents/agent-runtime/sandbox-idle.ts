import { Effect, Result } from "effect";
import type { RepositorySandbox } from "../repository-shell.js";

/**
 * sandbox-idle.ts -- whether a coding agent's sandbox runs no process the agent started, so stopping it ends no work.
 *
 * Stopping a sandbox keeps its filesystem and ends every process in it
 * (https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence), so
 * a stop in the middle of a turn, as a long pause asks
 * (`sandbox.ts`'s `parksForLongSleep`), must find nothing of the agent's
 * still running: a dev server, a watch of its checks, a slow suite left in
 * the background, its browser.
 *
 * Every process a person or a model drives in the sandbox starts under
 * `setpriv` with its capability bounding set emptied
 * (`../sandbox-capabilities.ts`): the agent's and its workers' commands
 * (`coder-host/shell.ts`), a Terminal tab's shells, the agent's browser,
 * the native runner, and `show_code`'s reads of the checkout. The
 * bounding set is inherited across `fork` and kept across `execve`, and a
 * process can only drop from it, never add back
 * (https://man7.org/linux/man-pages/man7/capabilities.7.html), so every
 * descendant of those commands, a daemon that detached from its shell
 * included, carries an empty one, and nothing else in the sandbox does:
 * the sandbox's API starts Luke's own commands, this probe among them, with
 * the whole set. The probe reads `CapBnd` from each process's
 * `/proc/<pid>/status` and names each process whose set is empty.
 *
 * Where the probe cannot tell, because the sandbox would not run it, it
 * exited otherwise, or its answer is not the one it writes, the sandbox is
 * read as busy, so it is left up.
 */

/** The probe's last line, ahead of the count of processes it read. */
const PROBE_DONE = "luke-probe-read";

/** The prefix of a line naming a process the agent started. */
const PROBE_AGENT = "luke-probe-agent";

/**
 * The probe, as a script the sandbox's API runs. A process that ends
 * between the listing and its read is passed over. The count of processes
 * read is written last, so an answer cut short, or a `/proc` with nothing
 * readable, reads as no answer rather than as no process.
 */
const PROBE = [
  "read=0",
  "for status in /proc/[0-9]*/status; do",
  `  line=$(awk '$1 == "Name:" { name = $2 } $1 == "CapBnd:" { bounding = $2 } END { if (bounding ~ /^0+$/) print "${PROBE_AGENT} " name }' "$status" 2>/dev/null) || continue`,
  "  read=$((read + 1))",
  '  if [ -n "$line" ]; then printf \'%s\\n\' "$line"; fi',
  "done",
  `printf '${PROBE_DONE} %d\\n' "$read"`,
].join("\n");

/** What the probe found: the names of the agent's processes still running, or nothing where it could not tell. */
type ProbeAnswer = { readonly agentProcesses: readonly string[] } | undefined;

/** The probe's output read: the agent's processes it named, where its last line says how many it read and that is any. */
function readProbe(stdout: string): ProbeAnswer {
  const lines = stdout.trimEnd().split("\n");
  const last = lines.at(-1)?.split(" ");
  if (last?.[0] !== PROBE_DONE || last.length !== 2) return undefined;
  const read = Number(last[1]);
  if (!Number.isInteger(read) || read < 1) return undefined;
  const agentProcesses = lines
    .slice(0, -1)
    .filter((line) => line.startsWith(`${PROBE_AGENT} `))
    .map((line) => line.slice(PROBE_AGENT.length + 1));
  return { agentProcesses };
}

/**
 * Whether the sandbox runs no process the agent started, so a stop ends no
 * work of the agent's. Where the probe cannot tell, it answers no, and
 * where the agent's processes run it says which, by name alone, in the log.
 */
export const sandboxIdle = /* @__PURE__ */ Effect.fn("web/sandboxIdle")(function* (
  sandbox: RepositorySandbox,
): Effect.fn.Return<boolean> {
  const ran = yield* Effect.result(
    Effect.tryPromise(() => sandbox.run({ command: PROBE, workingDirectory: "/" })),
  );
  if (Result.isFailure(ran)) {
    yield* Effect.logWarning("the sandbox's processes were not read; it is left up");
    return false;
  }
  const answer = ran.success.exitCode === 0 ? readProbe(ran.success.stdout) : undefined;
  if (answer === undefined) {
    yield* Effect.logWarning(
      `the sandbox's process probe gave no answer (exit ${ran.success.exitCode}); it is left up`,
    );
    return false;
  }
  if (answer.agentProcesses.length > 0) {
    yield* Effect.logInfo(
      `the sandbox is left up for the agent's processes: ${answer.agentProcesses.join(", ")}`,
    );
    return false;
  }
  return true;
});
