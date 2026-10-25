import type { ReactNode } from "react";
import {
  type ListSelection,
  ListSelectionContext,
  selectionRoot,
  useListSelection,
} from "./list-selection.js";

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
 * layout stands as it was.
 */

/** A region whose `CardPress` rows are chosen together, kept by `selection`'s owner. */
export function SelectionRegion({
  id,
  selection,
  children,
}: {
  /** The id a `SelectionBar` over the region names (`controls`). */
  id: string;
  /** Which rows are chosen and what hears the next set. */
  selection: ListSelection;
  children: ReactNode;
}): React.JSX.Element {
  const chooser = useListSelection(selection);
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
