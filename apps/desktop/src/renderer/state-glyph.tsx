/**
 * state-glyph.tsx -- where a piece of work stands, drawn on its own glyph rather than as a dot beside it, the way Cursor's and Codex's agent tabs draw it, and a failure at its row's end.
 *
 * Working, the working mark (`working-mark.tsx`) takes the glyph's place in
 * the glyph's own footprint, so a tab or a row moves nothing as its work
 * starts or ends; reduced motion and a capture run hold it on a frame that
 * still reads as working. A row with no glyph of its own, a sidebar plan's
 * time or a call's row in a transcript, draws the same mark through the
 * same seat, at the size its slot sets (`--state-glyph-size`). Failed, the
 * glyph stands as it does at rest, so a failed agent still shows the
 * harness it ran in, and an alert in the danger colour stands at the end
 * of its row or its tab (`stateEndMark`), before its time where it has
 * one, as an editor marks a file's tab with its problems; a call that
 * failed wears the same alert at its row's end. Only a failure has an end
 * mark of its work, so no other row keeps room for one; a tab whose box
 * holds a draft wears the draft's pencil there instead (`draft-mark.tsx`). At rest, finished or stopped
 * by hand, the glyph stands alone, since that is where every piece of work
 * ends and a mark on each says nothing. Working and failed are said aloud in a fixed word, so nothing of
 * the work rides the attribute the screen recording keeps; the glyph at
 * rest is decorative, its control's own label naming it, and a card or a
 * tab that says more of a stop than its glyph does says it in the one word
 * `glyphStateWords` gives.
 */

import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "./tooltip";
import { WorkingMark } from "./working-mark";

export const GLYPH_STATE = {
  WORKING: "working",
  FAILED: "failed",
  REST: "rest",
} as const;

export type GlyphState = (typeof GLYPH_STATE)[keyof typeof GLYPH_STATE];

/** What a reader is told of each state; nothing at rest. */
const GLYPH_STATE_WORDS = {
  [GLYPH_STATE.WORKING]: "Working",
  [GLYPH_STATE.FAILED]: "Failed",
  [GLYPH_STATE.REST]: undefined,
} as const satisfies Record<GlyphState, string | undefined>;

/** What a piece of work at rest is called once it was stopped, which its glyph at rest does not tell from a finish. */
const STOPPED_WORDS = "Stopped";

/** What a card or a tab says of where its work stands beyond its glyph: the state's own word, or Stopped for work at rest that was `stopped`. */
export function glyphStateWords(state: GlyphState, stopped: boolean): string | undefined {
  return state === GLYPH_STATE.REST && stopped ? STOPPED_WORDS : GLYPH_STATE_WORDS[state];
}

/**
 * A glyph wearing where its work stands: the working mark in its place
 * while it works, and the glyph itself otherwise, a failure included. A
 * row that has no glyph of its own draws it working alone, with no glyph.
 */
export function StateGlyph({
  glyph,
  state,
}: {
  glyph?: ReactNode;
  state: GlyphState;
}): React.JSX.Element {
  if (state !== GLYPH_STATE.WORKING) {
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
      <WorkingMark />
    </span>
  );
}

/**
 * The alert a failed piece of work wears at its row's end, named Failed to
 * a reader and, `hinted`, in its own hint. Note that a tab and a hover
 * card's row leave the hint out, because the tab's card already says it
 * failed and a hint hung from a card would stand over the card's words.
 */
function FailedMark({ hinted }: { hinted: boolean }): React.JSX.Element {
  const words = GLYPH_STATE_WORDS[GLYPH_STATE.FAILED];
  const mark = (
    <span className="failed-mark" role="img" aria-label={words}>
      <CircleAlertIcon aria-hidden="true" />
    </span>
  );
  return hinted ? <Tooltip label={words}>{mark}</Tooltip> : mark;
}

/** The mark at the end of a row or a tab whose work stands in `state`: the failed mark once it failed, nothing otherwise. */
export function stateEndMark(state: GlyphState, hinted: boolean): React.JSX.Element | undefined {
  return state === GLYPH_STATE.FAILED ? <FailedMark hinted={hinted} /> : undefined;
}
