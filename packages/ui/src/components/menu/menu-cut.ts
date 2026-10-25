/**
 * menu-cut.ts -- where a menu too tall for its room cuts its rows, so the fade at the cut lies over words that go on below it.
 *
 * A menu's rows scroll inside its surface where the room Base UI found for
 * it cannot hold them all, and the cut edge fades (`Menu`'s `MenuRows`).
 * Cut wherever the room happens to end, the fade can lie over the gap and
 * rule before a footer, or a footer's top padding, so it fades nothing a
 * reader can see and says nothing of the lines hidden below. A phone's
 * taller rows happen to cut through one, which fades where it is cut, so a
 * reader sees the list go on. This brings every cut to that: where the room
 * ends over no line's words, the rows stand shorter, cut through the middle
 * of the last line that fits, as a list that scrolls is cut.
 */

/** One line of a menu, down its column of rows: where it starts and ends, and whether it holds words or is a rule. */
export interface MenuLine {
  readonly top: number;
  readonly bottom: number;
  readonly words: boolean;
}

/**
 * How tall the rows of a menu stand where `lines`, `height` tall in all, do
 * not fit `room`, so its fade, `fade` deep, lies over words that go on past
 * the cut: none where they fit, or where the room already ends at least half
 * the fade into a line of words; otherwise the middle of the last line of
 * words whose middle the room reaches, or none where no line is that.
 */
export function menuCut(
  lines: readonly MenuLine[],
  height: number,
  room: number,
  fade: number,
): number | undefined {
  if (height <= room) return undefined;
  const cut = lines.find((line) => line.top < room && line.bottom > room);
  if (cut?.words === true && room - cut.top >= fade / 2) return undefined;
  // Note that a line shorter than the fade is passed over, because cut through its middle the fade would reach the line above.
  const last = lines.findLast(
    (line) => line.words && line.bottom - line.top >= fade && (line.top + line.bottom) / 2 <= room,
  );
  return last === undefined ? undefined : Math.round((last.top + last.bottom) / 2);
}
