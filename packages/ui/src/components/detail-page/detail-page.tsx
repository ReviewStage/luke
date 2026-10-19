import { type ReactNode, useId } from "react";
import { PAGE_FRAME, PAGE_WIDTH, type PageHeading } from "../page-frame/page-frame.js";

/**
 * detail-page.tsx -- the page one thing is drawn on: its title and acts, its main content, and an optional secondary column beside it.
 *
 * The page owns its widths and its scrolls: the header stands still over
 * the content, and the main content and the secondary column each scroll
 * on their own, so reading far down one leaves the other where it was. The
 * header and the columns under it share one measure centred in the room,
 * the same as a collection's page, so a title opens on the main content's
 * edge and the header's acts end on the secondary column's. Each scroll
 * reaches the page's edge on its own side, so the wheel works anywhere
 * over the column it moves. In a pane too narrow for two columns, the
 * secondary column follows the main content in the one scroll. A main
 * content that is only an `EmptyState` (or a centred `ErrorState`, where the
 * thing could not be read) stands it a little above the room's middle, as a
 * collection's page stands its empty and failed states.
 *
 * Under the window's toolbar (`PAGE_FRAME.TOOLBAR`) the page draws no
 * header: the toolbar stands still above the columns, and the page is named
 * by the toolbar's title. Content that scrolls sideways stands across the
 * whole room (`PAGE_WIDTH.FULL`) rather than at the measure. A page in a
 * narrow column under rows that stand at a column's inset, as a side
 * panel's tabs do (`CHOICE_BAR_INSET.READING`), stands its words with theirs
 * (`DETAIL_PAGE_INSET.READING`) rather than a page's inset in from them. A
 * `List` laid straight into the content, or straight under one of its
 * sections, reaches past the column by its rows' own inset, as on a
 * collection's page, so its words line up with the title's.
 *
 * The secondary column is a complementary landmark named by its `label`.
 * The page names itself by its title and takes no class or style.
 */

/** How far in from its sides the page stands its words: a page's inset, or a column's, as tabs read at the measure stand theirs. */
export const DETAIL_PAGE_INSET = {
  PAGE: "page",
  READING: "reading",
} as const;

export type DetailPageInset = (typeof DETAIL_PAGE_INSET)[keyof typeof DETAIL_PAGE_INSET];

/** What stands beside the main content: facts about the thing, its people, its history. */
export type DetailSecondary = {
  /** What the column is, said to a reader as the landmark's name. */
  label: string;
  content: ReactNode;
};

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/** One thing's page: its heading over the main content and an optional `secondary` column. */
export function DetailPage({
  secondary,
  inset = DETAIL_PAGE_INSET.PAGE,
  children,
  ...heading
}: PageHeading & {
  secondary?: DetailSecondary | undefined;
  /** How far in from its sides the words stand; a page's inset where left out. */
  inset?: DetailPageInset | undefined;
  /** The main content (sections, a document, a transcript). */
  children: ReactNode;
}): React.JSX.Element {
  const titleId = `${useId()}title`;
  const underToolbar = heading.frame === PAGE_FRAME.TOOLBAR;
  return (
    <section
      className="luke-detail-page"
      data-frame={heading.frame ?? PAGE_FRAME.PAGE}
      data-width={heading.width ?? PAGE_WIDTH.MEASURE}
      data-inset={inset}
      aria-labelledby={underToolbar ? undefined : titleId}
      aria-label={underToolbar ? heading.label : undefined}
    >
      {underToolbar ? (
        heading.toolbar
      ) : (
        <div className="luke-detail-page-top">
          <header className="luke-detail-page-header">
            <div className="luke-detail-page-heading">
              <h1 className="luke-detail-page-title" id={titleId}>
                {heading.title}
              </h1>
              {said(heading.description) ? (
                <p className="luke-detail-page-description">{heading.description}</p>
              ) : null}
            </div>
            {said(heading.actions) ? (
              <div className="luke-detail-page-actions">{heading.actions}</div>
            ) : null}
          </header>
        </div>
      )}
      <div className="luke-detail-page-body">
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a column scrolls on its own, and a column of words holds nothing else a keyboard could reach to scroll it by. */}
        <div className="luke-detail-page-main" tabIndex={0}>
          <div className="luke-detail-page-content">{children}</div>
        </div>
        {secondary === undefined ? null : (
          // biome-ignore lint/a11y/noNoninteractiveTabindex: it scrolls on its own, as the main column does.
          <aside className="luke-detail-page-secondary" aria-label={secondary.label} tabIndex={0}>
            <div className="luke-detail-page-content">{secondary.content}</div>
          </aside>
        )}
      </div>
    </section>
  );
}
