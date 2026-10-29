import type { ReactNode } from "react";
import { COMBOBOX_HEADING } from "../../shadcn/combobox.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * menu-section.tsx -- one headed run of a menu's or a popover's rows: the group heading ⌘K and the searchable menus head theirs with, a count at its right end, and a hairline over every section but the first.
 *
 * The heading is the group role's type (`TEXT_VARIANT.GROUP`) at the
 * combobox heading's inset, decoration a reader is not told, since the list
 * under it is named by the same words. A count, such as "21 tools" or
 * "3 of 5 on", stands at the heading's right end in the muted caption's
 * tabular figures. A section after another draws the hairline a popover's
 * foot stands under, across the whole width of the menu's inset, so a menu of
 * several sections reads as one set of bands; the first draws none.
 */

/** A section's head and its rows: `heading` over `children`, `count` at the head's end. */
export function MenuSection({
  heading,
  count,
  children,
}: {
  /** The section's name, which the list of its rows is named by as well. */
  heading: string;
  /** What the section counts, said at the head's right end; nothing is said where it is left out. */
  count?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="luke-menu-section -mx-menu-inset px-menu-inset not-first:mt-menu-inset not-first:border-t not-first:border-border">
      <div
        className={`luke-menu-section-head flex items-baseline gap-icon-gap ${COMBOBOX_HEADING}`}
        aria-hidden="true"
      >
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.GROUP}>
          {heading}
        </Text>
        {count === undefined ? null : (
          <span className="luke-menu-section-count ml-auto whitespace-nowrap text-caption-inline text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}
