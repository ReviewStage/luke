/**
 * working-mark.tsx -- the one mark an agent at work wears: two pixels chasing each other round the edge of a small grid, in the gray ink around it.
 *
 * Every place that says an agent is working draws this mark through the one
 * seat that says so (`state-glyph.tsx`'s `StateGlyph`): an agent's or a
 * subagent's glyph, a sidebar task's row, and a call's row in a transcript. Its cells and the gap between them are whole
 * pixels, eight cells lapped round a 3×3 grid. Each cell steps to the next
 * on one beat, so the motion is stepped frames of `transform` alone and
 * never lays anything out. Reduced motion and a capture run hold it on
 * `--loop-motion`, on a frame chosen to show the chase mid-lap rather than
 * its first, so a still mark still reads as working. The mark itself is
 * decorative; the seat it stands in names it.
 */

/** The pixels that move: each chaser and the fainter tail one cell behind it. */
const WORKING_DOT = {
  LEAD: "lead",
  LEAD_TAIL: "lead-tail",
  TRAIL: "trail",
  TRAIL_TAIL: "trail-tail",
} as const;

/** One cell's side, in CSS pixels. */
const CELL = 2;

/** One step from a cell to the next, cell and gap, in CSS pixels; the keyframes in `base.css` step by it. */
const PITCH = 4;

/** Where the first cell starts, from the mark's corner. */
const INSET = 1;

/** The mark's side, in CSS pixels. */
const SIDE = 12;

/** The cells of the track, in the order the chasers lap them. */
const TRACK = [
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
  [1, 2],
  [0, 2],
  [0, 1],
] as const;

/** Where a cell's top-left corner stands in the mark, in CSS pixels. */
interface CellCorner {
  readonly x: number;
  readonly y: number;
}

/** The corner of the grid's cell at column `column` and row `row`. */
function cellAt(column: number, row: number): CellCorner {
  return { x: INSET + column * PITCH, y: INSET + row * PITCH };
}

/** The mark, hidden from a reader, since the seat it stands in says it. */
export function WorkingMark(): React.JSX.Element {
  const start = cellAt(0, 0);
  return (
    <svg
      className="working-mark"
      width={SIDE}
      height={SIDE}
      viewBox={`0 0 ${SIDE} ${SIDE}`}
      aria-hidden="true"
    >
      {TRACK.map(([column, row], index) => (
        <rect
          key={index}
          className="working-mark-track"
          {...cellAt(column, row)}
          width={CELL}
          height={CELL}
          rx={CELL / 4}
        />
      ))}
      {Object.values(WORKING_DOT).map((dot) => (
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
}
