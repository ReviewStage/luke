import { type AgentToolPin, SMOLVM_LINUX_PIN } from "@luke/agent-runner/pins";
import { Duration, Effect, Option, Result, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { HOST_SMOLVM, type HostSmolvmSource } from "./host-os.js";

/**
 * host-smolvm.ts -- the check a host's daemon makes of its `smolvm` before it follows anything: that the one the install script put at the path it was told answers `--version` with the pinned release (`SMOLVM_LINUX_PIN`), and the words it refuses to start in where it does not.
 *
 * Every agent of a host runs in a VM of its own, so a box whose `smolvm` is
 * missing, will not run, or is another release than the one Luke's launcher
 * was written and tried against would fail agent after agent, each in its own
 * unclear way. The daemon asks once as it starts, and a refusal says what it
 * found and what to run. A host whose OS fetches the pinned release itself
 * (`HOST_SMOLVM.PIN`) is not asked: the fetch checks it.
 */

/** How long `smolvm --version` may take; it only prints its release. */
const VERSION_WITHIN = Duration.seconds(30);

/** What the box's operator runs to put the pinned release in place. */
const REINSTALL = "Run the install command again (Settings › Agents › Hosts) to install it.";

/** The `smolvm` a host runs its agents' VMs with, or the line it refuses to start with. */
type HostSmolvm = Result.Result<string | AgentToolPin, string>;

/** What `smolvm --version` prints for the release given. */
const versionLine = (version: string) => `smolvm ${version}`;

/** The `--version` answer of the `smolvm` at the path given, trimmed; none where it could not be run or did not exit 0 in time. */
const answered = (smolvm: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(smolvm, ["--version"], {
        stdin: "ignore",
        stderr: "ignore",
      });
      const printed = yield* Stream.mkString(Stream.decodeText(handle.stdout));
      const code = Number(yield* handle.exitCode);
      return code === 0 ? Option.some(printed.trim()) : Option.none<string>();
    }),
  ).pipe(
    Effect.timeoutOption(VERSION_WITHIN),
    Effect.map(Option.flatten),
    Effect.orElseSucceed(() => Option.none<string>()),
  );

/** The line the daemon refuses to start with where the `smolvm` at the path given is not the pinned release; none where it is. */
export const hostSmolvmRefusal = (smolvm: string) =>
  Effect.map(answered(smolvm), (answer) => {
    const wanted = versionLine(SMOLVM_LINUX_PIN.VERSION);
    if (Option.isNone(answer)) {
      return Option.some(
        `Luke host: could not run ${smolvm} --version, so it will not start: every agent runs in a smolvm ${SMOLVM_LINUX_PIN.VERSION} VM. ${REINSTALL}`,
      );
    }
    if (answer.value === wanted) return Option.none<string>();
    return Option.some(
      `Luke host: ${smolvm} answers "${answer.value}", not "${wanted}", so it will not start: Luke runs agents in the pinned release only. ${REINSTALL}`,
    );
  });

/**
 * The `smolvm` a host runs its agents' VMs with, from where its OS says it
 * comes: the path its service names, once it answers the pinned release, or
 * the pin, fetched and checked as the first agent starts; the line the
 * daemon refuses to start with otherwise.
 */
export const hostSmolvm = (
  source: HostSmolvmSource,
  environment: Readonly<Record<string, string | undefined>>,
) => {
  if (source.kind === HOST_SMOLVM.PIN) {
    return Effect.succeed<HostSmolvm>(Result.succeed(source.pin));
  }
  const smolvm = environment[source.variable] ?? "";
  if (smolvm.length === 0) {
    return Effect.succeed<HostSmolvm>(
      Result.fail(
        `Luke host: ${source.variable} names no smolvm, so it will not start. Run the install command again (Settings › Agents › Hosts) to set this box's service up.`,
      ),
    );
  }
  return Effect.map(
    hostSmolvmRefusal(smolvm),
    (refusal): HostSmolvm =>
      Option.match(refusal, {
        onNone: () => Result.succeed(smolvm),
        onSome: (line) => Result.fail(line),
      }),
  );
};
