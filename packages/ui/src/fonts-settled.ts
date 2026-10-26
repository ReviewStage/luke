/**
 * fonts-settled.ts -- calls back each time the page's web fonts finish loading, which moves every width words set without resizing the box around them.
 *
 * A measure that answers a width the words set (a path's fold, a bar's
 * wrap) is otherwise read only when a box it watches resizes, and a font
 * arriving late widens or narrows words inside a box held at its width, so
 * the measure stays where the fallback font left it. A host with no font set
 * (jsdom) loads nothing, so it never calls back.
 */

/** Calls `run` each time the page's fonts finish loading, until the answered stop is called. */
export function onFontsSettled(run: () => void): () => void {
  // Note that the font set is read as optional, because the DOM's types promise it and jsdom has none.
  const fonts: FontFaceSet | undefined = globalThis.document?.fonts;
  fonts?.addEventListener("loadingdone", run);
  return () => fonts?.removeEventListener("loadingdone", run);
}
