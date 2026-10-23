import { type ReactNode, useRef } from "react";

/**
 * readable-controls.tsx -- a region whose controls' words select and copy as a line of text does, a press that drags out a selection selecting rather than pressing.
 *
 * A control is pressed rather than read, so an app's reset keeps its words
 * from selecting. Some controls carry words a reader wants to copy, as an
 * agent's ask does: an option's label and detail, a step to take by hand.
 * Inside this region a choice's label and detail and a checkbox's words
 * select (readable-controls.css), and a press whose drag changed the
 * selection is held back, so dragging over an option's words to copy them
 * never picks it, nor ticks a step. A press that selects nothing, and one
 * from the keyboard, presses as it always does. The region draws no box of
 * its own, so what holds it lays its controls out as before.
 */

/** Where a selection starts and ends, which a press compares to tell whether its drag moved them. */
interface SelectionEnds {
  readonly anchor: Node | null;
  readonly anchorOffset: number;
  readonly focus: Node | null;
  readonly focusOffset: number;
}

/** The window's selection's ends as they stand; none where nothing is selected. */
function selectionEnds(): SelectionEnds | undefined {
  const selection = document.getSelection();
  if (selection === null || selection.isCollapsed) return undefined;
  return {
    anchor: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focus: selection.focusNode,
    focusOffset: selection.focusOffset,
  };
}

/** Whether a selection stands now that did not when the press went down. */
function selectedSince(before: SelectionEnds | undefined): boolean {
  const now = selectionEnds();
  if (now === undefined) return false;
  if (before === undefined) return true;
  return (
    now.anchor !== before.anchor ||
    now.anchorOffset !== before.anchorOffset ||
    now.focus !== before.focus ||
    now.focusOffset !== before.focusOffset
  );
}

/** Controls whose words a reader may select, a press that selects holding back its press. */
export function ReadableControls({ children }: { children: ReactNode }): React.JSX.Element {
  const before = useRef<SelectionEnds | undefined>(undefined);
  return (
    <div
      className="luke-readable-controls"
      onPointerDownCapture={() => {
        before.current = selectionEnds();
      }}
      onClickCapture={(event) => {
        // Note that a press from the keyboard has no detail, and never selects.
        if (event.detail === 0 || !selectedSince(before.current)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}
