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
        "label",
        "title",
        "touch",
        "caption-touch",
        "caption-inline",
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
        "control",
        "control-inset",
        "control-icon",
        "field-gap",
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
        "luke-2",
        "luke-4",
        "luke-6",
        "luke-8",
        "luke-12",
        "luke-16",
        "luke-40",
        "menu-least",
        "menu-most",
        "menu-chevron",
        "menu-max",
        "combobox-list",
        "combobox-lead",
        "list-gap",
        "touch",
        "choice-fill-compact",
        "choice-segment",
        "choice-segment-compact",
        "caption-glyph",
      ],
      radius: [
        "dialog",
        "menu",
        "menu-row",
        "tooltip",
        "control",
        "control-compact",
        "inline-edit",
        "menu-toolbar",
        "luke-6",
        "luke-8",
        "luke-10",
        "luke-full",
        "choice-segment",
        "choice-box",
      ],
      shadow: ["dialog", "dialog-drop", "menu", "tooltip", "switch-thumb"],
      leading: ["body"],
      font: ["ui"],
      "font-weight": ["regular"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
