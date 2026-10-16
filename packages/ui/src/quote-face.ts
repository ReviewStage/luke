/**
 * quote-face.ts -- the class every quoted block wears, wherever Markdown is drawn.
 *
 * A `>` quote is drawn by three renderers: Streamdown in a transcript, an
 * Inbox item, and a sent bubble; react-markdown in the plan, its versions,
 * Luke's notes, and the captions; and TipTap in the plan's editor. Each
 * hands its quote this one class, which the desktop's `markdown.css` draws,
 * so a quote reads the same wherever it stands and no renderer's own
 * default (Streamdown's, or the browser's 40px indent) reaches it.
 */

/** The class every quoted block wears, which the desktop's `markdown.css` draws. */
export const QUOTE_CLASS = "markdown-quote";
