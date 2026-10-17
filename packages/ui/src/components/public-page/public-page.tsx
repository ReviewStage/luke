import { type ReactNode, useId } from "react";

/**
 * public-page.tsx -- the page the public site is drawn on: the site's banner, the page's title and lead, its sections, and the site's footer, all on one column.
 *
 * The page owns the site's gutters and its rhythm. The banner, the content,
 * and the footer share one measure centred in the room, each inset by the
 * web profile's page inset, so the wordmark, a title, a section's words, and
 * a footer link start on one edge at every width. The banner stands still at
 * the top of the document's scroll over a wash of the ground, and the footer
 * opens under a rule across the page; their contents are the caller's. The
 * page sets no scroll of its own, because a public page is read in the
 * document's, which is what a prerendered page and a browser's find and
 * anchor links expect.
 *
 * The title is set in the profile's page title, or in the landing's hero,
 * which is the site's marketing display style and named apart from it; the
 * lead under either is the landing's. Sections follow at one rhythm, each
 * under an `h2` in the section role. The page takes no class or style.
 */

/** How a page's title is set: the profile's page title, or the landing's display hero. */
export const PUBLIC_TITLE = {
  PAGE: "page",
  HERO: "hero",
} as const;

export type PublicTitle = (typeof PUBLIC_TITLE)[keyof typeof PUBLIC_TITLE];

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/** One section of a public page: `children` under an optional `title`, at the page's rhythm. */
export function PublicSection({
  title,
  children,
}: {
  /** What the section is about, which names it. */
  title?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  const titleId = `${useId()}title`;
  const titled = said(title);
  return (
    <section className="luke-public-section" aria-labelledby={titled ? titleId : undefined}>
      {titled ? (
        <h2 className="luke-public-section-title" id={titleId}>
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

/** A public page: `banner` over the `title`, `lead`, and sections, over `footer`. */
export function PublicPage({
  banner,
  footer,
  title,
  titleStyle = PUBLIC_TITLE.PAGE,
  lead,
  children,
}: {
  /** The site's wordmark and navigation, laid on the column inside the banner. */
  banner?: ReactNode;
  /** The site's closing links and notices, laid on the column under the rule. */
  footer?: ReactNode;
  /** What the page is, as its `h1`; a page whose content brings its own leaves it out. */
  title?: ReactNode;
  titleStyle?: PublicTitle;
  /** A sentence or two under the title on what the page is for. */
  lead?: ReactNode;
  /** The page's sections, or the content of a page that is one. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="luke-public-page">
      {said(banner) ? (
        <header className="luke-public-page-banner">
          <div className="luke-public-page-column luke-public-page-banner-column">{banner}</div>
        </header>
      ) : null}
      <main className="luke-public-page-column luke-public-page-main">
        {said(title) ? (
          <div className="luke-public-page-intro">
            <h1 className="luke-public-page-title" data-style={titleStyle}>
              {title}
            </h1>
            {said(lead) ? <p className="luke-public-page-lead">{lead}</p> : null}
          </div>
        ) : null}
        <div className="luke-public-page-sections">{children}</div>
      </main>
      {said(footer) ? (
        <footer className="luke-public-page-footer">
          <div className="luke-public-page-column luke-public-page-footer-column">{footer}</div>
        </footer>
      ) : null}
    </div>
  );
}
