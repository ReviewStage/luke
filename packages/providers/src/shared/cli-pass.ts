import {
  ACTION_RESULT_STATUS,
  CLI_CONNECTION,
  type CliConnection,
  type ProviderActionResult,
  type ProviderSessionObservation,
  SESSION_LOCATION,
  type SessionProvider,
} from "@sidecar/session";
import {
  resolveOptions,
  unparsedWire,
  type WireBoundaryInput,
  type WireRecord,
  wireRecord,
} from "@sidecar/wire";
import { ADAPTER_DIAGNOSTIC_KIND, type AdapterDiagnosticCallback } from "./adapter-diagnostics.js";
import { ADAPTER_FAILURE, AdapterFailure, clearsObservedState } from "./adapter-failure.js";
import {
  boundedInvocation,
  DEFAULT_CLI_PATH_DIRECTORIES,
  INVOCATION_FAILURE,
  InvocationError,
} from "./invocation.js";

export const CLI_ADAPTER_DEFAULTS = {
  MINIMUM_REFRESH_INTERVAL_MS: 15 * 1000,
  COMMAND_TIMEOUT_MS: 8 * 1000,
  /**
   * A write command does more than a read answers for — Codex's creation
   * resolves the environment and stands the task up before it prints — so it
   * gets a wider deadline than the read's, and still a hard one.
   */
  WRITE_TIMEOUT_MS: 20 * 1000,
  /** A read that answers with more than this is not the bounded list it claims to be. */
  MAXIMUM_OUTPUT_BYTES: 4 * 1024 * 1024,
} as const;

export interface CliRunResult {
  exitCode: number;
  stdout: string;
}

export type CliRun = (
  binary: string,
  argv: readonly string[],
  options: Readonly<{ timeoutMs: number; maximumOutputBytes: number }>,
) => Promise<CliRunResult>;

/**
 * Runs the binary directly — no shell, so nothing in an argument can become a
 * second command — and answers with the exit code rather than throwing on it:
 * a probe's no is an answer, not a failure. Only a binary that cannot run at
 * all is unavailable; a command that ran out of time or output is transient.
 */
export const defaultCliRun: CliRun = async (binary, argv, options) => {
  try {
    const result = await boundedInvocation({
      binary,
      arguments: argv,
      timeoutMs: options.timeoutMs,
      maximumOutputBytes: options.maximumOutputBytes,
      pathDirectories: DEFAULT_CLI_PATH_DIRECTORIES,
    });
    return { exitCode: result.exitCode, stdout: result.stdout };
  } catch (error) {
    throw new AdapterFailure(
      error instanceof InvocationError && error.failure === INVOCATION_FAILURE.UNAVAILABLE
        ? ADAPTER_FAILURE.UNAVAILABLE
        : ADAPTER_FAILURE.TRANSIENT,
      `${binary} could not be run`,
    );
  }
};

/**
 * The only way an adapter reaches its provider while observing: one invocation
 * of the pass's binary, bounded in time and output, parsed as JSON, and
 * discarded past what the adapter reports. The argv an adapter passes must be
 * fixed by the build — the same rule that fixes a POSTed read document — with
 * nothing interpolated beyond bounded values the provider itself reported.
 */
export type CliReadRequest = (argv: readonly string[]) => Promise<WireRecord>;

export interface CliPassInput {
  provider: SessionProvider;
  /** The provider's own CLI, resolved the way the user's shell would resolve it. */
  binary: string;
  /**
   * The read that answers whether the CLI holds a login, by exit code alone.
   * Its stdout is never parsed: what the account is called is the CLI's
   * business, and whether it exists is the only fact observation needs.
   */
  loginProbeArgv: readonly string[];
  run?: CliRun;
  now?: () => number;
  minimumRefreshIntervalMs?: number;
  /**
   * Called when an observation pass fails for a reason other than the CLI
   * being unavailable or a command failing — a TypeError in an adapter's
   * parsing, for example. Unavailable and transient failures never reach it.
   */
  onDiagnostic?: AdapterDiagnosticCallback;
  /**
   * Clears anything the adapter cached across passes — projects offered for
   * creation, above all. It runs whenever the login goes away, so nothing
   * observed under one login can be offered or acted on under another.
   */
  forget?(): void;
  /** Runs one login-gated pass. Duplicate session ids are dropped here. */
  collect(request: CliReadRequest, now: number): Promise<readonly ProviderSessionObservation[]>;
}

/**
 * The shared half of every CLI-observed provider: the login gate, its own
 * refresh cadence, the failure rules that decide whether a snapshot survives,
 * bounded read-only invocations of the provider's own CLI, and the one write.
 *
 * The credential never passes through Luke. The CLI holds the login the user
 * gave it for its own sake, and observation runs under it exactly as the
 * user's own terminal would — Luke reads no token, stores none, and passes
 * none. A machine whose CLI is absent or signed out is observed as having
 * nothing, the same answer a cloud provider gives with no key, so observation
 * begins and ends with the user's own login and nothing else. Nothing here
 * raises `unauthorized` for that reason: an absent binary or a probe's no is
 * the only way a login stops standing.
 */
export interface CliPass {
  run(): Promise<readonly ProviderSessionObservation[]>;
  latest(): readonly ProviderSessionObservation[];
  /**
   * What the latest pass learned about the login behind this provider, for a
   * settings row to report — never the login itself, which stays the CLI's.
   */
  connection(): CliConnection;
  /** One authenticated write; answers what became of it, never throws. */
  write(argv: readonly string[]): Promise<{ outcome: ProviderActionResult; stdout?: string }>;
}

/**
 * Drops a session an adapter reported twice, and stamps the location the pass
 * already knows: nothing reaches this point except through the provider's own
 * cloud CLI, so an adapter cannot forget to say its sessions run elsewhere.
 */
function cliObservations(
  observations: readonly ProviderSessionObservation[],
): readonly ProviderSessionObservation[] {
  const unique = new Map<string, ProviderSessionObservation>();
  for (const observation of observations) {
    if (!unique.has(observation.providerSessionId)) {
      unique.set(observation.providerSessionId, {
        ...observation,
        location: SESSION_LOCATION.CLOUD,
      });
    }
  }
  return [...unique.values()];
}

export function cliPass(input: CliPassInput): CliPass {
  const provider = input.provider;
  const binary = input.binary;
  const run = input.run ?? defaultCliRun;
  const now = input.now ?? Date.now;
  const { minimumRefreshIntervalMs } = resolveOptions(
    input,
    { minimumRefreshIntervalMs: CLI_ADAPTER_DEFAULTS.MINIMUM_REFRESH_INTERVAL_MS },
    { nonNegative: ["minimumRefreshIntervalMs"] },
  );

  let observations: readonly ProviderSessionObservation[] = [];
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let collectPass = 0;
  let connection: CliConnection = CLI_CONNECTION.UNKNOWN;

  /**
   * Clears observed state and supersedes any pass still in flight, so nothing
   * read under a login that no longer stands can land back over the clear.
   */
  const forgetLogin = (): void => {
    collectPass += 1;
    input.forget?.();
    observations = [];
  };

  const probeLogin = async (): Promise<CliConnection> => {
    try {
      const probe = await run(binary, input.loginProbeArgv, {
        timeoutMs: CLI_ADAPTER_DEFAULTS.COMMAND_TIMEOUT_MS,
        maximumOutputBytes: CLI_ADAPTER_DEFAULTS.MAXIMUM_OUTPUT_BYTES,
      });
      return probe.exitCode === 0 ? CLI_CONNECTION.CONNECTED : CLI_CONNECTION.SIGNED_OUT;
    } catch (error) {
      // A probe that cannot run at all is a machine with nothing to observe;
      // a probe that ran out of time says nothing about the login either way,
      // so the pass keeps its snapshot and asks again next time.
      if (error instanceof AdapterFailure && clearsObservedState(error.failure)) {
        return CLI_CONNECTION.CLI_MISSING;
      }
      throw error;
    }
  };

  const assertPassCurrent = (pass: number): void => {
    if (pass !== collectPass) {
      throw new AdapterFailure(
        ADAPTER_FAILURE.TRANSIENT,
        `${provider.displayName} pass was superseded`,
      );
    }
  };

  /**
   * Binds one pass's invocations to its own currency, so a slow command from
   * a pass that has been superseded fails instead of landing its answer over
   * state that belongs to the newer pass.
   */
  const requestForPass = (pass: number): CliReadRequest => {
    return async (argv) => {
      assertPassCurrent(pass);
      const result = await run(binary, argv, {
        timeoutMs: CLI_ADAPTER_DEFAULTS.COMMAND_TIMEOUT_MS,
        maximumOutputBytes: CLI_ADAPTER_DEFAULTS.MAXIMUM_OUTPUT_BYTES,
      });
      assertPassCurrent(pass);
      const name = provider.displayName;
      if (result.exitCode !== 0) {
        throw new AdapterFailure(ADAPTER_FAILURE.TRANSIENT, `${name} CLI answered with a failure`);
      }
      let body: WireBoundaryInput;
      try {
        body = JSON.parse(result.stdout);
      } catch {
        throw new AdapterFailure(ADAPTER_FAILURE.TRANSIENT, `${name} CLI answered unreadably`);
      }
      const bodyRecord = wireRecord(unparsedWire(body));
      if (!bodyRecord) {
        throw new AdapterFailure(ADAPTER_FAILURE.TRANSIENT, `${name} CLI answered unexpectedly`);
      }
      return bodyRecord;
    };
  };

  return {
    async run() {
      const attemptedAt = now();
      // A CLI is spawned per read, so the cadence guard leads everything: the
      // shared refresh timer ticks faster than a process-per-pass should run.
      if (attemptedAt - lastAttemptAt < minimumRefreshIntervalMs) return observations;
      lastAttemptAt = attemptedAt;

      const pass = ++collectPass;
      try {
        // The login is probed every pass rather than cached, so signing the
        // CLI out is honoured on the next pass the way removing a key is:
        // state read under a login that no longer stands must not keep being
        // served.
        const probed = await probeLogin();
        connection = probed;
        if (probed !== CLI_CONNECTION.CONNECTED) {
          if (pass === collectPass) forgetLogin();
          return observations;
        }
        const collected = await input.collect(requestForPass(pass), attemptedAt);
        if (pass === collectPass) observations = cliObservations(collected);
      } catch (error) {
        // A superseded pass says nothing about the login that now stands.
        if (pass !== collectPass) return observations;
        if (error instanceof AdapterFailure) {
          // A binary gone mid-pass clears observed state; a command that ran
          // and failed keeps the previous snapshot until the next attempt.
          if (clearsObservedState(error.failure)) {
            connection = CLI_CONNECTION.CLI_MISSING;
            forgetLogin();
          }
          return observations;
        }
        // Anything else is a bug in this pass — a TypeError thrown by an
        // adapter's parsing is not a flaky command, and must not keep serving
        // the stale snapshot with no log, counter, or hook.
        input.onDiagnostic?.(
          ADAPTER_DIAGNOSTIC_KIND.PASS_FAILURE,
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
      return observations;
    },

    latest: () => observations,

    connection: () => connection,

    /**
     * The one authenticated write: a single invocation of the provider's own
     * CLI, for something the user just asked for against what the latest pass
     * observed — an adapter validates before it builds the argv, exactly as
     * the cloud pass's callers do. The login is probed at action time rather than
     * held from the observation pass, so a CLI signed out since then refuses
     * before anything runs, and the refusal wording is fixed here rather than
     * echoing whatever the CLI printed. What the command wrote to stdout rides
     * an acceptance for the adapter that needs the id a creation named — it
     * travels no further than that adapter.
     */
    async write(argv) {
      const name = provider.displayName;
      let probed: CliConnection;
      try {
        probed = await probeLogin();
      } catch {
        return {
          outcome: {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: `${name}'s CLI could not answer, so nothing was sent.`,
          },
        };
      }
      connection = probed;
      if (probed !== CLI_CONNECTION.CONNECTED) {
        // The action just learned what the next pass would have: the login is
        // gone. Observed state clears now rather than a tick later, and a pass
        // still in flight is superseded so its answer cannot land what was
        // read under the login that no longer stands.
        forgetLogin();
        return {
          outcome: {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason:
              probed === CLI_CONNECTION.CLI_MISSING
                ? `${name}'s CLI is not installed, so nothing was sent.`
                : `${name}'s CLI is signed out, so nothing was sent.`,
          },
        };
      }
      let result: CliRunResult;
      try {
        result = await run(binary, argv, {
          timeoutMs: CLI_ADAPTER_DEFAULTS.WRITE_TIMEOUT_MS,
          maximumOutputBytes: CLI_ADAPTER_DEFAULTS.MAXIMUM_OUTPUT_BYTES,
        });
      } catch {
        return {
          outcome: {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: `${name}'s CLI could not answer, so the request may not have landed.`,
          },
        };
      }
      if (result.exitCode !== 0) {
        return {
          outcome: {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: `${name}'s CLI refused the request.`,
          },
        };
      }
      // A write that landed changes what the provider holds, so the refresh
      // that follows must actually ask rather than serve the cached snapshot.
      lastAttemptAt = Number.NEGATIVE_INFINITY;
      return { outcome: { status: ACTION_RESULT_STATUS.ACCEPTED }, stdout: result.stdout };
    },
  };
}
