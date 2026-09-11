import {
  type ProviderSessionObservation,
  SESSION_LOCATION,
  type SessionApplicationId,
  type SessionWorkspace,
} from "@sidecar/session";
import { text } from "@sidecar/wire";

/** One manager's annotation of one provider's already-observed sessions. */
type WorkspaceHostEnrichment = (
  providerId: string,
  observations: readonly ProviderSessionObservation[],
) => readonly ProviderSessionObservation[];

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

/** What one manager's own index decides about the rows it holds. */
export interface HostClaimsInput<Context> {
  /** The association whose presence on a row means it is already annotated. */
  readonly applicationId: SessionApplicationId;
  readonly contexts: WorkspaceHostContexts<Context>;
  /**
   * Whether a matched row should stand at all. Conductor drops a chat its
   * records say the user filed away; every other manager keeps every match.
   */
  retains?(context: Context): boolean;
  /** One matched row's annotation, everything a manager decorates for itself. */
  annotate(input: {
    readonly observation: ProviderSessionObservation;
    readonly context: Context;
    readonly hostSessions: ReadonlyMap<string, Context>;
  }): ProviderSessionObservation;
}

export interface HostClaims {
  has(providerId: string, providerSessionId: string): boolean;
  readonly enrich: WorkspaceHostEnrichment;
}

/**
 * One local workspace manager's observed index of the agent sessions it
 * holds, annotating already-observed rows without ever making a provider's
 * own observation disappear: an absent app or an unreadable index is an empty
 * claim, and an empty claim changes nothing. Only local observations can match
 * a local manager's index — a cloud row with a coincidentally equal provider
 * id is never annotated — and a sub-agent inherits its nearest indexed
 * ancestor's context: the child is the manager's work even though only the
 * parent reached the manager's records. A row already carrying this manager's
 * association is left exactly as it stands.
 */
export function hostClaims<Context>(input: HostClaimsInput<Context>): HostClaims {
  const retains = input.retains ?? (() => true);
  return {
    has(providerId, providerSessionId) {
      return input.contexts.get(providerId)?.has(providerSessionId) === true;
    },

    enrich(providerId, observations) {
      const hostSessions = input.contexts.get(providerId);
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
        if (context && !retains(context)) return [];
        if (
          !context ||
          observation.applications?.some((application) => application.id === input.applicationId)
        ) {
          return [observation];
        }
        return [input.annotate({ observation, context, hostSessions })];
      });
    },
  };
}
