import { createElement, type HTMLAttributes, type Ref } from "react";
import { cn } from "../cn.js";

type CardElement = "div" | "article" | "figure" | "li" | "section" | "span";

function Card({
  as = "div",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: CardElement | undefined;
  ref?: Ref<HTMLElement> | undefined;
}) {
  return createElement(as, {
    "data-slot": "card",
    className: cn("relative block border", className),
    ...props,
  });
}

export { Card };
