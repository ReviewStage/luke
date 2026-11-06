import { type ComponentProps, type CSSProperties, createElement } from "react";
import { cn } from "../cn.js";

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
