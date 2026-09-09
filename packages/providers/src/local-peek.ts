import { normalizeSession, type Session, type SessionProviderPlugin } from "@sidecar/session";
import { type LocalSessionAdapterHomes, localSessionAdapters } from "./local-adapters.js";

export type LocalPeekOptions = LocalSessionAdapterHomes;

type LocalPeekObserver = Pick<SessionProviderPlugin, "provider" | "observe">;

/**
 * The on-disk observers from the same table `providerRegistrations` builds
 * from, minus everything account-shaped: no hook spool to read or register,
 * no key, and no cloud half beside a local one.
 */
function localPeekObservers(options: LocalPeekOptions): readonly LocalPeekObserver[] {
  return Object.values(localSessionAdapters(options));
}

/**
 * A one-shot, credential-free read of this machine's local coding-agent
 * sessions, for an introduction that runs before any account exists. It is
 * read-only by construction: the observers are asked one question,
 * `observe()`, and discarded, so no hook is installed, no key is read,
 * nothing is written, and nothing here can reach a write path. Sessions come
 * back newest-first, uncapped; bounding what an introduction shows is the
 * caller's decision.
 */
export async function peekLocalSessions(
  options: LocalPeekOptions = {},
): Promise<readonly Session[]> {
  const observed = await Promise.all(
    localPeekObservers(options).map(async (observer) => {
      try {
        const observations = await observer.observe();
        return observations.map((observation) => normalizeSession(observer.provider, observation));
      } catch {
        // A provider whose read fails is observed as having nothing, the same
        // answer a machine without that provider gives, so one broken home
        // never sinks the rest of the peek.
        return [];
      }
    }),
  );
  return observed.flat().sort((left, right) => right.lastActivityAt - left.lastActivityAt);
}
