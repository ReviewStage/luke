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
 *
 * The content is on the site's reading column, or on a wider one for a page
 * that sets a rail beside its words, as the changelog does; the banner and
 * the footer keep to the reading column either way. A page beneath another
 * names its way back above its title. Its sections stand apart by room, or
 * under a rule across the column each, as a list of entries does; a picture
 * or a recording may bleed wider than the column, as the landing's does.
 */

/** How a page's title is set: the profile's page title, or the landing's display hero. */
export const PUBLIC_TITLE = {
  PAGE: "page",
  HERO: "hero",
} as const;

export type PublicTitle = (typeof PUBLIC_TITLE)[keyof typeof PUBLIC_TITLE];

/** How wide a page's content runs: the site's reading column, or wide enough for a rail beside it. */
export const PUBLIC_PAGE_WIDTH = {
  COLUMN: "column",
  WIDE: "wide",
} as const;

export type PublicPageWidth = (typeof PUBLIC_PAGE_WIDTH)[keyof typeof PUBLIC_PAGE_WIDTH];

/** How a page's sections stand apart: by room alone, or each under a rule across the column. */
export const PUBLIC_SECTIONS = {
  SPACED: "spaced",
  RULED: "ruled",
} as const;

export type PublicSections = (typeof PUBLIC_SECTIONS)[keyof typeof PUBLIC_SECTIONS];

/** The page a page stands beneath, which its way back opens. */
export type PublicBack = {
  readonly href: string;
  /** What the page is called, read after the way back's arrow. */
  readonly label: string;
};

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

/**
 * A picture or a recording standing wider than the column, up to the page's
 * bleed and centred on the page, under a hairline frame. It measures the
 * page's own width (`cqw`, read off the page's container) rather than the
 * viewport's, which would count a classic scrollbar's gutter, and keeps the
 * page's inset from either edge, so on a phone it lines up with the words.
 */
export function PublicMedia({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="luke-public-media">{children}</div>;
}

/**
 * The site's banner, standing still at the top of the document's scroll:
 * `children` on the page's column, over a wash of the ground across the page.
 */
function PublicBanner({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <header className="luke-public-page-banner">
      <div className="luke-public-page-column luke-public-page-banner-column">{children}</div>
    </header>
  );
}

/** The site's footer: `children` on the page's column, under a rule across the page. */
function PublicFooter({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <footer className="luke-public-page-footer">
      <div className="luke-public-page-column luke-public-page-footer-column">{children}</div>
    </footer>
  );
}

/** A public page: `banner` over the way `back`, the `title`, `lead`, and sections, over `footer`. */
export function PublicPage({
  banner,
  footer,
  back,
  title,
  titleStyle = PUBLIC_TITLE.PAGE,
  width = PUBLIC_PAGE_WIDTH.COLUMN,
  sections = PUBLIC_SECTIONS.SPACED,
  lead,
  children,
}: {
  /** The site's wordmark and navigation, laid on the column inside the banner. */
  banner?: ReactNode;
  /** The site's closing links and notices, laid on the column under the rule. */
  footer?: ReactNode;
  /** The page this one stands beneath, named above the title as the way back to it. */
  back?: PublicBack | undefined;
  /** What the page is, as its `h1`; a page whose content brings its own leaves it out. */
  title?: ReactNode;
  titleStyle?: PublicTitle;
  width?: PublicPageWidth;
  sections?: PublicSections;
  /** A sentence or two under the title on what the page is for, or opening a page whose content brings its title. */
  lead?: ReactNode;
  /** The page's sections, or the content of a page that is one; a title alone may leave it out. */
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="luke-public-page">
      {said(banner) ? <PublicBanner>{banner}</PublicBanner> : null}
      <main className="luke-public-page-column luke-public-page-main" data-width={width}>
        {back !== undefined || said(title) || said(lead) ? (
          <div className="luke-public-page-intro">
            {back !== undefined ? (
              <a className="luke-public-page-back" href={back.href}>
                <span aria-hidden="true">← </span>
                {back.label}
              </a>
            ) : null}
            {said(title) ? (
              <h1 className="luke-public-page-title" data-style={titleStyle}>
                {title}
              </h1>
            ) : null}
            {said(lead) ? <p className="luke-public-page-lead">{lead}</p> : null}
          </div>
        ) : null}
        {said(children) ? (
          <div className="luke-public-page-sections" data-sections={sections}>
            {children}
          </div>
        ) : null}
      </main>
      {said(footer) ? <PublicFooter>{footer}</PublicFooter> : null}
    </div>
  );
}
