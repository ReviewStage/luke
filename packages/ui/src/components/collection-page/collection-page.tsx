import { type ReactNode, useId } from "react";
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

/** A collection's page: `title` and `actions`, `filters` under them, and the content `state` says. */
export function CollectionPage({
  title,
  description,
  actions,
  filters,
  state,
  loadingLabel,
  empty,
  error,
  children,
}: {
  /** What the collection is, which names the page. */
  title: ReactNode;
  description?: ReactNode;
  /** The page's own acts at the header's end (a Button to make one). */
  actions?: ReactNode;
  /** What narrows the collection (a search field, chips, a Segmented), on one wrapping line. */
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
  return (
    <section className="luke-collection-page" aria-labelledby={titleId}>
      <div className="luke-collection-page-top">
        <header className="luke-collection-page-header">
          <div className="luke-collection-page-heading">
            <h1 className="luke-collection-page-title" id={titleId}>
              {title}
            </h1>
            {said(description) ? (
              <p className="luke-collection-page-description">{description}</p>
            ) : null}
          </div>
          {said(actions) ? <div className="luke-collection-page-actions">{actions}</div> : null}
        </header>
        {said(filters) ? <div className="luke-collection-page-filters">{filters}</div> : null}
      </div>
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
