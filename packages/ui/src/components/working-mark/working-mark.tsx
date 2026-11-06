import { REPLAY_LEFT_OUT } from "../../session-replay-marks.js";
import { useMotionHeld } from "../../use-motion-held.js";
import { useBeat } from "../time/time-clock.js";

/**
 * working-mark.tsx -- the one mark an agent at work wears: two pixels chasing each other round the edge of a small grid, in the gray ink around it.
 *
 * Every place that says an agent is working draws this mark. It stands inside
 * the 16px icon seat: eight 3px cells lapped round a 3×3 grid, 2px apart.
 * Each pixel steps to the next cell on the one 200ms beat every mark shares
 * (`useBeat`), lapping the eight cells in 1.6s, so the motion is stepped
 * frames of `transform` alone, never lays anything out, and costs the window
 * a frame only when a pixel moves, where a CSS animation would tick it every
 * vsync. Reduced motion and a capture run hold it (`useMotionHeld`) on its
 * resting frame, chosen to show the chase mid-lap rather than its first, so a
 * still mark always lights four cells and reads as working. The screen
 * recording leaves it out (`REPLAY_LEFT_OUT`), because each step rewrites
 * four of its attributes, which the recorder would otherwise take down and
 * send twenty times a second for every mark on screen. The mark itself
 * is decorative; the seat it stands in names it. Its side is 16px unless a
 * container sets `--ui-working-mark-size`.
 *
 * It is drawn in the Tailwind theme's utilities: its size is fixed by the
 * `viewBox` the mark always carries, asked on the mark with that attribute
 * so a glyph's seat around it never stretches the grid.
 */

/**
 * The pixels that move: each chaser and the fainter tail one cell behind it,
 * with the track cell it rests on when still and steps on from.
 */
const WORKING_DOTS = [
  { dot: "lead", restsOn: 1, tail: false },
  { dot: "lead-tail", restsOn: 0, tail: true },
  { dot: "trail", restsOn: 5, tail: false },
  { dot: "trail-tail", restsOn: 4, tail: true },
] as const;

/** One cell's side, in CSS pixels. */
const CELL = 3;

/** One step from a cell to the next, cell and gap, in CSS pixels. */
const PITCH = 5;

/** The mark's side, in CSS pixels: the 16px icon seat. */
const SIDE = 16;

/** Where the first cell starts, from the mark's corner: the grid centered in the side. */
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

/** The `transform` that sets a pixel on the track cell at `index`, lapping past the last, from the first cell it is drawn on. */
function cellTransform(index: number): string {
  const [column, row] = TRACK[index % TRACK.length] ?? TRACK[0];
  return `translate(${column * PITCH}px, ${row * PITCH}px)`;
}

/** The moving pixels, `beat` cells on from where they rest. */
function WorkingDots({ beat }: { readonly beat: number }): React.JSX.Element {
  return (
    <>
      {WORKING_DOTS.map(({ dot, restsOn, tail }) => (
        <rect
          key={dot}
          className={tail ? "ui-working-mark-dot opacity-60" : "ui-working-mark-dot"}
          data-dot={dot}
          style={{ transform: cellTransform(restsOn + beat) }}
          {...cellAt(0, 0)}
          width={CELL}
          height={CELL}
          rx={CELL / 4}
        />
      ))}
    </>
  );
}

/** The moving pixels stepping on the shared beat. */
function LappingDots(): React.JSX.Element {
  return <WorkingDots beat={useBeat()} />;
}

/** The mark, hidden from a reader, since the seat it stands in says it. */
export function WorkingMark(): React.JSX.Element {
  // Note that a held mark never reads the beat at all, and one already standing stops as the setting changes.
  const held = useMotionHeld();
  return (
    <svg
      className={`ui-working-mark ${REPLAY_LEFT_OUT} [&[viewBox]]:block [&[viewBox]]:size-working-mark [&[viewBox]]:flex-none [&[viewBox]]:fill-current`}
      width={SIDE}
      height={SIDE}
      viewBox={`0 0 ${SIDE} ${SIDE}`}
      aria-hidden="true"
    >
      {TRACK.map(([column, row], index) => (
        <rect
          key={index}
          className="ui-working-mark-track opacity-30"
          {...cellAt(column, row)}
          width={CELL}
          height={CELL}
          rx={CELL / 4}
        />
      ))}
      {held ? <WorkingDots beat={0} /> : <LappingDots />}
    </svg>
  );
}
