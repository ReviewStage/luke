import { cn } from "../cn.js";

/**
 * kbd.tsx -- shadcn/ui's kbd (style `base-nova`), vendored and drawn as the window's chord.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add kbd` reads as a small diff. Its local
 * changes:
 *
 * - `Kbd` is one key's glyph rather than a keycap: none of shadcn's box
 *   (`h-5`, `min-w-5`, `rounded-sm`, `bg-muted`, `px-1`), type (`text-xs`,
 *   `font-medium`, `font-sans`), ink, or tooltip inks, since a chord is set
 *   as a Mac menu prints a key equivalent, its keys in the words' own face
 *   and size; the user agent's monospace is undone (`font-family: inherit`),
 *   and the glyph's box is cut to the capitals' height (`text-box`), so a
 *   row that centres the chord centres its capitals on its own words, and
 *   every glyph stands on one baseline. None of `pointer-events-none` or
 *   `select-none`, which the window never set on a chord.
 * - `KbdGroup` is the chord: shadcn's `inline-flex items-center` with the
 *   gap and type `@luke/ui`'s `Shortcut` gives it
 *   (`components/shortcut/shortcut.tsx`), which is what an app draws; this
 *   is its inside.
 */

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn("[font-family:inherit] [text-box:trim-both_cap_alphabetic]", className)}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd data-slot="kbd-group" className={cn("inline-flex items-center", className)} {...props} />
  );
}

export { Kbd, KbdGroup };
