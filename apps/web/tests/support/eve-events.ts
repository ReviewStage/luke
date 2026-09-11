import type { MessageStreamEvent } from "eve/client";

let eventOrdinal = 0;

/** One eve event with the envelope eve stamps; every call mints a new event id, as a retry would. */
export function stampedEveEvent<Event extends Omit<MessageStreamEvent, "meta">>(
  event: Event,
  at: number,
): MessageStreamEvent {
  eventOrdinal += 1;
  // SAFETY: the envelope is the one eve stamps; the union member is the event handed in.
  return {
    ...event,
    meta: { id: `evt_${String(eventOrdinal).padStart(6, "0")}`, at: new Date(at).toISOString() },
  } as MessageStreamEvent;
}
