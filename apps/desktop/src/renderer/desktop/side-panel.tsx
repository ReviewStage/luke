import type { Board } from "@sidecar/hosted/board-wire";
import {
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import type { CodeRef } from "@sidecar/hosted/plan-wire";
import {
  PLAN_WORK_STATE,
  type PlanCodeShowing,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
import {
  BoardIcon,
  CodeIcon,
  CollapseIcon,
  ExpandIcon,
  SidePanelIcon,
  TranscriptIcon,
  WorkIcon,
} from "@sidecar/panel";
import { FileDiffIcon, InboxIcon } from "lucide-react";
import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAct } from "../act";
import { useAppCommand } from "../app-commands";
import { EmptyState } from "../empty-state";
import { FindScope } from "../find-in-tab";
import { AgentChangesTab, changesTabLabel } from "../planning/agent-changes-tab";
import { AgentGlyph, AgentMark, AgentSubagentTab, SubagentMark } from "../planning/agent-tab";
import {
  AgentTabCard,
  type CardReading,
  cardCorner,
  delegatedChoice,
  heldLatest,
  lastFinished,
} from "../planning/agent-tab-card";
import { CodePane } from "../planning/code-pane";
import { fileName, type ShownFile, shownFiles } from "../planning/code-pane-model";
import { agentGlyphState, agentStateWords, providerOf } from "../planning/coding-agent-model";
import { snippetOf } from "../planning/file-tab-model";
import { FileTypeIcon } from "../planning/file-type-icon";
import { FileView } from "../planning/file-view";
import { PlanBoard } from "../planning/plan-board";
import { PlanTranscript } from "../planning/plan-transcript";
import { PlanWork, SubagentTab } from "../planning/plan-work";
import {
  type ChangesStripTab,
  inPlanOrder,
  isAgentTab,
  isChangesTab,
  isFileTab,
  isSubagentTab,
  type StripTab,
  type SubagentStripTab,
  sameTab,
  tabKey,
} from "../planning/tab-strip-model";
import { cardTitle } from "../planning/tool-call-model";
import {
  agentTranscript,
  readWholeTranscript,
  type TranscriptCopy,
  workerTranscript,
} from "../planning/transcript-copy";
import { TRANSCRIPT_REGION, type TranscriptRegion } from "../planning/transcript-model";
import type { CodingAgentsControl } from "../planning/use-coding-agents";
import { MAIN_TAB } from "../planning/use-main-tabs";
import {
  type DrawnTabs,
  drawsChanges,
  drawsSubagent,
  type FileHistoryStep,
  type FixedSidePanelTab,
  isPinnable,
  type OpenFile,
  type PinnedTab,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TAB_KIND,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
  type SidePanelControl,
  type SidePanelTab,
} from "../planning/use-side-panel";
import {
  type WorkTurnRow,
  type WorkWorkerBlock,
  workerCallIds,
  workerChoice,
  workerJob,
  workerOf,
  workFailed,
  workRowsOf,
} from "../planning/work-model";
import type { MenuRow } from "../searchable-menu";
import { SpinnerRegion } from "../spinner";
import {
  GLYPH_STATE,
  GLYPH_STATE_WORDS,
  type GlyphState,
  StateGlyph,
  stateEndMark,
} from "../state-glyph";
import { Tooltip } from "../tooltip";
import { type MenuAction, MenuItem } from "./action-menu";
import { paneTiming } from "./pane-motion";
import {
  type AddEntry,
  AddTabButton,
  DoorsTab,
  type HeldTranscripts,
  type TabDoors,
  type TabLook,
  type TabPin,
  type TabViews,
  type TranscriptCopier,
  useTranscriptCopier,
  type WorkerStandings,
} from "./strip-tabs";
import { TabStrip } from "./tab-strip";
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
 * panel's coming and going never moves it. Each tab stands where it was
 * opened, at the strip's end, and a plan that has used none, and has no agent, says
 * so in the panel's body under the "+". The plan's coding agents follow, one tab each, named by model and wearing
 * its harness's mark for where the agent stands; after them stand the subagents opened from
 * the Work tab, the "+", or a delegation's row in an agent's tab, one tab
 * each, named by job. A draft agent opened from the "+" stands after the
 * agents until its first message starts it. Every tab closes, and closing
 * an agent's or a subagent's closes only the view: the agent goes on as it
 * was, and the "+" opens its tab again; closing a draft's lets the draft
 * go, nothing of it having been started. Every tab's right-click offers
 * Close and Close others, a fixed tab's, an agent's, and a file's Pin to the
 * sidebar, and a transcript's tab its two copies. The plan's own actions stay in
 * the plan's toolbar and never come into the panel. Where a delegated
 * worker stands is what its own tab's pages say, kept here for its glyph
 * while the panel is drawn, and taken as running until a page says
 * otherwise. What an agent's or a delegated worker's tab last drew is kept
 * here too, for as long as the panel is drawn, so its card can preview its
 * latest step once another tab is shown.
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

/** Each kind's glyph, leading its tab, its row in the "+" menu, its pin in the sidebar (`pinnedTabIcon`), and its row in ⌘K. */
export const TAB_ICON = {
  [SIDE_PANEL_TAB.BOARD]: <BoardIcon />,
  [SIDE_PANEL_TAB.CODE]: <CodeIcon />,
  [SIDE_PANEL_TAB.TRANSCRIPT]: <TranscriptIcon />,
  [SIDE_PANEL_TAB.WORK]: <WorkIcon />,
} as const satisfies Record<FixedSidePanelTab, React.JSX.Element>;
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

/** The "+" menu's sections after the fixed kinds, which the plan's summary lists under the same headings. */
export const ADD_SECTION = {
  SUBAGENTS: "Subagents",
  FILES: "Files",
} as const;

/** The empty panel's row that opens a tab of the kind. */
function kindAction(
  tab: FixedSidePanelTab,
  onChoose: (tab: FixedSidePanelTab) => void,
): MenuAction {
  return {
    label: SIDE_PANEL_TAB_KIND[tab].label,
    icon: TAB_ICON[tab],
    onSelect: () => onChoose(tab),
  };
}

/** The "+" menu's row for a kind: its glyph and its name, whether or not its tab is open. */
function kindRow(tab: FixedSidePanelTab): MenuRow {
  return {
    id: tab,
    label: SIDE_PANEL_TAB_KIND[tab].label,
    icon: TAB_ICON[tab],
  };
}

/**
 * What the panel may open, as its "+" menu offers it and the plan's summary
 * lists it (`plan-summary.tsx`): the fixed kinds given, every one for the
 * "+" and those the plan has used for the summary; then, under Subagents,
 * each subagent the plan's work holds; then, under Files, each file Luke
 * showed on the plan, by name with its folder beside it. A subagent's row
 * wears its model's mark (`SubagentMark`), and where the worker stands only where
 * `standing` asks: the "+" leaves that to its tab, beside it, and the
 * summary has no tab beside it to say it. A file's row wears its type's
 * coloured icon, as the file tree draws it (`file-type-icon.tsx`), in the
 * "+" and the summary alike. Picking a row whose tab is open
 * chooses that tab rather than opening another, as a browser's tab search
 * does, so no row says it is open; a file not open opens on the newest
 * snippet of it. The plan's coding agents are opened from the plan's
 * column's own "+" (`main-tabs.tsx`).
 */
export function panelEntries(input: {
  panel: SidePanelControl;
  kinds: readonly FixedSidePanelTab[];
  workers: readonly WorkWorkerBlock[];
  files: readonly ShownFile[];
  standing: boolean;
}): AddEntry[] {
  const { panel, workers, files, standing } = input;
  const kinds = input.kinds.map((kind) => ({
    row: kindRow(kind),
    onPick: () => panel.onChoose(kind),
  }));
  const subagentRows = workers.map((worker) => ({
    row: {
      id: worker.call.id,
      label: worker.session?.title ?? workerJob(worker.call),
      icon: standing ? (
        <StateGlyph
          glyph={<SubagentMark model={workerChoice(worker)?.model} />}
          state={workerStanding(worker).state}
        />
      ) : (
        <SubagentMark model={workerChoice(worker)?.model} />
      ),
      section: ADD_SECTION.SUBAGENTS,
    },
    onPick: () => panel.onChoose({ subagent: worker.call.id }),
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
        icon: <FileTypeIcon name={name} />,
        detail: ref.path.slice(0, -name.length - 1) || undefined,
        terms: [ref.path],
        section: ADD_SECTION.FILES,
      },
      onPick: () => (open ? panel.onChoose({ file: ref.path }) : panel.onOpenFile(ref, ref.commit)),
    };
  });
  return [...kinds, ...subagentRows, ...fileRows];
}

/** Every subagent the plan's work holds, with its session, in the order started. */
export function planWorkers(
  turns: readonly PlanWorkTurn[] | undefined,
  workRows: readonly WorkTurnRow[],
): readonly WorkWorkerBlock[] {
  return workerCallIds(turns).flatMap((callId) => {
    const worker = workerOf(workRows, callId);
    return worker === undefined ? [] : [worker];
  });
}

/**
 * The glyph a tab's pin wears in the sidebar: its kind's, a file's, the
 * Inbox's tray, or an agent's as its tab wears it, where it stands included, wherever the
 * window last read the agent (`agent`), and otherwise the mark of the
 * harness it ran in when it was pinned.
 */
export function pinnedTabIcon(
  pin: PinnedTab,
  agent: Pick<CodingAgentSummary, "model" | "status"> | undefined,
): React.JSX.Element {
  const { tab } = pin;
  if (isAgentTab(tab)) {
    if (agent !== undefined) return <AgentGlyph agent={agent} />;
    return <AgentMark provider={pin.model === undefined ? undefined : providerOf(pin.model)} />;
  }
  if (tab === MAIN_TAB.INBOX) return <InboxIcon />;
  return isFileTab(tab) ? <FileTypeIcon name={fileName(tab.file)} /> : TAB_ICON[tab];
}

/** One tab the strip draws: the tab, how it looks, how it closes, and how its transcript is copied. */
interface DrawnTab {
  tab: SidePanelTab;
  look: TabLook;
  /** Closes the tab, as its × does. */
  close: () => void;
  copy?: ((copy: TranscriptCopy) => void) | undefined;
}

/**
 * The tabs the strip draws, in their kinds' order: the open fixed tabs, the
 * subagents, the files, and the agents' changes. A delegated worker's
 * transcript is read whole from the service for a copy, since its tab
 * holds it only while shown; a planning worker's is the session the plan's
 * work already holds. A subagent's tab hangs a card on hover, previewing
 * its latest step from what its tab last held (`heldLatest`) or the plan's
 * work holds, and never reading the service for it.
 */
function stripTabs(input: {
  panel: SidePanelControl;
  unread: readonly StripTab[];
  agents: CodingAgentsControl;
  subagents: readonly DrawnSubagent[];
  files: readonly OpenFile[];
  changes: readonly ChangesStripTab[];
  held: HeldTranscripts;
  copied: TranscriptCopier;
}): DrawnTab[] {
  const { panel, unread, agents, subagents, files, changes, held, copied } = input;
  const chosen = (tab: SidePanelTab) => panel.tab !== undefined && sameTab(tab, panel.tab);
  const models = agents.models ?? [];
  const look = (tab: SidePanelTab, drawn: Omit<TabLook, "selected" | "onSelect">) => ({
    ...drawn,
    unread: unread.some((each) => sameTab(each, tab)),
    selected: chosen(tab),
    onSelect: () => panel.onChoose(tab),
  });
  const fixed = panel.tabs.map((tab) => ({
    tab,
    look: look(tab, {
      icon: TAB_ICON[tab],
      label: SIDE_PANEL_TAB_KIND[tab].label,
    }),
    close: () => panel.onClose(tab),
  }));
  const subagentTabs = subagents.map(({ tab, label, untitled, state, stateWords, worker }) => {
    const running = state === GLYPH_STATE.WORKING;
    const { delegation } = tab;
    // Note that a delegated worker's pair is read from the call that started
    // it, among what its agent's tab last held, whatever turn that was,
    // because the call says it once and for good; its agent's own model
    // stands in for the mark until that call is held.
    const parent =
      delegation === undefined
        ? undefined
        : agents.agents?.find((agent) => agent.id === delegation.agent);
    const own = parent === undefined ? undefined : { model: parent.model, effort: parent.effort };
    const started =
      delegation === undefined ? undefined : held.agents.get(delegation.agent)?.messages;
    const delegated = own && delegatedChoice(started, tab.subagent, own);
    const model =
      delegation === undefined
        ? worker && workerChoice(worker)?.model
        : (delegated?.model ?? parent?.model);
    // A worker runs one turn, so the run its tab last read is its run for good.
    const readCard = () => {
      if (delegation === undefined) return workerCardReading(worker);
      const drawn = held.workers.get(tab.subagent);
      const now = { writing: running, runStartedAt: drawn?.runStartedAt };
      const messages = heldLatest(drawn, now, chosen(tab));
      return {
        corner: cardCorner({
          writing: running,
          startedAt: drawn?.runStartedAt,
          movedAt: lastFinished(messages),
          state: stateWords,
        }),
        choice: delegated,
        transcript:
          messages &&
          agentTranscript({ title: label, messages, brief: undefined, task: delegation.task }),
      };
    };
    const read = () =>
      delegation === undefined
        ? Promise.resolve(worker === undefined ? undefined : workerTranscript(worker))
        : readWholeTranscript(agents.readTranscript, {
            agentId: delegation.agent,
            callId: tab.subagent,
          }).then((messages) =>
            messages === undefined
              ? undefined
              : agentTranscript({
                  title: label,
                  messages,
                  brief: undefined,
                  task: delegation.task,
                }),
          );
    return {
      tab,
      look: look(tab, {
        icon: <StateGlyph glyph={<SubagentMark model={model} />} state={state} />,
        endMark: stateEndMark(state, false),
        label,
        card: <AgentTabCard name={label} untitled={untitled} models={models} read={readCard} />,
      }),
      close: () => panel.onClose(tab),
      copy: copied(read),
    };
  });
  const fileTabs = files.map(({ path }) => ({
    tab: { file: path },
    look: look(
      { file: path },
      { icon: <FileTypeIcon name={fileName(path)} />, label: fileName(path), tooltip: path },
    ),
    close: () => panel.onClose({ file: path }),
  }));
  const changesTabs = changes.map((tab) => ({
    tab,
    look: look(tab, { icon: <FileDiffIcon />, label: changesTabLabel(tab.changes, agents) }),
    close: () => panel.onClose(tab),
  }));
  return [...fixed, ...subagentTabs, ...fileTabs, ...changesTabs];
}

/**
 * The strip of tabs across the panel's top: the open fixed tabs, then the
 * subagents and the files, then the "+". A fixed tab's own word is all it
 * needs to say, so it hangs no pill, while a subagent's hangs a card naming
 * it whole with when it last moved and its latest step
 * (`agent-tab-card.tsx`); no tab has a chord. A tab something arrived on
 * while another was shown reads in semibold until shown. Every tab, of
 * whatever kind, stands at the strip's end once opened, a subagent's
 * wearing the worker's glyph with a ring while it runs, until the developer
 * drags or steps any tab to any place, which the plan keeps
 * (`use-side-panel.ts`). A tab pinned to the sidebar is drawn and moved as
 * any other. Every tab's right-click offers Close, Close others, which
 * closes every tab but it and chooses it, and a fixed tab's and a file's
 * Pin tab or Unpin tab, which puts it in the sidebar or takes it out; a
 * subagent's adds the two copies of its transcript, built from the rows the
 * tab draws (`transcript-copy.ts`) and answered with the window's toast.
 * The "+" stands after all of them, apart from the strip, so it is never
 * dragged nor dropped before. ⌘W closes the chosen tab while the panel
 * holds the window's focus (`keys`).
 */
function PanelTabs({
  panel,
  planId,
  keys,
  unread,
  agents,
  subagents,
  workers,
  files,
  changes,
  shownFiles,
  held,
}: {
  panel: SidePanelControl;
  /** The open plan, which a tab's pin is of. */
  planId: string;
  /** Whether the panel offers its keys: on screen, not on its way out, and holding the window's focus. */
  keys: boolean;
  unread: readonly StripTab[];
  agents: CodingAgentsControl;
  /** The open subagent tabs the plan draws, in the strip's order. */
  subagents: readonly DrawnSubagent[];
  /** Every subagent the plan's work holds, in the order started, which the "+" offers. */
  workers: readonly WorkWorkerBlock[];
  /** The open file tabs of files shown on the plan, in the strip's order. */
  files: readonly OpenFile[];
  /** The open Changes tabs of agents whose tabs stand open, in the order opened. */
  changes: readonly ChangesStripTab[];
  /** Each file Luke showed on the plan, which the "+" offers. */
  shownFiles: readonly ShownFile[];
  /** What the agents' and the delegated workers' tabs last drew, which the workers' hover cards preview. */
  held: HeldTranscripts;
}): React.JSX.Element {
  const copied = useTranscriptCopier();
  const kinds = stripTabs({ panel, unread, agents, subagents, files, changes, held, copied });
  const strip = inPlanOrder(kinds, panel.order, (entry) => entry.tab);
  // ⌘W closes the tab chosen, as its menu's Close does; with none, the key
  // falls through to the menu bar, which closes the window (`app-menu.ts`).
  const chosen = strip.find((entry) => entry.look.selected);
  useAppCommand(APP_COMMAND.CLOSE_TAB, keys ? chosen?.close : undefined);
  const pinOf = ({ tab, look }: DrawnTab): TabPin | undefined => {
    if (!isPinnable(tab)) return undefined;
    const pinned = panel.pins.some((pin) => pin.plan === planId && sameTab(pin.tab, tab));
    return {
      pinned,
      onToggle: () => (pinned ? panel.onUnpin(planId, tab) : panel.onPin(tab, look.label)),
    };
  };
  const doorsOf = (entry: DrawnTab, at: number): TabDoors => {
    const others = strip.filter((_, place) => place !== at);
    return {
      chosen: entry.look.selected,
      onClose: entry.close,
      onCloseOthers:
        others.length === 0
          ? undefined
          : () => {
              for (const other of others) other.close();
              panel.onChoose(entry.tab);
            },
      pin: pinOf(entry),
      onCopy: entry.copy,
    };
  };
  return (
    <div className="side-panel-tabs">
      <TabStrip
        label="Panel"
        onMove={(from, to) => {
          const entry = strip[from];
          if (entry !== undefined) panel.onMove(entry.tab, to);
        }}
      >
        {strip.map((entry, at) => (
          <DoorsTab key={tabKey(entry.tab)} look={entry.look} doors={doorsOf(entry, at)} />
        ))}
      </TabStrip>
      <AddTabButton
        label="Open a tab"
        placeholder="Search tabs"
        noMatch="No tabs match"
        entries={panelEntries({
          panel,
          kinds: SIDE_PANEL_TABS,
          workers,
          files: shownFiles,
          standing: false,
        })}
        onOpen={undefined}
        asked={panel.newTabAsked}
        answers={keys}
        onAnswered={panel.onNewTabAnswered}
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
  /** The call a version's Open asked to bring into view. */
  reveal?: { readonly call: string; readonly onRevealed: () => void } | undefined;
}

/** What Luke's planning model wrote and ran on the open plan's calls, and whether a call still stands. */
interface SidePanelWork {
  turns: readonly PlanWorkTurn[] | undefined;
  callLive: boolean;
  earlier: string | undefined;
  onLoadEarlier: () => Promise<void>;
  /** The moment whose turn a version's Open asked to bring into view. */
  reveal?: { readonly at: number; readonly onRevealed: () => void } | undefined;
}

/** An open subagent tab the plan draws: its tab, what the strip calls it, where its glyph says it stands, and the planning worker's block where it is one. */
interface DrawnSubagent {
  tab: SubagentStripTab;
  /** Its title, or its task's first line until it has one. */
  label: string;
  untitled: boolean;
  state: GlyphState;
  /** What its hint says of where it stands, as its own tab's transcript says it. */
  stateWords: string | undefined;
  worker: WorkWorkerBlock | undefined;
}

/**
 * Where a planning worker stands as its tab wears it: working while its
 * call still moves, failed where its session's own task failed, as an
 * agent's failed turn is, even where the planning model answered the call
 * and went on, and at rest once it ended otherwise. Note that a
 * worker whose call ended without answering and whose task recorded no
 * failure is said to have stopped, because that is a worker the developer
 * stopped or whose planning call ended under it, as its own transcript's
 * end line says (`plan-work.tsx`), and no failure of its own.
 */
function workerStanding(worker: WorkWorkerBlock): Pick<DrawnSubagent, "state" | "stateWords"> {
  if (worker.call.running) {
    return { state: GLYPH_STATE.WORKING, stateWords: GLYPH_STATE_WORDS[GLYPH_STATE.WORKING] };
  }
  if (workFailed(worker.session?.record)) {
    return { state: GLYPH_STATE.FAILED, stateWords: GLYPH_STATE_WORDS[GLYPH_STATE.FAILED] };
  }
  const stopped = worker.call.state === PLAN_WORK_STATE.FAILED;
  return { state: GLYPH_STATE.REST, stateWords: stopped ? "Stopped" : undefined };
}

/**
 * What a planning worker's card says: where it stands and when it last
 * moved, the model it ran on, and its latest step, from the session the
 * plan's work holds. Its tab's card and its row's in the plan's summary both
 * say it. A worker the work no longer holds says nothing, as its tab is
 * then not drawn (`drawnSubagents`).
 */
export function workerCardReading(worker: WorkWorkerBlock | undefined): CardReading {
  const { state, stateWords } =
    worker === undefined
      ? { state: GLYPH_STATE.REST, stateWords: undefined }
      : workerStanding(worker);
  return {
    corner: cardCorner({
      writing: state === GLYPH_STATE.WORKING,
      startedAt: worker?.session?.startedAt,
      movedAt: worker?.session?.endedAt,
      state: stateWords,
    }),
    choice: worker && workerChoice(worker),
    transcript: worker && workerTranscript(worker),
  };
}

/** The open subagent tabs the plan draws now (`drawsSubagent`), in the strip's order: each planning worker the work still holds, and each delegated worker whose agent's tab is open. */
function drawnSubagents(
  tabs: readonly SubagentStripTab[],
  workRows: readonly WorkTurnRow[],
  standings: WorkerStandings,
  held: HeldTranscripts,
  drawn: Pick<DrawnTabs, "agents" | "subagents">,
): readonly DrawnSubagent[] {
  return tabs.flatMap((tab): DrawnSubagent[] => {
    if (!drawsSubagent(tab, drawn)) return [];
    const { delegation, subagent } = tab;
    if (delegation !== undefined) {
      const status = standings.get(subagent) ?? CODING_AGENT_STATUS.RUNNING;
      // Its own page says its title, and its agent's pages say every worker's.
      const title =
        held.workers.get(subagent)?.title ??
        held.agents.get(delegation.agent)?.subagentTitles.get(subagent);
      return [
        {
          tab,
          label: title ?? cardTitle(delegation.task),
          untitled: title === undefined,
          state: agentGlyphState(status),
          stateWords: agentStateWords(status),
          worker: undefined,
        },
      ];
    }
    const worker = workerOf(workRows, subagent);
    if (worker === undefined) return [];
    const title = worker.session?.title;
    const label = title ?? workerJob(worker.call);
    return [{ tab, label, untitled: title === undefined, ...workerStanding(worker), worker }];
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
  onOpenAgent,
  onWorkerStatus,
  onWorkerHeld,
  onOpenFile,
  fileTree,
  onBrowseFile,
  onFileHistory,
  onFoldNote,
  codeReveal,
  onShowNote,
  onRevealed,
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
  /** Whether the panel is on screen, so a subagent's tab knows to follow its transcript. */
  shown: boolean;
  /** Opens a planning worker's session in a tab of its own, by the call that started it. */
  onOpenSubagent: (callId: string) => void;
  /** Opens a coding agent's tab in the plan's column, by the agent. */
  onOpenAgent: (agentId: string) => void;
  /** A delegated worker's page said where it stands now. */
  onWorkerStatus: (callId: string, status: CodingAgentStatus) => void;
  /** A delegated worker's tab drew its transcript anew, by the call that started it. */
  onWorkerHeld: TabViews["onWorkerHeld"];
  /** Opens a file of the plan's repository in a tab of its own, the reference's lines lit. */
  onOpenFile: (ref: CodeRef, commit?: string) => void;
  /** Whether a File tab's tree is open, which holds for every File tab alike, and its toggle. */
  fileTree: { readonly open: boolean; readonly onToggle: () => void };
  /** Shows a file browsed to from a File tab's tree or breadcrumbs (`SidePanelControl.onBrowseFile`). */
  onBrowseFile: (from: string, path: string, newTab: boolean) => void;
  /** Walks a File tab's history a step (`SidePanelControl.onFileHistory`). */
  onFileHistory: (from: string, step: FileHistoryStep) => void;
  /** Folds or opens a note on a File tab (`SidePanelControl.onFoldNote`). */
  onFoldNote: (path: string, callId: string, folded: boolean) => void;
  /** The call whose card the Code tab scrolls to as it is drawn, which a File tab's note asked for. */
  codeReveal: string | undefined;
  /** Shows the Code tab on the card of the call a File tab's note is from. */
  onShowNote: (callId: string) => void;
  /** Says the Code tab scrolled to the card asked for. */
  onRevealed: () => void;
}): React.JSX.Element {
  const { act, tell } = useAct();
  if (isChangesTab(tab)) {
    return (
      <AgentChangesTab key={tab.changes} agentId={tab.changes} control={agents} shown={shown} />
    );
  }
  if (isFileTab(tab)) {
    const file = files.find((each) => each.path === tab.file);
    // The tab stands for a file no longer open only until the panel moves
    // on, a render away.
    // Note that the plan given another repository draws the file afresh,
    // because the lines held were read from the one before.
    return file === undefined ? (
      <SpinnerRegion label="Loading file" />
    ) : (
      <Fragment key={repository ?? undefined}>
        <FileView
          planId={planId}
          repository={repository}
          file={file}
          snippet={snippetOf(shownCode, file)}
          shownCode={shownCode}
          readFile={(window) => act(ACT_KIND.PLANNING_FILE, { planId, ...window })}
          readFolder={(path) => act(ACT_KIND.PLANNING_TREE, { planId, path })}
          readWhole={() => act(ACT_KIND.PLANNING_TREE, { planId, path: "", recursive: true })}
          openGitHub={(url) => tell(ACT_KIND.GITHUB_OPEN, { url })}
          treeOpen={fileTree.open}
          onToggleTree={fileTree.onToggle}
          onBrowse={(path, newTab) => onBrowseFile(file.path, path, newTab)}
          history={{
            canGoBack: (file.back?.length ?? 0) > 0,
            canGoForward: (file.forward?.length ?? 0) > 0,
            onStep: (step) => onFileHistory(file.path, step),
          }}
          onFoldNote={(callId, folded) => onFoldNote(file.path, callId, folded)}
          onShowNote={onShowNote}
        />
      </Fragment>
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
          onHeld={onWorkerHeld}
        />
      );
    }
    const worker = workerOf(workRows, tab.subagent);
    // The tab stands for a subagent the work no longer holds only until the
    // panel moves back to the board, a render away.
    return worker === undefined ? (
      <SpinnerRegion label="Loading subagent" />
    ) : (
      <SubagentTab key={tab.subagent} worker={worker} shown={shown} models={agents.models} />
    );
  }
  switch (tab) {
    case SIDE_PANEL_TAB.BOARD:
      // An archived plan's board only shows, as its agents only read.
      return (
        <PlanBoard planId={planId} board={board} viewOnly={agents.onUnarchive !== undefined} />
      );
    case SIDE_PANEL_TAB.CODE:
      return shownCode === undefined || shownCode.length === 0 ? (
        <EmptyState icon={TAB_ICON[SIDE_PANEL_TAB.CODE]}>{NO_CODE_LINE}</EmptyState>
      ) : (
        <CodePane
          shown={shownCode}
          calls={transcript.region.kind === TRANSCRIPT_REGION.READY ? transcript.region.calls : []}
          onOpenFile={onOpenFile}
          reveal={codeReveal}
          onRevealed={onRevealed}
        />
      );
    case SIDE_PANEL_TAB.TRANSCRIPT:
      return (
        <PlanTranscript
          region={transcript.region}
          onRetry={transcript.onRetry}
          reveal={transcript.reveal}
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
          onOpenAgent={onOpenAgent}
          shown={shown}
          models={agents.models}
          reveal={work.reveal}
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
 * is also what offers the panel's shortcut. ⌘T is the plan's page's, which hands it to the column
 * holding the window's focus (desktop-plans.tsx). While the plan is not
 * drawn there is no panel to show, so it is disabled and offers none.
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
  openAgents,
  views,
  shown,
  focused,
  onOpenAgent,
}: SidePanelDrawing & {
  panel: SidePanelControl;
  /** The tabs holding something that arrived while another was shown, each in semibold until it is shown. */
  unread: readonly StripTab[];
  planId: string;
  /** The plan's repository, `owner/name`, or none before one is chosen. */
  repository: string | null;
  board: Board | undefined;
  /** Every code Luke showed on the plan, oldest first. */
  shownCode: readonly PlanCodeShowing[] | undefined;
  transcript: SidePanelTranscript;
  work: SidePanelWork;
  agents: CodingAgentsControl;
  /** The plan's agents whose tabs stand open in the plan's column, whose workers' tabs stand here; nothing while unread. */
  openAgents: readonly string[] | undefined;
  /** What the agents' and the workers' tabs last drew and said, which the workers' tabs and cards read. */
  views: TabViews;
  /** Whether the plan's page is on screen, which a subagent's tab follows its transcript under. */
  shown: boolean;
  /** Whether the panel holds the window's focus, which its ⌘W, ⌘T, and ⌘F answer to. */
  focused: boolean;
  /** Opens a coding agent's tab in the plan's column, by the agent, which a start's row on the Work tab asks for. */
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const aside = useRef<HTMLElement>(null);
  const room = useRef<HTMLDivElement>(null);
  const { tab } = panel;
  // Whether a File tab's tree is open, for every File tab alike and for the
  // window's life, as an editor's explorer stands across its tabs.
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
  const fileTree = useMemo(
    () => ({ open: fileTreeOpen, onToggle: () => setFileTreeOpen((was) => !was) }),
    [fileTreeOpen],
  );
  // Every subagent the plan's work holds, and those with a tab open, each
  // with its session, in the order started and the strip's order; a
  // delegated worker's tab stands while its agent's does.
  const workRows = workRowsOf(work.turns, work.callLive);
  const workers = planWorkers(work.turns, workRows);
  const { held: drawnTranscripts, standings } = views;
  const subagents = drawnSubagents(panel.subagents, workRows, standings, drawnTranscripts, {
    agents: openAgents,
    subagents: workers.map((worker) => worker.call.id),
  });
  // The file tabs of files shown on the plan or browsed to on it, in the strip's order.
  const offered = shownFiles(shownCode ?? []);
  const files = panel.files.filter(
    (file) => file.browsedOn === planId || offered.some((ref) => ref.path === file.path),
  );
  // An agent's Changes tab stands while the agent's own tab does.
  const changes = panel.changes.filter((each) => drawsChanges(each, { agents: openAgents }));
  const label =
    tab === undefined
      ? undefined
      : isSubagentTab(tab)
        ? subagents.find((each) => sameTab(each.tab, tab))?.label
        : isFileTab(tab)
          ? tab.file
          : isChangesTab(tab)
            ? changesTabLabel(tab.changes, agents)
            : SIDE_PANEL_TAB_KIND[tab].label;
  const openSubagent = useCallback(
    (callId: string) => panel.onChoose({ subagent: callId }),
    [panel.onChoose],
  );
  // The card a File tab's note asked the Code tab to scroll to, until it has.
  const [codeReveal, setCodeReveal] = useState<string | undefined>(undefined);
  const showNote = useCallback(
    (callId: string) => {
      setCodeReveal(callId);
      panel.onChoose(SIDE_PANEL_TAB.CODE);
    },
    [panel.onChoose],
  );
  const revealed = useCallback(() => setCodeReveal(undefined), []);
  const keys = shown && leaving === PANEL_LEAVING.NONE;

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
        data-popover-room=""
        style={panel.fullScreen ? undefined : { width: panel.width }}
      >
        {/* The row is a drag region and each control in it is not; Chromium
            takes regions in document order, so the controls follow it. */}
        <div className="side-panel-bar">
          <PanelTabs
            panel={panel}
            planId={planId}
            keys={keys && focused}
            unread={unread}
            agents={agents}
            subagents={subagents}
            workers={workers}
            files={files}
            changes={changes}
            shownFiles={offered}
            held={drawnTranscripts}
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
          // The Board is drawn on a canvas, which keeps a find of its own.
          <FindScope
            className="side-panel-content"
            role="tabpanel"
            aria-label={label}
            active={keys && focused && tab !== SIDE_PANEL_TAB.BOARD}
            subject={{ plan: planId, tab }}
          >
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
              shown={keys}
              onOpenSubagent={openSubagent}
              onOpenAgent={onOpenAgent}
              onWorkerStatus={views.onWorkerStatus}
              onWorkerHeld={views.onWorkerHeld}
              onOpenFile={panel.onOpenFile}
              fileTree={fileTree}
              onBrowseFile={panel.onBrowseFile}
              onFileHistory={panel.onFileHistory}
              onFoldNote={panel.onFoldNote}
              codeReveal={codeReveal}
              onShowNote={showNote}
              onRevealed={revealed}
            />
          </FindScope>
        )}
        {/* Last, so the drag region of the row above does not take the
            edge's top from it. Full screen has no edge to drag. */}
        {panel.fullScreen ? null : <ResizeEdge edge={edge} />}
      </aside>
    </>
  );
}
