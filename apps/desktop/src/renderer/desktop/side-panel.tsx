import type { Board } from "@sidecar/hosted/board-wire";
import type { PlanCode, PlanWorkTurn } from "@sidecar/hosted/planning-view";
import {
  BoardIcon,
  CodeIcon,
  CollapseIcon,
  ExpandIcon,
  PlusIcon,
  SidePanelIcon,
  TranscriptIcon,
  WorkIcon,
} from "@sidecar/panel";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { APP_COMMAND, type AppCommand } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { CodePane } from "../planning/code-pane";
import { PlanBoard } from "../planning/plan-board";
import { PlanTranscript } from "../planning/plan-transcript";
import { PlanWork } from "../planning/plan-work";
import type { TranscriptRegion } from "../planning/transcript-model";
import {
  SIDE_PANEL_TAB,
  SIDE_PANEL_TAB_KIND,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
  type SidePanelControl,
  type SidePanelTab,
  tabAddable,
} from "../planning/use-side-panel";
import { commandKeyshortcuts, Tooltip } from "../tooltip";
import {
  ActionMenu,
  MENU_ALIGN,
  MENU_DROP,
  type MenuAction,
  MenuItem,
  type OpenMenu,
} from "./action-menu";
import { paneTiming } from "./pane-motion";
import { Tab, TabStrip } from "./tab-strip";
import { EDGE_SIDE, type ResizableEdgeProps, useResizableEdge } from "./use-resizable-edge";

/**
 * side-panel.tsx -- the open plan's side panel at the window's right: its toggle, its tabs and their "+", its full-screen button, the tab shown, and the edge it is resized by.
 *
 * Each part draws what `use-side-panel.ts` holds and hands every press back
 * to it, so the panel decides nothing about when it shows.
 *
 * The panel runs the window's full height. Its top row is the window's drag
 * handle above it, holding the tabs and their "+" at its left and the
 * full-screen button at its right, which leaves room past itself for the
 * toggle; the tabs narrow, then scroll, rather than push either. The toggle
 * is the window's rather than the panel's (desktop-shell.tsx), so the
 * panel's coming and going never moves it. The plan's own actions stay in the plan's toolbar
 * and never come into the panel.
 *
 * Shutting the panel, or bringing it back from full screen, changes the
 * window's layout at once, and the panel keeps drawing what it held until its
 * exit has played (`useSidePanelDrawing`); its arrivals are pane-motion.tsx's.
 */

/** What the Code tab says while Luke has no code on screen. */
const NO_CODE_LINE = "When Luke shows you code during a call, it appears here.";

/**
 * What the panel leaves the document beside it, as desktop.css declares it
 * on the plan's area: the panel is dragged no wider than the area less this,
 * and has no greatest width of its own. `.side-panel`'s `max-width` holds the
 * same room while the window narrows.
 */
const DOCUMENT_RESERVE_PROPERTY = "--document-reserve";

/**
 * The room the document keeps in the plan's area, in CSS pixels. Where the
 * stylesheet declares none it keeps the panel's own least width, the floor
 * the stylesheet gives it beside the open sidebar.
 */
function documentReserve(area: HTMLElement): number {
  const declared = Number.parseFloat(
    getComputedStyle(area).getPropertyValue(DOCUMENT_RESERVE_PROPERTY),
  );
  return Number.isFinite(declared) ? declared : SIDE_PANEL_WIDTH.MIN;
}

/** Each kind's glyph, leading its tab and its row in the "+" menu. */
const TAB_ICON = {
  [SIDE_PANEL_TAB.BOARD]: <BoardIcon />,
  [SIDE_PANEL_TAB.CODE]: <CodeIcon />,
  [SIDE_PANEL_TAB.TRANSCRIPT]: <TranscriptIcon />,
  [SIDE_PANEL_TAB.WORK]: <WorkIcon />,
} as const satisfies Record<SidePanelTab, React.JSX.Element>;

/** The shortcut that shows each tab. */
const TAB_COMMAND = {
  [SIDE_PANEL_TAB.BOARD]: APP_COMMAND.SHOW_BOARD,
  [SIDE_PANEL_TAB.CODE]: APP_COMMAND.SHOW_CODE,
  [SIDE_PANEL_TAB.TRANSCRIPT]: APP_COMMAND.SHOW_TRANSCRIPT,
  [SIDE_PANEL_TAB.WORK]: APP_COMMAND.SHOW_WORK,
} as const satisfies Record<SidePanelTab, AppCommand>;
/** How the drawn panel is on its way to the one asked for, if it is: shutting, or leaving full screen. */
const PANEL_LEAVING = {
  NONE: "none",
  CLOSE: "close",
  FULL_SCREEN: "full-screen",
} as const;

type PanelLeaving = (typeof PANEL_LEAVING)[keyof typeof PANEL_LEAVING];

/**
 * The panel's left edge, dragged to resize it, past its least width to close
 * it, and past its greatest to fill the window; double-clicked, it goes back
 * to the default width.
 */
function ResizeEdge({ edge }: { edge: ResizableEdgeProps }): React.JSX.Element {
  return <div className="side-panel-resize" {...edge} />;
}

/** The menu entry, or the empty panel's row, that opens a tab of the kind. */
function kindAction(
  tab: SidePanelTab,
  tabs: readonly SidePanelTab[],
  onChoose: (tab: SidePanelTab) => void,
): MenuAction {
  const action: MenuAction = {
    label: SIDE_PANEL_TAB_KIND[tab].label,
    icon: TAB_ICON[tab],
    command: TAB_COMMAND[tab],
    onSelect: () => onChoose(tab),
  };
  return tabAddable(tab, tabs) ? action : { ...action, unavailable: "Open" };
}

/**
 * The "+" after the last tab, and the menu it drops: every kind of tab, with
 * its shortcut, and those that may not be opened again dimmed. With every
 * kind open there is nothing to add, so it is dimmed and says so.
 */
function AddTabButton({
  tabs,
  onChoose,
}: {
  tabs: readonly SidePanelTab[];
  onChoose: (tab: SidePanelTab) => void;
}): React.JSX.Element {
  const [menu, setMenu] = useState<OpenMenu | undefined>(undefined);
  const opener = useRef<HTMLButtonElement | null>(null);
  const close = useCallback((returnFocus: boolean) => {
    setMenu(undefined);
    if (returnFocus) opener.current?.focus();
  }, []);
  const full = SIDE_PANEL_TABS.every((kind) => !tabAddable(kind, tabs));
  return (
    <>
      <Tooltip label={full ? "Every tab is open" : "Open a tab"}>
        <button
          ref={opener}
          type="button"
          className="icon-button tab-add"
          aria-label="Open a tab"
          aria-haspopup="menu"
          aria-expanded={menu !== undefined}
          aria-disabled={full}
          onClick={(event) => {
            if (menu !== undefined) {
              close(true);
              return;
            }
            if (full) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            setMenu({
              placement: { x: bounds.left, y: bounds.bottom + MENU_DROP, align: MENU_ALIGN.START },
              opener: event.currentTarget,
            });
          }}
        >
          <PlusIcon />
        </button>
      </Tooltip>
      {menu === undefined ? null : (
        <ActionMenu
          label="Open a tab"
          menu={menu}
          groups={[SIDE_PANEL_TABS.map((kind) => kindAction(kind, tabs, onChoose))]}
          onClose={close}
        />
      )}
    </>
  );
}

/**
 * The strip of tabs across the panel's top, then the "+". A tab's own word
 * is all it needs to say, so it hangs no pill; its chord is in the View menu,
 * the "+" menu, and on the Keyboard shortcuts page.
 */
function PanelTabs({
  panel,
  unread,
}: {
  panel: SidePanelControl;
  unread: readonly SidePanelTab[];
}): React.JSX.Element {
  return (
    <div className="side-panel-tabs">
      <TabStrip label="Panel">
        {panel.tabs.map((tab) => (
          <Tab
            key={tab}
            icon={TAB_ICON[tab]}
            label={SIDE_PANEL_TAB_KIND[tab].label}
            selected={tab === panel.tab}
            unread={unread.includes(tab)}
            keyshortcuts={commandKeyshortcuts(TAB_COMMAND[tab])}
            onSelect={() => panel.onChoose(tab)}
            onClose={() => panel.onClose(tab)}
          />
        ))}
      </TabStrip>
      <AddTabButton tabs={panel.tabs} onChoose={panel.onChoose} />
    </div>
  );
}

/** The panel with every tab closed: what it holds, offered as the "+" menu offers it. */
function NoTabs({ onChoose }: { onChoose: (tab: SidePanelTab) => void }): React.JSX.Element {
  return (
    <div className="side-panel-no-tabs">
      <p className="side-panel-no-tabs-line">No tabs open</p>
      {SIDE_PANEL_TABS.map((kind) => {
        const action = kindAction(kind, [], onChoose);
        return <MenuItem key={kind} action={action} inMenu={false} onChoose={action.onSelect} />;
      })}
    </div>
  );
}

/** What was said on the open plan's calls, and the retry of a read that failed. */
interface SidePanelTranscript {
  region: TranscriptRegion;
  onRetry: () => void;
}

/** What Luke's planning model wrote and ran on the open plan's calls, and whether a call still stands. */
interface SidePanelWork {
  turns: readonly PlanWorkTurn[] | undefined;
  callLive: boolean;
}

/** What the chosen tab shows. */
function TabContent({
  tab,
  planId,
  board,
  code,
  transcript,
  work,
}: {
  tab: SidePanelTab;
  planId: string;
  board: Board | undefined;
  code: PlanCode | undefined;
  transcript: SidePanelTranscript;
  work: SidePanelWork;
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
    case SIDE_PANEL_TAB.WORK:
      return <PlanWork turns={work.turns} callLive={work.callLive} />;
  }
}

/**
 * Shows and hides the panel. It stands at the window's top right, beside
 * neither top row it serves, the way the sidebar's toggle stands beside the
 * traffic lights: one button in one place whether the panel is hidden,
 * beside the document, full screen, or still sliding, so a press lands on
 * it however fast the presses come. It stands on every plan's page, so it
 * is also what offers the panel's shortcuts: its own, and one to open the
 * panel on each tab. While the plan is not drawn there is no panel to show,
 * so it is disabled and offers none.
 */
export function SidePanelToggle({
  panel,
  disabled,
}: {
  panel: SidePanelControl;
  disabled: boolean;
}): React.JSX.Element {
  const label = panel.open ? "Hide panel" : "Show panel";
  const offer = (run: () => void) => (disabled ? undefined : run);
  useAppCommand(APP_COMMAND.TOGGLE_SIDE_PANEL, offer(panel.onToggle));
  useAppCommand(
    APP_COMMAND.SHOW_BOARD,
    offer(() => panel.onChoose(SIDE_PANEL_TAB.BOARD)),
  );
  useAppCommand(
    APP_COMMAND.SHOW_CODE,
    offer(() => panel.onChoose(SIDE_PANEL_TAB.CODE)),
  );
  useAppCommand(
    APP_COMMAND.SHOW_TRANSCRIPT,
    offer(() => panel.onChoose(SIDE_PANEL_TAB.TRANSCRIPT)),
  );
  useAppCommand(
    APP_COMMAND.SHOW_WORK,
    offer(() => panel.onChoose(SIDE_PANEL_TAB.WORK)),
  );
  return (
    <Tooltip label={label} command={APP_COMMAND.TOGGLE_SIDE_PANEL}>
      <button
        type="button"
        className="icon-button side-panel-toggle"
        aria-label={label}
        aria-expanded={panel.open}
        data-open={String(panel.open)}
        disabled={disabled}
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
 * window's Escape, which steps back one layer at a time. A panel on its way
 * out offers neither: what it draws is no longer what the panel is.
 */
function FullScreenToggle({
  fullScreen,
  leaving,
  onToggle,
}: {
  fullScreen: boolean;
  leaving: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const label = fullScreen ? "Exit full screen" : "Expand panel";
  useAppCommand(APP_COMMAND.TOGGLE_FULL_SCREEN, leaving ? undefined : onToggle);
  useAppCommand(APP_COMMAND.EXIT_FULL_SCREEN, fullScreen && !leaving ? onToggle : undefined);
  return (
    <Tooltip label={label} command={APP_COMMAND.TOGGLE_FULL_SCREEN}>
      <button
        type="button"
        className="icon-button side-panel-full-screen"
        aria-label={label}
        aria-pressed={fullScreen}
        onClick={onToggle}
      >
        {fullScreen ? <CollapseIcon /> : <ExpandIcon />}
      </button>
    </Tooltip>
  );
}

/** The panel as the window draws it, which an exit holds behind the one asked for until it has played. */
export interface SidePanelDrawing {
  /** The panel to draw, or nothing while it is shut and gone. */
  panel: SidePanelControl | undefined;
  leaving: PanelLeaving;
  /** The exit has played: draw the panel as asked. */
  onLeft: () => void;
  edge: ResizableEdgeProps;
}

/** An exit under way, and the panel it holds drawn. */
interface HeldPanel {
  leaving: PanelLeaving;
  panel: SidePanelControl;
}

function sameDrawing(a: SidePanelControl, b: SidePanelControl): boolean {
  return (
    a.open === b.open &&
    a.fullScreen === b.fullScreen &&
    a.width === b.width &&
    a.tabs === b.tabs &&
    a.tab === b.tab
  );
}

/** What is drawn for `panel` while `held` stands. */
function drawnPanel(panel: SidePanelControl, held: HeldPanel | undefined): SidePanelControl {
  if (held?.leaving === PANEL_LEAVING.CLOSE) return held.panel;
  if (held?.leaving === PANEL_LEAVING.FULL_SCREEN) return { ...panel, fullScreen: true };
  return panel;
}

/**
 * The exit `panel`'s change asks for, given what was drawn before it, or
 * `undefined` where the change ends the exit under way, or the one standing.
 */
function exitFor(
  drawn: SidePanelControl,
  last: SidePanelControl,
  panel: SidePanelControl,
  held: HeldPanel | undefined,
): HeldPanel | undefined {
  if (last.open && !panel.open) return { leaving: PANEL_LEAVING.CLOSE, panel: drawn };
  if (panel.open && last.fullScreen && !panel.fullScreen) {
    return { leaving: PANEL_LEAVING.FULL_SCREEN, panel: drawn };
  }
  // Shown again, or full screen again, before the exit has played.
  if (panel.open && (held?.leaving === PANEL_LEAVING.CLOSE || panel.fullScreen)) return undefined;
  return held;
}

/**
 * The panel the plan's page draws for the one asked for, and the edge it is
 * resized by. A panel shut, or brought back from full screen, keeps drawing
 * what it last held until its exit has played, as docs/DESIGN.md asks of
 * anything leaving. The edge's drag is held here rather than in the panel,
 * because a drag that shuts the panel goes on, and may open it again.
 */
export function useSidePanelDrawing(panel: SidePanelControl): SidePanelDrawing {
  const [last, setLast] = useState(panel);
  const [held, setHeld] = useState<HeldPanel | undefined>(undefined);
  if (!sameDrawing(last, panel)) {
    setLast(panel);
    setHeld(exitFor(drawnPanel(last, held), last, panel, held));
  }
  const onLeft = useCallback(() => setHeld(undefined), []);
  const drawn = drawnPanel(panel, held);
  const edge = useResizableEdge({
    side: EDGE_SIDE.LEFT,
    width: drawn.width,
    bounds: SIDE_PANEL_WIDTH,
    reserve: documentReserve,
    label: "Resize panel",
    onResize: panel.onResize,
    onToggleCollapsed: panel.onToggle,
    onToggleExpanded: panel.onToggleFullScreen,
  });
  return {
    panel: drawn.open ? drawn : undefined,
    leaving: held?.leaving ?? PANEL_LEAVING.NONE,
    onLeft,
    edge,
  };
}

/**
 * Plays the drawn panel's exit at `aside` and answers `onLeft` once it has:
 * out past the window's right, or, leaving full screen, covered from its left
 * edge to where it will stand beside the document, which `room` already
 * marks. Each starts from wherever an arrival under way had brought it. With
 * no motion to play it answers at once, before the frame is drawn.
 */
function playExit(
  aside: HTMLElement,
  room: HTMLElement | null,
  leaving: PanelLeaving,
  onLeft: () => void,
): (() => void) | undefined {
  const timing = paneTiming(aside);
  if (timing === undefined) {
    onLeft();
    return undefined;
  }
  const drawn = getComputedStyle(aside);
  const beside =
    room === null ? 0 : room.getBoundingClientRect().left - aside.getBoundingClientRect().left;
  const keyframes =
    leaving === PANEL_LEAVING.CLOSE
      ? [{ transform: drawn.transform }, { transform: "translateX(100%)" }]
      : [
          { clipPath: drawn.clipPath === "none" ? "inset(0)" : drawn.clipPath },
          { clipPath: `inset(0 0 0 ${beside}px)` },
        ];
  for (const running of aside.getAnimations()) running.cancel();
  const exit = aside.animate(keyframes, { ...timing, fill: "forwards" });
  exit.onfinish = onLeft;
  return () => exit.cancel();
}

/**
 * The panel itself, drawn while it is open and through its exit. Full screen,
 * it covers the document rather than taking its place, and an empty room
 * holds the panel's own width beside the document beneath, so the document
 * keeps its layout and is there to be uncovered as the panel goes back.
 */
export function SidePanel({
  panel,
  leaving,
  onLeft,
  edge,
  unread,
  planId,
  board,
  code,
  transcript,
  work,
}: SidePanelDrawing & {
  panel: SidePanelControl;
  /** The tabs holding something that arrived while another was shown, each dotted until it is shown. */
  unread: readonly SidePanelTab[];
  planId: string;
  board: Board | undefined;
  code: PlanCode | undefined;
  transcript: SidePanelTranscript;
  work: SidePanelWork;
}): React.JSX.Element {
  const aside = useRef<HTMLElement>(null);
  const room = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (leaving === PANEL_LEAVING.NONE || aside.current === null) return;
    return playExit(aside.current, room.current, leaving, onLeft);
  }, [leaving, onLeft]);

  return (
    <>
      {/* Shut, it gives the document its room back at once, to glide into. */}
      {panel.fullScreen && leaving !== PANEL_LEAVING.CLOSE ? (
        <div ref={room} className="side-panel-room" style={{ width: panel.width }} />
      ) : null}
      <aside
        ref={aside}
        className="side-panel"
        aria-label="Panel"
        inert={leaving !== PANEL_LEAVING.NONE}
        data-full-screen={String(panel.fullScreen)}
        data-leaving={leaving === PANEL_LEAVING.NONE ? undefined : leaving}
        style={panel.fullScreen ? undefined : { width: panel.width }}
      >
        {/* The row is a drag region and each control in it is not; Chromium
            takes regions in document order, so the controls follow it. */}
        <div className="side-panel-bar">
          <PanelTabs panel={panel} unread={unread} />
          <FullScreenToggle
            fullScreen={panel.fullScreen}
            leaving={leaving !== PANEL_LEAVING.NONE}
            onToggle={panel.onToggleFullScreen}
          />
        </div>
        {panel.tab === undefined ? (
          <div className="side-panel-content">
            <NoTabs onChoose={panel.onChoose} />
          </div>
        ) : (
          <div
            className="side-panel-content"
            role="tabpanel"
            aria-label={SIDE_PANEL_TAB_KIND[panel.tab].label}
          >
            <TabContent
              tab={panel.tab}
              planId={planId}
              board={board}
              code={code}
              transcript={transcript}
              work={work}
            />
          </div>
        )}
        {/* Last, so the drag region of the row above does not take the
            edge's top from it. Full screen has no edge to drag. */}
        {panel.fullScreen ? null : <ResizeEdge edge={edge} />}
      </aside>
    </>
  );
}
