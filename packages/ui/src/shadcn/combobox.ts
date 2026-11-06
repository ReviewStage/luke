export const COMBOBOX_LIST =
  "relative flex max-h-combobox-list flex-col overflow-x-hidden overflow-y-auto overscroll-contain p-menu-inset data-[height=fill]:max-h-none data-[height=fill]:min-h-0 data-[height=fill]:flex-auto";

export const COMBOBOX_WELL =
  "flex min-w-0 flex-col *:data-[slot=combobox-list]:rounded-b-control *:data-[slot=combobox-list]:border *:data-[slot=combobox-list]:border-t-0 *:data-[slot=combobox-list]:border-border-strong *:data-[slot=combobox-list]:bg-input";

export const COMBOBOX_ITEM =
  "group/option flex h-menu-row flex-none cursor-default items-center gap-icon-gap rounded-menu-row px-row-inset font-sans text-body whitespace-nowrap text-foreground select-none aria-selected:not-aria-disabled:bg-secondary";

export const COMBOBOX_ITEM_LEAD =
  "inline-flex flex-none items-center group-aria-disabled/option:opacity-disabled";

export const COMBOBOX_ITEM_GLYPH =
  "inline-flex size-menu-glyph flex-none items-center justify-center text-muted-foreground group-aria-disabled/option:opacity-disabled [&_:is(svg,img)]:size-menu-glyph";

export const COMBOBOX_ITEM_LABEL =
  "min-w-0 flex-initial overflow-hidden font-label group-aria-disabled/option:opacity-disabled";

export const COMBOBOX_ITEM_DETAIL =
  "block min-w-0 flex-[0_1000_auto] overflow-hidden pl-ui-12 text-caption leading-[inherit] text-muted-foreground";

export const COMBOBOX_ITEM_HINT =
  "inline-flex flex-none items-center gap-ui-4 pl-ui-16 text-caption leading-[inherit] text-muted-foreground";

export const COMBOBOX_ITEM_END =
  "inline-flex size-menu-glyph flex-none items-center justify-center text-muted-foreground group-aria-current/option:text-foreground group-aria-disabled/option:opacity-disabled [&_svg]:size-menu-glyph [&_svg]:text-inherit";

export const COMBOBOX_HEADING = "px-row-inset pt-row-inset pb-ui-4";

export const COMBOBOX_EMPTY =
  "m-0 flex min-h-ui-40 items-center justify-center px-list-inset py-ui-4 text-center text-caption text-muted-foreground";
