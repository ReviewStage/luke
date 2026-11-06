import { Equal } from "effect";
import { isPlainRecord, type WireBoundaryInput } from "./json.js";

type Held = WireBoundaryInput;

type HeldRecord = { readonly [key: string]: Held };

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

function kept(held: Held, next: Held): Held {
  if (held === next) return held;
  if (Array.isArray(next)) return Array.isArray(held) ? keptList(held, next) : next;
  if (isPlainRecord(next)) return isPlainRecord(held) ? keptRecord(held, next) : next;
  return Equal.equals(held, next) ? held : next;
}

export function keepIdentity<Value>(held: Value, next: Value): Value {
  const answer = kept(held as unknown as Held, next as unknown as Held);
  return answer as unknown as Value;
}
