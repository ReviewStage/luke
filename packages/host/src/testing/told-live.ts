import type { LiveRead } from "@repo/features/live-wire";
import { GATEWAY_EVENT } from "@repo/gateway";
import { isRecord, type WireValue } from "@repo/wire";

/**
 * told-live.ts -- what a composer told of one live follow's slice, read off the events it emitted.
 *
 * A live follow's slice is told on the one event every follow shares
 * (`LIVE_READ_CHANGED`), named by its slice (`liveTold`), so a test that
 * keeps a composer's events reads one slice's tellings here.
 */

/** Every telling of the slice `read` among `events`, whole, in order. */
export function toldLive(
  events: readonly { readonly kind: string; readonly payload: WireValue }[],
  read: LiveRead,
): WireValue[] {
  return events.flatMap(({ kind, payload }) =>
    kind === GATEWAY_EVENT.LIVE_READ_CHANGED &&
    isRecord(payload) &&
    payload.read === read &&
    payload.held !== undefined
      ? [payload.held]
      : [],
  );
}
