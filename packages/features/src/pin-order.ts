import { Schema as EffectSchema } from "effect";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

export const PIN_POSITION_BOUNDS = {
  MAX_CHARS: 100,
} as const;

const KEY_DIGITS = /^[0-9A-Za-z]+$/;

export function isPinPosition(key: string): boolean {
  if (key.length > PIN_POSITION_BOUNDS.MAX_CHARS || !KEY_DIGITS.test(key)) return false;
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

export const pinPositionSchema = EffectSchema.String.check(EffectSchema.makeFilter(isPinPosition));

export interface PinPlace {
  readonly position?: string | undefined;
  readonly at: number;
}

function positionOf(place: PinPlace): string | undefined {
  const { position } = place;
  return position !== undefined && isPinPosition(position) ? position : undefined;
}

function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

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

function positionsAfterDrop<Row>(
  after: readonly Row[],
  moved: Row,
  placeOf: (row: Row) => PinPlace,
): ReadonlyMap<Row, string> {
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
  return positionsAfterDrop(after, moved, placeOf);
}

export function pinPositionsForInsert<Row>(
  order: readonly Row[],
  row: Row,
  to: number,
  placeOf: (row: Row) => PinPlace,
): ReadonlyMap<Row, string> {
  const after = [...order];
  after.splice(Math.max(0, Math.min(to, order.length)), 0, row);
  return positionsAfterDrop(after, row, placeOf);
}
