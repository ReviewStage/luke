import type { ReactNode } from "react";
import { GLYPH } from "../../icons/icons.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * quiet-words.tsx -- where something stands, said as plain words in the caption's type and the muted ink rather than a badge's pill: "Pending", "Waiting on Ada", an agent's "Done".
 *
 * The words carry the state and nothing paints it, so it reads as a note on
 * the row rather than a call to act, as an ask's Recommended does. A mark
 * may lead them where the state asks a reader's eye: the failure glyph in
 * the danger ink, as `FailedMark` wears it, for something that destroys or
 * failed (`QUIET_MARK.FAILED`). The mark only repeats the words, so it is
 * hidden from a reader.
 */

/** The mark the words follow: the failure glyph in the danger ink. */
export const QUIET_MARK = {
  FAILED: "failed",
} as const;

export type QuietMark = (typeof QUIET_MARK)[keyof typeof QUIET_MARK];

/** The failure glyph `QUIET_MARK.FAILED` names, hidden from a reader since the words say it. */
function FailedGlyph(): React.JSX.Element {
  return (
    <span
      className="ui-quiet-failed inline-flex size-row-mark flex-none items-center justify-center text-destructive [&>svg]:size-full"
      aria-hidden="true"
    >
      <GLYPH.FAILED aria-hidden="true" />
    </span>
  );
}

/** `children` as quiet words, after `mark` where one is given. */
export function QuietWords({
  mark,
  children,
}: {
  mark?: QuietMark | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span className="ui-quiet-words inline-flex min-w-0 items-center gap-tight-gap">
      {mark === QUIET_MARK.FAILED ? <FailedGlyph /> : null}
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {children}
      </Text>
    </span>
  );
}
