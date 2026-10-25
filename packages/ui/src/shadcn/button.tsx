import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../cn.js";

/**
 * button.tsx -- shadcn/ui's button (style `base-nova`, on Base UI), vendored and drawn at Luke's control roles.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add button` reads as a small diff. Luke's
 * changes: the sizes are the control's roles (`control`, `compact`, `icon`,
 * `icon-compact`, and a menu's `row`) and a `shape` that rounds them; the
 * looks are not here, because a look is a set of `--luke-button-*` inks a
 * container's sheet may restyle (`components/button/button.css`), so the
 * fill and ink are drawn there and only the edge is read here; none of
 * shadcn's outline or ring utilities, because the window's own focus ring
 * (`@luke/panel`'s base.css) draws the keyboard's ring and a utility would
 * outrank it (`anti-slop/no-shadcn-focus-ring`); none of its press translate, which
 * Luke's button answers by its face (`button.css`); and the desktop's arrow
 * cursor. `@luke/ui`'s `Button` and `IconButton`
 * (`components/button/button.tsx`) are what an app draws; this is their
 * inside, and `buttonVariants` dresses a link as a button, as shadcn's does.
 */

const buttonVariants = cva(
  "group/button relative flex-none items-center justify-center max-w-full m-0 border border-solid border-button-edge font-ui no-underline whitespace-nowrap transition-[--luke-button-fill,background-color,color,filter,opacity] duration-(--luke-duration-hover) ease-motion-exit",
  {
    variants: {
      size: {
        control: "inline-flex h-control rounded-control text-label font-label",
        compact: "inline-flex h-6 px-2 rounded-control text-tag font-tag",
        icon: "inline-flex size-control p-0 rounded-control text-label font-label",
        "icon-compact": "inline-flex size-6 p-0 rounded-luke-6 text-label font-label",
        row: "flex w-full justify-start h-menu-row px-2 rounded-menu-row text-body font-text",
      },
      shape: {
        square: "",
        round: "",
      },
    },
    compoundVariants: [
      {
        shape: "round",
        size: "control",
        class: "rounded-luke-full px-[calc(var(--luke-control-height)/2)]",
      },
      { shape: "round", size: "compact", class: "rounded-luke-full" },
      { shape: "round", size: "icon", class: "rounded-luke-full" },
    ],
    defaultVariants: {
      size: "control",
      shape: "square",
    },
  },
);

function Button({
  className,
  size = "control",
  shape = "square",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ size, shape, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
