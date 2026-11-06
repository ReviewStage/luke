import { formatCount } from "@repo/features/number-format";
import { useState } from "react";
import { useDisclosure } from "../../use-disclosure.js";

const COUNTER =
  "ui-length-counter inline-flex flex-none whitespace-nowrap font-body text-caption font-text text-muted-foreground tabular-nums animate-arrive data-[full=true]:text-danger data-[leaving=true]:animate-leave";

const COUNT =
  "ui-length-counter-count inline-block data-[move=up]:animate-tick-up data-[move=down]:animate-tick-down";

export const COUNTER_FROM = 0.8;

const COUNT_MOVE = {
  UP: "up",
  DOWN: "down",
} as const;

type CountMove = (typeof COUNT_MOVE)[keyof typeof COUNT_MOVE];

export function LengthCounter({
  length,
  limit,
}: {
  length: number;
  limit: number;
}): React.JSX.Element | null {
  const shown = useDisclosure(length >= limit * COUNTER_FROM);
  const [was, setWas] = useState(length);
  const [move, setMove] = useState<CountMove | undefined>(undefined);
  if (length !== was) {
    setWas(length);
    setMove(length > was ? COUNT_MOVE.UP : COUNT_MOVE.DOWN);
  }
  if (!shown.mounted) return null;
  return (
    <span
      ref={shown.ref}
      className={COUNTER}
      data-full={length >= limit ? "true" : undefined}
      data-leaving={shown.leaving ? "true" : undefined}
    >
      <span key={length} className={COUNT} data-move={move}>
        {formatCount(length)}
      </span>
      /{formatCount(limit)}
    </span>
  );
}
