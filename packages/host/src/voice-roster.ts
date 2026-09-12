import type { RosterSeedSession } from "@sidecar/live";
import type { Session } from "@sidecar/session";

/**
 * The desk as the voice may be told it. A session carries far more than this —
 * an error line, a branch, a repository, a model, an address, a workspace, a
 * diff — and the voice is handed none of it: what it holds is a summary it
 * can answer "is anything waiting on me?" from, and every act still resolves
 * in the brain, which reads the whole roster. The mapping is where that stops,
 * which is why it stands alone with a test over its own field set rather than
 * inside the composer.
 *
 * The identity travels for the refresh's diff and nothing else: it tells one
 * row from another between passes and never enters a rendered line.
 */
export function voiceRoster(sessions: readonly Session[]): readonly RosterSeedSession[] {
  return sessions.map((session) => ({
    identity: {
      providerId: session.providerId,
      providerSessionId: session.providerSessionId,
    },
    title: session.title,
    provider: { displayName: session.provider.displayName },
    status: session.status,
    ...(session.holdingForDeveloper === true ? { holdingForDeveloper: true } : undefined),
    ...(session.detail.activity === undefined ? undefined : { activity: session.detail.activity }),
    lastActivityAt: session.lastActivityAt,
  }));
}
