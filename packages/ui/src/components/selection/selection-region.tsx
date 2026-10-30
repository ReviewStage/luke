import type { ReactNode } from "react";
import {
  type ListSelection,
  ListSelectionContext,
  selectionRoot,
  useListSelection,
} from "./list-selection.js";

export { selectionRun } from "./list-selection.js";

/**
 * selection-region.tsx -- a box whose rows are chosen together, as a `List`'s are, where the rows are the app's own: a grid of `CardPress` rows split under group heads.
 *
 * A `List` chooses its own `ListRow`s. A page that draws its rows another
 * way, one grid of columns under several folding groups, as the Tasks
 * page's List does, still chooses them as a Mac's list does: it stands its
 * groups in a region, and each row's `CardPress` takes part by its key
 * (`selectKey`). ⌘-click, ⇧-click, ⇧↑↓, ⌘A, and Esc then reach across every
 * group the region holds, in the order the rows are drawn
 * (`list-selection.ts`). The region draws no box of its own, so the page's
 * layout stands as it was. Where its rows stand in runs side by side, a
 * board's columns, each run wears `selectionRun`, and a ⇧-press reaches only
 * across its own. A region drawing only the rows near the view
 * (`VirtualRows`) is handed every row's key in order (`order`), so ⇧-click
 * and ⌘A reach the rows it leaves undrawn.
 */

/** A region whose `CardPress` rows are chosen together, kept by `selection`'s owner. */
export function SelectionRegion({
  id,
  selection,
  order,
  children,
}: {
  /** The id a `SelectionBar` over the region names (`controls`). */
  id: string;
  /** Which rows are chosen and what hears the next set. */
  selection: ListSelection;
  /** Every choosable row's key, in order, where the region draws only some of them; the rows drawn are read where none is given. */
  order?: readonly string[] | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const chooser = useListSelection(selection, order);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the region only hears the keys its rows' presses raise, which bubble to it; the presses are the controls.
    <div
      id={id}
      className="luke-selection-region contents"
      {...selectionRoot()}
      onKeyDown={(event) => {
        chooser.onKeyDown(event);
      }}
    >
      <ListSelectionContext.Provider value={chooser.selecting}>
        {children}
      </ListSelectionContext.Provider>
    </div>
  );
}
