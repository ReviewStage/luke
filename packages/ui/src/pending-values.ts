import { Duration } from "effect";

/**
 * pending-values.ts -- a value given here that the service has yet to carry, drawn over the view until the view answers it.
 *
 * A press draws its value at once and sends it, and the value stands over
 * what the view carries until one of these lets it go: the view carries it,
 * so the press landed; the view carries a third value, neither this one nor
 * one it replaced, so the service or a teammate answered otherwise and the
 * view wins; the view no longer holds what it names; or its time runs out,
 * so a write whose answer never reaches the view is not drawn forever. A
 * refusal lets go of it at once (`pendingWithout`), and a sign-out of every
 * one, which the caller does by dropping the map, since what a pending value
 * names is the account's it was given under.
 *
 * Time is the runtime clock's, read by the caller and handed in, so a test
 * moves it on a `TestClock`; a value counts its time from the first reading
 * after it was asked.
 */

/** How long a value given here may stand over a view that has not carried it. */
export const PENDING_LIMIT = Duration.seconds(30);

/** A value a press gave something, until the view answers it. */
export interface PendingValue<V> {
  /** What the press asked for, drawn over the view. */
  readonly value: V;
  /**
   * What the view may still carry while the press is in flight: what it
   * carried when asked, and every value an earlier press here asked that this
   * one replaced, since the view may pass through those on its way.
   */
  readonly replaced: readonly V[];
  /** The runtime clock's first reading since the press, from which its time counts; none until the clock reads. */
  readonly since?: number;
}

/** The values given here that the view has yet to carry, by what each names. */
export type PendingValues<K, V> = ReadonlyMap<K, PendingValue<V>>;

/** Whether two values are one as the view draws them. */
export type SameValue<V> = (a: V, b: V) => boolean;

/**
 * The pending value a press asks for, over what the view carries now and
 * whatever pending value of the same thing it replaces. Its time starts anew,
 * because its own write has only just been sent.
 */
export function pendingValue<V>(
  standing: PendingValue<V> | undefined,
  value: V,
  viewed: V | undefined,
  same: SameValue<V>,
): PendingValue<V> {
  const earlier = standing === undefined ? [] : [...standing.replaced, standing.value];
  const replaced: V[] = [];
  for (const each of viewed === undefined ? earlier : [viewed, ...earlier]) {
    if (!same(each, value) && !replaced.some((kept) => same(kept, each))) replaced.push(each);
  }
  return { value, replaced };
}

/** The pending values with the one given let go, only while it is still the one standing, so a later press's stays. */
export function pendingWithout<K, V>(
  held: PendingValues<K, V>,
  key: K,
  pending: PendingValue<V>,
): PendingValues<K, V> {
  if (held.get(key) !== pending) return held;
  const next = new Map(held);
  next.delete(key);
  return next;
}

/** Whether a pending value still stands over what the view carries for it, at `now` on the runtime clock. */
function stillPending<V>(
  pending: PendingValue<V>,
  viewed: V | undefined,
  same: SameValue<V>,
  now: number | undefined,
): boolean {
  if (viewed === undefined || same(viewed, pending.value)) return false;
  if (!pending.replaced.some((each) => same(each, viewed))) return false;
  const since = pending.since ?? now;
  return now === undefined || since === undefined || now - since < Duration.toMillis(PENDING_LIMIT);
}

/**
 * The pending values the view still leaves standing at `now`, each stamped
 * with the clock's first reading since it was asked. The same map comes back
 * when nothing changed, so a caller holding it in state draws nothing anew.
 */
export function pendingSettled<K, V>(
  held: PendingValues<K, V>,
  viewedOf: (key: K) => V | undefined,
  same: SameValue<V>,
  now: number | undefined,
): PendingValues<K, V> {
  let changed = false;
  const next = new Map<K, PendingValue<V>>();
  for (const [key, pending] of held) {
    if (!stillPending(pending, viewedOf(key), same, now)) {
      changed = true;
      continue;
    }
    const stamped = pending.since === undefined && now !== undefined;
    next.set(key, stamped ? { ...pending, since: now } : pending);
    changed ||= stamped;
  }
  return changed ? next : held;
}

/** What each pending value draws, by what it names. */
export function pendingShown<K, V>(held: PendingValues<K, V>): ReadonlyMap<K, V> {
  return new Map([...held].map(([key, pending]) => [key, pending.value] as const));
}
