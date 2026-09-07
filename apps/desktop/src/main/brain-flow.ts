import { BRAIN_WAKE_KIND, type BrainWakeEvent } from "@sidecar/brain";
import type { ObservedSpoolEvent } from "@sidecar/providers";
import type { Session, SessionIdentity } from "@sidecar/session";

/**
 * What the brain keeps across launches, and how a hook's spool event becomes
 * a wake. The decisions are pure so they can be tested without Electron, on
 * the memory flow's own pattern; the wiring that reads and writes the file and
 * watches the spools lives in desktop-app.
 *
 * The state file is the brain's one envelope — its Responses memory, cursors,
 * request records, and action journal — written only through the store the
 * main process owns. It lives in Luke's own application data beside the
 * conversation, never in a provider's file.
 */

export const BRAIN_STATE_FILE = "brain-state.json";

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
