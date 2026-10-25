/**
 * menu-cut.ts -- where a menu too tall for its room cuts its rows, so the fade at the cut lies over words that go on below it.
 *
 * A menu's rows scroll inside its surface where the room Base UI found for
 * it cannot hold them all, and the cut edge fades (`Menu`'s `MenuRows`).
 * Cut wherever the room happens to end, the fade can lie over the gap and
 * rule between groups, so it fades nothing a reader can see and says
 * nothing of the items hidden below. A phone's taller rows happen to cut
 * through one, which fades where it is cut, so a reader sees the list go
 * on. This brings such a cut to that: where the room ends over no line's
 * words while items go on past it, the rows stand shorter, cut through the
 * middle of the last line that fits, as a list that scrolls is cut. Where
 * every item already shows whole, and only a note (a heading's or a
 * footer's) runs on past the room, the rows keep the whole room, so no item
 * is faded for the sake of a note.
 */

/** What a line of a menu's column is: an item a press chooses, a note of words that chooses nothing (its heading or footer), or a rule between groups. */
export const MENU_LINE = {
  ITEM: "item",
  NOTE: "note",
  RULE: "rule",
} as const;

type MenuLineKind = (typeof MENU_LINE)[keyof typeof MENU_LINE];

/** One line of a menu, down its column of rows: where it starts and ends, and what it is. */
export interface MenuLine {
  readonly top: number;
  readonly bottom: number;
  readonly kind: MenuLineKind;
}

/**
 * How tall the rows of a menu stand where `lines`, `height` tall in all, do
 * not fit `room`, so its fade, `fade` deep, lies over words that go on past
 * the cut: none where they fit, where every item ends within the room, or
 * where the room already ends at least half the fade into a line of words;
 * otherwise the middle of the last line of words whose middle the room
 * reaches, or none where no line is that.
 */
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
  // Note that a line shorter than the fade is passed over, because cut through its middle the fade would reach the line above.
  const last = lines.findLast(
    (line) => words(line) && line.bottom - line.top >= fade && (line.top + line.bottom) / 2 <= room,
  );
  return last === undefined ? undefined : Math.round((last.top + last.bottom) / 2);
}
