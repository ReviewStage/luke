import {
  PROVIDER_ACT_RESULT_STATUS,
  type ProviderActResult,
  type ProviderSessionObservation,
  resolveOptions,
  SESSION_LOCATION,
  type SessionProvider,
  SessionProviderAdapterBase,
  type WireRecord,
} from "@sidecar/core";
import { CLI_FAILURE, CliFailure } from "@sidecar/core/effect-errors";
import { Effect } from "effect";
import { Cli } from "./services/cli";
import { CLI_CONNECTION, type CliConnection } from "./shared/contracts";
import { unparsedWire, type WireBoundaryInput, wireRecord } from "./wire-boundary";

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

export interface CliAdapterOptions {
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
 // SAFETY: The preceding check establishes the asserted contract.
 * of the profile's binary, bounded in time and output, parsed as JSON, and
 * discarded past what the subclass reports. The argv a subclass passes must be
 * fixed by the build — the same rule that fixes a POSTed read document — with
 * nothing interpolated beyond bounded values the provider itself reported.
 */
export type CliReadRequest = (
  argv: readonly string[],
) => Effect.Effect<WireRecord, CliFailure, Cli>;

/**
 * The shared half of every CLI-observed provider adapter: the login gate, its
 * own refresh cadence, the failure rules that decide whether a snapshot
 * survives, and bounded read-only invocations of the provider's own CLI.
 *
 * The credential never passes through Luke. The CLI holds the login the user
 // SAFETY: The preceding check establishes the asserted contract.
 * gave it for its own sake, and observation runs under it exactly as the
 * user's own terminal would — Luke reads no token, stores none, and passes
 // SAFETY: The preceding check establishes the asserted contract.
 * none. A machine whose CLI is absent or signed out is observed as having
 * nothing, the same answer a cloud provider gives with no key, so observation
 * begins and ends with the user's own login and nothing else.
 */
export abstract class CliSessionAdapter extends SessionProviderAdapterBase {
  readonly provider: SessionProvider;

  readonly #binary: string;
  readonly #loginProbeArgv: readonly string[];
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
    this.#now = options.now ?? Date.now;
    const { minimumRefreshIntervalMs } = resolveOptions(
      options,
      { minimumRefreshIntervalMs: CLI_ADAPTER_DEFAULTS.MINIMUM_REFRESH_INTERVAL_MS },
      { nonNegative: ["minimumRefreshIntervalMs"] },
    );
    this.#minimumRefreshIntervalMs = minimumRefreshIntervalMs;
    this.#onDiagnostic = options.onDiagnostic;
  }

  observe(): Effect.Effect<readonly ProviderSessionObservation[], unknown, Cli> {
    return Effect.gen(this, function* () {
      const now = this.#now();
      // A CLI is spawned per read, so the cadence guard leads everything: the
      // shared refresh timer ticks faster than a process-per-pass should run.
      if (now - this.#lastAttemptAt < this.#minimumRefreshIntervalMs) return this.#observations;
      this.#lastAttemptAt = now;

      const pass = ++this.#collectPass;
      yield* Effect.gen(this, function* () {
        // The login is probed every pass rather than cached, so signing the CLI
        // out is honoured on the next pass the way removing a key is: state read
        // under a login that no longer stands must not keep being served.
        const connection = yield* this.#probeLogin();
        this.#connection = connection;
        if (connection !== CLI_CONNECTION.CONNECTED) {
          this.#forgetObservedState(pass);
          return;
        }
        const collected = yield* this.collect(this.#requestForPass(pass), now);
        if (pass === this.#collectPass) this.#observations = cliObservations(collected);
      }).pipe(
        Effect.catchTag("CliFailure", (error) => {
          // A superseded pass says nothing about the login that now stands.
          if (pass !== this.#collectPass) return Effect.void;
          // A binary gone mid-pass clears observed state; a command that ran and
          // failed keeps the previous snapshot until the next attempt.
          if (error.failure === CLI_FAILURE.UNAVAILABLE) {
            this.#connection = CLI_CONNECTION.CLI_MISSING;
            this.#forgetObservedState(pass);
          }
          return Effect.void;
        }),
        Effect.catchAll((error) => {
          if (pass !== this.#collectPass) return Effect.void;
          // Anything else is a bug in this pass — a TypeError thrown by a
          // subclass's parsing is not a flaky command, and must not keep serving
          // the stale snapshot with no log, counter, or hook.
          this.#onDiagnostic?.(
            (error as unknown) instanceof Error ? error : new Error(String(error)),
          );
          return Effect.fail(error);
        }),
      );
      return this.#observations;
    });
  }

  /** Runs one login-gated pass. Duplicate session ids are dropped by the base. */
  protected abstract collect(
    request: CliReadRequest,
    now: number,
  ): Effect.Effect<readonly ProviderSessionObservation[], CliFailure, Cli>;

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
   // SAFETY: The preceding check establishes the asserted contract.
   * observed — a subclass validates before it builds the argv, exactly as the
   * cloud base does. The login is probed at act time rather than held from
   * the observation pass, so a CLI signed out since then refuses before
   * anything runs, and the refusal wording is fixed here rather than echoing
   * whatever the CLI printed. What the command wrote to stdout rides an
   * acceptance for the subclass that needs the id a creation named — it
   * travels no further than that subclass.
   */
  protected performWrite(
    argv: readonly string[],
  ): Effect.Effect<{ outcome: ProviderActResult; stdout?: string }, never, Cli> {
    return Effect.gen(this, function* () {
      const name = this.provider.displayName;
      const probe = yield* Effect.either(this.#probeLogin());
      if (probe._tag === "Left") {
        return {
          outcome: {
            status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
            reason: `${name}'s CLI could not answer, so nothing was sent.`,
          },
        };
      }
      const connection = probe.right;
      this.#connection = connection;
      if (connection !== CLI_CONNECTION.CONNECTED) {
        // The act just learned what the next pass would have: the login is
        // gone. Observed state clears now rather than a tick later, and a pass
        // still in flight is superseded so its answer cannot land what was read
        // under the login that no longer stands.
        this.#forgetLogin();
        return {
          outcome: {
            status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
            reason:
              connection === CLI_CONNECTION.CLI_MISSING
                ? `${name}'s CLI is not installed, so nothing was sent.`
                : `${name}'s CLI is signed out, so nothing was sent.`,
          },
        };
      }
      const cli = yield* Cli;
      const run = yield* Effect.either(
        cli.run(this.#binary, argv, {
          timeoutMs: CLI_ADAPTER_DEFAULTS.WRITE_TIMEOUT_MS,
          maximumOutputBytes: CLI_ADAPTER_DEFAULTS.MAXIMUM_OUTPUT_BYTES,
          provider: name,
        }),
      );
      if (run._tag === "Left") {
        return {
          outcome: {
            status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
            reason: `${name}'s CLI could not answer, so the request may not have landed.`,
          },
        };
      }
      const result = run.right;
      if (result.exitCode !== 0) {
        return {
          outcome: {
            status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
            reason: `${name}'s CLI refused the request.`,
          },
        };
      }
      // A write that landed changes what the provider holds, so the refresh
      // that follows must actually ask rather than serve the cached snapshot.
      this.#lastAttemptAt = Number.NEGATIVE_INFINITY;
      return { outcome: { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED }, stdout: result.stdout };
    });
  }

  #probeLogin(): Effect.Effect<CliConnection, CliFailure, Cli> {
    return Effect.gen(this, function* () {
      const cli = yield* Cli;
      const probe = yield* cli
        .run(this.#binary, this.#loginProbeArgv, {
          timeoutMs: CLI_ADAPTER_DEFAULTS.COMMAND_TIMEOUT_MS,
          maximumOutputBytes: CLI_ADAPTER_DEFAULTS.MAXIMUM_OUTPUT_BYTES,
          provider: this.provider.displayName,
        })
        .pipe(
          Effect.catchTag("CliFailure", (error) =>
            error.failure === CLI_FAILURE.UNAVAILABLE
              ? Effect.succeed(undefined)
              : Effect.fail(error),
          ),
        );
      if (probe === undefined) return CLI_CONNECTION.CLI_MISSING;
      return probe.exitCode === 0 ? CLI_CONNECTION.CONNECTED : CLI_CONNECTION.SIGNED_OUT;
    });
  }

  /**
   * Binds one pass's invocations to its own currency, so a slow command from
   * a pass that has been superseded fails instead of landing its answer over
   * state that belongs to the newer pass.
   */
  #requestForPass(pass: number): CliReadRequest {
    return (argv) =>
      Effect.gen(this, function* () {
        yield* this.#assertPassCurrent(pass);
        const cli = yield* Cli;
        const result = yield* cli.run(this.#binary, argv, {
          timeoutMs: CLI_ADAPTER_DEFAULTS.COMMAND_TIMEOUT_MS,
          maximumOutputBytes: CLI_ADAPTER_DEFAULTS.MAXIMUM_OUTPUT_BYTES,
          provider: this.provider.displayName,
        });
        yield* this.#assertPassCurrent(pass);
        const name = this.provider.displayName;
        if (result.exitCode !== 0) {
          return yield* Effect.fail(
            new CliFailure({
              failure: CLI_FAILURE.TRANSIENT,
              exitCode: result.exitCode,
              provider: name,
            }),
          );
        }
        let body: WireBoundaryInput;
        try {
          body = JSON.parse(result.stdout) as WireBoundaryInput;
        } catch {
          return yield* Effect.fail(
            new CliFailure({
              failure: CLI_FAILURE.TRANSIENT,
              provider: name,
            }),
          );
        }
        const bodyRecord = wireRecord(unparsedWire(body));
        if (!bodyRecord) {
          return yield* Effect.fail(
            new CliFailure({
              failure: CLI_FAILURE.TRANSIENT,
              provider: name,
            }),
          );
        }
        return bodyRecord;
      });
  }

  #assertPassCurrent(pass: number): Effect.Effect<void, CliFailure> {
    if (pass !== this.#collectPass) {
      return Effect.fail(
        new CliFailure({
          failure: CLI_FAILURE.TRANSIENT,
          provider: this.provider.displayName,
        }),
      );
    }
    return Effect.void;
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
