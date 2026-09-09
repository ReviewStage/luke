import {
  ACT_RESULT_STATUS,
  type ProviderMessageResult,
  type ProviderSessionMessage,
  type ProviderSessionObservation,
  SessionProviderAdapterBase,
  UNSUPPORTED_BY_OBSERVATION,
} from "@sidecar/session";
import { type RosterHolder, rosterHolder } from "./observation-pass.js";

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
