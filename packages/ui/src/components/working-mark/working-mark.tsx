import { useCallback, useRef } from "react";
import { REPLAY_LEFT_OUT } from "../../session-replay-marks.js";
import { useMotionHeld } from "../../use-motion-held.js";
import { useOnBeat } from "../time/time-clock.js";

const WORKING_DOTS = [
  { dot: "lead", restsOn: 1, tail: false },
  { dot: "lead-tail", restsOn: 0, tail: true },
  { dot: "trail", restsOn: 5, tail: false },
  { dot: "trail-tail", restsOn: 4, tail: true },
] as const;

const CELL = 3;

const PITCH = 5;

const SIDE = 16;

const INSET = (SIDE - (2 * PITCH + CELL)) / 2;

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

interface CellCorner {
  readonly x: number;
  readonly y: number;
}

function cellAt(column: number, row: number): CellCorner {
  return { x: INSET + column * PITCH, y: INSET + row * PITCH };
}

function cellTransform(index: number): string {
  const [column, row] = TRACK[index % TRACK.length] ?? TRACK[0];
  return `translate(${column * PITCH}px, ${row * PITCH}px)`;
}

function WorkingDots({
  dotRefs,
}: {
  readonly dotRefs?: React.RefObject<(SVGRectElement | null)[]>;
}): React.JSX.Element {
  return (
    <>
      {WORKING_DOTS.map(({ dot, restsOn, tail }, index) => (
        <rect
          key={dot}
          ref={
            dotRefs === undefined
              ? undefined
              : (rect) => {
                  dotRefs.current[index] = rect;
                }
          }
          className={tail ? "ui-working-mark-dot opacity-60" : "ui-working-mark-dot"}
          data-dot={dot}
          style={{ transform: cellTransform(restsOn) }}
          {...cellAt(0, 0)}
          width={CELL}
          height={CELL}
          rx={CELL / 4}
        />
      ))}
    </>
  );
}

function LappingDots(): React.JSX.Element {
  const dotRefs = useRef<(SVGRectElement | null)[]>([]);
  const step = useCallback((beat: number) => {
    WORKING_DOTS.forEach(({ restsOn }, index) => {
      const rect = dotRefs.current[index];
      if (rect) rect.style.transform = cellTransform(restsOn + beat);
    });
  }, []);
  useOnBeat(step);
  return <WorkingDots dotRefs={dotRefs} />;
}

export function WorkingMark(): React.JSX.Element {
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
      {held ? <WorkingDots /> : <LappingDots />}
    </svg>
  );
}
