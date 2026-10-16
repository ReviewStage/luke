/**
 * pin-order.ts -- the order the sidebar's Pinned section stands in, which the developer sets by dragging a pin.
 *
 * Each pin may hold a position, a fractional index as rocicorp's
 * `fractional-indexing` mints one (the scheme Figma and Linear order their
 * lists by): a short string that sorts by plain code-unit comparison, so a pin
 * dropped between two others takes a key between theirs and no other pin is
 * written. A pin with no position, one pinned since the last drag or before
 * there were positions, stands by when it was pinned: before the first
 * positioned pin pinned earlier than it, so a new pin lands on top, as every
 * pin did when the order was the newest pinned first. The plans' and the
 * agents' pins keep their positions on the account (`plan_pin`, `agent_pin`),
 * and a tab pinned to the sidebar keeps its own on the Mac, all in the one
 * key space, so the three sort together.
 */

import { Schema as EffectSchema } from "effect";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

export const PIN_POSITION_BOUNDS = {
  /** The longest position kept. A key grows by about a character each time a pin is dropped into the same gap; past this the whole section is given fresh keys. */
  MAX_CHARS: 100,
} as const;

/** The base-62 digits a key is spelled in, the library's own. */
const KEY_DIGITS = /^[0-9A-Za-z]+$/;

/** Whether `key` is a position the order can mint a key beside: a well-formed fractional index within the bound. */
export function isPinPosition(key: string): boolean {
  if (key.length > PIN_POSITION_BOUNDS.MAX_CHARS || !KEY_DIGITS.test(key)) return false;
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

/** A pin's position as a request names it: well-formed and within the bound. */
export const pinPositionSchema = EffectSchema.String.check(EffectSchema.makeFilter(isPinPosition));

/** Where a pin stands: its position where it holds one, and when it was pinned, which places one that holds none. */
export interface PinPlace {
  readonly position?: string | undefined;
  readonly at: number;
}

/** The position a pin is placed by, or none where it holds no well-formed one. */
function positionOf(place: PinPlace): string | undefined {
  const { position } = place;
  return position !== undefined && isPinPosition(position) ? position : undefined;
}

/** Plain code-unit order, which fractional indexing keys sort by; never `localeCompare`, which folds case. */
function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * The pins in the order the section draws them: the positioned ones by
 * position, a tie by the newer pinned first, and each with no position
 * merged in before the first positioned pin pinned earlier than it, the
 * newer pinned first among themselves.
 */
export function inPinOrder<Row>(rows: readonly Row[], placeOf: (row: Row) => PinPlace): Row[] {
  const placed = rows.map((row) => ({
    row,
    at: placeOf(row).at,
    position: positionOf(placeOf(row)),
  }));
  const positioned = placed
    .filter((each) => each.position !== undefined)
    .sort((a, b) => compareKeys(a.position ?? "", b.position ?? "") || b.at - a.at);
  const loose = placed.filter((each) => each.position === undefined).sort((a, b) => b.at - a.at);
  const order: Row[] = [];
  let p = 0;
  let l = 0;
  while (p < positioned.length || l < loose.length) {
    const next = positioned[p];
    const free = loose[l];
    if (free !== undefined && (next === undefined || free.at > next.at)) {
      order.push(free.row);
      l += 1;
    } else if (next !== undefined) {
      order.push(next.row);
      p += 1;
    }
  }
  return order;
}

/**
 * The positions to write once the pin at `from` in `order`, as `inPinOrder`
 * drew it, is dropped at `to`: the dropped pin's, between its new
 * neighbours', and any other pin's that holds none or no longer sorts after
 * the one before it, so afterwards every pin holds a position and the
 * positions run in the order drawn. A pin whose position stands is not in
 * the answer, so a drop between two positioned pins writes one. Where a key
 * would grow past the bound, every pin is given a fresh one instead.
 */
export function pinPositionsForMove<Row>(
  order: readonly Row[],
  from: number,
  to: number,
  placeOf: (row: Row) => PinPlace,
): ReadonlyMap<Row, string> {
  const moved = order[from];
  if (moved === undefined || from === to || to < 0 || to >= order.length) return new Map();
  const after = order.filter((_, index) => index !== from);
  after.splice(to, 0, moved);
  // The position a pin of the new order keeps unless it must move: none for the dropped pin, or past the end.
  const standing = (at: number) => {
    const row = after[at];
    return row === undefined || row === moved ? undefined : positionOf(placeOf(row));
  };
  const positions = new Map<Row, string>();
  let previous: string | null = null;
  let index = 0;
  while (index < after.length) {
    const own = standing(index);
    if (own !== undefined && (previous === null || own > previous)) {
      previous = own;
      index += 1;
      continue;
    }
    // The run of pins from here up to the next that already sorts after the one before them takes keys between.
    let end = index + 1;
    while (end < after.length) {
      const next = standing(end);
      if (next !== undefined && (previous === null || next > previous)) break;
      end += 1;
    }
    const keys = generateNKeysBetween(previous, standing(end) ?? null, end - index);
    keys.forEach((key, at) => {
      const row = after[index + at];
      if (row !== undefined) positions.set(row, key);
    });
    previous = keys.at(-1) ?? previous;
    index = end;
  }
  if ([...positions.values()].every((key) => key.length <= PIN_POSITION_BOUNDS.MAX_CHARS)) {
    return positions;
  }
  const fresh = generateNKeysBetween(null, null, after.length);
  return new Map(
    after.flatMap((row, at) => {
      const key = fresh[at];
      return key === undefined || key === positionOf(placeOf(row)) ? [] : [[row, key] as const];
    }),
  );
}
