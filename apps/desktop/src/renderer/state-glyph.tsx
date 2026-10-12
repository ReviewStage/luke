/**
 * state-glyph.tsx -- where a piece of work stands, drawn on its own glyph rather than as a dot beside it, the way Cursor's and Codex's agent tabs draw it.
 *
 * Working, the glyph shrinks inside the window's one spinner ring
 * (`spinner.tsx`) turning around it; reduced motion and a capture run hold
 * the ring still (`--loop-motion`), which still reads as working. Failed, an alert in the danger colour takes the
 * glyph's place. At rest, finished or stopped by hand, the glyph stands
 * alone, since that is where every piece of work ends and a mark on each
 * says nothing. Working and failed are said aloud in a fixed word, so
 * nothing of the work rides the attribute the screen recording keeps; the
 * glyph at rest is decorative, its control's own label naming it.
 */

import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SpinnerRing } from "./spinner";

export const GLYPH_STATE = {
  WORKING: "working",
  FAILED: "failed",
  REST: "rest",
} as const;

export type GlyphState = (typeof GLYPH_STATE)[keyof typeof GLYPH_STATE];

/** What a reader is told of each state; nothing at rest. */
export const GLYPH_STATE_WORDS = {
  [GLYPH_STATE.WORKING]: "Working",
  [GLYPH_STATE.FAILED]: "Failed",
  [GLYPH_STATE.REST]: undefined,
} as const satisfies Record<GlyphState, string | undefined>;

/** A glyph wearing where its work stands. */
export function StateGlyph({
  glyph,
  state,
}: {
  glyph: ReactNode;
  state: GlyphState;
}): React.JSX.Element {
  if (state === GLYPH_STATE.REST) {
    return (
      <span className="state-glyph" data-state={state}>
        {glyph}
      </span>
    );
  }
  return (
    <span
      className="state-glyph"
      data-state={state}
      role="img"
      aria-label={GLYPH_STATE_WORDS[state]}
    >
      {state === GLYPH_STATE.FAILED ? (
        <CircleAlertIcon aria-hidden="true" />
      ) : (
        <>
          {glyph}
          <SpinnerRing />
        </>
      )}
    </span>
  );
}
