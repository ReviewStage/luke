import type { Board } from "@sidecar/hosted/board-wire";
import type { PlanCode } from "@sidecar/hosted/planning-view";
import { CollapseIcon, ExpandIcon, SidePanelIcon } from "@sidecar/panel";
import { CodePane } from "../planning/code-pane";
import { PlanBoard } from "../planning/plan-board";
import { PlanTranscript } from "../planning/plan-transcript";
import type { TranscriptRegion } from "../planning/transcript-model";
import {
  SIDE_PANEL_SHORTCUT_LABEL,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
  type SidePanelControl,
  type SidePanelTab,
} from "../planning/use-side-panel";
import { EDGE_SIDE, type ResizableEdgeProps, useResizableEdge } from "./use-resizable-edge";

/**
 * side-panel.tsx -- the open plan's side panel at the window's right: its toggle, its tab strip, its full-screen button, the tab shown, and the edge it is resized by.
 *
 * Each part draws what `use-side-panel.ts` holds and hands every press back
 * to it, so the panel decides nothing about when it shows.
 *
 * The panel runs the window's full height. Its top row is the window's drag
 * handle above it, holding the tabs at its left and, at its right, the
 * full-screen button and the toggle that hides the panel, which stands in the
 * plan's toolbar only while the panel is hidden. The plan's own actions stay
 * in the plan's toolbar and never come into the panel.
 */

/** What the Code tab says while Luke has no code on screen. */
const NO_CODE_LINE = "When Luke shows you code during a call, it appears here.";

/**
 * What the panel leaves the document beside it, in CSS pixels: the panel is
 * dragged no wider than the plan's area less this. `.side-panel`'s
 * `max-width` in desktop.css holds the same room while the window narrows.
 */
const DOCUMENT_RESERVE = 360;

/**
 * The panel's left edge, dragged to resize it, past its least width to close
 * it, and past its greatest to fill the window; double-clicked, it goes back
 * to the default width.
 */
function ResizeEdge({ edge }: { edge: ResizableEdgeProps }): React.JSX.Element {
  // biome-ignore lint/a11y/useSemanticElements: a resize edge is a focusable separator that takes keys, which an <hr> cannot be.
  return <div className="side-panel-resize" {...edge} />;
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

/** What was said on the open plan's calls, and the retry of a read that failed. */
interface SidePanelTranscript {
  region: TranscriptRegion;
  onRetry: () => void;
}

/** What the chosen tab shows. */
function TabContent({
  tab,
  planId,
  board,
  code,
  transcript,
}: {
  tab: SidePanelTab;
  planId: string;
  board: Board | undefined;
  code: PlanCode | undefined;
  transcript: SidePanelTranscript;
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
    case SIDE_PANEL_TAB.TRANSCRIPT:
      return <PlanTranscript region={transcript.region} onRetry={transcript.onRetry} />;
  }
}

/** The last button of whichever top row it stands in, which shows and hides the panel. */
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

/** Grows the panel over the document, or brings it back beside it. */
function FullScreenToggle({
  fullScreen,
  onToggle,
}: {
  fullScreen: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const label = fullScreen ? "Exit full screen" : "Expand panel";
  return (
    <button
      type="button"
      className="toolbar-button toolbar-icon-button side-panel-full-screen"
      aria-label={label}
      aria-pressed={fullScreen}
      title={label}
      onClick={onToggle}
    >
      {fullScreen ? <CollapseIcon /> : <ExpandIcon />}
    </button>
  );
}

/** The panel itself, drawn only while it is open. */
export function SidePanel({
  panel,
  planId,
  board,
  code,
  transcript,
}: {
  panel: SidePanelControl;
  planId: string;
  board: Board | undefined;
  code: PlanCode | undefined;
  transcript: SidePanelTranscript;
}): React.JSX.Element {
  const label = SIDE_PANEL_TABS.find((entry) => entry.tab === panel.tab)?.label;
  const { snap, edge } = useResizableEdge({
    side: EDGE_SIDE.LEFT,
    width: panel.width,
    bounds: SIDE_PANEL_WIDTH,
    reserve: DOCUMENT_RESERVE,
    label: "Resize panel",
    onResize: panel.onResize,
    onCollapse: panel.onToggle,
    onExpand: panel.onToggleFullScreen,
  });
  return (
    <aside
      className="side-panel"
      aria-label="Panel"
      data-full-screen={String(panel.fullScreen)}
      data-snap={snap}
      style={panel.fullScreen ? undefined : { width: panel.width }}
    >
      {/* The row is a drag region and each control in it is not; Chromium
          takes regions in document order, so the controls follow it. */}
      <div className="side-panel-bar">
        <TabStrip tab={panel.tab} onChoose={panel.onChoose} />
        <div className="side-panel-bar-actions">
          <FullScreenToggle fullScreen={panel.fullScreen} onToggle={panel.onToggleFullScreen} />
          <SidePanelToggle open onToggle={panel.onToggle} />
        </div>
      </div>
      <div className="side-panel-content" role="tabpanel" aria-label={label}>
        <TabContent
          tab={panel.tab}
          planId={planId}
          board={board}
          code={code}
          transcript={transcript}
        />
      </div>
      {/* Last, so the drag region of the row above does not take the
          edge's top from it. Full screen has no edge to drag. */}
      {panel.fullScreen ? null : <ResizeEdge edge={edge} />}
    </aside>
  );
}
