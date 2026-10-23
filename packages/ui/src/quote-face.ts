/**
 * quote-face.ts -- the class every quoted block wears, wherever Markdown is drawn.
 *
 * A `>` quote is drawn by two renderers: `@luke/ui/markdown` in a
 * transcript, an Inbox item, a sent bubble, the plan, its versions, Luke's
 * notes, and the captions; and TipTap in the plan's editor. Each hands its
 * quote this one class, which `components/prose/prose.css` draws,
 * so a quote reads the same wherever it stands and no renderer's own
 * default (Streamdown's, or the browser's 40px indent) reaches it.
 */

/** The class every quoted block wears, which `prose.css` draws. */
export const QUOTE_CLASS = "markdown-quote";
