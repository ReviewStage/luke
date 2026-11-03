import { type ReactNode, useId } from "react";
import { TEXT_VARIANT } from "../text/text.js";
import { SiteFrame, SiteRule } from "../landing/site-frame.js";
import { TextLink } from "../text-link/text-link.js";

/**
 * public-page.tsx -- the page the public site is drawn on: the page's title and lead and its sections on one column, in the site's frame with the landing.
 *
 * The page stands in the site's frame (`site-frame.tsx`), as the landing
 * does: the margin grid's rails, the bar that floats once the page scrolls
 * holding the caller's banner and its call, and the foot holding the
 * caller's footer over the wordmark in dots, a rule across the rails above
 * it. Its content is on one measure centred in the room, inset by the web
 * profile's page inset. The page sets no scroll of its own, because a
 * public page is read in the document's, which is what a prerendered page
 * and a browser's find and anchor links expect.
 *
 * The title is set in the landing's display face at a feature's size, or in
 * its hero; the lead under either is the landing's. Sections follow at one rhythm, each
 * under an `h2` in the section role. The page takes no class or style.
 *
 * The content is on the site's reading column, or on a wider one for a page
 * that sets a rail beside its words, as the changelog does. A page beneath another
 * names its way back above its title. Its sections stand apart by room, or
 * under a rule across the column each, as a list of entries does; a picture
 * or a recording may bleed wider than the column, as the landing's does.
 *
 * It is drawn in Tailwind utilities over the theme, with no shadcn/ui base,
 * since shadcn has no page frame. Its sheet (`public-page.css`) keeps the
 * page's rhythm, which its own width steps (a container query), the hero's
 * size, which steps the same way, the sections' spacing, which a ruled
 * list undoes, and the fit of what a caller hands its media.
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

/** Each content width's measure; the banner and the footer keep the reading column's. */
const WIDTH_CLASS = {
  [PUBLIC_PAGE_WIDTH.COLUMN]: "max-w-public-page",
  [PUBLIC_PAGE_WIDTH.WIDE]: "max-w-public-page-wide",
} as const satisfies Record<PublicPageWidth, string>;

/** A column: the measure centred in the room, inset by the page's gutter, so all three open on one edge. */
const COLUMN_CLASS = "ui-public-page-column box-border w-full mx-auto px-page-inset";

/**
 * Each title's type: the profile's page title, or the landing's display
 * hero, whose size is the sheet's, since it steps down in a narrow page.
 * Note that the window has no display type, so on the desktop profile the
 * hero falls back to the page title.
 */
const TITLE_CLASS = {
  [PUBLIC_TITLE.PAGE]: "",
  [PUBLIC_TITLE.HERO]: "leading-public-page-hero font-public-page-hero tracking-public-page-hero",
} as const satisfies Record<PublicTitle, string>;

/**
 * How far under the intro the sections open: by a step, or, ruled, a step
 * further, so the first rule reads as the list's top edge rather than the
 * intro's underline.
 */
const SECTIONS_GAP_CLASS = {
  [PUBLIC_SECTIONS.SPACED]: "mt-ui-32",
  [PUBLIC_SECTIONS.RULED]: "mt-ui-40",
} as const satisfies Record<PublicSections, string>;

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
    <section className="ui-public-section" aria-labelledby={titled ? titleId : undefined}>
      {titled ? (
        <h2
          className="ui-public-section-title m-0 mb-section-gap text-section font-section"
          id={titleId}
        >
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
  return (
    <div className="ui-public-media mx-public-media-reach [*+&]:mt-ui-48 overflow-hidden border border-border rounded-public-media shadow-public-media">
      {children}
    </div>
  );
}

/** A public page: `banner` over the way `back`, the `title`, `lead`, and sections, over `footer`. */
export function PublicPage({
  banner,
  bannerCall,
  footer,
  back,
  title,
  titleStyle = PUBLIC_TITLE.PAGE,
  width = PUBLIC_PAGE_WIDTH.COLUMN,
  sections = PUBLIC_SECTIONS.SPACED,
  lead,
  children,
}: {
  /** The site's wordmark and navigation, laid across the site's bar. */
  banner?: ReactNode;
  /** The bar's call at its end, which a page narrower than a phone's leaves out. */
  bannerCall?: ReactNode;
  /** The site's closing links and notices, laid over the wordmark at the foot. */
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
  const intro = back !== undefined || said(title) || said(lead);
  return (
    <SiteFrame bar={banner} barCall={bannerCall} footer={footer}>
      <div className="ui-public-page @container flex flex-col min-w-0 text-foreground font-ui">
        <main
          className={`${COLUMN_CLASS} ${WIDTH_CLASS[width]} ui-public-page-main flex-1 pt-public-page-start pb-public-page-end wrap-anywhere`}
          data-width={width}
        >
          {intro ? (
            <div className="ui-public-page-intro">
              {back !== undefined ? (
                <div className="ui-public-page-back mb-ui-16">
                  <TextLink href={back.href} variant={TEXT_VARIANT.LABEL}>
                    <span aria-hidden="true">← </span>
                    {back.label}
                  </TextLink>
                </div>
              ) : null}
              {said(title) ? (
                <h1
                  className={`ui-public-page-title m-0 text-pretty ${TITLE_CLASS[titleStyle]}`}
                  data-style={titleStyle}
                >
                  {title}
                </h1>
              ) : null}
              {said(lead) ? (
                <p
                  className={`ui-public-page-lead m-0 ${said(title) ? "mt-ui-24" : ""} max-w-public-page-lead text-muted-foreground text-public-page-lead text-pretty`}
                >
                  {lead}
                </p>
              ) : null}
            </div>
          ) : null}
          {said(children) ? (
            <div
              className={`ui-public-page-sections ${intro ? SECTIONS_GAP_CLASS[sections] : ""}`}
              data-sections={sections}
            >
              {children}
            </div>
          ) : null}
        </main>
      </div>
      <SiteRule />
    </SiteFrame>
  );
}
