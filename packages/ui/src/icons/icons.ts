/**
 * icons.ts -- the one door every icon is imported through.
 *
 * Lucide's glyphs by Lucide's own names, the registry that says which one
 * glyph stands for each concept the app draws, and the seats an icon is drawn
 * at. A screen asks for a concept (`GLYPH.TASK`) and seats it
 * (`<GlyphSlot size={ICON_SIZE.MEDIUM}>`); it reaches for a Lucide name only
 * for a glyph that is no concept of its own. Nothing outside `@luke/ui` imports
 * `lucide-react`: `anti-slop/no-lucide-outside-door` holds that, from a baseline
 * of the files that still do, which only shrinks as each screen moves here.
 *
 * `@luke/ui`'s own glyphs (`face/glyphs.tsx`) are reached through `GLYPH`, and
 * through the barrel under their old names until the last screen that imports
 * one moves. A door re-exports no name the barrel exports, so the glyphs'
 * names are not repeated here.
 */

export * from "lucide-react";
export { GLYPH, type Glyph } from "./glyph-registry.js";
export { ICON_SIZE, ICON_STROKE_WIDTH, type IconSize } from "./icon-size.js";
