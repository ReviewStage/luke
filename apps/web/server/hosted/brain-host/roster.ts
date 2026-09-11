import {
  type BrainRoster,
  normalizeSession,
  type ObservedWorkspaceProject,
  PROVIDER_IDENTITY_BY_ID,
  type ProviderSessionObservation,
  type Session,
  type SessionIdentity,
  sessionContextText,
} from "../../core.js";
import type { ObservationStore } from "../observation-pass.js";
import { storedRoster } from "../observation-pass.js";
import type { ObservedRoster } from "../observed-roster.js";
import type { VaultKeyRow } from "../vault-route.js";

/**
 * The roster the hosted brain is shown: the account's stored snapshot, the
 * same one the observe route serves and an action is admitted against, read
 * into the sessions and projects the desktop's standing context is composed
 * from. It is read from the store and never from a provider — the brain's
 * turns observe nothing; the scheduled pass does — so every inference of a
 * turn reads the roster as the last pass left it.
 */
export interface HostedRoster {
  readonly sessions: readonly Session[];
  readonly projects: readonly ObservedWorkspaceProject[];
  readonly observations: ReadonlyMap<string, readonly ProviderSessionObservation[]>;
  readonly observedAt: number | undefined;
  /** The snapshot as the pass stored it, for the action execution that admits against one provider's slice of it. */
  readonly stored?: ObservedRoster;
}

export const EMPTY_HOSTED_ROSTER: HostedRoster = {
  sessions: [],
  projects: [],
  observations: new Map(),
  observedAt: undefined,
};

export function hostedRosterFrom(
  roster: ObservedRoster | undefined,
  observedAt: number | undefined,
): HostedRoster {
  if (!roster) return { ...EMPTY_HOSTED_ROSTER, observedAt };
  const sessions: Session[] = [];
  const projects: ObservedWorkspaceProject[] = [];
  const observations = new Map<string, readonly ProviderSessionObservation[]>();
  for (const provider of roster.providers) {
    const identity = PROVIDER_IDENTITY_BY_ID[provider.providerId];
    const sessionProvider = { id: identity.id, displayName: identity.displayName };
    observations.set(provider.providerId, provider.observations);
    for (const observation of provider.observations) {
      sessions.push(normalizeSession(sessionProvider, observation));
    }
    for (const project of provider.projects) {
      projects.push({
        ...project,
        providerId: provider.providerId,
        providerName: identity.displayName,
      });
    }
  }
  return { sessions, projects, observations, observedAt, stored: roster };
}

/** The stored snapshot as the brain reads it, only where it was observed under the keys standing now; nothing where no pass has written one. */
export async function readHostedRoster(
  store: ObservationStore,
  userId: string,
  rows: readonly VaultKeyRow[],
  secret: string,
): Promise<HostedRoster> {
  const stored = await storedRoster(store, userId, rows, secret);
  return hostedRosterFrom(stored?.roster, stored?.observedAt);
}

/** The roster as the brain's turns take it: rendered, with the identities every tool argument is validated against. */
export function brainRosterOf(roster: HostedRoster, now: number): BrainRoster {
  return {
    text: sessionContextText(roster.sessions, now),
    identities: roster.sessions.map(
      (session): SessionIdentity => ({
        providerId: session.providerId,
        providerSessionId: session.providerSessionId,
      }),
    ),
    sessions: roster.sessions,
  };
}

/** The observed session an identity names, as the snapshot holds it. */
export function observedSession(
  roster: HostedRoster,
  identity: SessionIdentity,
): Session | undefined {
  return roster.sessions.find(
    (session) =>
      session.providerId === identity.providerId &&
      session.providerSessionId === identity.providerSessionId,
  );
}
