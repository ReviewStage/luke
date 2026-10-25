/**
 * place-columns.ts -- the columns Settings, a version history, and the Admin place lay their list and the item chosen in it in, as class names every screen of theirs draws with.
 *
 * Each takes the whole shell: the list where the plans' sidebar stands, as
 * wide as the sidebar but never wider than the share of the stage the
 * split's line leaves its least list (300 of 860, `column-split.ts`), so a
 * sidebar dragged wide leaves the item its room, the way back at the list's
 * head and its title a step under it; and the item beside it. A narrow room,
 * or a screen split to one column, stands one of the two alone
 * (`desktop.css`'s narrow-room rules, which outrank these).
 */

/** The screen: its list and its item in two columns, filling the shell's row. */
export const PLACE_SPLIT = "col-span-full grid min-h-0 grid-cols-place-split grid-rows-single";

/** The list's column, on the sidebar's ground, at the column's inset. */
export const PLACE_LIST =
  "relative flex min-h-0 flex-col bg-sidebar px-column-inset pb-column-inset";

/** The list's title, a step under the way back above it. */
export const PLACE_LIST_TITLE = "mx-row-inset my-block-gap";

/** The item's column. */
export const PLACE_PAGE = "flex min-h-0 min-w-0 flex-col";
