/**
 * find-skip.ts -- the attribute a find over a tab leaves out: what is drawn among its words and is none of them.
 */

/**
 * The attribute worn by what is drawn among a tab's words and is none of
 * them: the find bar itself, standing inside the tab it searches, a code
 * line's number in its gutter, and the copy of a shimmer's words its light
 * is drawn with. The panel's find (`find-matches.ts`) searches nothing under it.
 */
export const FIND_SKIP_ATTRIBUTE = "data-find-skip";
