import type { ReactNode } from "react";
import { GLYPH } from "../../icons/icons.js";
import { AttentionMark } from "../attention-mark/attention-mark.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

export const QUIET_MARK = {
  ATTENTION: "attention",
  FAILED: "failed",
} as const;

export type QuietMark = (typeof QUIET_MARK)[keyof typeof QUIET_MARK];

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

export function QuietWords({
  mark,
  label,
  children,
}: {
  mark?: QuietMark | undefined;
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
