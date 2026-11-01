import { LUKE_BROWSER_PIN } from "@luke/agent-runner/pins";
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
 * the background.
 *
 * Every process a person or a model drives in the sandbox starts under
 * `setpriv` with its capability bounding set emptied
 * (`../sandbox-capabilities.ts`): the agent's and its workers' commands
 * (`coder-host/shell.ts`), a Terminal tab's shells, the agent's browser,
 * and the native runner. The
 * bounding set is inherited across `fork` and kept across `execve`, and a
 * process can only drop from it, never add back
 * (https://man7.org/linux/man-pages/man7/capabilities.7.html), so every
 * descendant of those commands, a daemon that detached from its shell
 * included, carries an empty one, and nothing else in the sandbox does:
 * the sandbox's API starts Luke's own commands, this probe among them, with
 * the whole set. The probe reads `CapBnd` from each process's
 * `/proc/<pid>/status` and names each process whose set is empty.
 *
 * Luke's own browser is the one such process it passes over: Xvfb, and
 * Chromium with its renderers and helpers, each in a session led by Xvfb on
 * Luke's display or by Chromium on Luke's DevTools port
 * (`@luke/agent-runner/pins`'s `LUKE_BROWSER_PIN`), which the probe reads
 * from the session's leader's `/proc/<sid>/cmdline`. Once the agent opened
 * it, it would otherwise hold every pause's sandbox up for the rest of the
 * turn. A stop ends it, and the next connection starts it again on the
 * profile the stop kept on disk and reopens the agent's tabs
 * (`../browser/restore-tabs.ts`), losing only what its pages held unsaved.
 * The bridge a live view reaches it through is no session of the browser's,
 * so a member watching still reads as busy, beside the lease that holds the
 * sandbox for them (`sandbox.ts`).
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
 * between the listing and its read is passed over, and one whose session
 * is named nowhere (`NSsid`) or whose leader's command line cannot be read
 * is never taken for the browser's. The count of processes read is written
 * last, so an answer cut short, or a `/proc` with nothing readable, reads
 * as no answer rather than as no process.
 */
const PROBE = [
  "read=0",
  "leads_browser() {",
  `  tr '\\0' '\\n' <"/proc/$1/cmdline" 2>/dev/null | awk -v xvfb='${LUKE_BROWSER_PIN.XVFB}' -v display=':${LUKE_BROWSER_PIN.DISPLAY}' -v devtools='--remote-debugging-port=${LUKE_BROWSER_PIN.DEVTOOLS_PORT}' 'NR == 1 { count = split($0, path, "/"); led = path[count] == xvfb } led && NR == 2 { found = $0 == display } !led && $0 == devtools { found = 1 } END { exit !found }'`,
  "}",
  "for status in /proc/[0-9]*/status; do",
  `  line=$(awk '$1 == "Name:" { name = $2 } $1 == "NSsid:" { session = $2 } $1 == "CapBnd:" { bounding = $2 } END { if (bounding ~ /^0+$/) print (session == "" ? "-" : session) " " name }' "$status" 2>/dev/null) || continue`,
  "  read=$((read + 1))",
  '  [ -n "$line" ] || continue',
  `  if leads_browser "\${line%% *}"; then continue; fi`,
  `  printf '${PROBE_AGENT} %s\\n' "\${line#* }"`,
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
