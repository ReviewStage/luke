import { Schema as EffectSchema } from "effect";

const PAGE_SIZE_TYPE = "app-page-size";

export const pageSizeSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(PAGE_SIZE_TYPE),
  height: EffectSchema.Finite.check(EffectSchema.isGreaterThanOrEqualTo(0)),
});

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

export const PAGE_FIT = {
  PENDING: "pending",
  CONTENT: "content",
  FILLS: "fills",
} as const;

export type PageFit =
  | { readonly kind: typeof PAGE_FIT.PENDING }
  | { readonly kind: typeof PAGE_FIT.CONTENT; readonly height: number }
  | { readonly kind: typeof PAGE_FIT.FILLS };

export const PAGE_FIT_PENDING: PageFit = { kind: PAGE_FIT.PENDING };

const FRAME_SLACK = 1;

export function pageFitAfter(fit: PageFit, height: number, frameHeight: number): PageFit {
  if (fit.kind !== PAGE_FIT.CONTENT && Math.abs(height - frameHeight) <= FRAME_SLACK) {
    return { kind: PAGE_FIT.FILLS };
  }
  return { kind: PAGE_FIT.CONTENT, height };
}
