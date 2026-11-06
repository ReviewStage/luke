import { Duration } from "effect";

export const PENDING_LIMIT = Duration.seconds(30);

export interface PendingValue<V> {
  readonly value: V;
  readonly replaced: readonly V[];
  readonly since?: number;
  readonly press: symbol;
}

export type PendingValues<K, V> = ReadonlyMap<K, PendingValue<V>>;

export type SameValue<V> = (a: V, b: V) => boolean;

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
  return { value, replaced, press: Symbol("press") };
}

export function pendingWithout<K, V>(
  held: PendingValues<K, V>,
  key: K,
  pending: PendingValue<V>,
): PendingValues<K, V> {
  if (held.get(key)?.press !== pending.press) return held;
  const next = new Map(held);
  next.delete(key);
  return next;
}

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

export function pendingShown<K, V>(held: PendingValues<K, V>): ReadonlyMap<K, V> {
  return new Map([...held].map(([key, pending]) => [key, pending.value] as const));
}
