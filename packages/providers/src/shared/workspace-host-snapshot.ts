import {
  type ProviderSessionObservation,
  SESSION_LOCATION,
  type SessionApplicationId,
  type SessionWorkspace,
} from "@sidecar/session";
import { text } from "@sidecar/wire";

/**
 * What one workspace manager's own records say about the sessions it holds,
 * keyed by the agent provider Luke already observes each session under and
 * then by the provider's own session id.
 */
export type WorkspaceHostContexts<Context> = ReadonlyMap<string, ReadonlyMap<string, Context>>;

/**
 * One chat is grouped by exactly one manager however many of them hold it, so
 * a claim lands only where no manager earlier in the enrichment order already
 * grouped the chat.
 */
export function unclaimedWorkspace(
  observation: ProviderSessionObservation,
  claim: SessionWorkspace,
): SessionWorkspace | undefined {
  return observation.workspace ? undefined : claim;
}

/**
 * One local workspace manager's observed index of the agent sessions it
 * holds, annotating already-observed rows without ever making a provider's
 * own observation disappear: an absent app or an unreadable index is an empty
 * snapshot, and an empty snapshot changes nothing. Only local observations
 * can match a local manager's index — a cloud row with a coincidentally equal
 * provider id is never annotated — and a sub-agent inherits its nearest
 * indexed ancestor's context: the child is the manager's work even though
 * only the parent reached the manager's records. A row already carrying this
 * manager's association is left exactly as it stands.
 */
export abstract class WorkspaceHostSnapshot<Context> {
  readonly #sessionsByProvider: WorkspaceHostContexts<Context>;

  constructor(sessionsByProvider: WorkspaceHostContexts<Context> = new Map()) {
    this.#sessionsByProvider = sessionsByProvider;
  }

  /** The association whose presence on a row means it is already annotated. */
  protected abstract readonly applicationId: SessionApplicationId;

  has(providerId: string, providerSessionId: string): boolean {
    return this.#sessionsByProvider.get(providerId)?.has(providerSessionId) === true;
  }

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

  enrich(
    providerId: string,
    observations: readonly ProviderSessionObservation[],
  ): readonly ProviderSessionObservation[] {
    const hostSessions = this.#sessionsByProvider.get(providerId);
    if (!hostSessions) return observations;

    const localObservationsById = new Map(
      observations
        .filter((observation) => observation.location !== SESSION_LOCATION.CLOUD)
        .map((observation) => [observation.providerSessionId, observation] as const),
    );

    const contextFor = (observation: ProviderSessionObservation): Context | undefined => {
      if (observation.location === SESSION_LOCATION.CLOUD) return undefined;
      let sessionId: string | undefined = observation.providerSessionId;
      const visited = new Set<string>();
      while (sessionId && !visited.has(sessionId)) {
        const context = hostSessions.get(sessionId);
        if (context) return context;
        visited.add(sessionId);
        sessionId = text(localObservationsById.get(sessionId)?.parentProviderSessionId);
      }
      return undefined;
    };

    return observations.flatMap((observation) => {
      const context = contextFor(observation);
      if (context && !this.retains(context)) return [];
      if (
        !context ||
        observation.applications?.some((application) => application.id === this.applicationId)
      ) {
        return [observation];
      }
      return [this.annotate(observation, context, hostSessions)];
    });
  }
}
