import { formatCount } from "@luke/features/number-format";
import { Fragment, type ReactNode } from "react";
import { STATUS_TONE, type StatusTone } from "../../status-tone.js";

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

/** A part's glyph and the words that say it, required beside one. */
type CountGlyph =
  | { glyph?: undefined; glyphLabel?: undefined }
  | { glyph: ReactNode; glyphLabel: string };

/** One part of a count: what it says, its tone, and a glyph before it. */
export type CountPart = {
  readonly text: string;
  readonly tone?: StatusTone | undefined;
} & Readonly<CountGlyph>;

/**
 * A part laid out as a row of its glyph and words, in its tone, which holds
 * whether its option is chosen or not; quiet, it takes its count's ink. Its
 * glyph stands at the caption's size.
 */
const PART =
  "luke-count-part inline-flex items-center gap-0.5 [&:not([data-tone=neutral])]:text-tone-ink";
const GLYPH = "luke-count-glyph inline-flex [&>svg]:size-caption-glyph";

/** One part, its glyph named for a reader who cannot see it. */
function CountPartView({ part }: { part: CountPart }): React.JSX.Element {
  return (
    <span className={PART} data-tone={part.tone ?? STATUS_TONE.NEUTRAL}>
      {part.glyph === undefined ? null : (
        <span className={GLYPH} role="img" aria-label={part.glyphLabel}>
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
    { text: `+${formatCount(additions)}`, tone: STATUS_TONE.COMPLETE },
    { text: `−${formatCount(deletions)}`, tone: STATUS_TONE.DANGER },
  ];
}
