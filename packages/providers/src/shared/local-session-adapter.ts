import {
  ACT_RESULT_STATUS,
  type ProviderMessageResult,
  type ProviderSessionMessage,
  type ProviderSessionObservation,
  type SessionProvider,
  SessionProviderAdapterBase,
  UNSUPPORTED_BY_OBSERVATION,
} from "@sidecar/session";
import type { SessionFileCandidate } from "./local-files.js";
import {
  type ObservationPass,
  observationPass,
  type RosterHolder,
  rosterHolder,
} from "./observation-pass.js";

export interface LocalSessionAdapterOptions {
  now?: () => number;
}

/**
 * The adapter-shaped half of a local provider: the roster a local write
 * re-checks against, and the guard that does the re-checking.
 */
export abstract class LocalSessionAdapter extends SessionProviderAdapterBase {
  readonly #now: () => number;
  readonly #roster: RosterHolder = rosterHolder();

  protected constructor(options: LocalSessionAdapterOptions = {}) {
    super();
    this.#now = options.now ?? Date.now;
  }

  protected observationTime(): number {
    return this.#now();
  }

  /** Publishes exactly the roster a local write must re-check against. */
  protected observed(
    observations: readonly ProviderSessionObservation[],
  ): readonly ProviderSessionObservation[] {
    return this.#roster.publish(observations);
  }

  /**
   * Reads the delivery's own target back out of the latest pass, which is the
   * one place a local write may learn where to land. A local adapter gains no
   * write by inheriting this: the default delivery remains unsupported.
   */
  override async sendMessage(message: ProviderSessionMessage): Promise<ProviderMessageResult> {
    const observation = this.#roster
      .latest()
      .find((candidate) => candidate.providerSessionId === message.providerSessionId);
    if (!observation) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
      };
    }
    return this.deliverMessage(observation, message.text);
  }

  protected async deliverMessage(
    _observation: ProviderSessionObservation,
    _text: string,
  ): Promise<ProviderMessageResult> {
    return {
      status: ACT_RESULT_STATUS.UNSUPPORTED,
      reason: "This provider has no such control.",
    };
  }
}

export abstract class LocalFileSessionAdapter<
  Candidate extends SessionFileCandidate,
  Parsed,
> extends LocalSessionAdapter {
  abstract override readonly provider: SessionProvider;

  readonly #pass: ObservationPass;

  protected constructor(options: LocalSessionAdapterOptions = {}) {
    super(options);
    this.#pass = observationPass<Candidate, Parsed>({
      now: () => this.observationTime(),
      discover: () => this.discover(),
      prepare: (candidates) => this.prepare(candidates),
      parse: (candidate) => this.parse(candidate),
      observation: ({ candidate, parsed, now, activeSessionFreshnessMs }) =>
        this.observation(candidate, parsed, now, activeSessionFreshnessMs),
    });
  }

  protected abstract discover(): Promise<readonly Candidate[]>;
  protected abstract parse(candidate: Candidate): Promise<Parsed>;
  protected abstract observation(
    candidate: Candidate,
    parsed: Parsed,
    now: number,
    activeSessionFreshnessMs: number,
  ): Promise<ProviderSessionObservation> | ProviderSessionObservation;

  protected prepare(_candidates: readonly Candidate[]): Promise<void> | void {}

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    return this.observed(await this.#pass.run());
  }
}
