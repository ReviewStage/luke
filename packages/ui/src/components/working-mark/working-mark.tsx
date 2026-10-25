/**
 * working-mark.tsx -- the one mark an agent at work wears: two pixels chasing each other round the edge of a small grid, in the ink around it.
 *
 * Every place that says an agent is working draws this mark. It stands inside
 * the 16px icon seat: eight 3px cells lapped round a 3×3 grid, 2px apart.
 * Each cell steps to the next on one beat, so the motion is stepped frames of
 * `transform` alone and never lays anything out. Reduced motion and a capture
 * run hold it on `--luke-loop-motion`, on a frame chosen to show the chase
 * mid-lap rather than its first. A capture that drops the animation outright
 * falls back on each pixel's own resting `transform`, the very same frame, so
 * a still mark always lights four cells and reads as working. The mark itself
 * is decorative; the seat it stands in names it. Its side is 16px unless a
 * container sets `--luke-working-mark-size`.
 */

/**
 * The pixels that move: each chaser and the fainter tail one cell behind it,
 * with the track cell it rests on when still. `working-mark.css` delays each
 * one to hold the same cell.
 */
const WORKING_DOTS = [
  { dot: "lead", restsOn: 1 },
  { dot: "lead-tail", restsOn: 0 },
  { dot: "trail", restsOn: 5 },
  { dot: "trail-tail", restsOn: 4 },
] as const;

/** One cell's side, in CSS pixels. */
const CELL = 3;

/** One step from a cell to the next, cell and gap, in CSS pixels; the keyframes in `working-mark.css` step by it. */
const PITCH = 5;

/** The mark's side, in CSS pixels: the 16px icon seat. */
const SIDE = 16;

/** Where the first cell starts, from the mark's corner: the grid centred in the side. */
const INSET = (SIDE - (2 * PITCH + CELL)) / 2;

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

/** The `transform` that sets a pixel on the track cell at `index`, from the first cell it is drawn on. */
function restingTransform(index: number): string {
  const [column, row] = TRACK[index] ?? TRACK[0];
  return `translate(${column * PITCH}px, ${row * PITCH}px)`;
}

/** The mark, hidden from a reader, since the seat it stands in says it. */
export function WorkingMark(): React.JSX.Element {
  const start = cellAt(0, 0);
  return (
    <svg
      className="luke-working-mark"
      width={SIDE}
      height={SIDE}
      viewBox={`0 0 ${SIDE} ${SIDE}`}
      aria-hidden="true"
    >
      {TRACK.map(([column, row], index) => (
        <rect
          key={index}
          className="luke-working-mark-track"
          {...cellAt(column, row)}
          width={CELL}
          height={CELL}
          rx={CELL / 4}
        />
      ))}
      {WORKING_DOTS.map(({ dot, restsOn }) => (
        <rect
          key={dot}
          className="luke-working-mark-dot"
          data-dot={dot}
          style={{ transform: restingTransform(restsOn) }}
          {...start}
          width={CELL}
          height={CELL}
          rx={CELL / 4}
        />
      ))}
    </svg>
  );
}
