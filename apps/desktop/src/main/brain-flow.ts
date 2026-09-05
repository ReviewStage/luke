import {
  BRAIN_WAKE_KIND,
  type BrainPersistedState,
  type BrainWakeEvent,
  brainPersistedStateFromWire,
} from "@sidecar/brain";
import type { ObservedSpoolEvent } from "@sidecar/providers";
import type { HookEvent, Session, SessionIdentity } from "@sidecar/session";
import type { UnparsedWireValue } from "@sidecar/wire";

/**
 * What the brain keeps across launches, and how a hook's spool event becomes
 * a wake. The decisions are pure so they can be tested without Electron, on
 * the memory flow's own pattern; the wiring that reads and writes the file and
 * watches the spools lives in desktop-app.
 *
 * The state file is the brain's memory: the Responses input array from the
 * latest compaction item onward, and the transcript cursor each session was
 * last read to. It lives in Luke's own application data beside the
 * conversation, never in a provider's file, and the History tab's Clear
 * deletes it along with the thread.
 */

export const BRAIN_STATE_FILE = "brain-state.json";

/**
 * Reads a stored brain state, or nothing when the file is missing, from
 * another build, or malformed. The memory is not load-bearing: a launch that
 * cannot read it begins with an empty one, which is what every launch did
 * before the file existed, and the compaction the model produces rebuilds the
 * summary from what it sees next.
 */
export function brainStateFromStored(stored: string | undefined): BrainPersistedState | undefined {
  if (stored === undefined) return undefined;
  try {
    // SAFETY: JSON.parse returns a wire value; the reader below is the validation.
    const parsed = JSON.parse(stored) as UnparsedWireValue;
    return brainPersistedStateFromWire(parsed);
  } catch {
    return undefined;
  }
}

/** The record the brain's state persists as. */
export function brainStateRecord(state: BrainPersistedState): string {
  return `${JSON.stringify(state)}\n`;
}

/**
 * Turns one provider's batch of spool events into wakes. Every hook event
 * wakes the brain — the brain decides what matters, so nothing is filtered
 * here — and each wake carries the session as the registry holds it at that
 * moment, when it holds it at all: a hook can land for a session the poll has
 * not yet seen, and the brain still hears that it moved.
 */
export function wakeEventsFromHooks(
  providerId: string,
  hookEvents: readonly ObservedSpoolEvent<HookEvent>[],
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
