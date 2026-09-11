import type { MessageStreamEvent } from "eve/client";

let eventOrdinal = 0;

/** One eve event with the envelope eve stamps; every call mints a new event id, as a retry would. */
export function stampedEveEvent<Event extends Omit<MessageStreamEvent, "meta">>(
  event: Event,
  at: number,
  deliveryIds?: readonly string[],
): MessageStreamEvent {
  eventOrdinal += 1;
  const id = `evt_${String(eventOrdinal).padStart(6, "0")}`;
  const stampedAt = new Date(at).toISOString();
  // A turn's start names the deliveries it folded, which is where each ask learns its turn.
  const meta: MessageStreamEvent["meta"] =
    deliveryIds === undefined
      ? { id, at: stampedAt }
      : { id, at: stampedAt, deliveryIds: [...deliveryIds] };
  // SAFETY: the envelope is the one eve stamps; the union member is the event handed in.
  return { ...event, meta } as MessageStreamEvent;
}
