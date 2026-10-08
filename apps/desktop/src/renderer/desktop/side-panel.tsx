import type { Board } from "@sidecar/hosted/board-wire";
import type { PlanCode } from "@sidecar/hosted/planning-view";
import { SidePanelIcon } from "@sidecar/panel";
import { useRef } from "react";
import { CodePane } from "../planning/code-pane";
import { PlanBoard } from "../planning/plan-board";
import {
  SIDE_PANEL_SHORTCUT_LABEL,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
  type SidePanelControl,
  type SidePanelTab,
} from "../planning/use-side-panel";

/**
 * side-panel.tsx -- the open plan's side panel at the window's right: its toolbar toggle, its tab strip, the tab shown, and the edge it is resized by.
 *
 * Each part draws what `use-side-panel.ts` holds and hands every press back
 * to it, so the panel decides nothing about when it shows.
 */

/** What the Code tab says while Luke has no code on screen. */
const NO_CODE_LINE = "When Luke shows you code during a call, it appears here.";

/** How far one arrow press on the resize edge moves it, in CSS pixels. */
const RESIZE_STEP = 16;

/**
 * The panel's left edge, dragged to resize it. The pointer is captured on
 * press, so a drag that crosses the board's canvas is still the edge's.
 */
function ResizeEdge({
  width,
  onResize,
}: {
  width: number;
  onResize: (width: number) => void;
}): React.JSX.Element {
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a resize edge is a focusable separator that takes keys, which an <hr> cannot be.
    <div
      className="side-panel-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuemin={SIDE_PANEL_WIDTH.MIN}
      aria-valuemax={SIDE_PANEL_WIDTH.MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        if (drag.current !== undefined)
          onResize(drag.current.width + drag.current.x - event.clientX);
      }}
      onPointerUp={() => {
        drag.current = undefined;
      }}
      onPointerCancel={() => {
        drag.current = undefined;
      }}
      onKeyDown={(event) => {
        // The panel is on the right, so Left widens it.
        const step =
          event.key === "ArrowLeft" ? RESIZE_STEP : event.key === "ArrowRight" ? -RESIZE_STEP : 0;
        if (step === 0) return;
        event.preventDefault();
        onResize(width + step);
      }}
    />
  );
}

/** The strip of tabs across the panel's top. */
function TabStrip({
  tab,
  onChoose,
}: {
  tab: SidePanelTab;
  onChoose: (tab: SidePanelTab) => void;
}): React.JSX.Element {
  return (
    <div className="side-panel-tabs" role="tablist" aria-label="Panel">
      {SIDE_PANEL_TABS.map((entry) => (
        <button
          type="button"
          role="tab"
          key={entry.tab}
          className="side-panel-tab"
          aria-selected={entry.tab === tab}
          onClick={() => onChoose(entry.tab)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}

/** What the chosen tab shows. */
function TabContent({
  tab,
  planId,
  board,
  code,
}: {
  tab: SidePanelTab;
  planId: string;
  board: Board | undefined;
  code: PlanCode | undefined;
}): React.JSX.Element {
  switch (tab) {
    case SIDE_PANEL_TAB.BOARD:
      return <PlanBoard planId={planId} board={board} />;
    case SIDE_PANEL_TAB.CODE:
      return code === undefined ? (
        <p className="side-panel-empty">{NO_CODE_LINE}</p>
      ) : (
        <CodePane code={code} />
      );
  }
}

/** The toolbar's last button, which shows and hides the panel. */
export function SidePanelToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const label = open ? "Hide panel" : "Show panel";
  return (
    <button
      type="button"
      className="toolbar-button toolbar-icon-button side-panel-toggle"
      aria-label={label}
      aria-expanded={open}
      title={`${label} (${SIDE_PANEL_SHORTCUT_LABEL})`}
      data-open={String(open)}
      onClick={onToggle}
    >
      <SidePanelIcon />
    </button>
  );
}

/** The panel itself, drawn only while it is open. */
export function SidePanel({
  panel,
  planId,
  board,
  code,
}: {
  panel: SidePanelControl;
  planId: string;
  board: Board | undefined;
  code: PlanCode | undefined;
}): React.JSX.Element {
  const label = SIDE_PANEL_TABS.find((entry) => entry.tab === panel.tab)?.label;
  return (
    <aside className="side-panel" aria-label="Panel" style={{ width: panel.width }}>
      <ResizeEdge width={panel.width} onResize={panel.onResize} />
      <TabStrip tab={panel.tab} onChoose={panel.onChoose} />
      <div className="side-panel-content" role="tabpanel" aria-label={label}>
        <TabContent tab={panel.tab} planId={planId} board={board} code={code} />
      </div>
    </aside>
  );
}
