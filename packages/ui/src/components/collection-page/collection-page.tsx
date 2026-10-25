import { type ReactNode, type Ref, useId } from "react";
import {
  PAGE_FRAME,
  PAGE_WIDTH,
  type PageHeading,
  type PageWidth,
} from "../page-frame/page-frame.js";
import { PageHeader } from "../page-header/page-header.js";
import { SKELETON_SHAPE, Skeleton, SkeletonRegion } from "../skeleton/skeleton.js";

/**
 * collection-page.tsx -- the page a collection is drawn on: its title and acts, the filters under them, and the collection itself, or what stands in its place while it is read, empty, or failed.
 *
 * The page owns its widths and its one scroll: the header and the filters
 * stand still over a content column that scrolls beneath them, all three at
 * one measure centred in the room, so a title, a filter, and a row's title
 * start on one edge. A `List` laid straight into the content reaches past
 * that edge by its rows' own inset, so its words line up with the title's
 * and its fill runs out to either side. Each state of the content opens at
 * the same place under the filters: a read in progress stands the
 * caller's own skeleton of what will land, or rows of blocks where the rows
 * will be, and the empty and failed states stand a little above the room's
 * middle, so swapping one state for another moves
 * nothing above it.
 *
 * Under the window's toolbar (`PAGE_FRAME.TOOLBAR`) the page draws no
 * header: the toolbar stands still above the filters, and the page is named
 * by the toolbar's title. A board that scrolls sideways stands its content
 * across the whole room (`PAGE_WIDTH.FULL`) rather than at the measure.
 *
 * The page heads itself with a document's header (`PageHeader`), its title
 * the page's one `h1`. The empty and failed states are the caller's, handed in whole, since an
 * empty collection says what to do about it and a failed one how to retry.
 * The page names itself by its title and takes no class or style.
 *
 * It is drawn in Tailwind utilities over the theme, with no shadcn/ui base,
 * since shadcn has no page frame; what the frame and the width ask of each
 * part is picked here. Its sheet (`collection-page.css`) keeps the page's
 * measure and inset, which its profile and its own width set, the filter
 * line's `:has()`, the notice's room, the rows of blocks a read stands (a
 * skeleton's classes name only themselves), and the reach of what the caller
 * lays in.
 */

/** What the content shows: rows being read, none at all, a failure, or the rows. */
export const COLLECTION_STATE = {
  LOADING: "loading",
  EMPTY: "empty",
  ERROR: "error",
  READY: "ready",
} as const;

export type CollectionState = (typeof COLLECTION_STATE)[keyof typeof COLLECTION_STATE];

/** How many rows a read in progress stands, enough to fill the top of a window. */
const LOADING_ROWS = 4;

/** What the header, the filters, and the content share: the page's inset, and its measure centred in what is left. */
const COLUMN_CLASS = "box-border w-full mx-auto px-collection-page-inset";

/**
 * Each width's measure and content. At the measure the content holds what
 * it holds and ends on the page's inset. Across the room, a board's content
 * holds to the page's height rather than its cards', so a board whose
 * columns scroll their own cards fills the page and never scrolls it down;
 * content taller than that runs past it, and the page scrolls down as it
 * would. Its end inset is a last item rather than padding, so it still
 * follows what runs past.
 */
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

/**
 * The header and filters stand still above the scroll, and reserve a
 * scrollbar's gutter as the scroll does, so a scrollbar that takes room
 * narrows the column under them no more than them. Their end gap is the
 * content's room under the filters, which keeps a focus ring on a filter
 * inside what they clip. In a pane too short for them they take half its
 * height at most and scroll themselves, so the content keeps the rest.
 */
const TOP_CLASS =
  "flex-none box-border max-h-1/2 overflow-x-hidden overflow-y-auto scrollbar-gutter-stable pb-section-gap";

/** An empty or failed collection's notice, centred in the room under the filters (its room above and below is the sheet's). */
const NOTICE_CLASS = "flex flex-1 flex-col items-center text-center";

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/**
 * Rows of blocks in a `ListRow`'s shape, a title over its line: what a read
 * in progress stands where the caller hands no skeleton of its own.
 */
function CollectionPageRowsSkeleton(): React.JSX.Element {
  return (
    <div className="luke-collection-page-skeleton">
      {Array.from({ length: LOADING_ROWS }, (_, row) => (
        <div key={row} className="luke-collection-page-skeleton-row">
          <span className="luke-collection-page-skeleton-title">
            <Skeleton shape={SKELETON_SHAPE.LINE} width="40%" />
          </span>
          <span className="luke-collection-page-skeleton-description">
            <Skeleton shape={SKELETON_SHAPE.LINE} width="65%" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** The page's loading region, named `label` to a reader: `skeleton`, or rows of blocks where none is given. */
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

/** A collection's page: its heading, `filters` under it, and the content `state` says. */
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
  /** What narrows the collection (a search field, chips, a `ChoiceBar`), on one wrapping line. */
  filters?: ReactNode;
  state: CollectionState;
  /** What is being read, said to a reader while the rows are. */
  loadingLabel: string;
  /**
   * What stands in the content's place while it is read: the collection's
   * own `*Skeleton`, drawn in the page's loading region, so the content
   * lands where its blocks stood. Rows of blocks where none is given.
   */
  skeleton?: ReactNode;
  /** What stands in the rows' place when there are none (an EmptyState). */
  empty?: ReactNode;
  /** What stands in the rows' place when they could not be read (an ErrorState). */
  error?: ReactNode;
  /** The rows (a List of ListRows), drawn once `state` is ready. */
  children?: ReactNode;
  /** The page's one scroller, for a caller that remembers where it stood. */
  scrollRef?: Ref<HTMLDivElement>;
}): React.JSX.Element {
  const titleId = `${useId()}title`;
  const underToolbar = heading.frame === PAGE_FRAME.TOOLBAR;
  const width = heading.width ?? PAGE_WIDTH.MEASURE;
  const sized = WIDTH_CLASS[width];
  const filterLine = said(filters) ? (
    <div
      className={`luke-collection-page-filters ${COLUMN_CLASS} ${sized.measure} flex-wrap items-center gap-control-gap pt-section-gap`}
    >
      {filters}
    </div>
  ) : null;
  // Note that under a toolbar with no filters the content opens the filters' gap below the toolbar's hairline, as its padding rather than the scroll's, because a sticky head sticks inside its scroller's padding and would leave what scrolls under it showing above it.
  const toolbarGap = underToolbar && filterLine === null ? "pt-section-gap" : "";
  return (
    <section
      className="luke-collection-page @container flex flex-1 flex-col min-w-0 h-full min-h-0 text-foreground font-ui text-body"
      data-frame={heading.frame}
      data-width={width}
      aria-labelledby={underToolbar ? undefined : titleId}
      aria-label={underToolbar ? heading.label : undefined}
    >
      {underToolbar ? (
        <>
          {heading.toolbar}
          {filterLine === null ? null : (
            <div className={`luke-collection-page-top ${TOP_CLASS}`}>{filterLine}</div>
          )}
        </>
      ) : (
        <div className={`luke-collection-page-top ${TOP_CLASS}`}>
          <div
            className={`luke-collection-page-header ${COLUMN_CLASS} ${sized.measure} pt-collection-page-inset`}
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
        className={`luke-collection-page-scroll flex flex-1 flex-col min-h-0 ${sized.scroll} overflow-y-auto overscroll-contain scrollbar-gutter-stable`}
        ref={scrollRef}
      >
        <div
          className={`luke-collection-page-content ${COLUMN_CLASS} ${sized.measure} flex flex-col ${sized.content} ${toolbarGap}`}
        >
          {state === COLLECTION_STATE.LOADING ? (
            <CollectionPageSkeleton label={loadingLabel} skeleton={skeleton} />
          ) : null}
          {state === COLLECTION_STATE.EMPTY ? (
            <div className={`luke-collection-page-notice ${NOTICE_CLASS}`}>{empty}</div>
          ) : null}
          {state === COLLECTION_STATE.ERROR ? (
            <div className={`luke-collection-page-notice ${NOTICE_CLASS}`}>{error}</div>
          ) : null}
          {state === COLLECTION_STATE.READY ? children : null}
        </div>
      </div>
    </section>
  );
}
