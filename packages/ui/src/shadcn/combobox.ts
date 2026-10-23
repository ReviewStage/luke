/**
 * combobox.ts -- shadcn/ui's combobox (style `base-nova`, on Base UI), its list's drawing alone, in Luke's menu rows.
 *
 * What is kept of `shadcn add combobox` is the drawing of its list: the list
 * box, an item, a group's label, and the empty line, each the class string
 * its `ComboboxList`, `ComboboxItem`, `ComboboxLabel`, and `ComboboxEmpty`
 * spell, so a later `shadcn add combobox` reads as a small diff against
 * them. Its Base UI parts are left out, because Base UI's combobox owns
 * whether the list is open, what it filters, and which item is lit, and
 * every caller of `@luke/ui`'s `Combobox` owns all three
 * (`components/combobox/use-combobox-field.ts`), a list engine of the app's
 * (cmdk) among them; and its input, trigger, clear, chips, and popup are
 * left out, because the field is the text field's own and the list stands
 * in flow under it as one well rather than over the page.
 *
 * Luke's changes, against shadcn's own strings: an item is a menu row's
 * height and corner, lit by the `aria-selected` the field or the engine sets
 * rather than Base UI's `data-highlighted`, dimmed by `aria-disabled`, its
 * indicator a slot of its own at the row's end rather than an absolute
 * check; the list is capped by the app's placement hook
 * (`--luke-combobox-list-max`), scrolls only down (its ring is `combobox.css`'s
 * to leave off, the active option marking it); the label is the subtle caption; and the empty
 * line is a row or two tall, so a list with nothing never falls to a sliver.
 * `@luke/ui`'s `Combobox` (`components/combobox/combobox.tsx`) is what an
 * app draws; these are its inside.
 */

/** The list box: a column that scrolls down within its cap, and never sideways. */
export const COMBOBOX_LIST =
  "relative flex max-h-combobox-list flex-col overflow-x-hidden overflow-y-auto overscroll-contain p-menu-inset data-[height=fill]:max-h-none data-[height=fill]:min-h-0 data-[height=fill]:flex-auto";

/** The list as the field's foot opens onto it: the field's edge and ground, under a field whose own foot is square. */
export const COMBOBOX_WELL =
  "flex min-w-0 flex-col *:data-[slot=combobox-list]:rounded-b-control *:data-[slot=combobox-list]:border *:data-[slot=combobox-list]:border-t-0 *:data-[slot=combobox-list]:border-border-strong *:data-[slot=combobox-list]:bg-input";

/** An item: its glyph, its name, then its detail and hint at its end, lit while it is the active option. */
export const COMBOBOX_ITEM =
  "group/option flex h-menu-row flex-none cursor-default items-center gap-icon-gap rounded-menu-row px-luke-8 font-sans text-body whitespace-nowrap text-foreground select-none aria-selected:not-aria-disabled:bg-secondary aria-disabled:opacity-40";

/** What leads an item before its glyph, a task's key say, in a column wide enough for a long one, so the glyphs and names it leads line up down the list. */
export const COMBOBOX_ITEM_LEAD = "inline-flex min-w-combobox-lead flex-none items-center";

/** An item's leading glyph, muted, a glyph's size whatever it is handed. */
export const COMBOBOX_ITEM_GLYPH =
  "inline-flex size-menu-glyph flex-none items-center justify-center text-muted-foreground [&_:is(svg,img)]:size-menu-glyph";

/** An item's name, which gives way only after its detail does. */
export const COMBOBOX_ITEM_LABEL = "min-w-0 flex-initial overflow-hidden font-medium";

/** An item's detail, quieter, giving way first where the row runs short. */
export const COMBOBOX_ITEM_DETAIL =
  "block min-w-0 flex-[0_1000_auto] overflow-hidden pl-luke-12 text-caption leading-[inherit] text-subtle-foreground";

/** An item's hint at its end, at a menu's distance from what stands before it, as a chord is. */
export const COMBOBOX_ITEM_HINT =
  "inline-flex flex-none items-center gap-luke-4 pl-luke-16 text-caption leading-[inherit] text-subtle-foreground";

/** An item's end slot, one glyph wide: a chevron, or the check of the one chosen now in the text's own ink. */
export const COMBOBOX_ITEM_END =
  "inline-flex size-menu-glyph flex-none items-center justify-center text-subtle-foreground group-aria-current/option:text-foreground [&_svg]:size-menu-glyph [&_svg]:text-inherit";

/** A group's heading over its run. */
export const COMBOBOX_LABEL = "px-luke-8 pt-luke-8 pb-luke-4 text-caption font-medium text-subtle-foreground";

/** What stands where no option does, or after them: one quiet line, centred, a row or two tall. */
export const COMBOBOX_EMPTY =
  "m-0 flex min-h-luke-40 items-center justify-center px-luke-12 py-luke-4 text-center text-caption text-subtle-foreground";
