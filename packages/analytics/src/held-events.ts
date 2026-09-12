import { type Effect, Schema } from "effect";
import {
  PRODUCT_EVENT_MAXIMUM_AGE_MS,
  type ProductEvent,
  productEventFromWire,
} from "./product-events.js";

/**
 * The shape of a hold on disk. Bumped when the record's own shape changes; a
 * hold of another version reads as nothing, which is the safe direction for a
 * count — a launch lost is a launch lost, never a batch posted twice.
 */
export const HELD_PRODUCT_EVENTS_VERSION = 1;

/**
 * A hold as it persists: the file's shape is decoded here, and each event in
 * it is read again by the allowlist reader when a run adopts it, so a build
 * that narrowed the vocabulary drops the event rather than posting a name it
 * no longer has. The per-event schema is deliberately loose for that reason:
 * the allowlist is `productEventFromWire`'s to decide, once, for the wire and
 * the disk alike.
 */
export const HeldProductEventsRecordSchema = Schema.Struct({
  version: Schema.Literal(HELD_PRODUCT_EVENTS_VERSION),
  events: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      at: Schema.Number,
      properties: Schema.Record({
        key: Schema.String,
        value: Schema.Union(Schema.String, Schema.Number),
      }),
    }),
  ),
});

export type HeldProductEventsRecord = typeof HeldProductEventsRecordSchema.Type;

/**
 * Where a batch no credential could carry waits between runs. The sender
 * reads it once, ahead of its first flush, and writes it whenever a flush
 * leaves events standing or clears a hold that stood; it never writes before
 * it has read, so a quit that comes first leaves the earlier hold whole. Both
 * effects are handed in already provided — the host reads and writes the file
 * under its own state root — and neither fails: an unreadable hold is no hold,
 * and a write that could not land is reported where the host reports.
 */
export interface HeldProductEvents {
  readonly read: Effect.Effect<HeldProductEventsRecord | undefined>;
  readonly write: (record: HeldProductEventsRecord) => Effect.Effect<void>;
}

/**
 * What a run adopts out of a hold, bounded on both sides: an event the
 * allowlist no longer reads goes, an event older than the service's own age
 * window goes (it would only be posted to be re-dated), and past `limit` the
 * oldest go, the same rule the live queue keeps. What survives is in the order
 * it was held, oldest first, so it lands ahead of the run's own events.
 */
export function adoptableHeldProductEvents(
  record: HeldProductEventsRecord,
  now: number,
  limit: number,
): ProductEvent[] {
  const oldestAdmitted = now - PRODUCT_EVENT_MAXIMUM_AGE_MS;
  const adopted: ProductEvent[] = [];
  for (const held of record.events) {
    const event = productEventFromWire(held);
    if (!event || event.at < oldestAdmitted) continue;
    adopted.push(event);
  }
  return adopted.length > limit ? adopted.slice(adopted.length - limit) : adopted;
}
