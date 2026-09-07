import { BRAIN_WAKE_KIND, type BrainWakeEvent } from "@sidecar/brain";
import type { ObservedSpoolEvent } from "@sidecar/providers";
import type { Session, SessionIdentity } from "@sidecar/session";

/**
 * How a hook's spool event becomes a wake, and the names of the files an
 * earlier build kept. The decisions are pure so they can be tested without
 * Electron; the wiring that watches the spools lives in desktop-app.
 *
 * The brain's envelope, the conversation, and the remembered facts live in
 * the runtime store's database under Luke's own application data — never in a
 * provider's file. The three names below are what earlier builds wrote them
 * to, beside `settings.json`; a launch imports them once into the database
 * and moves them into the store's recovery directory, so nothing writes to
 * these paths again.
 */

export const LEGACY_STATE_FILES = {
  BRAIN_STATE: "brain-state.json",
  CONVERSATION: "conversation.json",
  REMEMBERED_FACTS: "memory.json",
} as const;

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
