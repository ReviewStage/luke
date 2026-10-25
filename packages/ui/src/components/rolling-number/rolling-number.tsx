import { Fragment, useState } from "react";

/**
 * rolling-number.tsx -- a count that ticks as it changes: each digit that changed rolls out and its successor rolls in, the way an odometer's wheel turns.
 *
 * A count beside words ("2 of 5 done") changes in place while it is read, and
 * a digit swapped on the frame it changed is easy to miss. Here a digit that
 * changed rolls on `transform` alone, up as the count grows and down as it
 * falls, so nothing that holds text changes size mid-motion (docs/DESIGN.md);
 * a digit that stands is not touched, and the digits are tabular, so a count
 * that keeps its length keeps its width. A count drawn first stands still:
 * only a change rolls.
 *
 * The digit leaving is drawn from its `data-digit` by its `::before`
 * rather than as words, so what the count says, copied or read aloud, is
 * only its value, and it is taken out once its exit has run.
 *
 * It is drawn in the Tailwind theme's utilities, each digit in a slot
 * clipped to its line by a clip-path rather than an overflow, because an
 * inline block that clips its overflow sits on its bottom edge rather than
 * on the words' baseline; the rolls are `rolling-number.css`'s.
 */

/** Which way a change rolls, read by the stylesheet from `data-roll`. */
const ROLL = {
  UP: "up",
  DOWN: "down",
} as const;

type Roll = (typeof ROLL)[keyof typeof ROLL];

/** The count as last drawn, the one it changed from, how many changes it has seen, and whether the digits it changed from have left. */
interface Shown {
  readonly value: number;
  readonly previous: number | undefined;
  readonly roll: Roll | undefined;
  readonly turn: number;
  readonly left: boolean;
}

/** A count's digits, the units last; a count that is not a whole number is drawn as it reads. */
function digitsOf(value: number): readonly string[] {
  return [...String(value)];
}

/** One digit's place: the digit, and the one it replaced while that leaves. */
function DigitSlot({
  digit,
  was,
  roll,
  turn,
  left,
  onLeft,
}: {
  digit: string;
  /** The digit this place held before the change; none where the count was shorter. */
  was: string | undefined;
  roll: Roll | undefined;
  turn: number;
  left: boolean;
  onLeft: () => void;
}): React.JSX.Element {
  // Note that a digit that changed is keyed by the turn, so each change
  // mounts it and the one it replaced anew and their roll starts over even
  // mid-roll.
  const changed = roll !== undefined && was !== digit;
  const leaving = changed && !left ? was : undefined;
  return (
    <span className="luke-rolling-number-slot relative inline-block [clip-path:inset(0)]">
      <Fragment key={changed ? turn : "standing"}>
        <span
          className="luke-rolling-number-digit inline-block"
          data-roll={changed ? roll : undefined}
        >
          {digit}
        </span>
        {leaving === undefined ? null : (
          <span
            className="luke-rolling-number-leaving pointer-events-none absolute inset-0 before:content-[attr(data-digit)]"
            data-roll={roll}
            data-digit={leaving}
            aria-hidden="true"
            onAnimationEnd={onLeft}
          />
        )}
      </Fragment>
    </span>
  );
}

/** A count whose changed digits roll into place as it changes. */
export function RollingNumber({
  value,
}: {
  /** The count to draw. */
  value: number;
}): React.JSX.Element {
  const [shown, setShown] = useState<Shown>({
    value,
    previous: undefined,
    roll: undefined,
    turn: 0,
    left: true,
  });
  // Note that the change is taken in the render that sees it, because a
  // change noticed an effect later would draw one frame of the new count
  // standing still before it rolls.
  if (value !== shown.value) {
    setShown({
      value,
      previous: shown.value,
      roll: value > shown.value ? ROLL.UP : ROLL.DOWN,
      turn: shown.turn + 1,
      left: false,
    });
  }
  const digits = digitsOf(shown.value);
  const before = shown.previous === undefined ? [] : digitsOf(shown.previous);
  const left = () => setShown((current) => ({ ...current, left: true }));
  // A digit is matched with the one in its place counted from the units.
  return (
    <span className="luke-rolling-number inline-flex tabular-nums">
      {digits.map((digit, index) => {
        const place = digits.length - index;
        return (
          <DigitSlot
            key={place}
            digit={digit}
            was={before[before.length - place]}
            roll={shown.roll}
            turn={shown.turn}
            left={shown.left}
            onLeft={left}
          />
        );
      })}
    </span>
  );
}
