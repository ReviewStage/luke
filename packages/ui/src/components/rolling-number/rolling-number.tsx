import { Fragment, useState } from "react";

const ROLL = {
  UP: "up",
  DOWN: "down",
} as const;

type Roll = (typeof ROLL)[keyof typeof ROLL];

interface Shown {
  readonly value: number;
  readonly previous: number | undefined;
  readonly roll: Roll | undefined;
  readonly turn: number;
  readonly left: boolean;
}

function digitsOf(value: number): readonly string[] {
  return [...String(value)];
}

function DigitSlot({
  digit,
  was,
  roll,
  turn,
  left,
  onLeft,
}: {
  digit: string;
  was: string | undefined;
  roll: Roll | undefined;
  turn: number;
  left: boolean;
  onLeft: () => void;
}): React.JSX.Element {
  const changed = roll !== undefined && was !== digit;
  const leaving = changed && !left ? was : undefined;
  return (
    <span className="ui-rolling-number-slot relative inline-block [clip-path:inset(0)]">
      <Fragment key={changed ? turn : "standing"}>
        <span
          className="ui-rolling-number-digit inline-block"
          data-roll={changed ? roll : undefined}
        >
          {digit}
        </span>
        {leaving === undefined ? null : (
          <span
            className="ui-rolling-number-leaving pointer-events-none absolute inset-0 before:content-[attr(data-digit)]"
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

export function RollingNumber({ value }: { value: number }): React.JSX.Element {
  const [shown, setShown] = useState<Shown>({
    value,
    previous: undefined,
    roll: undefined,
    turn: 0,
    left: true,
  });
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
  return (
    <span className="ui-rolling-number inline-flex tabular-nums">
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
