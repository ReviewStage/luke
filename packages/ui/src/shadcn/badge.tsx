import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";

/**
 * badge.tsx -- shadcn/ui's badge (style `base-nova`, on Base UI), vendored and drawn as Luke's badge.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add badge` reads as a small diff. Its local
 * changes:
 *
 * - The base box is Luke's badge: a capsule that may shrink below its words
 *   and wrap them (no `h-5`, `w-fit`, `shrink-0`, `overflow-hidden`, or
 *   `whitespace-nowrap`), cornered by half a one-line badge's height
 *   (`rounded-badge`) rather than a full round, so a wrapped badge stands as
 *   a rounded box, in the tag's type and weight, its hairline
 *   drawn inside (`inset-ring`) rather than as a border, so it stands no
 *   taller than the compact chip beside it, and any glyph in it at 12px.
 * - `variant` names today's tones (`neutral`, `working`, `attention`,
 *   `complete`, `merged`, `danger`) rather than shadcn's `default`,
 *   `secondary`, `destructive`, `outline`, `ghost`, and `link`: a tone is
 *   said in the badge's glyph's ink, and a neutral badge's words are muted.
 * - `face` is added: the chip's own opaque face inside its hairline
 *   (`plain`), a provider's colour (`filled`, from the custom properties the
 *   badge sets inline), or the ink (`lit`).
 * - `dot` is added: a dot of the tone's ink before the words, for a badge in
 *   a tone with no glyph or swatch to say it.
 * - None of shadcn's focus, `aria-invalid`, ring, transition, or `[a]:hover`
 *   utilities, since a badge takes no focus and no press, and the window
 *   draws the one focus ring (`shadcn-focus.test.ts`).
 * - Its classes are joined (`clsx`), not merged (`cn`), because
 *   a badge's type, ink, and face are picked whole by its variants, with
 *   no caller's class to settle against them.
 *
 * `@luke/ui`'s `Badge` (`components/badge/badge.tsx`) is what an app draws;
 * this is its inside.
 */

const badgeVariants = cva(
  "group/badge inline-flex min-w-0 max-w-full flex-initial items-center gap-badge-gap rounded-badge px-badge-inline py-badge-block font-body text-tag leading-tag font-tag inset-ring [&_svg]:flex-none [&_svg]:size-badge-glyph [&_svg]:text-tone-ink",
  {
    variants: {
      // Note that every tone draws its glyph in the tone's ink, which its `data-tone` sets (`tokens/status-tone.css`).
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
