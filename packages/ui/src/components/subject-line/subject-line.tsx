import type { ReactNode } from "react";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

export const SUBJECT_FIT = {
  LINE: "line",
  OWN: "own",
} as const;

export type SubjectFit = (typeof SUBJECT_FIT)[keyof typeof SUBJECT_FIT];

const SUBJECT_SEAT_CLASS: Record<SubjectFit, string> = {
  [SUBJECT_FIT.LINE]: "flex min-w-0 shrink-0 basis-title-floor grow *:min-w-0 *:max-w-full",
  [SUBJECT_FIT.OWN]: "flex min-w-0 *:min-w-0 *:max-w-full",
};

export function SubjectLine({
  lead,
  children,
  fit = SUBJECT_FIT.LINE,
  ...attributes
}: {
  lead: ReactNode;
  children?: ReactNode;
  fit?: SubjectFit | undefined;
} & { readonly [data: `data-${string}`]: string | undefined }): React.JSX.Element {
  return (
    <Text
      {...attributes}
      as={TEXT_ELEMENT.DIV}
      variant={TEXT_VARIANT.CAPTION}
      tone={TEXT_TONE.MUTED}
      className="flex min-w-0 max-w-full flex-wrap items-baseline"
    >
      <span className="min-w-0 whitespace-pre-wrap">
        {lead}
        {children == null ? null : " "}
      </span>
      {children == null ? null : <span className={SUBJECT_SEAT_CLASS[fit]}>{children}</span>}
    </Text>
  );
}
