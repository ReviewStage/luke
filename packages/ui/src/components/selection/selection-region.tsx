import type { ReactNode } from "react";
import {
  type ListSelection,
  ListSelectionContext,
  PLAIN_PRESS,
  type PlainPress,
  selectionRoot,
  useListSelection,
} from "./list-selection.js";

export { PLAIN_PRESS, type PlainPress, selectionRun } from "./list-selection.js";

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
 * (`VirtualRows`) is handed every row's key in order, run by run (`order`),
 * so ⇧-click, ⇧↑↓, and ⌘A reach the rows it leaves undrawn, and the door
 * that draws one (`bringIn`), so ⇧↑↓ take the focus on to it. A region
 * with no bar over it, the sidebar's, has a plain press let the rows chosen
 * go (`plain`), as a Mac's sidebar list does.
 */

/** A region whose `CardPress` rows are chosen together, kept by `selection`'s owner. */
export function SelectionRegion({
  id,
  selection,
  order,
  bringIn,
  plain = PLAIN_PRESS.KEEPS,
  children,
}: {
  /** The id a `SelectionBar` over the region names (`controls`). */
  id: string;
  /** Which rows are chosen and what hears the next set. */
  selection: ListSelection;
  /** Every choosable row's key, in order, run by run, where the region draws only some of them: one run where its rows stand in none; the rows drawn are read where none is given. */
  order?: readonly (readonly string[])[] | undefined;
  /** Brings the row keyed `key` into view, drawing it, and calls `then` once it is drawn; answers whether any row has that key. */
  bringIn?: ((key: string, then: () => void) => boolean) | undefined;
  /** What a plain press does to the rows chosen: kept where a `SelectionBar` lets them go, let go where none stands. */
  plain?: PlainPress | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const chooser = useListSelection(selection, order, bringIn, plain);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the region only hears the keys its rows' presses raise, which bubble to it; the presses are the controls.
    <div
      id={id}
      className="ui-selection-region contents"
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
