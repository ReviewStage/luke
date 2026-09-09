import {
  type CliConnection,
  type ProviderActResult,
  type ProviderSessionObservation,
  type SessionProvider,
  SessionProviderAdapterBase,
} from "@sidecar/session";
import type { AdapterDiagnosticCallback } from "./adapter-diagnostics.js";
import { type CliPass, type CliReadRequest, type CliRun, cliPass } from "./cli-pass.js";

export interface CliAdapterOptions {
  run?: CliRun;
  now?: () => number;
  minimumRefreshIntervalMs?: number;
  /**
   * Called when an observation pass fails for a reason other than the CLI
   * being unavailable or a command failing — a TypeError in a subclass's
   * parsing, for example. Unavailable and transient failures never reach it.
   */
  onDiagnostic?: AdapterDiagnosticCallback;
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
 * The adapter-shaped half of a CLI-observed provider. `cliPass` holds the
 * login gate, the refresh cadence, the failure rules and the one write; what
 * is left here is the seams a subclass supplies.
 */
export abstract class CliSessionAdapter extends SessionProviderAdapterBase {
  readonly provider: SessionProvider;

  readonly #pass: CliPass;

  constructor(profile: CliAdapterProfile, options: CliAdapterOptions = {}) {
    super();
    this.provider = profile.provider;
    this.#pass = cliPass({
      ...profile,
      ...options,
      collect: (request, now) => this.collect(request, now),
      forget: () => this.forgetCachedIdentity(),
    });
  }

  observe(): Promise<readonly ProviderSessionObservation[]> {
    return this.#pass.run();
  }

  /** Runs one login-gated pass. Duplicate session ids are dropped by the pass. */
  protected abstract collect(
    request: CliReadRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]>;

  /**
   * What the latest pass learned about the login behind this provider, for a
   * settings row to report — never the login itself, which stays the CLI's.
   */
  connection(): CliConnection {
    return this.#pass.connection();
  }

  /** What the latest pass observed, for a subclass answering an act of its own. */
  protected latest(): readonly ProviderSessionObservation[] {
    return this.#pass.latest();
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
   * cloud base does.
   */
  protected performWrite(
    argv: readonly string[],
  ): Promise<{ outcome: ProviderActResult; stdout?: string }> {
    return this.#pass.write(argv);
  }
}
