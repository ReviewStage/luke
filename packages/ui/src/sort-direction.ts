/**
 * sort-direction.ts -- the two ways a column orders its rows, named as `aria-sort` names them.
 *
 * A view model of its own, so a DOM-free sorter and the `DataTable` that
 * announces its order share one vocabulary without the sorter resolving React.
 */

/** The values `aria-sort` takes, so the state is the announcement. */
export const SORT_DIRECTION = {
  ASCENDING: "ascending",
  DESCENDING: "descending",
} as const;

export type SortDirection = (typeof SORT_DIRECTION)[keyof typeof SORT_DIRECTION];
