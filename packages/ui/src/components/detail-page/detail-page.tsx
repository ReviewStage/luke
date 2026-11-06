import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { PAGE_FRAME, PAGE_WIDTH, type PageHeading } from "../page-frame/page-frame.js";
import { type PageScroll, PageScrollContext } from "../page-frame/page-scroll.js";
import { useHeadingAway } from "../page-header/heading-away.js";
import { PageHeader } from "../page-header/page-header.js";
import { Toolbar, type ToolbarPickUp } from "../toolbar/toolbar.js";

export const DETAIL_PAGE_INSET = {
  PAGE: "page",
  READING: "reading",
} as const;

export type DetailPageInset = (typeof DETAIL_PAGE_INSET)[keyof typeof DETAIL_PAGE_INSET];

const COLUMN_CLASS =
  "box-border min-w-0 min-h-0 overscroll-contain scrollbar-gutter-stable outline-offset-[var(--ui-focus-ring-inset)]";

const CONTENT_CLASS = "pb-detail-page-end wrap-anywhere";

export type DetailSecondary = {
  label: string;
  content: ReactNode;
};

export function DetailPage({
  secondary,
  inset = DETAIL_PAGE_INSET.PAGE,
  onPickUp,
  children,
  ...heading
}: PageHeading & {
  secondary?: DetailSecondary | undefined;
  onPickUp?: ((pickUp: ToolbarPickUp) => void) | undefined;
  inset?: DetailPageInset | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const titleId = `${useId()}title`;
  const body = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const named = useHeadingAway(body, header);
  const main = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLElement>(null);
  const mainContent = useRef<HTMLDivElement>(null);
  const sideContent = useRef<HTMLDivElement>(null);
  const [mainScroll] = useState((): PageScroll => ({ scroller: main, shiftedBy: mainContent }));
  const [sideScroll] = useState((): PageScroll => ({ scroller: side, shiftedBy: sideContent }));
  const underToolbar = heading.frame === PAGE_FRAME.TOOLBAR;
  const barOutside = !underToolbar && onPickUp !== undefined;
  useEffect(() => {
    onPickUp?.({ name: named.name, shown: named.away });
  }, [onPickUp, named.name, named.away]);
  return (
    <section
      className="ui-detail-page @container flex flex-1 flex-col min-w-0 h-full min-h-0 text-foreground font-ui text-body"
      data-frame={heading.frame}
      data-width={heading.width ?? PAGE_WIDTH.MEASURE}
      data-inset={inset}
      aria-labelledby={underToolbar ? undefined : titleId}
      aria-label={underToolbar ? heading.label : undefined}
    >
      {underToolbar ? (
        heading.toolbar
      ) : barOutside ? null : (
        <Toolbar pickUp={{ name: named.name, shown: named.away }} />
      )}
      <div ref={body} className="ui-detail-page-body flex-1 min-h-0">
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a column scrolls on its own, and a column of words holds nothing else a keyboard could reach to scroll it by. */}
        <div ref={main} className={`ui-detail-page-main ${COLUMN_CLASS}`} tabIndex={0}>
          {underToolbar ? null : (
            <div
              ref={header}
              className="ui-detail-page-header pt-detail-page-inset pb-section-gap room-narrow:pt-title-under-bar"
            >
              <PageHeader
                title={heading.title}
                titleId={titleId}
                description={heading.description}
                actions={heading.actions}
              />
            </div>
          )}
          <div ref={mainContent} className={`ui-detail-page-content ${CONTENT_CLASS}`}>
            <PageScrollContext value={mainScroll}>{children}</PageScrollContext>
          </div>
        </div>
        {secondary === undefined ? null : (
          <aside
            ref={side}
            className={`ui-detail-page-secondary ${COLUMN_CLASS}`}
            aria-label={secondary.label}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: it scrolls on its own, as the main column does.
            tabIndex={0}
          >
            <div ref={sideContent} className={`ui-detail-page-content ${CONTENT_CLASS}`}>
              <PageScrollContext value={sideScroll}>{secondary.content}</PageScrollContext>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
