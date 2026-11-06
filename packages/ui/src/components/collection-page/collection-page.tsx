import { type ReactNode, type Ref, useCallback, useId, useRef, useState } from "react";
import {
  PAGE_FRAME,
  PAGE_WIDTH,
  type PageHeading,
  type PageWidth,
} from "../page-frame/page-frame.js";
import { type PageScroll, PageScrollContext } from "../page-frame/page-scroll.js";
import { PageHeader } from "../page-header/page-header.js";
import { SKELETON_SHAPE, Skeleton, SkeletonRegion } from "../skeleton/skeleton.js";

export const COLLECTION_STATE = {
  LOADING: "loading",
  EMPTY: "empty",
  ERROR: "error",
  READY: "ready",
} as const;

export type CollectionState = (typeof COLLECTION_STATE)[keyof typeof COLLECTION_STATE];

const LOADING_ROWS = 4;

const COLUMN_CLASS = "box-border w-full mx-auto px-collection-page-inset";

const WIDTH_CLASS = {
  [PAGE_WIDTH.MEASURE]: {
    measure: "max-w-collection-page",
    content: "flex-[1_0_auto] pb-collection-page-inset",
    scroll: "overflow-x-hidden",
  },
  [PAGE_WIDTH.FULL]: {
    measure: "max-w-none",
    content:
      "flex-[1_1_0] min-h-0 after:flex-none after:h-collection-page-inset after:content-['']",
    scroll: "overflow-x-auto",
  },
} as const satisfies Record<PageWidth, { measure: string; content: string; scroll: string }>;

const TOP_CLASS =
  "flex-none box-border max-h-1/2 overflow-x-hidden overflow-y-auto scrollbar-gutter-stable pb-section-gap";

const NOTICE_CLASS = "flex flex-1 flex-col items-center text-center";

function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

function CollectionPageRowsSkeleton(): React.JSX.Element {
  return (
    <div className="ui-collection-page-skeleton">
      {Array.from({ length: LOADING_ROWS }, (_, row) => (
        <div key={row} className="ui-collection-page-skeleton-row">
          <span className="ui-collection-page-skeleton-title">
            <Skeleton shape={SKELETON_SHAPE.LINE} width="40%" />
          </span>
          <span className="ui-collection-page-skeleton-description">
            <Skeleton shape={SKELETON_SHAPE.LINE} width="65%" />
          </span>
        </div>
      ))}
    </div>
  );
}

function CollectionPageSkeleton({
  label,
  skeleton,
}: {
  label: string;
  skeleton: ReactNode;
}): React.JSX.Element {
  return (
    <SkeletonRegion label={label}>{skeleton ?? <CollectionPageRowsSkeleton />}</SkeletonRegion>
  );
}

export function CollectionPage({
  filters,
  state,
  loadingLabel,
  skeleton,
  empty,
  error,
  children,
  scrollRef,
  ...heading
}: PageHeading & {
  filters?: ReactNode;
  state: CollectionState;
  loadingLabel: string;
  skeleton?: ReactNode;
  empty?: ReactNode;
  error?: ReactNode;
  children?: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
}): React.JSX.Element {
  const titleId = `${useId()}title`;
  const scroll = useRef<HTMLDivElement | null>(null);
  const holdScroll = useCallback(
    (element: HTMLDivElement | null) => {
      scroll.current = element;
      if (typeof scrollRef === "function") scrollRef(element);
      else if (scrollRef !== undefined && scrollRef !== null) scrollRef.current = element;
    },
    [scrollRef],
  );
  const content = useRef<HTMLDivElement>(null);
  const [pageScroll] = useState((): PageScroll => ({ scroller: scroll, shiftedBy: content }));
  const underToolbar = heading.frame === PAGE_FRAME.TOOLBAR;
  const width = heading.width ?? PAGE_WIDTH.MEASURE;
  const sized = WIDTH_CLASS[width];
  const filterLine = said(filters) ? (
    <div
      className={`ui-collection-page-filters ${COLUMN_CLASS} ${sized.measure} flex-wrap items-center gap-control-gap pt-section-gap`}
    >
      {filters}
    </div>
  ) : null;
  const toolbarGap = underToolbar && filterLine === null ? "pt-section-gap" : "";
  return (
    <section
      className="ui-collection-page @container flex flex-1 flex-col min-w-0 h-full min-h-0 text-foreground font-ui text-body"
      data-frame={heading.frame}
      data-width={width}
      aria-labelledby={underToolbar ? undefined : titleId}
      aria-label={underToolbar ? heading.label : undefined}
    >
      {underToolbar ? (
        <>
          {heading.toolbar}
          {filterLine === null ? null : (
            <div className={`ui-collection-page-top ${TOP_CLASS}`}>{filterLine}</div>
          )}
        </>
      ) : (
        <div className={`ui-collection-page-top ${TOP_CLASS}`}>
          <div
            className={`ui-collection-page-header ${COLUMN_CLASS} ${sized.measure} pt-collection-page-inset`}
          >
            <PageHeader
              title={heading.title}
              titleId={titleId}
              description={heading.description}
              actions={heading.actions}
            />
          </div>
          {filterLine}
        </div>
      )}
      <div
        className={`ui-collection-page-scroll flex flex-1 flex-col min-h-0 ${sized.scroll} overflow-y-auto overscroll-contain scrollbar-gutter-stable`}
        ref={holdScroll}
      >
        <div
          ref={content}
          className={`ui-collection-page-content ${COLUMN_CLASS} ${sized.measure} flex flex-col ${sized.content} ${toolbarGap}`}
        >
          {state === COLLECTION_STATE.LOADING ? (
            <CollectionPageSkeleton label={loadingLabel} skeleton={skeleton} />
          ) : null}
          {state === COLLECTION_STATE.EMPTY ? (
            <div className={`ui-collection-page-notice ${NOTICE_CLASS}`}>{empty}</div>
          ) : null}
          {state === COLLECTION_STATE.ERROR ? (
            <div className={`ui-collection-page-notice ${NOTICE_CLASS}`}>{error}</div>
          ) : null}
          {state === COLLECTION_STATE.READY ? (
            <PageScrollContext value={pageScroll}>{children}</PageScrollContext>
          ) : null}
        </div>
      </div>
    </section>
  );
}
