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
      text: [
        "body",
        "caption",
        "section",
        "hover-card-name",
        "hover-card-sub",
        "hover-card-code",
        "hover-card-coarse",
      ],
      spacing: [
        "control-gap",
        "icon-gap",
        "menu-glyph",
        "menu-inset",
        "menu-row",
        "card-inset-snug",
        "dialog-reach",
        "dialog-inset",
        "dialog-action-gap",
        "dialog-action",
        "dialog-room",
        "viewport-top",
        "keyboard-inset",
        "popover-room",
        "tooltip-card-inline",
        "hover-card-glyph",
        "hover-card-more",
        "hover-card-indent",
      ],
      radius: ["dialog", "menu", "menu-row", "tooltip"],
      shadow: ["dialog", "dialog-drop", "menu", "tooltip"],
      container: [
        "dialog-confirm",
        "dialog-wide",
        "dialog-composer",
        "dialog-composer-reach",
        "dialog-media-min",
        "dialog-media-max",
        "tooltip",
        "tooltip-card",
      ],
      animate: [
        "dialog-scrim",
        "dialog-in",
        "dialog-nudge",
        "dialog-shake",
        "menu-in",
        "tooltip-in",
        "tooltip-leave",
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
