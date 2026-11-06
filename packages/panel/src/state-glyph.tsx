import { FailedMark as FailedRowMark, Tooltip, WorkingMark } from "@repo/ui";
import type { ReactNode } from "react";

export const GLYPH_STATE = {
  WORKING: "working",
  FAILED: "failed",
  REST: "rest",
} as const;

export type GlyphState = (typeof GLYPH_STATE)[keyof typeof GLYPH_STATE];

const GLYPH_STATE_WORDS = {
  [GLYPH_STATE.WORKING]: "Working",
  [GLYPH_STATE.FAILED]: "Failed",
  [GLYPH_STATE.REST]: undefined,
} as const satisfies Record<GlyphState, string | undefined>;

const STOPPED_WORDS = "Stopped";

export function glyphStateWords(state: GlyphState, stopped: boolean): string | undefined {
  return state === GLYPH_STATE.REST && stopped ? STOPPED_WORDS : GLYPH_STATE_WORDS[state];
}

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

function FailedMark({ hinted }: { hinted: boolean }): React.JSX.Element {
  return hinted ? (
    <Tooltip label={GLYPH_STATE_WORDS[GLYPH_STATE.FAILED]}>
      <FailedRowMark />
    </Tooltip>
  ) : (
    <FailedRowMark />
  );
}

export function stateEndMark(state: GlyphState, hinted: boolean): React.JSX.Element | undefined {
  return state === GLYPH_STATE.FAILED ? <FailedMark hinted={hinted} /> : undefined;
}
