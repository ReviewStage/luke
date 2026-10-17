import { type ReactNode, useId } from "react";

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
 * secondary column follows the main content in the one scroll.
 *
 * The secondary column is a complementary landmark named by its `label`.
 * The page names itself by its title and takes no class or style.
 */

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

/** One thing's page: `title` and `actions` over the main content and an optional `secondary` column. */
export function DetailPage({
  title,
  description,
  actions,
  secondary,
  children,
}: {
  /** What the thing is called, which names the page. */
  title: ReactNode;
  description?: ReactNode;
  /** The page's own acts at the header's end (a Button to edit, a menu of the rest). */
  actions?: ReactNode;
  secondary?: DetailSecondary | undefined;
  /** The main content (sections, a document, a transcript). */
  children: ReactNode;
}): React.JSX.Element {
  const titleId = `${useId()}title`;
  return (
    <section className="luke-detail-page" aria-labelledby={titleId}>
      <div className="luke-detail-page-top">
        <header className="luke-detail-page-header">
          <div className="luke-detail-page-heading">
            <h1 className="luke-detail-page-title" id={titleId}>
              {title}
            </h1>
            {said(description) ? (
              <p className="luke-detail-page-description">{description}</p>
            ) : null}
          </div>
          {said(actions) ? <div className="luke-detail-page-actions">{actions}</div> : null}
        </header>
      </div>
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
