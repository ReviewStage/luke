import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";

const badgeVariants = cva(
  "group/badge inline-flex min-w-0 max-w-full flex-initial items-center gap-badge-gap rounded-badge px-badge-inline py-badge-block font-body text-tag leading-tag font-tag inset-ring [&_svg]:flex-none [&_svg]:size-badge-glyph [&_svg]:text-tone-ink",
  {
    variants: {
      variant: {
        neutral: "",
        working: "",
        attention: "",
        complete: "",
        merged: "",
        danger: "",
      },
      face: {
        plain: "bg-chip inset-ring-border-strong",
        filled: "bg-badge-fill inset-ring-badge-fill-edge text-badge-fill-words whitespace-nowrap",
        lit: "bg-ink inset-ring-ink text-ink-foreground",
      },
      dot: {
        true: "before:flex-none before:size-status-dot before:rounded-full",
        false: "",
      },
    },
    compoundVariants: [
      { face: "plain", variant: "neutral", className: "text-muted-foreground" },
      {
        face: "plain",
        variant: ["working", "attention", "complete", "merged", "danger"],
        className: "text-foreground",
      },
      { dot: true, className: "before:bg-tone-ink" },
    ],
    defaultVariants: {
      variant: "neutral",
      face: "plain",
      dot: false,
    },
  },
);

function Badge({
  className,
  variant = "neutral",
  face = "plain",
  dot = false,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: clsx(badgeVariants({ variant, face, dot }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
