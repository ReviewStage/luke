/**
 * lead-row.ts -- the row a numbered step and the wait under the steps both stand in: a lead in one slot, then one column of words.
 *
 * A step's number and the wait's ring stand in the same slot, a number
 * well wide and one label line tall, each centered in it, so the lead sits
 * on the words' first line and the words of every step and of the wait
 * start at one edge. What the row says under its words, a hint or a
 * control, stands in that same column at the control gap.
 */

/** The row: the lead's slot, then the column, both from the row's top. */
export const LEAD_ROW = "flex items-start gap-control-gap";

/** The lead's slot: a number well wide, one label line tall, what it holds centered in it. */
export const LEAD_SLOT = "flex h-lh w-ui-20 flex-none items-center justify-center text-label";

/** The column: the row's words, then what it says under them. */
export const LEAD_WORDS = "flex min-w-0 flex-1 flex-col gap-control-gap";
