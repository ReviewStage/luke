/**
 * palette-query.ts -- the words a shot types into ⌘K as the staging opens it, taken once by the palette's opening.
 *
 * Throwaway (`README.md`). Imports nothing, so the palette can read it
 * without reaching the shots' registry.
 */

let armed: string | undefined;

/** Arms the query the palette's next opening types. */
export function armPaletteQuery(query: string): void {
  armed = query;
}

/** The armed query, once; nothing where none is armed. */
export function takePaletteQuery(): string | undefined {
  const query = armed;
  armed = undefined;
  return query;
}
