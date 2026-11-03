import { Schema as EffectSchema } from "effect";

/**
 * page-size.ts -- how tall a plan's page is as drawn: the height the page's frame hands the window, which a page drawn in written words is drawn at.
 *
 * A page drawn in a transcript or an Inbox thread stands as tall as its
 * words, not as tall as a pane (`@repo/ui`'s `PageEmbed`), and only the page
 * knows how tall that is: its frame holds an opaque origin, so the window
 * cannot read into it. Every server of a page therefore answers it with one
 * script of our own ahead of the agent's HTML (`withPageScripts`), which
 * posts the page's height to the window as it first lays out and again each
 * time it changes.
 *
 * The script runs among the page's own, so whatever the frame posts is the
 * page's word, not ours: the window takes the message only from the frame it
 * drew and only in the shape below, and draws the frame no taller than its
 * own bound however tall the page says it is.
 */

/** The mark every message of a height wears, setting it apart from whatever else the page posts. */
const PAGE_SIZE_TYPE = "app-page-size";

/** A message the frame posts to the window: the page's height, in CSS pixels. */
export const pageSizeSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(PAGE_SIZE_TYPE),
  height: EffectSchema.Finite.check(EffectSchema.isGreaterThanOrEqualTo(0)),
});

/**
 * The script the frame runs, ahead of the page's own. It is plain JavaScript in
 * a string because it runs in the page, apart from every bundle of ours.
 * It reads the page's height as its root lays out, or as far as its body
 * scrolls where the page holds its body to the frame's height, never the
 * frame's own height, so a page shorter than the frame says how short it is,
 * and posts it as the page is read, once loaded, and whenever the root or
 * the body changes size where the window can say so, once a height, so a
 * page that holds still posts nothing more.
 */
export const PAGE_SIZE_SCRIPT = `(() => {
  "use strict";
  const TYPE = ${JSON.stringify(PAGE_SIZE_TYPE)};
  let posted = -1;

  const post = () => {
    const root = document.documentElement.getBoundingClientRect().height;
    const height = Math.ceil(Math.max(root, document.body === null ? 0 : document.body.scrollHeight));
    if (height === posted) return;
    posted = height;
    parent.postMessage({ type: TYPE, height }, "*");
  };

  const watch = () => {
    post();
    if (typeof ResizeObserver !== "function") return;
    const sizes = new ResizeObserver(post);
    sizes.observe(document.documentElement);
    if (document.body !== null) sizes.observe(document.body);
  };

  if (document.readyState === "loading") addEventListener("DOMContentLoaded", watch, { once: true });
  else watch();
  addEventListener("load", post, { once: true });
})();`;
