import { type ReactNode, useId } from "react";
import { TEXT_VARIANT } from "../text/text.js";
import { SiteFrame, SiteRule } from "../landing/site-frame.js";
import { TextLink } from "../text-link/text-link.js";

export const PUBLIC_TITLE = {
  PAGE: "page",
  HERO: "hero",
} as const;

export type PublicTitle = (typeof PUBLIC_TITLE)[keyof typeof PUBLIC_TITLE];

export const PUBLIC_PAGE_WIDTH = {
  COLUMN: "column",
  WIDE: "wide",
} as const;

export type PublicPageWidth = (typeof PUBLIC_PAGE_WIDTH)[keyof typeof PUBLIC_PAGE_WIDTH];

export const PUBLIC_SECTIONS = {
  SPACED: "spaced",
  RULED: "ruled",
} as const;

export type PublicSections = (typeof PUBLIC_SECTIONS)[keyof typeof PUBLIC_SECTIONS];

export type PublicBack = {
  readonly href: string;
  readonly label: string;
};

const WIDTH_CLASS = {
  [PUBLIC_PAGE_WIDTH.COLUMN]: "max-w-public-page",
  [PUBLIC_PAGE_WIDTH.WIDE]: "max-w-public-page-wide",
} as const satisfies Record<PublicPageWidth, string>;

const COLUMN_CLASS = "ui-public-page-column box-border w-full mx-auto px-page-inset";

const TITLE_CLASS = {
  [PUBLIC_TITLE.PAGE]: "",
  [PUBLIC_TITLE.HERO]: "leading-public-page-hero font-public-page-hero tracking-public-page-hero",
} as const satisfies Record<PublicTitle, string>;

const SECTIONS_GAP_CLASS = {
  [PUBLIC_SECTIONS.SPACED]: "mt-ui-32",
  [PUBLIC_SECTIONS.RULED]: "mt-ui-40",
} as const satisfies Record<PublicSections, string>;

function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

export function PublicSection({
  title,
  children,
}: {
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

export function PublicMedia({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="ui-public-media mx-public-media-reach [*+&]:mt-ui-48 overflow-hidden border border-border rounded-public-media shadow-public-media">
      {children}
    </div>
  );
}

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
  banner?: ReactNode;
  bannerCall?: ReactNode;
  footer?: ReactNode;
  back?: PublicBack | undefined;
  title?: ReactNode;
  titleStyle?: PublicTitle;
  width?: PublicPageWidth;
  sections?: PublicSections;
  lead?: ReactNode;
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
