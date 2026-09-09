import type { ProviderSessionObservation, SessionApplicationId } from "@sidecar/session";
import { type HostClaims, hostClaims, type WorkspaceHostContexts } from "./host-claims.js";

/**
 * The class-shaped reading of {@link hostClaims}, for the managers whose
 * readers are still classes. Everything a claim decides lives in that
 * function; what a subclass supplies is the association, whether a matched
 * row stands, and the annotation itself.
 */
export abstract class WorkspaceHostSnapshot<Context> {
  readonly #contexts: WorkspaceHostContexts<Context>;
  #claims: HostClaims | undefined;

  constructor(sessionsByProvider: WorkspaceHostContexts<Context> = new Map()) {
    this.#contexts = sessionsByProvider;
  }

  /** The association whose presence on a row means it is already annotated. */
  protected abstract readonly applicationId: SessionApplicationId;

  /**
   * Whether a matched row should stand at all. Conductor drops a chat its
   * records say the user filed away; every other manager keeps every match.
   */
  protected retains(_context: Context): boolean {
    return true;
  }

  /** One matched row's annotation, everything a manager decorates for itself. */
  protected abstract annotate(
    observation: ProviderSessionObservation,
    context: Context,
    hostSessions: ReadonlyMap<string, Context>,
  ): ProviderSessionObservation;

  /**
   * A subclass's own fields are not assigned while the base constructor runs
   * and `applicationId` is one of them, so the claims are built on first use.
   */
  #resolved(): HostClaims {
    this.#claims ??= hostClaims<Context>({
      applicationId: this.applicationId,
      contexts: this.#contexts,
      retains: (context) => this.retains(context),
      annotate: ({ observation, context, hostSessions }) =>
        this.annotate(observation, context, hostSessions),
    });
    return this.#claims;
  }

  has(providerId: string, providerSessionId: string): boolean {
    return this.#resolved().has(providerId, providerSessionId);
  }

  enrich(
    providerId: string,
    observations: readonly ProviderSessionObservation[],
  ): readonly ProviderSessionObservation[] {
    return this.#resolved().enrich(providerId, observations);
  }
}
