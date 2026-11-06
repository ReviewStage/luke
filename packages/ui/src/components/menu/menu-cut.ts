export const MENU_LINE = {
  ITEM: "item",
  NOTE: "note",
  RULE: "rule",
} as const;

type MenuLineKind = (typeof MENU_LINE)[keyof typeof MENU_LINE];

export interface MenuLine {
  readonly top: number;
  readonly bottom: number;
  readonly kind: MenuLineKind;
}

export function menuCut(
  lines: readonly MenuLine[],
  height: number,
  room: number,
  fade: number,
): number | undefined {
  if (height <= room) return undefined;
  if (!lines.some((line) => line.kind === MENU_LINE.ITEM && line.bottom > room)) return undefined;
  const words = (line: MenuLine) => line.kind !== MENU_LINE.RULE;
  const cut = lines.find((line) => line.top < room && line.bottom > room);
  if (cut !== undefined && words(cut) && room - cut.top >= fade / 2) return undefined;
  const last = lines.findLast(
    (line) => words(line) && line.bottom - line.top >= fade && (line.top + line.bottom) / 2 <= room,
  );
  return last === undefined ? undefined : Math.round((last.top + last.bottom) / 2);
}
