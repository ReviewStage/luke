import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../cn.js";

const buttonVariants = cva(
  "group/button relative flex-none items-center justify-center max-w-full m-0 border border-solid border-button-edge font-ui no-underline whitespace-nowrap transition-[--ui-button-fill,background-color,color,filter,opacity] duration-(--ui-duration-hover) ease-motion-exit",
  {
    variants: {
      size: {
        control: "inline-flex h-control rounded-control text-label font-label",
        compact: "inline-flex h-6 px-2 rounded-control text-tag font-tag",
        icon: "inline-flex size-control p-0 rounded-control text-label font-label",
        "icon-compact": "inline-flex size-6 p-0 rounded-ui-6 text-label font-label",
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
        class: "rounded-ui-full px-[calc(var(--ui-control-height)/2)]",
      },
      { shape: "round", size: "compact", class: "rounded-ui-full" },
      { shape: "round", size: "icon", class: "rounded-ui-full" },
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
