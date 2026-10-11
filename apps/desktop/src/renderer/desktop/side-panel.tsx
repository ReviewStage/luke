import type { Board } from "@sidecar/hosted/board-wire";
import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import type { CodeRef } from "@sidecar/hosted/plan-wire";
import type { PlanCodeShowing, PlanWorkTurn } from "@sidecar/hosted/planning-view";
import {
  BoardIcon,
  CodeIcon,
  CollapseIcon,
  ExpandIcon,
  PencilIcon,
  PlusIcon,
  SidePanelIcon,
  TerminalIcon,
  TranscriptIcon,
  WorkIcon,
} from "@sidecar/panel";
import { BotIcon, FileCodeIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { APP_COMMAND, type AppCommand } from "#shared/shortcuts";
import { useAct } from "../act";
import { useAppCommand } from "../app-commands";
import { AgentStatusDot, AgentSubagentTab, AgentTab } from "../planning/agent-tab";
import { CodePane } from "../planning/code-pane";
import { fileName, shownFiles } from "../planning/code-pane-model";
import { agentStillWriting, agentTabLabel, modelLabel } from "../planning/coding-agent-model";
import { DRAFT_TAB_LABEL, DraftAgentTab } from "../planning/draft-agent-tab";
import { FileTab } from "../planning/file-tab";
import { PlanBoard } from "../planning/plan-board";
import { PlanTranscript } from "../planning/plan-transcript";
import { PlanWork, SubagentTab } from "../planning/plan-work";
import { cardTitle } from "../planning/tool-call-model";
import { TRANSCRIPT_REGION, type TranscriptRegion } from "../planning/transcript-model";
import type { CodingAgentsControl } from "../planning/use-coding-agents";
import {
  type DrawnTabs,
  drawsSubagent,
  type FixedSidePanelTab,
  isAgentTab,
  isDraftTab,
  isFileTab,
  isSubagentTab,
  type OpenFile,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TAB_KIND,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
  type SidePanelControl,
  type SidePanelTab,
  type SubagentSidePanelTab,
  sameTab,
} from "../planning/use-side-panel";
import {
  type WorkTurnRow,
  type WorkWorkerBlock,
  workerCallIds,
  workerJob,
  workerOf,
  workRowsOf,
} from "../planning/work-model";
import { type MenuRow, SearchableMenu } from "../searchable-menu";
import { commandKeyshortcuts, Tooltip } from "../tooltip";
import { ActionMenu, MENU_ALIGN, type MenuAction, MenuItem, type OpenMenu } from "./action-menu";
import { paneTiming } from "./pane-motion";
import { PlanNameField, usePlanRename } from "./plan-name-field";
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
 * panel's coming and going never moves it. The fixed tabs the plan has
 * used come first, and a plan that has used none, and has no agent, says
 * so in the panel's body under the "+". The plan's coding agents follow, one tab each, named by model with a dot
 * for where the agent stands; after them stand the subagents opened from
 * the Work tab, the "+", or a delegation's row in an agent's tab, one tab
 * each, named by job. A draft agent opened from the "+" stands after the
 * agents until its first message starts it. Every tab closes, and closing
 * an agent's or a subagent's closes only the view: the agent goes on as it
 * was, and the "+" opens its tab again; closing a draft's lets the draft
 * go, nothing of it having been started. The plan's own actions stay in
 * the plan's toolbar and never come into the panel. Where a delegated
 * worker stands is what its own tab's pages say, kept here for its glyph
 * while the panel is drawn, and taken as running until a page says
 * otherwise.
 *
 * Shutting the panel, or bringing it back from full screen, changes the
 * window's layout at once, and the panel keeps drawing what it held until its
 * exit has played (`useSidePanelDrawing`); its arrivals are pane-motion.tsx's.
 */

/** What the Code tab says while Luke has shown no code on the plan. */
const NO_CODE_LINE = "When Luke shows you code during a call, it appears here.";

/** What the panel says on a plan that has used none of its tabs, each of which adds itself once it holds something. */
const NOTHING_YET_LINE = "Luke's board, code, transcript, and work appear here as you plan.";

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
} as const satisfies Record<FixedSidePanelTab, React.JSX.Element>;

/** The shortcut that shows each fixed tab; an agent's tab has none. */
const TAB_COMMAND = {
  [SIDE_PANEL_TAB.BOARD]: APP_COMMAND.SHOW_BOARD,
  [SIDE_PANEL_TAB.CODE]: APP_COMMAND.SHOW_CODE,
  [SIDE_PANEL_TAB.TRANSCRIPT]: APP_COMMAND.SHOW_TRANSCRIPT,
  [SIDE_PANEL_TAB.WORK]: APP_COMMAND.SHOW_WORK,
} as const satisfies Record<FixedSidePanelTab, AppCommand>;
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

/** The "+" menu's sections after the fixed kinds. */
const ADD_SECTION = {
  AGENTS: "Coding agents",
  SUBAGENTS: "Subagents",
  FILES: "Files",
} as const;

/** The "+" menu's row that opens a draft agent, which no tab's key spells. */
const NEW_AGENT_ROW = "new-coding-agent";

/** What the row that opens a draft says while a Start is out. */
const NEW_AGENT_STARTING = "Starting…";

/** Which edge of the "+" its menu hangs from: its left, or its right where the window leaves no room. */
const MENU_SIDE = {
  START: "start",
  END: "end",
} as const;

type MenuSide = (typeof MENU_SIDE)[keyof typeof MENU_SIDE];

/** The empty panel's row that opens a tab of the kind. */
function kindAction(
  tab: FixedSidePanelTab,
  onChoose: (tab: FixedSidePanelTab) => void,
): MenuAction {
  return {
    label: SIDE_PANEL_TAB_KIND[tab].label,
    icon: TAB_ICON[tab],
    command: TAB_COMMAND[tab],
    onSelect: () => onChoose(tab),
  };
}

/** The "+" menu's row for a kind: its glyph, its name, and its shortcut, whether or not its tab is open. */
function kindRow(tab: FixedSidePanelTab): MenuRow {
  return {
    id: tab,
    label: SIDE_PANEL_TAB_KIND[tab].label,
    icon: TAB_ICON[tab],
    command: TAB_COMMAND[tab],
  };
}

/** One row of the "+" menu, and what picking it does. */
interface AddEntry {
  row: MenuRow;
  onPick: () => void;
}

/**
 * The "+" menu's rows: the fixed kinds; then, under Coding agents, the row
 * that opens a draft agent, or chooses the open plan's draft where it has
 * one, unavailable with Start's own reason while Start could not run, and
 * each of the plan's agents in the order started; then, under Subagents,
 * each subagent the plan's work holds; then, under Files, each file Luke
 * showed on the plan, by name with its folder beside it. An agent's row
 * wears the Coding agents glyph and a subagent's the worker's, and neither
 * says where it stands, which its tab does. Picking a row whose tab is open
 * chooses that tab rather than opening another, as a browser's tab search
 * does, so no row says it is open; a file not open opens on the newest
 * snippet of it.
 */
function addEntries(input: {
  panel: SidePanelControl;
  agents: CodingAgentsControl;
  workers: readonly WorkWorkerBlock[];
  files: readonly CodeRef[];
}): AddEntry[] {
  const { panel, agents, workers, files } = input;
  const { start } = agents;
  const kinds = SIDE_PANEL_TABS.map((kind) => ({
    row: kindRow(kind),
    onPick: () => panel.onChoose(kind),
  }));
  const newAgent: AddEntry = {
    row: {
      id: NEW_AGENT_ROW,
      label: "New coding agent",
      icon: <PlusIcon />,
      section: ADD_SECTION.AGENTS,
      // Start's reason stands exactly while Start could not run on the open plan.
      disabled: start.busy ? NEW_AGENT_STARTING : start.reason,
    },
    onPick: () => panel.onChoose({ draft: agents.onNewDraft() }),
  };
  const agentRows = (agents.agents ?? []).map((agent) => ({
    row: {
      id: agent.id,
      label: agentTabLabel(agent, agents.models),
      icon: <TerminalIcon />,
      section: ADD_SECTION.AGENTS,
    },
    onPick: () => panel.onChoose({ agent: agent.id }),
  }));
  const subagentRows = workers.map(({ call }) => ({
    row: {
      id: call.id,
      label: workerJob(call),
      icon: <BotIcon />,
      section: ADD_SECTION.SUBAGENTS,
    },
    onPick: () => panel.onChoose({ subagent: call.id }),
  }));
  // Note that a file's row is named by its place in the list, because a path
  // may spell a kind's word or another row's id, and the list only grows.
  const fileRows = files.map((ref, at) => {
    const name = fileName(ref.path);
    const open = panel.files.some((file) => file.path === ref.path);
    return {
      row: {
        id: String(at),
        label: name,
        icon: <FileCodeIcon />,
        detail: ref.path.slice(0, -name.length - 1) || undefined,
        terms: [ref.path],
        section: ADD_SECTION.FILES,
      },
      onPick: () => (open ? panel.onChoose({ file: ref.path }) : panel.onOpenFile(ref)),
    };
  });
  return [...kinds, newAgent, ...agentRows, ...subagentRows, ...fileRows];
}

/**
 * The "+" after the last tab, and the menu it drops: the shared searchable
 * one, as the repository and model pickers drop, over the rows
 * `addEntries` lists. It hangs from the "+"'s left edge, or from its right
 * where the window ends before the menu would, measured before it is
 * painted. Opening it asks `onOpen` to read what the rows say again, as the
 * Start menu reads its models, so an agent whose tab is not shown, which
 * nothing follows, says where it stands now rather than where it last did.
 * It always opens, since New coding agent always stands in it, and says
 * why where it cannot be picked.
 */
function AddTabButton({
  entries,
  onOpen,
}: {
  entries: readonly AddEntry[];
  onOpen: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<MenuSide>(MENU_SIDE.START);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const menu = root.current?.querySelector(".searchable-menu") ?? null;
    if (!open || menu === null) return;
    const room = document.documentElement.clientWidth;
    setSide(menu.getBoundingClientRect().right > room ? MENU_SIDE.END : MENU_SIDE.START);
  }, [open]);

  // Note that we hand focus back to the "+", as a native menu returns it to
  // its trigger, because closing takes the focused field away with it.
  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  const pick = (id: string) => {
    const entry = entries.find((each) => each.row.id === id);
    close();
    entry?.onPick();
  };

  return (
    <div ref={root} className="tab-add-anchor" data-side={side}>
      <Tooltip label="Open a tab">
        <button
          ref={opener}
          type="button"
          className="icon-button tab-add"
          aria-label="Open a tab"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => {
            if (open) {
              close();
              return;
            }
            setSide(MENU_SIDE.START);
            setOpen(true);
            onOpen();
          }}
        >
          <PlusIcon />
        </button>
      </Tooltip>
      {open ? (
        <SearchableMenu
          id={menuId}
          className="tab-add-menu"
          label="Open a tab"
          placeholder="Search tabs and agents"
          rows={entries.map((entry) => entry.row)}
          value={undefined}
          noMatch="No tabs match"
          onPick={pick}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * One coding agent's tab: named by its title, or its model until it has one,
 * with the model in its hint, and dotted for where the agent stands. A
 * right-click offers its actions where the pointer is, the way a plan in
 * the sidebar offers its own, and Rename turns the tab into its name's
 * field until the edit ends; a key that ends it hands focus back to the tab.
 */
function AgentPanelTab({
  agent,
  agents,
  selected,
  unread,
  onSelect,
  onClose,
}: {
  agent: CodingAgentSummary;
  agents: CodingAgentsControl;
  selected: boolean;
  unread: boolean;
  onSelect: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const rename = usePlanRename(agent.id, agents.onRename);
  const [menu, setMenu] = useState<OpenMenu | undefined>(undefined);
  const tab = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (rename.editing || !refocus.current) return;
    refocus.current = false;
    tab.current?.focus();
  }, [rename.editing]);
  const close = useCallback((returnFocus: boolean) => {
    setMenu(undefined);
    if (returnFocus) tab.current?.focus();
  }, []);
  const label = agentTabLabel(agent, agents.models);
  const editor = rename.editing ? (
    <PlanNameField
      name={label}
      className="tab-field"
      label="Agent name"
      maxLength={CODING_AGENT_BOUNDS.MAX_TITLE_CHARS}
      onEnd={(edit) => {
        refocus.current = edit.byKey;
        rename.end(edit);
      }}
    />
  ) : undefined;
  return (
    <>
      <Tab
        icon={<AgentStatusDot status={agent.status} />}
        label={label}
        selected={selected}
        unread={unread}
        tooltip={modelLabel(agent.model, agents.models)}
        editor={editor}
        tabRef={tab}
        onSelect={onSelect}
        onClose={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({
            placement: { x: event.clientX, y: event.clientY, align: MENU_ALIGN.START },
            opener: event.currentTarget,
          });
        }}
      />
      {menu === undefined ? null : (
        <ActionMenu
          label="Agent actions"
          menu={menu}
          groups={[[{ label: "Rename", icon: <PencilIcon />, onSelect: rename.begin }]]}
          onClose={close}
        />
      )}
    </>
  );
}

/**
 * The strip of tabs across the panel's top: the open fixed tabs, then one
 * per coding agent of the plan whose tab was not closed, then the "+". A tab's own word is all it
 * needs to say, so it hangs no pill; a fixed tab's chord is in the View
 * menu, the "+" menu, and on the Keyboard shortcuts page, and an agent's
 * tab wears the dot for where the agent stands in its glyph's place; no
 * agent's or subagent's tab has a chord. A tab
 * something arrived on while another was shown, and an agent's whose end no
 * one was looking at, wear the note at their corner until shown. The fixed
 * tabs are dragged or stepped into the order the panel keeps; the agent
 * tabs stand after them in the order the agents started, and the subagent
 * tabs after those in the order opened, each wearing the worker's glyph,
 * lit while it runs, so neither is dragged, and a fixed tab dragged toward
 * them goes no further than the last fixed place. The "+" stands after all
 * of them, apart from the strip, so it is never dragged nor dropped before.
 */
function PanelTabs({
  panel,
  unread,
  agents,
  subagents,
  workers,
  files,
  shownFiles,
}: {
  panel: SidePanelControl;
  unread: readonly SidePanelTab[];
  agents: CodingAgentsControl;
  /** The open subagent tabs the plan draws, in the strip's order. */
  subagents: readonly DrawnSubagent[];
  /** Every subagent the plan's work holds, in the order started, which the "+" offers. */
  workers: readonly WorkWorkerBlock[];
  /** The open file tabs of files shown on the plan, in the strip's order. */
  files: readonly OpenFile[];
  /** Each file Luke showed on the plan, which the "+" offers. */
  shownFiles: readonly CodeRef[];
}): React.JSX.Element {
  const chosen = (tab: SidePanelTab) => panel.tab !== undefined && sameTab(tab, panel.tab);
  const draft = agents.draft?.id;
  const noted = (tab: SidePanelTab) => unread.some((each) => sameTab(each, tab));
  return (
    <div className="side-panel-tabs">
      <TabStrip
        label="Panel"
        movable={panel.tabs.length}
        onMove={(from, to) => {
          // Only the fixed tabs move, and only among themselves.
          const tab = panel.tabs[from];
          if (tab !== undefined) panel.onMove(tab, to);
        }}
      >
        {panel.tabs.map((tab) => (
          <Tab
            key={tab}
            icon={TAB_ICON[tab]}
            label={SIDE_PANEL_TAB_KIND[tab].label}
            selected={chosen(tab)}
            unread={noted(tab)}
            keyshortcuts={commandKeyshortcuts(TAB_COMMAND[tab])}
            onSelect={() => panel.onChoose(tab)}
            onClose={() => panel.onClose(tab)}
          />
        ))}
        {(agents.agents ?? [])
          .filter((agent) => !panel.closedAgents.includes(agent.id))
          .map((agent) => (
            <AgentPanelTab
              key={agent.id}
              agent={agent}
              agents={agents}
              selected={chosen({ agent: agent.id })}
              unread={noted({ agent: agent.id })}
              onSelect={() => panel.onChoose({ agent: agent.id })}
              onClose={() => panel.onClose({ agent: agent.id })}
            />
          ))}
        {draft === undefined ? null : (
          <Tab
            key={draft}
            icon={<PlusIcon />}
            label={DRAFT_TAB_LABEL}
            selected={chosen({ draft })}
            onSelect={() => panel.onChoose({ draft })}
            onClose={() => {
              panel.onClose({ draft });
              agents.onDiscardDraft(draft);
            }}
          />
        )}
        {subagents.map(({ tab, label, running }) => (
          <Tab
            key={tab.subagent}
            icon={<BotIcon className={running ? "text-luke" : undefined} />}
            label={label}
            selected={chosen(tab)}
            onSelect={() => panel.onChoose(tab)}
            onClose={() => panel.onClose(tab)}
          />
        ))}
        {files.map(({ path }) => (
          <Tab
            key={path}
            icon={<FileCodeIcon />}
            label={fileName(path)}
            tooltip={path}
            selected={chosen({ file: path })}
            onSelect={() => panel.onChoose({ file: path })}
            onClose={() => panel.onClose({ file: path })}
          />
        ))}
        {/* The first read of the plan's agents did not land: nothing is known
            to draw, so the strip offers the read again where the tabs would be. */}
        {agents.listFailed && agents.agents === undefined ? (
          <button type="button" className="toolbar-button" onClick={agents.onRetryList}>
            Agents · Try again
          </button>
        ) : null}
      </TabStrip>
      <AddTabButton
        entries={addEntries({ panel, agents, workers, files: shownFiles })}
        onOpen={agents.onRetryList}
      />
    </div>
  );
}

/** The panel with every tab closed: what it holds, offered as the "+" menu offers it. */
function NoTabs({ onChoose }: { onChoose: (tab: FixedSidePanelTab) => void }): React.JSX.Element {
  return (
    <div className="side-panel-no-tabs">
      <p className="side-panel-no-tabs-line">No tabs open</p>
      {SIDE_PANEL_TABS.map((kind) => {
        const action = kindAction(kind, onChoose);
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
  earlier: string | undefined;
  onLoadEarlier: () => Promise<void>;
}

/** An open subagent tab the plan draws: its tab, what the strip calls it, whether its glyph is lit, and the planning worker's block where it is one. */
interface DrawnSubagent {
  tab: SubagentSidePanelTab;
  label: string;
  running: boolean;
  worker: WorkWorkerBlock | undefined;
}

/** Where the open delegated workers stand, by the call that started each, as their tabs' pages last said. */
type WorkerStandings = ReadonlyMap<string, CodingAgentStatus>;

/** The open subagent tabs the plan draws now (`drawsSubagent`), in the strip's order: each planning worker the work still holds, and each delegated worker whose agent's tab is open. */
function drawnSubagents(
  tabs: readonly SubagentSidePanelTab[],
  workRows: readonly WorkTurnRow[],
  standings: WorkerStandings,
  drawn: Pick<DrawnTabs, "agents" | "subagents">,
): readonly DrawnSubagent[] {
  return tabs.flatMap((tab): DrawnSubagent[] => {
    if (!drawsSubagent(tab, drawn)) return [];
    if (tab.delegation !== undefined) {
      const status = standings.get(tab.subagent) ?? CODING_AGENT_STATUS.RUNNING;
      return [
        {
          tab,
          label: cardTitle(tab.delegation.task),
          running: agentStillWriting(status),
          worker: undefined,
        },
      ];
    }
    const worker = workerOf(workRows, tab.subagent);
    return worker === undefined
      ? []
      : [{ tab, label: workerJob(worker.call), running: worker.call.running, worker }];
  });
}

/** What the chosen tab shows. */
function TabContent({
  tab,
  planId,
  repository,
  board,
  shownCode,
  files,
  transcript,
  work,
  workRows,
  agents,
  standings,
  shown,
  onOpenSubagent,
  onOpenDelegation,
  onWorkerStatus,
  onOpenFile,
}: {
  tab: SidePanelTab;
  planId: string;
  /** The plan's repository, which a file's tab is read from as it stands now. */
  repository: string | null;
  board: Board | undefined;
  shownCode: readonly PlanCodeShowing[] | undefined;
  /** The open file tabs, which a file's tab reads its lit lines from. */
  files: readonly OpenFile[];
  transcript: SidePanelTranscript;
  work: SidePanelWork;
  /** The plan's work as rows, which a subagent's tab reads its session from. */
  workRows: readonly WorkTurnRow[];
  agents: CodingAgentsControl;
  standings: WorkerStandings;
  /** Whether the panel is on screen, so an agent's tab knows to follow its transcript. */
  shown: boolean;
  /** Opens a planning worker's session in a tab of its own, by the call that started it. */
  onOpenSubagent: (callId: string) => void;
  /** Opens one of an agent's workers in a tab of its own, by the agent, the call that started it, and the task; where the worker stands seeds its glyph. */
  onOpenDelegation: (
    agentId: string,
    callId: string,
    task: string,
    status: CodingAgentStatus,
  ) => void;
  /** A delegated worker's page said where it stands now. */
  onWorkerStatus: (callId: string, status: CodingAgentStatus) => void;
  /** Opens a file of the plan's repository in a tab of its own, the reference's lines lit. */
  onOpenFile: (ref: CodeRef) => void;
}): React.JSX.Element {
  const { act } = useAct();
  if (isFileTab(tab)) {
    const file = files.find((each) => each.path === tab.file);
    // As a subagent's: the tab stands for a file no longer open only until
    // the panel moves on, a render away.
    // Note that the plan given another repository draws the file afresh,
    // because the lines held were read from the one before.
    return file === undefined ? (
      <p className="side-panel-empty">Opening the file…</p>
    ) : (
      <Fragment key={repository ?? undefined}>
        <FileTab
          key={file.path}
          file={file}
          readFile={(window) => act(ACT_KIND.PLANNING_FILE, { planId, ...window })}
        />
      </Fragment>
    );
  }
  if (isDraftTab(tab)) {
    // As an agent's: the tab stands for a draft the plan no longer holds
    // only until the panel moves back to the board, a render away.
    return agents.draft?.id === tab.draft ? (
      <DraftAgentTab key={tab.draft} draft={agents.draft} control={agents} />
    ) : (
      <p className="side-panel-empty">Reading the agent…</p>
    );
  }
  if (isAgentTab(tab)) {
    const agent = agents.agents?.find((each) => each.id === tab.agent);
    // The tab stands for an agent the list no longer holds only until the
    // panel moves back to the board, a render away.
    return agent === undefined ? (
      <p className="side-panel-empty">Reading the agent…</p>
    ) : (
      <AgentTab
        key={agent.id}
        agent={agent}
        control={agents}
        shown={shown}
        onOpenSubagent={(callId, task, status) => onOpenDelegation(agent.id, callId, task, status)}
      />
    );
  }
  if (isSubagentTab(tab)) {
    if (tab.delegation !== undefined) {
      return (
        <AgentSubagentTab
          key={tab.subagent}
          agentId={tab.delegation.agent}
          callId={tab.subagent}
          task={tab.delegation.task}
          status={standings.get(tab.subagent) ?? CODING_AGENT_STATUS.RUNNING}
          control={agents}
          shown={shown}
          onStatus={(status) => onWorkerStatus(tab.subagent, status)}
        />
      );
    }
    const worker = workerOf(workRows, tab.subagent);
    // As an agent's: the tab stands for a subagent the work no longer holds
    // only until the panel moves back to the board, a render away.
    return worker === undefined ? (
      <p className="side-panel-empty">Reading the subagent…</p>
    ) : (
      <SubagentTab key={tab.subagent} worker={worker} />
    );
  }
  switch (tab) {
    case SIDE_PANEL_TAB.BOARD:
      return <PlanBoard planId={planId} board={board} />;
    case SIDE_PANEL_TAB.CODE:
      return shownCode === undefined || shownCode.length === 0 ? (
        <p className="side-panel-empty">{NO_CODE_LINE}</p>
      ) : (
        <CodePane
          shown={shownCode}
          calls={transcript.region.kind === TRANSCRIPT_REGION.READY ? transcript.region.calls : []}
          copyText={(words) => act(ACT_KIND.WINDOW_COPY_TEXT, { words })}
          onOpenFile={onOpenFile}
        />
      );
    case SIDE_PANEL_TAB.TRANSCRIPT:
      return (
        <PlanTranscript
          region={transcript.region}
          onRetry={transcript.onRetry}
          copyText={(words) => act(ACT_KIND.WINDOW_COPY_TEXT, { words })}
        />
      );
    case SIDE_PANEL_TAB.WORK:
      return (
        <PlanWork
          turns={work.turns}
          callLive={work.callLive}
          earlier={work.earlier}
          onLoadEarlier={work.onLoadEarlier}
          onOpenSubagent={onOpenSubagent}
          shown={shown}
        />
      );
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
  repository,
  board,
  shownCode,
  transcript,
  work,
  agents,
  shown,
}: SidePanelDrawing & {
  panel: SidePanelControl;
  /** The tabs holding something that arrived while another was shown, each dotted until it is shown. */
  unread: readonly SidePanelTab[];
  planId: string;
  /** The plan's repository, `owner/name`, or none before one is chosen. */
  repository: string | null;
  board: Board | undefined;
  /** Every code Luke showed on the plan, oldest first. */
  shownCode: readonly PlanCodeShowing[] | undefined;
  transcript: SidePanelTranscript;
  work: SidePanelWork;
  agents: CodingAgentsControl;
  /** Whether the plan's page is on screen, which an agent's tab follows its transcript under. */
  shown: boolean;
}): React.JSX.Element {
  const aside = useRef<HTMLElement>(null);
  const room = useRef<HTMLDivElement>(null);
  const { tab } = panel;
  // Every subagent the plan's work holds, and those with a tab open, each
  // with its session, in the order started and the strip's order; a
  // delegated worker's tab stands while its agent's does.
  const workRows = workRowsOf(work.turns, work.callLive);
  const held = (callId: string) => {
    const worker = workerOf(workRows, callId);
    return worker === undefined ? [] : [worker];
  };
  const workers = workerCallIds(work.turns).flatMap(held);
  const [standings, setStandings] = useState<WorkerStandings>(() => new Map());
  const openAgents = agents.agents
    ?.filter((agent) => !panel.closedAgents.includes(agent.id))
    .map((agent) => agent.id);
  const subagents = drawnSubagents(panel.subagents, workRows, standings, {
    agents: openAgents,
    subagents: workers.map((worker) => worker.call.id),
  });
  // The file tabs of files shown on the plan, in the strip's order.
  const offered = shownFiles(shownCode ?? []);
  const files = panel.files.filter((file) => offered.some((ref) => ref.path === file.path));
  const shownAgent =
    tab !== undefined && isAgentTab(tab)
      ? agents.agents?.find((agent) => agent.id === tab.agent)
      : undefined;
  const label =
    tab === undefined
      ? undefined
      : isAgentTab(tab)
        ? shownAgent === undefined
          ? undefined
          : agentTabLabel(shownAgent, agents.models)
        : isSubagentTab(tab)
          ? subagents.find((each) => sameTab(each.tab, tab))?.label
          : isDraftTab(tab)
            ? DRAFT_TAB_LABEL
            : isFileTab(tab)
              ? tab.file
              : SIDE_PANEL_TAB_KIND[tab].label;
  const openSubagent = useCallback(
    (callId: string) => panel.onChoose({ subagent: callId }),
    [panel.onChoose],
  );
  const onWorkerStatus = useCallback((callId: string, status: CodingAgentStatus) => {
    setStandings((was) => (was.get(callId) === status ? was : new Map(was).set(callId, status)));
  }, []);
  const openDelegation = useCallback(
    (agent: string, callId: string, task: string, status: CodingAgentStatus) => {
      onWorkerStatus(callId, status);
      panel.onChoose({ subagent: callId, delegation: { agent, task } });
    },
    [panel.onChoose, onWorkerStatus],
  );

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
          <PanelTabs
            panel={panel}
            unread={unread}
            agents={agents}
            subagents={subagents}
            workers={workers}
            files={files}
            shownFiles={offered}
          />
          <FullScreenToggle
            fullScreen={panel.fullScreen}
            leaving={leaving !== PANEL_LEAVING.NONE}
            onToggle={panel.onToggleFullScreen}
          />
        </div>
        {/* A plan that has used no tab says what will stand here, the "+"
            above offering any meanwhile; one whose tabs were closed offers
            them again in place. */}
        {tab === undefined ? (
          <div className="side-panel-content">
            {panel.closedTabs.length === 0 ? (
              <p className="side-panel-empty">{NOTHING_YET_LINE}</p>
            ) : (
              <NoTabs onChoose={panel.onChoose} />
            )}
          </div>
        ) : (
          <div className="side-panel-content" role="tabpanel" aria-label={label}>
            <TabContent
              tab={tab}
              planId={planId}
              repository={repository}
              board={board}
              shownCode={shownCode}
              files={files}
              transcript={transcript}
              work={work}
              workRows={workRows}
              agents={agents}
              standings={standings}
              shown={shown && leaving === PANEL_LEAVING.NONE}
              onOpenSubagent={openSubagent}
              onOpenDelegation={openDelegation}
              onWorkerStatus={onWorkerStatus}
              onOpenFile={panel.onOpenFile}
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
