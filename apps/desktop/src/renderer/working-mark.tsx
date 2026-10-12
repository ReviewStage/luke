/**
 * working-mark.tsx -- the one mark an agent at work wears: two pixels chasing each other round the edge of a small grid, in the gray ink around it.
 *
 * Every place that says an agent is working draws this mark: an agent's or
 * a subagent's glyph (`state-glyph.tsx`), a sidebar plan's row, a call's
 * row in a transcript, and the summary rail's badge. Its cells and the gap
 * between them are whole pixels and the same at every size, so the badge is
 * the glyph's grid with fewer cells rather than the glyph shrunk: the glyph
 * laps eight cells round a 3×3 grid, the badge four round a 2×2. Each cell
 * steps to the next on one beat, so the motion is stepped frames of
 * `transform` alone and never lays anything out. Reduced motion and a
 * capture run hold it on `--loop-motion`, on a frame chosen to show the
 * chase mid-lap rather than its first, so a still mark still reads as
 * working. The mark is decorative unless given a label, which is said in a
 * fixed word, so nothing of the work rides the attribute the screen
 * recording keeps.
 */

/** How large the mark is drawn: a glyph beside words, or a badge on an icon. */
export const WORKING_MARK_SIZE = {
  GLYPH: "glyph",
  BADGE: "badge",
} as const;

export type WorkingMarkSize = (typeof WORKING_MARK_SIZE)[keyof typeof WORKING_MARK_SIZE];

/** The pixels that move: each chaser and the fainter tail one cell behind it. */
const WORKING_DOT = {
  LEAD: "lead",
  LEAD_TAIL: "lead-tail",
  TRAIL: "trail",
  TRAIL_TAIL: "trail-tail",
} as const;

type WorkingDot = (typeof WORKING_DOT)[keyof typeof WORKING_DOT];

/** One cell's side, in CSS pixels, at every size. */
const CELL = 2;

/** One step from a cell to the next, cell and gap, in CSS pixels, at every size; the keyframes in `base.css` step by it. */
const PITCH = 4;

/** Where the first cell starts, from the mark's corner, at every size. */
const INSET = 1;

/**
 * Each size's grid: its side, the cells of its track in the order the
 * chasers lap them, and which pixels chase. Note that the badge has room
 * for one chaser alone, because its two diagonals would otherwise trade
 * places on every beat and read as a blink rather than a lap.
 */
const WORKING_GRID = {
  [WORKING_MARK_SIZE.GLYPH]: {
    side: 12,
    track: [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
      [2, 2],
      [1, 2],
      [0, 2],
      [0, 1],
    ],
    dots: [WORKING_DOT.LEAD, WORKING_DOT.LEAD_TAIL, WORKING_DOT.TRAIL, WORKING_DOT.TRAIL_TAIL],
  },
  [WORKING_MARK_SIZE.BADGE]: {
    side: 8,
    track: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    dots: [WORKING_DOT.LEAD, WORKING_DOT.LEAD_TAIL],
  },
} as const satisfies Record<
  WorkingMarkSize,
  { side: number; track: readonly (readonly [number, number])[]; dots: readonly WorkingDot[] }
>;

/** Where a cell's top-left corner stands in the mark, in CSS pixels. */
interface CellCorner {
  readonly x: number;
  readonly y: number;
}

/** The corner of the grid's cell at column `column` and row `row`. */
function cellAt(column: number, row: number): CellCorner {
  return { x: INSET + column * PITCH, y: INSET + row * PITCH };
}

/**
 * The mark at `size`, said to a reader as `label` where it stands alone, or
 * hidden from one where the control around it already says it.
 */
export function WorkingMark({
  size = WORKING_MARK_SIZE.GLYPH,
  label,
}: {
  size?: WorkingMarkSize;
  label?: string;
}): React.JSX.Element {
  const { side, track, dots } = WORKING_GRID[size];
  const start = cellAt(0, 0);
  const mark = (
    <svg
      className="working-mark"
      data-size={size}
      width={side}
      height={side}
      viewBox={`0 0 ${side} ${side}`}
      aria-hidden="true"
    >
      {track.map(([column, row], index) => (
        <rect
          key={index}
          className="working-mark-track"
          {...cellAt(column, row)}
          width={CELL}
          height={CELL}
          rx={CELL / 4}
        />
      ))}
      {dots.map((dot) => (
        <rect
          key={dot}
          className="working-mark-dot"
          data-dot={dot}
          {...start}
          width={CELL}
          height={CELL}
          rx={CELL / 4}
        />
      ))}
    </svg>
  );
  if (label === undefined) return mark;
  return (
    <span className="working-mark-said" role="img" aria-label={label}>
      {mark}
    </span>
  );
}
