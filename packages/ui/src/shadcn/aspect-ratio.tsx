import { type ComponentProps, type CSSProperties, createElement } from "react";
import { cn } from "../cn.js";

/**
 * aspect-ratio.tsx -- shadcn/ui's aspect ratio (style `base-nova`), vendored and drawn as the box a page's or a picture's shape is held in.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add aspect-ratio` reads as a small diff. Its
 * local change: it is made as whichever element its place reads it as
 * (`as`), a `span` where it stands in a line of words or a press, as a
 * thumb does inside a card's button, as well as a `div`.
 */

/** The elements a box of a shape may be made as. */
type AspectRatioElement = "div" | "span";

function AspectRatio({
  as = "div",
  ratio,
  className,
  style,
  ...props
}: ComponentProps<"div"> & { as?: AspectRatioElement | undefined; ratio: number }) {
  return createElement(as, {
    "data-slot": "aspect-ratio",
    style: {
      "--ratio": ratio,
      ...style,
    } as CSSProperties,
    className: cn("relative aspect-(--ratio)", className),
    ...props,
  });
}

export { AspectRatio };
