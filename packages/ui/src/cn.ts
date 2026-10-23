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
 * Note that the merge is told the type, length, and corner names
 * `tailwind/theme.css` adds, because tailwind-merge reads a name it does not
 * know as a colour: `text-body` beside `text-foreground` would be dropped as
 * a second text colour, and `px-control-inset` would outlive a later `p-0`.
 */

const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["body", "label", "caption", "title", "body-size", "touch", "caption-touch"],
      leading: ["body"],
      spacing: [
        "luke-2",
        "luke-4",
        "luke-6",
        "luke-8",
        "luke-12",
        "luke-16",
        "luke-20",
        "luke-24",
        "inline-edit-lift",
        "control",
        "control-inset",
        "control-icon",
        "control-gap",
        "icon-gap",
        "menu-glyph",
        "control-compact",
        "time-inset",
        "time-value",
        "text-area-least",
        "text-area-bare-least",
        "text-area-grow-max",
        "text-area-inset-start",
        "text-area-inset-inline",
        "text-area-inset-end",
        "search-lead",
        "search-clear",
        "menu-search",
        "inline-edit-reach",
      ],
      radius: ["control", "control-compact", "inline-edit"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
