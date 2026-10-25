/**
 * drop-slot.tsx -- the empty place a carried row would land in, where a list that takes one holds none yet: a row's height, its edge dashed.
 *
 * A list that stands only while it holds rows, as the sidebar's Pinned,
 * draws one under its heading while a row is carried, so the first row has
 * somewhere to be let go. It says nothing: the heading above it names the
 * list and the row in hand is what goes there, so a line about dragging
 * would only describe what the reader is already doing (docs/DESIGN.md,
 * "delete what describes"). Carried over, the zone around it wears
 * `CARD_DROP_TARGET` (`use-row-drag.ts`), and its edge takes the focus
 * ring's ink. It is hidden from assistive technology, since a drag is the
 * pointer's alone and the list's own menus pin from the keyboard.
 */

/** The empty place a carried row lands in. */
export function DropSlot(): React.JSX.Element {
  return <div className="luke-drop-slot" aria-hidden="true" />;
}
