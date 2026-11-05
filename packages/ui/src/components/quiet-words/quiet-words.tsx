import type { ReactNode } from "react";
import { GLYPH } from "../../icons/icons.js";
import { AttentionMark } from "../attention-mark/attention-mark.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/**
 * quiet-words.tsx -- where something stands, said as plain words in the caption's type and the muted ink rather than a badge's pill: "Pending", "Waiting on Ada", an agent's "Done".
 *
 * The words carry the state and nothing paints it, so it reads as a note on
 * the row rather than a call to act, as an ask's Recommended does. A mark
 * may lead them where the state asks a reader's eye: the attention mark of
 * something waiting on the reader (`QUIET_MARK.ATTENTION`), or the failure
 * glyph in the danger ink, as `FailedMark` wears it, for something that
 * destroys or failed (`QUIET_MARK.FAILED`). The mark only repeats the words,
 * so it is hidden from a reader.
 *
 * Words that say less than the state, a count after the attention mark,
 * name it by `label`, which a reader hears in their place.
 */

/** The mark the words follow: the attention mark, or the failure glyph in the danger ink. */
export const QUIET_MARK = {
  ATTENTION: "attention",
  FAILED: "failed",
} as const;

export type QuietMark = (typeof QUIET_MARK)[keyof typeof QUIET_MARK];

/** The mark `mark` names, hidden from a reader since the words say it. */
function Mark({ mark }: { mark: QuietMark }): React.JSX.Element {
  if (mark === QUIET_MARK.ATTENTION) return <AttentionMark />;
  return (
    <span
      className="ui-quiet-failed inline-flex size-row-mark flex-none items-center justify-center text-destructive [&>svg]:size-full"
      aria-hidden="true"
    >
      <GLYPH.FAILED aria-hidden="true" />
    </span>
  );
}

/** `children` as quiet words, after `mark` where one is given, named `label` where they say less. */
export function QuietWords({
  mark,
  label,
  children,
}: {
  mark?: QuietMark | undefined;
  /** What a reader hears in the words' place where they say less than the state ("2 need you" for "2"). */
  label?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span className="ui-quiet-words inline-flex min-w-0 items-center gap-tight-gap">
      {mark === undefined ? null : <Mark mark={mark} />}
      <Text
        as={TEXT_ELEMENT.SPAN}
        variant={TEXT_VARIANT.CAPTION}
        tone={TEXT_TONE.MUTED}
        aria-hidden={label === undefined ? undefined : "true"}
      >
        {children}
      </Text>
      {label === undefined ? null : <VisuallyHidden>{label}</VisuallyHidden>}
    </span>
  );
}
