import type { ReactNode } from "react";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * subject-line.tsx -- a quiet line that leads into one thing: what happened, in words kept whole, then the chip of what it happened to, which takes the rest of the line.
 *
 * A thread's line in a transcript ("Thread answer" and the thread's chip)
 * and a service's card ("Reviewed" and the pull request's chip) each head
 * what follows with one such line. Its subject is the reason the line is
 * there, so it is never held to the measure a mention keeps in prose
 * (`--luke-inline-ref-pill-width`, `inline-ref.tsx`): a pill here is as wide
 * as its name, and is cut, fading where it is, only where the line itself
 * runs out after the lead. A lead that leaves less of the line than a
 * title's readable floor (`--luke-title-floor`) stands the subject on a
 * line of its own beneath it, and a lead wider than its line wraps, so a
 * long name before it never pushes the subject out of sight. Note that the
 * subject's cap is undone on whatever the caller hands as `children`, its
 * pill or its link, because the caller draws it through the window's own
 * chip.
 */

/**
 * How much of the line the subject takes: the rest of it, standing on a
 * line of its own where less than a title's floor is left (`LINE`), or its
 * own width alone, cut where the line runs out (`OWN`), for a subject inside
 * a line that names more beside it (`MessageHead`).
 */
export const SUBJECT_FIT = {
  LINE: "line",
  OWN: "own",
} as const;

export type SubjectFit = (typeof SUBJECT_FIT)[keyof typeof SUBJECT_FIT];

/** The subject's seat, by how much of the line it takes. */
const SUBJECT_SEAT_CLASS: Record<SubjectFit, string> = {
  [SUBJECT_FIT.LINE]: "flex min-w-0 shrink-0 basis-title-floor grow *:min-w-0 *:max-w-full",
  [SUBJECT_FIT.OWN]: "flex min-w-0 *:min-w-0 *:max-w-full",
};

/** A head line: `lead`, whole, then `children`, the one thing it names, cut only at the line's end. */
export function SubjectLine({
  lead,
  children,
  fit = SUBJECT_FIT.LINE,
  ...attributes
}: {
  /** What happened, in words: "Thread answer", "Reviewed". */
  lead: ReactNode;
  /** The chip, or link, of what it happened to; none where nothing names it. */
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
      {/* Note that the space after the lead stands inside it, held, because a flex line drops one between its items, and words copied from the line would run the lead into its subject. */}
      <span className="min-w-0 whitespace-pre-wrap">
        {lead}
        {children == null ? null : " "}
      </span>
      {children == null ? null : <span className={SUBJECT_SEAT_CLASS[fit]}>{children}</span>}
    </Text>
  );
}
