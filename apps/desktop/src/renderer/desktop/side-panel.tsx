import type { Board } from "@sidecar/hosted/board-wire";
import type { PlanCode } from "@sidecar/hosted/planning-view";
import { CollapseIcon, ExpandIcon, SidePanelIcon } from "@sidecar/panel";
import { APP_COMMAND, type AppCommand } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { CodePane } from "../planning/code-pane";
import { PlanBoard } from "../planning/plan-board";
import { PlanTranscript } from "../planning/plan-transcript";
import type { TranscriptRegion } from "../planning/transcript-model";
import {
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
  type SidePanelControl,
  type SidePanelTab,
} from "../planning/use-side-panel";
import { Tooltip } from "../tooltip";
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

/** The shortcut that shows each tab. */
const TAB_COMMAND = {
  [SIDE_PANEL_TAB.BOARD]: APP_COMMAND.SHOW_BOARD,
  [SIDE_PANEL_TAB.CODE]: APP_COMMAND.SHOW_CODE,
  [SIDE_PANEL_TAB.TRANSCRIPT]: APP_COMMAND.SHOW_TRANSCRIPT,
} as const satisfies Record<SidePanelTab, AppCommand>;

/**
 * The panel's left edge, dragged to resize it, past its least width to close
 * it, and past its greatest to fill the window; double-clicked, it goes back
 * to the default width.
 */
function ResizeEdge({ edge }: { edge: ResizableEdgeProps }): React.JSX.Element {
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
        <Tooltip key={entry.tab} label={entry.label} command={TAB_COMMAND[entry.tab]}>
          <button
            type="button"
            role="tab"
            className="side-panel-tab"
            aria-selected={entry.tab === tab}
            onClick={() => onChoose(entry.tab)}
          >
            {entry.label}
          </button>
        </Tooltip>
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

/**
 * The last button of whichever top row it stands in, which shows and hides
 * the panel. Exactly one stands beside an open plan, the plan's toolbar's or
 * the panel's own, so it is also what offers the panel's shortcuts: its own,
 * and one to open the panel on each tab.
 */
export function SidePanelToggle({ panel }: { panel: SidePanelControl }): React.JSX.Element {
  const label = panel.open ? "Hide panel" : "Show panel";
  useAppCommand(APP_COMMAND.TOGGLE_SIDE_PANEL, panel.onToggle);
  useAppCommand(APP_COMMAND.SHOW_BOARD, () => panel.onChoose(SIDE_PANEL_TAB.BOARD));
  useAppCommand(APP_COMMAND.SHOW_CODE, () => panel.onChoose(SIDE_PANEL_TAB.CODE));
  useAppCommand(APP_COMMAND.SHOW_TRANSCRIPT, () => panel.onChoose(SIDE_PANEL_TAB.TRANSCRIPT));
  return (
    <Tooltip label={label} command={APP_COMMAND.TOGGLE_SIDE_PANEL}>
      <button
        type="button"
        className="toolbar-button toolbar-icon-button side-panel-toggle"
        aria-label={label}
        aria-expanded={panel.open}
        data-open={String(panel.open)}
        onClick={panel.onToggle}
      >
        <SidePanelIcon />
      </button>
    </Tooltip>
  );
}

/**
 * Grows the panel over the document, or brings it back beside it. It stands
 * while the panel is open, so it offers the full-screen chord, and the menu
 * bar's way out while the panel fills the window. Escape's own way out is the
 * window's Escape, which steps back one layer at a time.
 */
function FullScreenToggle({
  fullScreen,
  onToggle,
}: {
  fullScreen: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const label = fullScreen ? "Exit full screen" : "Expand panel";
  useAppCommand(APP_COMMAND.TOGGLE_FULL_SCREEN, onToggle);
  useAppCommand(APP_COMMAND.EXIT_FULL_SCREEN, fullScreen ? onToggle : undefined);
  return (
    <Tooltip label={label} command={APP_COMMAND.TOGGLE_FULL_SCREEN}>
      <button
        type="button"
        className="toolbar-button toolbar-icon-button side-panel-full-screen"
        aria-label={label}
        aria-pressed={fullScreen}
        onClick={onToggle}
      >
        {fullScreen ? <CollapseIcon /> : <ExpandIcon />}
      </button>
    </Tooltip>
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
          <SidePanelToggle panel={panel} />
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
