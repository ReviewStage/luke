import {
  boundedInvocation,
  DEFAULT_CLI_PATH_DIRECTORIES,
  INVOCATION_FAILURE,
  InvocationError,
} from "@sidecar/process";
import {
  ACT_RESULT_STATUS,
  CLI_CONNECTION,
  type CliConnection,
  type ProviderActResult,
  type ProviderSessionObservation,
  SESSION_LOCATION,
  type SessionProvider,
  SessionProviderAdapterBase,
} from "@sidecar/session";
import {
  resolveOptions,
  unparsedWire,
  type WireBoundaryInput,
  type WireRecord,
  wireRecord,
} from "@sidecar/wire";

/**
 * How a CLI-observed provider fails. Unavailable means there is nothing to
 * observe with — the binary is not installed, or its login probe answered no —
 * which is the CLI analogue of a missing API key and clears observed state the
 * same way. Transient covers a command that ran and failed, which keeps the
 * last snapshot until the next attempt the way a network blip does.
 */
export const CLI_FAILURE = {
  UNAVAILABLE: "unavailable",
  TRANSIENT: "transient",
} as const;

export type CliFailure = (typeof CLI_FAILURE)[keyof typeof CLI_FAILURE];

export class CliCommandError extends Error {
  readonly failure: CliFailure;

  constructor(failure: CliFailure, message: string) {
    super(message);
    this.name = "CliCommandError";
    this.failure = failure;
  }
}

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

/**
 * Where provider CLIs actually land on a Mac. An app launched from the Finder
 * inherits a PATH without the package-manager directories a terminal adds, so
 * these are appended after the inherited PATH — never ahead of it, so a binary
 * the user's own shell would resolve still wins.
 */
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
const defaultRun: CliRun = async (binary, argv, options) => {
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
    throw new CliCommandError(
      error instanceof InvocationError && error.failure === INVOCATION_FAILURE.UNAVAILABLE
        ? CLI_FAILURE.UNAVAILABLE
        : CLI_FAILURE.TRANSIENT,
      `${binary} could not be run`,
    );
  }
};

export interface CliAdapterOptions {
  run?: CliRun;
  now?: () => number;
  minimumRefreshIntervalMs?: number;
  /**
   * Called when an observation pass fails for a reason other than the CLI
   * being unavailable or a command failing — a TypeError in a subclass's
   * parsing, for example. Unavailable and transient failures never reach it.
   */
  onDiagnostic?: (error: Error) => void;
}

/** The provider identity and the one binary a subclass observes with. */
export interface CliAdapterProfile {
  provider: SessionProvider;
  /** The provider's own CLI, resolved the way the user's shell would resolve it. */
  binary: string;
  /**
   * The read that answers whether the CLI holds a login, by exit code alone.
   * Its stdout is never parsed: what the account is called is the CLI's
   * business, and whether it exists is the only fact observation needs.
   */
  loginProbeArgv: readonly string[];
}

/**
 * The only way a subclass reaches its provider while observing: one invocation
 * of the profile's binary, bounded in time and output, parsed as JSON, and
 * discarded past what the subclass reports. The argv a subclass passes must be
 * fixed by the build — the same rule that fixes a POSTed read document — with
 * nothing interpolated beyond bounded values the provider itself reported.
 */
export type CliReadRequest = (argv: readonly string[]) => Promise<WireRecord>;

/**
 * The shared half of every CLI-observed provider adapter: the login gate, its
 * own refresh cadence, the failure rules that decide whether a snapshot
 * survives, and bounded read-only invocations of the provider's own CLI.
 *
 * The credential never passes through Luke. The CLI holds the login the user
 * gave it for its own sake, and observation runs under it exactly as the
 * user's own terminal would — Luke reads no token, stores none, and passes
 * none. A machine whose CLI is absent or signed out is observed as having
 * nothing, the same answer a cloud provider gives with no key, so observation
 * begins and ends with the user's own login and nothing else.
 */
export abstract class CliSessionAdapter extends SessionProviderAdapterBase {
  readonly provider: SessionProvider;

  readonly #binary: string;
  readonly #loginProbeArgv: readonly string[];
  readonly #run: CliRun;
  readonly #now: () => number;
  readonly #minimumRefreshIntervalMs: number;
  readonly #onDiagnostic: ((error: Error) => void) | undefined;

  #observations: readonly ProviderSessionObservation[] = [];
  #lastAttemptAt = Number.NEGATIVE_INFINITY;
  #collectPass = 0;
  #connection: CliConnection = CLI_CONNECTION.UNKNOWN;

  constructor(profile: CliAdapterProfile, options: CliAdapterOptions = {}) {
    super();
    this.provider = profile.provider;
    this.#binary = profile.binary;
    this.#loginProbeArgv = profile.loginProbeArgv;
    this.#run = options.run ?? defaultRun;
    this.#now = options.now ?? Date.now;
    const { minimumRefreshIntervalMs } = resolveOptions(
      options,
      { minimumRefreshIntervalMs: CLI_ADAPTER_DEFAULTS.MINIMUM_REFRESH_INTERVAL_MS },
      { nonNegative: ["minimumRefreshIntervalMs"] },
    );
    this.#minimumRefreshIntervalMs = minimumRefreshIntervalMs;
    this.#onDiagnostic = options.onDiagnostic;
  }

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    const now = this.#now();
    // A CLI is spawned per read, so the cadence guard leads everything: the
    // shared refresh timer ticks faster than a process-per-pass should run.
    if (now - this.#lastAttemptAt < this.#minimumRefreshIntervalMs) return this.#observations;
    this.#lastAttemptAt = now;

    const pass = ++this.#collectPass;
    try {
      // The login is probed every pass rather than cached, so signing the CLI
      // out is honoured on the next pass the way removing a key is: state read
      // under a login that no longer stands must not keep being served.
      const connection = await this.#probeLogin();
      this.#connection = connection;
      if (connection !== CLI_CONNECTION.CONNECTED) {
        this.#forgetObservedState(pass);
        return this.#observations;
      }
      const collected = await this.collect(this.#requestForPass(pass), now);
      if (pass === this.#collectPass) this.#observations = cliObservations(collected);
    } catch (error) {
      // A superseded pass says nothing about the login that now stands.
      if (pass !== this.#collectPass) return this.#observations;
      if (error instanceof CliCommandError) {
        // A binary gone mid-pass clears observed state; a command that ran and
        // failed keeps the previous snapshot until the next attempt.
        if (error.failure === CLI_FAILURE.UNAVAILABLE) {
          this.#connection = CLI_CONNECTION.CLI_MISSING;
          this.#forgetObservedState(pass);
        }
        return this.#observations;
      }
      // Anything else is a bug in this pass — a TypeError thrown by a
      // subclass's parsing is not a flaky command, and must not keep serving
      // the stale snapshot with no log, counter, or hook.
      this.#onDiagnostic?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    return this.#observations;
  }

  /** Runs one login-gated pass. Duplicate session ids are dropped by the base. */
  protected abstract collect(
    request: CliReadRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]>;

  /**
   * What the latest pass learned about the login behind this provider, for a
   * settings row to report — never the login itself, which stays the CLI's.
   */
  connection(): CliConnection {
    return this.#connection;
  }

  /**
   * Clears anything a subclass cached across passes — projects offered for
   * creation, above all. It runs whenever the login goes away, so nothing
   * observed under one login can be offered or acted on under another.
   */
  protected forgetCachedIdentity(): void {}

  /**
   * The one authenticated write: a single invocation of the provider's own
   * CLI, for something the user just asked for against what the latest pass
   * observed — a subclass validates before it builds the argv, exactly as the
   * cloud base does. The login is probed at act time rather than held from
   * the observation pass, so a CLI signed out since then refuses before
   * anything runs, and the refusal wording is fixed here rather than echoing
   * whatever the CLI printed. What the command wrote to stdout rides an
   * acceptance for the subclass that needs the id a creation named — it
   * travels no further than that subclass.
   */
  protected async performWrite(
    argv: readonly string[],
  ): Promise<{ outcome: ProviderActResult; stdout?: string }> {
    const name = this.provider.displayName;
    let connection: CliConnection;
    try {
      connection = await this.#probeLogin();
    } catch {
      return {
        outcome: {
          status: ACT_RESULT_STATUS.REJECTED,
          reason: `${name}'s CLI could not answer, so nothing was sent.`,
        },
      };
    }
    this.#connection = connection;
    if (connection !== CLI_CONNECTION.CONNECTED) {
      // The act just learned what the next pass would have: the login is
      // gone. Observed state clears now rather than a tick later, and a pass
      // still in flight is superseded so its answer cannot land what was read
      // under the login that no longer stands.
      this.#forgetLogin();
      return {
        outcome: {
          status: ACT_RESULT_STATUS.REJECTED,
          reason:
            connection === CLI_CONNECTION.CLI_MISSING
              ? `${name}'s CLI is not installed, so nothing was sent.`
              : `${name}'s CLI is signed out, so nothing was sent.`,
        },
      };
    }
    let result: CliRunResult;
    try {
      result = await this.#run(this.#binary, argv, {
        timeoutMs: CLI_ADAPTER_DEFAULTS.WRITE_TIMEOUT_MS,
        maximumOutputBytes: CLI_ADAPTER_DEFAULTS.MAXIMUM_OUTPUT_BYTES,
      });
    } catch {
      return {
        outcome: {
          status: ACT_RESULT_STATUS.REJECTED,
          reason: `${name}'s CLI could not answer, so the request may not have landed.`,
        },
      };
    }
    if (result.exitCode !== 0) {
      return {
        outcome: {
          status: ACT_RESULT_STATUS.REJECTED,
          reason: `${name}'s CLI refused the request.`,
        },
      };
    }
    // A write that landed changes what the provider holds, so the refresh
    // that follows must actually ask rather than serve the cached snapshot.
    this.#lastAttemptAt = Number.NEGATIVE_INFINITY;
    return { outcome: { status: ACT_RESULT_STATUS.ACCEPTED }, stdout: result.stdout };
  }

  async #probeLogin(): Promise<CliConnection> {
    try {
      const probe = await this.#run(this.#binary, this.#loginProbeArgv, {
        timeoutMs: CLI_ADAPTER_DEFAULTS.COMMAND_TIMEOUT_MS,
        maximumOutputBytes: CLI_ADAPTER_DEFAULTS.MAXIMUM_OUTPUT_BYTES,
      });
      return probe.exitCode === 0 ? CLI_CONNECTION.CONNECTED : CLI_CONNECTION.SIGNED_OUT;
    } catch (error) {
      // A probe that cannot run at all is a machine with nothing to observe;
      // a probe that ran out of time says nothing about the login either way,
      // so the pass keeps its snapshot and asks again next time.
      if (error instanceof CliCommandError && error.failure === CLI_FAILURE.UNAVAILABLE) {
        return CLI_CONNECTION.CLI_MISSING;
      }
      throw error;
    }
  }

  /**
   * Binds one pass's invocations to its own currency, so a slow command from
   * a pass that has been superseded fails instead of landing its answer over
   * state that belongs to the newer pass.
   */
  #requestForPass(pass: number): CliReadRequest {
    return async (argv) => {
      this.#assertPassCurrent(pass);
      const result = await this.#run(this.#binary, argv, {
        timeoutMs: CLI_ADAPTER_DEFAULTS.COMMAND_TIMEOUT_MS,
        maximumOutputBytes: CLI_ADAPTER_DEFAULTS.MAXIMUM_OUTPUT_BYTES,
      });
      this.#assertPassCurrent(pass);
      const name = this.provider.displayName;
      if (result.exitCode !== 0) {
        throw new CliCommandError(CLI_FAILURE.TRANSIENT, `${name} CLI answered with a failure`);
      }
      let body: WireBoundaryInput;
      try {
        body = JSON.parse(result.stdout);
      } catch {
        throw new CliCommandError(CLI_FAILURE.TRANSIENT, `${name} CLI answered unreadably`);
      }
      const bodyRecord = wireRecord(unparsedWire(body));
      if (!bodyRecord) {
        throw new CliCommandError(CLI_FAILURE.TRANSIENT, `${name} CLI answered unexpectedly`);
      }
      return bodyRecord;
    };
  }

  #assertPassCurrent(pass: number): void {
    if (pass !== this.#collectPass) {
      throw new CliCommandError(
        CLI_FAILURE.TRANSIENT,
        `${this.provider.displayName} pass was superseded`,
      );
    }
  }

  #forgetObservedState(pass: number): void {
    if (pass !== this.#collectPass) return;
    this.#forgetLogin();
  }

  /**
   * Clears observed state and supersedes any pass still in flight, so nothing
   * read under a login that no longer stands can land back over the clear.
   */
  #forgetLogin(): void {
    this.#collectPass += 1;
    this.forgetCachedIdentity();
    this.#observations = [];
  }
}

/**
 * Drops a session a subclass reported twice, and stamps the location the base
 * already knows: nothing reaches this point except through the provider's own
 * cloud CLI, so a subclass cannot forget to say its sessions run elsewhere.
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
