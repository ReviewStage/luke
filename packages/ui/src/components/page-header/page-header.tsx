import type { ReactNode } from "react";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * page-header.tsx -- a document's own header in the page: its title, the page's one `h1`, a line saying what it is, and the page's acts at the title's end.
 *
 * A document (the plan, Settings, a person, an automation being edited) is
 * named once, in the page, by this header; a workspace (Inbox, Tasks)
 * is named by the window's top bar instead and draws none. `DetailPage`,
 * `CollectionPage`, and `SettingsPage` each head themselves with it, so a
 * title opens, sizes, and wraps one way on every document, and a page never
 * draws a second `h1` of its own.
 *
 * The acts are centred on the title's first line, whatever a control's
 * height is beside the title's leading. They share the title's line while
 * the title keeps a least width beside them, a long title wrapping inside
 * its column rather than sending them to a row of their own; where not even
 * that fits they wrap under it, and wrap among themselves past the line's
 * width, so no act stands outside the page. A
 * quiet act (Settings' Reset) ends with its words on the content's edge
 * rather than its hover's pill (`PAGE_HEADER_END.WORDS`).
 *
 * The header owns no room around itself: the page it stands on places it,
 * at the page's inset and measure. It takes no class or style.
 */

/** Where the acts end: their boxes on the content's edge, or a quiet act's words. */
export const PAGE_HEADER_END = {
  BOX: "box",
  WORDS: "words",
} as const;

export type PageHeaderEnd = (typeof PAGE_HEADER_END)[keyof typeof PAGE_HEADER_END];

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/** A document's header: `title` as the page's `h1`, `description` under it, and `actions` at its end. */
export function PageHeader({
  title,
  titleId,
  description,
  actions,
  end = PAGE_HEADER_END.BOX,
}: {
  /** What the page shows, which names it: the page's one `h1`. */
  title: ReactNode;
  /** The id the title stands under, for the page's region to name itself by. */
  titleId?: string | undefined;
  /** A line saying what the page is, under the title. */
  description?: ReactNode;
  /** The page's own acts, at the end of the title's line. */
  actions?: ReactNode;
  /** Where the acts end; their boxes on the content's edge where left out. */
  end?: PageHeaderEnd | undefined;
}): React.JSX.Element {
  return (
    <header className="luke-page-header" data-end={end}>
      <div className="luke-page-header-heading">
        <Text variant={TEXT_VARIANT.TITLE} as={TEXT_ELEMENT.H1} id={titleId}>
          {title}
        </Text>
        {said(description) ? <Text tone={TEXT_TONE.MUTED}>{description}</Text> : null}
      </div>
      {said(actions) ? <div className="luke-page-header-actions">{actions}</div> : null}
    </header>
  );
}
