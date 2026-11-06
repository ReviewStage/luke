import type { ReactNode } from "react";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * numbered-steps.tsx -- a short list of things to do in order, each led by its number in a small round well: its words, then what it needs under them.
 *
 * A flow a person carries out elsewhere, such as entering a code on another
 * site, is said as numbered steps rather than a paragraph, so the order is
 * the first thing read. Each step's number stands in a round well on the
 * step's first line, its words in the label's type beside it, and what the
 * step needs, a hint, a code to copy, or the presses that carry it out,
 * stands under the words in the same column. It is an ordered list, so a
 * reader hears each step's place and the count; the drawn number is the
 * list's own and is hidden from a reader. It is drawn in the Tailwind
 * theme's utilities.
 */

/** The number's well: round, on the words' first line, in the caption's figures. */
const NUMBER =
  "ui-numbered-step-number inline-flex size-ui-20 flex-none items-center justify-center rounded-full bg-well text-caption text-muted-foreground tabular-nums";

/** The steps, in order, as an ordered list a reader hears counted. */
export function NumberedSteps({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <ol className="ui-numbered-steps flex list-none flex-col gap-section-gap p-0 m-0">
      {children}
    </ol>
  );
}

/** One step, `number` in its well, `title` beside it, and what it needs (`children`) under the title. */
export function NumberedStep({
  number,
  title,
  children,
}: {
  /** Its place in the list, drawn in the well; a reader hears the list's own. */
  number: number;
  title: ReactNode;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <li className="ui-numbered-step flex items-start gap-control-gap">
      <span className={NUMBER} aria-hidden="true">
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-control-gap">
        <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.LABEL}>
          {title}
        </Text>
        {children}
      </div>
    </li>
  );
}
