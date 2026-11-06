import { type ReactNode, useRef } from "react";

interface SelectionEnds {
  readonly anchor: Node | null;
  readonly anchorOffset: number;
  readonly focus: Node | null;
  readonly focusOffset: number;
}

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

export function ReadableControls({ children }: { children: ReactNode }): React.JSX.Element {
  const before = useRef<SelectionEnds | undefined>(undefined);
  return (
    <div
      className="ui-readable-controls"
      onPointerDownCapture={() => {
        before.current = selectionEnds();
      }}
      onClickCapture={(event) => {
        if (event.detail === 0 || !selectedSince(before.current)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}
