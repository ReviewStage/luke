import type { ReactNode } from "react";
import { COMBOBOX_HEADING } from "../../shadcn/combobox.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";

export function MenuSection({
  heading,
  count,
  children,
}: {
  heading: string;
  count?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="ui-menu-section -mx-menu-inset px-menu-inset not-first:mt-menu-inset not-first:border-t not-first:border-border">
      <div
        className={`ui-menu-section-head flex items-baseline gap-icon-gap ${COMBOBOX_HEADING}`}
        aria-hidden="true"
      >
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.GROUP}>
          {heading}
        </Text>
        {count === undefined ? null : (
          <span className="ui-menu-section-count ml-auto whitespace-nowrap text-caption-inline text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}
