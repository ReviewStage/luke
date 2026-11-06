import { formatCount } from "@repo/features/number-format";
import { Fragment, type ReactNode } from "react";
import { STATUS_TONE, type StatusTone } from "../../status-tone.js";

type CountGlyph =
  | { glyph?: undefined; glyphLabel?: undefined }
  | { glyph: ReactNode; glyphLabel: string };

export type CountPart = {
  readonly text: string;
  readonly tone?: StatusTone | undefined;
  readonly folds?: boolean | undefined;
} & Readonly<CountGlyph>;

const PART =
  "ui-count-part inline-flex items-center gap-0.5 [&:not([data-tone=neutral])]:text-tone-ink";
const GLYPH = "ui-count-glyph inline-flex [&>svg]:size-caption-glyph";

function CountPartView({ part }: { part: CountPart }): React.JSX.Element {
  return (
    <span
      className={PART}
      data-tone={part.tone ?? STATUS_TONE.NEUTRAL}
      data-folds={part.folds === true ? "" : undefined}
    >
      {part.glyph === undefined ? null : (
        <span className={GLYPH} role="img" aria-label={part.glyphLabel}>
          {part.glyph}
        </span>
      )}
      {part.text}
    </span>
  );
}

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

export function linesCount(additions: number, deletions: number): readonly CountPart[] {
  return [
    { text: `+${formatCount(additions)}`, tone: STATUS_TONE.COMPLETE },
    { text: `−${formatCount(deletions)}`, tone: STATUS_TONE.DANGER },
  ];
}
