/**
 * home-row.ts -- the parts of a row on Home, a person's page, the Inbox, and Chat's rail, as class names each draws its row's picture and metadata with.
 *
 * A row's metadata is what the row is about, a teammate's face, the row's
 * mark, and its time, set apart by the line's own gap and centred on it.
 * The context gives way before the marks and the time, because the
 * metadata's slot clips at its end and the time is what ends it, and stops
 * at a bound, so a long one never takes the row's title's room.
 */

/** The metadata: its parts in a line, all but the context held whole, a draft's pencil at the attention mark's size, as a sidebar task's row wears it at its glyph's (`draft-mark.tsx`). */
export const HOME_ROW_META =
  "home-row-meta inline-flex items-center gap-item-gap [&>:not(.home-row-context)]:flex-none [&_.draft-mark]:size-luke-12";

/** What the row is about, muted at the caption's size, cut short within its bound. */
export const HOME_ROW_CONTEXT =
  "home-row-context min-w-0 max-w-row-context flex-initial overflow-hidden text-muted-foreground text-caption-inline whitespace-nowrap";

/** The row's picture, a tile or a glyph at a row glyph's size; a state glyph's own drawing is left to its mark, which fills the share of the face the glyph is given (`actor-ref.tsx`). */
export const HOME_ROW_PICTURE =
  "home-row-picture inline-flex size-luke-16 flex-none items-center justify-center text-muted-foreground [&_:not(.state-glyph)>svg]:size-control-icon";
