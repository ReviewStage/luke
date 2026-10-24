import { useState } from "react";
import { useDisclosure } from "../../use-disclosure.js";

/**
 * length-counter.tsx -- how much of a field's limit its words have taken, shown once they near it, its count ticking as it moves.
 *
 * A field with a length limit says nothing of it while its words are well
 * short of it; from four fifths of the way (`COUNTER_FROM`) the counter
 * fades in, "52/64", and its count ticks as it changes, rising from below as
 * it grows and dropping from above as it shrinks, so a glance tells which
 * way it went. At the limit it is drawn in the danger ink, since the field
 * takes no more. Below four fifths again it fades out, held through its
 * exit (`useDisclosure`). It takes no class or style: where it stands is its
 * caller's, a `FormField`'s label line. It is drawn in Tailwind utilities
 * over the theme's caption and motion roles, and keeps the
 * `luke-length-counter` names a test finds it by.
 */

/** The counter: a caption's tabular figures in the muted ink, the danger ink at the limit, fading in and out. */
const COUNTER =
  "luke-length-counter inline-flex flex-none whitespace-nowrap font-body text-caption font-normal text-muted-foreground tabular-nums animate-arrive data-[full=true]:text-danger data-[leaving=true]:animate-leave";

/** The count: a figure of its own that ticks in from the way it moved. */
const COUNT =
  "luke-length-counter-count inline-block data-[move=up]:animate-tick-up data-[move=down]:animate-tick-down";

/** How far toward its limit a field's words go before the counter shows. */
export const COUNTER_FROM = 0.8;

/** Which way the count last moved, which its tick travels. */
const COUNT_MOVE = {
  UP: "up",
  DOWN: "down",
} as const;

type CountMove = (typeof COUNT_MOVE)[keyof typeof COUNT_MOVE];

/** `length` of `limit`, once it reaches four fifths of it. */
export function LengthCounter({
  length,
  limit,
}: {
  /** How many characters the field holds. */
  length: number;
  /** How many it takes at most. */
  limit: number;
}): React.JSX.Element | null {
  const shown = useDisclosure(length >= limit * COUNTER_FROM);
  const [was, setWas] = useState(length);
  const [move, setMove] = useState<CountMove | undefined>(undefined);
  // Note that the move is taken in the render that sees it, so the tick starts on that frame.
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
      {/* Note that each count is a figure of its own, so a change plays its tick from the start. */}
      <span key={length} className={COUNT} data-move={move}>
        {length}
      </span>
      /{limit}
    </span>
  );
}
