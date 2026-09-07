import { BRAIN_WAKE_KIND, type BrainWakeEvent } from "@sidecar/brain";
import type { ObservedSpoolEvent } from "@sidecar/providers";
import type { Session, SessionIdentity } from "@sidecar/session";

/**
 * How a hook's spool event becomes a wake. The decision is pure so it can be
 * tested without Electron; the wiring that watches the spools lives in
 * desktop-app.
 */

/**
 * Turns one provider's batch of spool events into wakes. Every hook event
 * wakes the brain — the brain decides what matters, so nothing is filtered
 * here — and each wake carries the session as the registry holds it at that
 * moment, when it holds it at all: a hook can land for a session the poll has
 * not yet seen, and the brain still hears that it moved.
 */
export function wakeEventsFromHooks(
  providerId: string,
  hookEvents: readonly ObservedSpoolEvent<string>[],
  registry: { get(identity: SessionIdentity): Session | undefined },
  now: number,
): readonly BrainWakeEvent[] {
  return hookEvents.map((hookEvent) => {
    const identity: SessionIdentity = {
      providerId,
      providerSessionId: hookEvent.providerSessionId,
    };
    const session = registry.get(identity);
    return {
      kind: BRAIN_WAKE_KIND.HOOK,
      identity,
      hookEvent: hookEvent.event,
      ...(session ? { session } : undefined),
      atMs: Number.isFinite(hookEvent.atMs) ? hookEvent.atMs : now,
    };
  });
}
