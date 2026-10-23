import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * cn.ts -- the class-name joiner every Tailwind-written component is written against.
 *
 * What the shadcn registry's `@/lib/utils` is: conditional classes joined,
 * then merged so a caller's `className` wins over a component's own
 * utility for the same property. The desktop's AI Elements components and
 * the site's chart both call it.
 *
 * Note that the merge is told the theme's own sizes (`tailwind/theme.css`),
 * because one it does not know it reads as a colour: `text-label` beside
 * `text-button-ink` would be dropped as a second ink, and `h-control`
 * kept beside the `size-6` meant to replace it.
 */
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["body", "label", "caption"],
      spacing: [
        "control",
        "control-inset",
        "control-icon",
        "icon-gap",
        "menu-row",
        "menu-glyph",
        "list-gap",
        "touch",
        "choice-fill-compact",
        "choice-segment",
        "choice-segment-compact",
        "caption-glyph",
      ],
      radius: ["control", "menu-row", "luke-6", "luke-8", "luke-10", "luke-full", "choice-segment"],
      font: ["ui"],
      "font-weight": ["regular"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
