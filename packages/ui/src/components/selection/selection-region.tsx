import type { ReactNode } from "react";
import {
  type ListSelection,
  ListSelectionContext,
  selectionRoot,
  useListSelection,
} from "./list-selection.js";

export { selectionRun } from "./list-selection.js";

export function SelectionRegion({
  id,
  selection,
  order,
  bringIn,
  children,
}: {
  id: string;
  selection: ListSelection;
  order?: readonly (readonly string[])[] | undefined;
  bringIn?: ((key: string, then: () => void) => boolean) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const chooser = useListSelection(selection, order, bringIn);
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
