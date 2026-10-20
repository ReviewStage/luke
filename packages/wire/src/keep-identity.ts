/**
 * keep-identity.ts -- a value delivered again, rebuilt over the one held before it, so that every part of it that did not change is the held part itself.
 *
 * A client is handed its state whole and new on every delivery: parsed from
 * the text it crossed a process in, or decoded into a fresh tree, so nothing
 * in it is the object a reader held a moment ago, and every `===`, memo, or
 * `Equal.equals` keyed on a part of it misses, or walks it whole, even where
 * that part says exactly what it said before. {@link keepIdentity} walks the
 * delivery once against what is held and answers it with each part equal to
 * the held one replaced by the held one, so a reader of an unchanged part
 * holds the same object and the comparisons after it stop at the first `===`.
 * One walk of the data is the cost, where a miss costs a render of everything
 * drawn from it.
 *
 * It is bounded to the data a delivery is: plain records and arrays are
 * opened, and any other value is a leaf, kept where `Equal.equals` finds it
 * equal. Neither value is ever written to, and both are taken as immutable,
 * as Effect's own `Hash` and `Equal` caches already take them; a value with
 * a cycle in it is not data and is not walked.
 */
import { Equal } from "effect";
import { isPlainRecord, type WireBoundaryInput } from "./json.js";

/** What the walk reads: JSON data as this build holds it, a field standing undefined included. */
type Held = WireBoundaryInput;

/** A record of held data, as the walk opens one. */
type HeldRecord = { readonly [key: string]: Held };

/**
 * A record kept: the held one where it has the same keys and each value is
 * the held value, `next` itself where nothing of the held one was reused, and
 * a new record of `next`'s keys over the kept values otherwise.
 */
function keptRecord(held: HeldRecord, next: HeldRecord): HeldRecord {
  const keys = Object.keys(next);
  const values: Held[] = [];
  let unchanged = keys.length === Object.keys(held).length;
  let reused = false;
  for (const key of keys) {
    const stood = Object.hasOwn(held, key);
    const value = stood ? kept(held[key], next[key]) : next[key];
    unchanged &&= stood && value === held[key];
    reused ||= value !== next[key];
    values.push(value);
  }
  if (unchanged) return held;
  if (!reused) return next;
  return Object.fromEntries(keys.map((key, at) => [key, values[at]]));
}

/**
 * A list kept: matched from its front while each item is the held one, then
 * from its back short of the front, and position by position in between.
 * That covers what a list here does between two deliveries (an item
 * appended, one prepended, one changed in place), each in one pass. Note
 * that an item that moved past others keeps the parts it shares with the
 * item now at its old place, not its own identity: a list that reorders
 * often is drawn again where it moved, which costs less than matching every
 * item against every other on every delivery.
 *
 * The pair the front stopped at is not compared again from the back: had it
 * matched, the front would not have stopped there.
 */
function keptList(held: readonly Held[], next: readonly Held[]): readonly Held[] {
  const values = [...next];
  const shortest = Math.min(held.length, next.length);
  let front = 0;
  while (front < shortest) {
    values[front] = kept(held[front], next[front]);
    if (values[front] !== held[front]) break;
    front += 1;
  }
  const reach = shortest - front - (held.length === next.length ? 1 : 0);
  let back = 0;
  while (back < reach) {
    const value = kept(held[held.length - 1 - back], next[next.length - 1 - back]);
    if (value !== held[held.length - 1 - back]) break;
    values[next.length - 1 - back] = value;
    back += 1;
  }
  for (let at = front + 1; at < next.length - back; at += 1) {
    values[at] = at < held.length - back ? kept(held[at], next[at]) : next[at];
  }
  const unchanged =
    values.length === held.length && values.every((value, at) => value === held[at]);
  if (unchanged) return held;
  return values.every((value, at) => value === next[at]) ? next : values;
}

/** One value kept against the one held where it stood. */
function kept(held: Held, next: Held): Held {
  if (held === next) return held;
  if (Array.isArray(next)) return Array.isArray(held) ? keptList(held, next) : next;
  if (isPlainRecord(next)) return isPlainRecord(held) ? keptRecord(held, next) : next;
  return Equal.equals(held, next) ? held : next;
}

/**
 * `next` with every part of it structurally equal to the part of `held` that
 * stood in its place replaced by that part: `held` itself where the two are
 * equal, `next` itself where nothing of `held` could be reused, and otherwise
 * a new value sharing what it can. What it answers is always equal to `next`.
 */
export function keepIdentity<Value>(held: Value, next: Value): Value {
  // SAFETY: both are one shape of the data this module is bounded to, which the walk reads as the JSON it is.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The walk reads JSON data; the caller's type is set aside at this one door.
  const answer = kept(held as unknown as Held, next as unknown as Held);
  // SAFETY: what the walk answers is `held`, `next`, or a value equal to `next` built of their parts, so it is the caller's shape again.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The caller's type is restored at the same door it was set aside at.
  return answer as unknown as Value;
}
