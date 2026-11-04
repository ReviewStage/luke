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

/** How a page drawn in words is fitted: not yet heard from, as tall as its own content, or filling whatever frame holds it. */
export const PAGE_FIT = {
  PENDING: "pending",
  CONTENT: "content",
  FILLS: "fills",
} as const;

export type PageFit =
  | { readonly kind: typeof PAGE_FIT.PENDING }
  | { readonly kind: typeof PAGE_FIT.CONTENT; readonly height: number }
  | { readonly kind: typeof PAGE_FIT.FILLS };

/** A page not yet heard from. */
export const PAGE_FIT_PENDING: PageFit = { kind: PAGE_FIT.PENDING };

/** How near a reported height may stand to the frame's own and still be the frame's, a rounded pixel either way. */
const FRAME_SLACK = 1;

/**
 * How a page is fitted once it reports `height` from a frame `frameHeight`
 * tall. A page as tall as its words is drawn at that height. A page that
 * holds its root to the frame's height (`100vh`, `height: 100%`) has no
 * height of its own and always reports the frame's, so it is drawn at a
 * screenful instead of shrinking to the stand-in it was first framed at.
 * Note that a page found to have a height of its own keeps it, because one
 * whose words happen to match the frame it first stood in would otherwise
 * swing between the two.
 */
export function pageFitAfter(fit: PageFit, height: number, frameHeight: number): PageFit {
  if (fit.kind !== PAGE_FIT.CONTENT && Math.abs(height - frameHeight) <= FRAME_SLACK) {
    return { kind: PAGE_FIT.FILLS };
  }
  return { kind: PAGE_FIT.CONTENT, height };
}
