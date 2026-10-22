import { type ReactNode, useId } from "react";
import { PAGE_FRAME, PAGE_WIDTH, type PageHeading } from "../page-frame/page-frame.js";
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
 * the same place under the filters: a read in progress stands rows of
 * blocks where the rows will be, and the empty and failed states stand a
 * little above the room's middle, so swapping one state for another moves
 * nothing above it.
 *
 * Under the window's toolbar (`PAGE_FRAME.TOOLBAR`) the page draws no
 * header: the toolbar stands still above the filters, and the page is named
 * by the toolbar's title. A board that scrolls sideways stands its content
 * across the whole room (`PAGE_WIDTH.FULL`) rather than at the measure.
 *
 * The empty and failed states are the caller's, handed in whole, since an
 * empty collection says what to do about it and a failed one how to retry.
 * The page names itself by its title and takes no class or style.
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

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/** Rows of blocks in a `ListRow`'s shape, a title over its line, named `label` to a reader. */
function LoadingRows({ label }: { label: string }): React.JSX.Element {
  return (
    <SkeletonRegion label={label}>
      <div className="luke-collection-page-loading">
        {Array.from({ length: LOADING_ROWS }, (_, row) => (
          <div key={row} className="luke-collection-page-loading-row">
            <span className="luke-collection-page-loading-title">
              <Skeleton shape={SKELETON_SHAPE.LINE} width="40%" />
            </span>
            <span className="luke-collection-page-loading-description">
              <Skeleton shape={SKELETON_SHAPE.LINE} width="65%" />
            </span>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** A collection's page: its heading, `filters` under it, and the content `state` says. */
export function CollectionPage({
  filters,
  state,
  loadingLabel,
  empty,
  error,
  children,
  ...heading
}: PageHeading & {
  /** What narrows the collection (a search field, chips, a `ChoiceBar`), on one wrapping line. */
  filters?: ReactNode;
  state: CollectionState;
  /** What is being read, said to a reader while the rows are. */
  loadingLabel: string;
  /** What stands in the rows' place when there are none (an EmptyState). */
  empty?: ReactNode;
  /** What stands in the rows' place when they could not be read (an ErrorState). */
  error?: ReactNode;
  /** The rows (a List of ListRows), drawn once `state` is ready. */
  children?: ReactNode;
}): React.JSX.Element {
  const titleId = `${useId()}title`;
  const underToolbar = heading.frame === PAGE_FRAME.TOOLBAR;
  const filterLine = said(filters) ? (
    <div className="luke-collection-page-filters">{filters}</div>
  ) : null;
  return (
    <section
      className="luke-collection-page"
      data-frame={heading.frame ?? PAGE_FRAME.PAGE}
      data-width={heading.width ?? PAGE_WIDTH.MEASURE}
      aria-labelledby={underToolbar ? undefined : titleId}
      aria-label={underToolbar ? heading.label : undefined}
    >
      {underToolbar ? (
        <>
          {heading.toolbar}
          {filterLine === null ? null : (
            <div className="luke-collection-page-top">{filterLine}</div>
          )}
        </>
      ) : (
        <div className="luke-collection-page-top">
          <header className="luke-collection-page-header">
            <div className="luke-collection-page-heading">
              <h1 className="luke-collection-page-title" id={titleId}>
                {heading.title}
              </h1>
              {said(heading.description) ? (
                <p className="luke-collection-page-description">{heading.description}</p>
              ) : null}
            </div>
            {said(heading.actions) ? (
              <div className="luke-collection-page-actions">{heading.actions}</div>
            ) : null}
          </header>
          {filterLine}
        </div>
      )}
      <div className="luke-collection-page-scroll">
        <div className="luke-collection-page-content">
          {state === COLLECTION_STATE.LOADING ? <LoadingRows label={loadingLabel} /> : null}
          {state === COLLECTION_STATE.EMPTY ? (
            <div className="luke-collection-page-notice">{empty}</div>
          ) : null}
          {state === COLLECTION_STATE.ERROR ? (
            <div className="luke-collection-page-notice">{error}</div>
          ) : null}
          {state === COLLECTION_STATE.READY ? children : null}
        </div>
      </div>
    </section>
  );
}
