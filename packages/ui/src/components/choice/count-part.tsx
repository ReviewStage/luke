import { Fragment, type ReactNode } from "react";

/**
 * count-part.tsx -- what an option of a row where you choose one counts, as parts each in its own tone, which every such row draws alike.
 *
 * A count is one part or several: a pull request's checks are one, "9/9" in
 * the complete tone with a glyph before it, and its lines are two, the lines
 * it adds and the lines it removes. A part is quiet unless it says a state,
 * and a glyph that says one carries the words a reader who cannot see it
 * hears, so a state is never colour and shape alone. A diff's line counts
 * always carry colour, its additions in the complete tone and its deletions
 * in the danger tone, chosen or not and in every look, so they are built
 * one way (`linesCount`) and no caller can draw them grey.
 */

/** The tone a count part is drawn in: quiet, or one of the state palette's. */
export const COUNT_TONE = {
  QUIET: "quiet",
  COMPLETE: "complete",
  ATTENTION: "attention",
  DANGER: "danger",
} as const;

export type CountTone = (typeof COUNT_TONE)[keyof typeof COUNT_TONE];

/** A part's glyph and the words that say it, required beside one. */
type CountGlyph =
  | { glyph?: undefined; glyphLabel?: undefined }
  | { glyph: ReactNode; glyphLabel: string };

/** One part of a count: what it says, its tone, and a glyph before it. */
export type CountPart = {
  readonly text: string;
  readonly tone?: CountTone | undefined;
} & Readonly<CountGlyph>;

/** One part, its glyph named for a reader who cannot see it. */
function CountPartView({ part }: { part: CountPart }): React.JSX.Element {
  return (
    <span className="luke-tab-count-part" data-tone={part.tone ?? COUNT_TONE.QUIET}>
      {part.glyph === undefined ? null : (
        <span className="luke-tab-count-glyph" role="img" aria-label={part.glyphLabel}>
          {part.glyph}
        </span>
      )}
      {part.text}
    </span>
  );
}

/** A count's `parts`, a space between each. */
export function CountParts({ parts }: { parts: readonly CountPart[] }): React.JSX.Element {
  return (
    <>
      {parts.map((part, at) => (
        <Fragment key={at}>
          {at === 0 ? null : " "}
          <CountPartView part={part} />
        </Fragment>
      ))}
    </>
  );
}

/** The parts of a diff's line count: `+additions` in the complete tone and `−deletions` in the danger tone. */
export function linesCount(additions: number, deletions: number): readonly CountPart[] {
  return [
    { text: `+${additions.toLocaleString()}`, tone: COUNT_TONE.COMPLETE },
    { text: `−${deletions.toLocaleString()}`, tone: COUNT_TONE.DANGER },
  ];
}
