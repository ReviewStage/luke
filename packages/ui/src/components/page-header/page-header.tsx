import type { ReactNode } from "react";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

export const PAGE_HEADER_END = {
  BOX: "box",
  WORDS: "words",
} as const;

export type PageHeaderEnd = (typeof PAGE_HEADER_END)[keyof typeof PAGE_HEADER_END];

function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

export function PageHeader({
  title,
  titleId,
  description,
  actions,
  end = PAGE_HEADER_END.BOX,
}: {
  title: ReactNode;
  titleId?: string | undefined;
  description?: ReactNode;
  actions?: ReactNode;
  end?: PageHeaderEnd | undefined;
}): React.JSX.Element {
  return (
    <header className="ui-page-header" data-end={end}>
      <div className="ui-page-header-heading">
        <Text variant={TEXT_VARIANT.TITLE} as={TEXT_ELEMENT.H1} id={titleId}>
          {title}
        </Text>
        {said(description) ? <Text tone={TEXT_TONE.MUTED}>{description}</Text> : null}
      </div>
      {said(actions) ? <div className="ui-page-header-actions">{actions}</div> : null}
    </header>
  );
}
