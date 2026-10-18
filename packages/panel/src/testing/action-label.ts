/**
 * action-label.ts -- what a test of a label a reader presses stands on: the labels that wear a trailing ellipsis.
 *
 * Note that no button, menu item, or command in the app ends its name with
 * an ellipsis, a dialog opener's included: an ellipsis says work under way
 * ("Saving…") or text cut short, and a label to press is neither.
 */

/** A trailing ellipsis, as one character or as three dots. */
const TRAILING_ELLIPSIS = /(…|\.\.\.)\s*$/u;

/** The labels among `labels` that end with an ellipsis, none where every label reads as a press should. */
export function ellipsized(labels: Iterable<string | null | undefined>): string[] {
  return [...labels].flatMap((label) =>
    label !== null && label !== undefined && TRAILING_ELLIPSIS.test(label) ? [label] : [],
  );
}
