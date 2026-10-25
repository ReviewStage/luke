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
 * The disabled fade (`opacity-disabled`) is told as an opacity, which it
 * would otherwise not read as one, so a later fade would not replace it.
 */

/**
 * The names the panel work column's block of the theme adds (its layout's
 * spacing roles, a transcript's opening line, the call's video room, a
 * tool's page, the find bar, the version history), by the group
 * tailwind-merge reads each in.
 */
const PANEL_WORK_COLUMN = {
  "font-weight": ["luke-medium", "luke-regular", "luke-semibold"],
  leading: ["tool-description"],
  spacing: [
    "attention-mark",
    "agent-video-frame",
    "column-inset",
    "find-field",
    "origin-glyph",
    "ring-reach",
  ],
  radius: ["disc"],
  shadow: ["tool-default"],
  animate: ["edit-composer-in", "edit-composer-out"],
} as const;

/**
 * The names the feedback and display components' block of the theme adds
 * (badge, chip, avatar, toast, spinner, progress, skeleton, banner, card,
 * pagination, breadcrumbs, data table), by the group tailwind-merge reads
 * each in.
 */
const FEEDBACK_DISPLAY = {
  text: ["dialog"],
  "font-weight": ["dialog"],
  leading: ["tag"],
  spacing: [
    "avatar-account",
    "avatar-card",
    "avatar-glyph",
    "avatar-glyph-share",
    "avatar-inline",
    "avatar-mark",
    "avatar-masthead",
    "avatar-page",
    "avatar-portrait",
    "avatar-row",
    "avatar-stack",
    "badge-block",
    "badge-gap",
    "badge-glyph",
    "badge-inline",
    "badge-swatch",
    "banner-card",
    "banner-card-start",
    "banner-disc",
    "banner-row-inset",
    "banner-strip-block",
    "banner-strip-end",
    "banner-strip-start",
    "banner-words-gap",
    "breadcrumb-chevron",
    "breadcrumb-gap",
    "breadcrumb-pill-block",
    "breadcrumb-pill-inline",
    "breadcrumb-title-chevron",
    "card",
    "card-compact",
    "card-head-block",
    "card-head-gap",
    "card-head-inline",
    "card-snug",
    "chip-chevron",
    "chip-compact",
    "chip-compact-inset",
    "chip-field",
    "chip-field-half",
    "chip-inset",
    "chip-inset-wide",
    "chip-min-field",
    "chip-remove",
    "chip-remove-glyph",
    "chip-tight",
    "data-table-cell-block",
    "data-table-cell-inline",
    "data-table-medium",
    "data-table-narrow",
    "data-table-wide",
    "pagination-gap",
    "pagination-item",
    "pagination-item-inset",
    "pagination-steps-gap",
    "progress-height",
    "skeleton-line",
    "skeleton-line-gap",
    "spinner",
    "spinner-region",
    "spinner-region-inset",
    "spinner-small",
    "status-dot",
    "toast-gap",
    "toast-glyph-inset",
    "toast-inset",
    "toast-line-gap",
    "toast-text-inset",
  ],
  radius: [
    "avatar-square",
    "avatar-tile",
    "badge",
    "breadcrumb",
    "card",
    "card-raised",
    "skeleton",
    "toast",
  ],
  shadow: ["avatar-edge", "avatar-tile-edge", "card-lift", "card-soft", "toast", "toast-dismiss"],
  container: ["progress"],
} as const;

/**
 * The names the content and text components' block of the theme adds (text,
 * text link, inline ref, code card, shortcut, glyph slot, saved tick,
 * working mark, thinking dots), by the group tailwind-merge reads each in.
 */
const CONTENT_TEXT = {
  text: ["toolbar-title", "shortcut"],
  "font-weight": ["toolbar-title"],
  leading: ["reading"],
  spacing: ["glyph", "working-mark", "thinking-dot", "inline-ref-mark"],
  radius: ["text-link"],
  shadow: ["inline-ref-wash"],
  container: ["inline-ref-pill", "inline-ref-pill-stated"],
} as const;

/**
 * The names the rows and navigation block of the theme adds (list row, nav
 * item, disclosure, bar item, pane bar, toolbar, over pane, folding search,
 * searchable menu), by the group tailwind-merge reads each in.
 */
const ROWS_NAVIGATION = {
  text: ["dialog-size", "tag-size"],
  leading: ["label"],
  spacing: [
    "bar-count-reach",
    "caption-leading",
    "disclosure-row",
    "item-gap",
    "list-row-lead",
    "luke-32",
    "luke-48",
    "menu-label",
    "nav-identity",
    "over-pane",
    "over-pane-column",
    "pane-bar",
    "submenu",
    "submenu-reach",
    "swipe-label",
  ],
  shadow: ["bar-count-ring"],
  radius: ["inherit"],
} as const;

/**
 * The names the panel Home and tasks block of the theme adds (the page's
 * inset and section gap, the welcome, a row's context, New task's title, a
 * card's line, the Board's column, the List's row and maker), by the group
 * tailwind-merge reads each in.
 */
const PANEL_HOME_TASKS = {
  spacing: [
    "card-line",
    "new-task-title",
    "page-inset",
    "page-section-gap",
    "row-context",
    "tasks-board-column",
    "tasks-list-maker",
    "tasks-list-row",
    "welcome-composer",
    "welcome-face",
    "welcome-tile",
  ],
} as const;

/**
 * The names the panel shell's block of the theme adds (the sidebar, a row's
 * end mark, a search's match, the call card, the settings rows), by the
 * group tailwind-merge reads each in.
 */
const PANEL_SHELL = {
  tracking: ["identity"],
  spacing: [
    "row-mark",
    "section-gap",
    "settings-row-block",
    "settings-row-inline",
    "settings-row",
    "settings-row-pair",
    "heir-least",
    "settings-search-clearance",
  ],
  radius: ["luke-14"],
} as const;

/**
 * The names the chips, media, and call block of the theme adds (attachment
 * chip, picture set and tile, page thumb, video player, provider button,
 * composer frame, call bar and video tile), by the group tailwind-merge reads
 * each in.
 */
const CHIPS_MEDIA_CALL = {
  text: ["label-inline"],
  spacing: [
    "attachment-chip",
    "attachment-chip-check",
    "attachment-chip-lead",
    "attachment-chip-max",
    "attachment-chip-meter",
    "attachment-chip-remove",
    "attachment-chip-remove-out",
    "attachment-chip-thumb",
    "call-row",
    "call-row-max",
    "call-tile",
    "call-tile-face-max",
    "call-tile-face-share",
    "icon-12",
    "icon-16",
    "page-thumb-row",
    "picture-row",
    "picture-thumb",
    "provider-gate",
    "provider-gate-touch",
    "stage",
    "video-player",
  ],
  radius: ["attachment-chip-face", "call-tile"],
  shadow: ["attachment-chip-disc", "composer", "provider-gate"],
  aspect: ["picture"],
} as const;

const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "body",
        "label",
        "caption",
        "title",
        "body-size",
        "touch",
        "caption-touch",
        "caption-inline",
        "section",
        "hover-card-code",
        "group",
        "tag",
        ...FEEDBACK_DISPLAY.text,
        ...CONTENT_TEXT.text,
        ...ROWS_NAVIGATION.text,
        ...CHIPS_MEDIA_CALL.text,
      ],
      "font-weight": [
        "text",
        "label",
        "group",
        "tag",
        "caption",
        "section",
        "emphasis",
        "title",
        ...PANEL_WORK_COLUMN["font-weight"],
        ...FEEDBACK_DISPLAY["font-weight"],
        ...CONTENT_TEXT["font-weight"],
      ],
      tracking: ["title", ...PANEL_SHELL.tracking],
      leading: [
        "body",
        ...FEEDBACK_DISPLAY.leading,
        ...CONTENT_TEXT.leading,
        ...ROWS_NAVIGATION.leading,
        ...PANEL_WORK_COLUMN.leading,
      ],
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
        "block-gap",
        "row-inset",
        "list-inset",
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
        "menu-inset",
        "menu-row",
        "card-inset-snug",
        "dialog-reach",
        "dialog-inset",
        "dialog-action-gap",
        "dialog-action",
        "dialog-room",
        "dialog-command-top",
        "dialog-command-room",
        "dialog-command-sheet",
        "viewport-top",
        "keyboard-inset",
        "popover-room",
        "tooltip-card-inline",
        "hover-card-glyph",
        "hover-card-list",
        "field-gap",
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
        ...PANEL_WORK_COLUMN.spacing,
        ...FEEDBACK_DISPLAY.spacing,
        ...CONTENT_TEXT.spacing,
        ...ROWS_NAVIGATION.spacing,
        ...PANEL_SHELL.spacing,
        ...CHIPS_MEDIA_CALL.spacing,
        ...PANEL_HOME_TASKS.spacing,
      ],
      radius: [
        "control",
        "control-compact",
        "inline-edit",
        "dialog",
        "menu",
        "menu-row",
        "tooltip",
        "menu-toolbar",
        "luke-6",
        "luke-8",
        "luke-10",
        "luke-full",
        "choice-segment",
        "choice-box",
        ...PANEL_WORK_COLUMN.radius,
        ...FEEDBACK_DISPLAY.radius,
        ...CONTENT_TEXT.radius,
        ...ROWS_NAVIGATION.radius,
        ...PANEL_SHELL.radius,
        ...CHIPS_MEDIA_CALL.radius,
      ],
      shadow: [
        "dialog",
        "dialog-drop",
        "menu",
        "tooltip",
        "switch-thumb",
        ...PANEL_WORK_COLUMN.shadow,
        ...FEEDBACK_DISPLAY.shadow,
        ...CONTENT_TEXT.shadow,
        ...ROWS_NAVIGATION.shadow,
        ...CHIPS_MEDIA_CALL.shadow,
      ],
      font: ["ui"],
      aspect: [...CHIPS_MEDIA_CALL.aspect],
      container: [
        "dialog-confirm",
        "dialog-wide",
        "dialog-composer",
        "dialog-composer-reach",
        "dialog-media-min",
        "dialog-media-max",
        "dialog-command",
        "tooltip",
        "tooltip-card",
        ...FEEDBACK_DISPLAY.container,
        ...CONTENT_TEXT.container,
      ],
      animate: [
        "dialog-scrim",
        "dialog-in",
        "dialog-nudge",
        "dialog-shake",
        "menu-in",
        "tooltip-in",
        "tooltip-leave",
        ...PANEL_WORK_COLUMN.animate,
      ],
    },
    classGroups: {
      opacity: [{ opacity: ["disabled"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
