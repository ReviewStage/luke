import type { Board } from "@luke/features/board-wire";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentPullRequest,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import type { ModelChoice } from "@luke/features/models-wire";
import type { PageLine } from "@luke/features/page-wire";
import type { CodeRef } from "@luke/features/task-wire";
import { TASK_WORK_STATE, type TaskCodeShowing } from "@luke/features/tasks-view";
import { TERMINAL_ASK, TERMINAL_TARGET, terminalTarget } from "@luke/features/terminal-entry";
import { ACT_KIND } from "@luke/host/acts";
import { CollapseIcon, ExpandIcon, SidePanelIcon } from "@luke/ui";
import {
  agentOfTab,
  type ChangesStripTab,
  inTaskOrder,
  isChangesTab,
  isFileTab,
  isPageTab,
  isSubagentTab,
  isTerminalTab,
  type PageStripTab,
  type StripTab,
  type SubagentStripTab,
  sameTab,
  TAB_WORDS,
  type TerminalStripTab,
  tabKey,
} from "@luke/ui/tab-strip-model";
import { type ShownFile, shownFiles } from "@luke/voice/code-pane-model";
import { TRANSCRIPT_REGION, type TranscriptRegion } from "@luke/voice/transcript-model";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAct } from "../act";
import { useAppCommand } from "../app-commands";
import { CallTabVideo } from "../call/panel-avatar";
import { useCopyLinkItem } from "../copy-link-item";
import { EmptyState } from "../empty-state";
import { FindScope } from "../find-in-tab";
import { drawnVisibly, focusSeek } from "../focus-seek";
import { panelTabPlace } from "../links-at-hand";
import { type MenuRow, MenuRowList } from "../searchable-menu";
import { SpinnerRegion } from "../spinner";
import { GLYPH_STATE, type GlyphState, glyphStateWords, stateEndMark } from "../state-glyph";
import { AgentChangesTab, ChangesCard, peopleOf } from "../tasks/agent-changes-tab";
import { AgentActorRef, AgentCard, agentSubject, NOTHING_HELD } from "../tasks/agent-ref";
import { AgentSubagentTab, type BriefTask, type TranscriptCards } from "../tasks/agent-tab";
import {
  AgentTabCard,
  type CardReading,
  cardCorner,
  delegatedChoice,
  heldLatest,
  lastFinished,
} from "../tasks/agent-tab-card";
import { CodePane, centreWithin } from "../tasks/code-pane";
import {
  agentGlyphState,
  agentStateWords,
  agentTabLabel,
  pullRequestNumberLabel,
} from "../tasks/coding-agent-model";
import { FileCard, fileLook, newestFileNote } from "../tasks/file-ref";
import { snippetOf } from "../tasks/file-tab-model";
import { FileView } from "../tasks/file-view";
import { PagePane } from "../tasks/page-pane";
import { type KindLook, TAB_KIND, tabLook } from "../tasks/tab-look";
import { TaskBoard } from "../tasks/task-board";
import { TaskCall } from "../tasks/task-call";
import { useOpenTerminal } from "../tasks/terminal-commands";
import { TerminalCardFoot, TerminalStanding } from "../tasks/terminal-shells";
import { TerminalTab } from "../tasks/terminal-tab";
import { cardTitle, TOOL_TARGET, type ToolTarget } from "../tasks/tool-call-model";
import {
  agentTranscript,
  readWholeTranscript,
  type TranscriptCopy,
} from "../tasks/transcript-copy";
import type { TranscriptReader } from "../tasks/use-agent-transcript";
import type { CodingAgentsControl } from "../tasks/use-coding-agents";
import {
  type DrawnTabs,
  drawsChanges,
  drawsSubagent,
  drawsTerminal,
  type FileHistoryStep,
  type FixedSidePanelTab,
  isPinnable,
  type OpenFile,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
  type SidePanelControl,
  type SidePanelTab,
} from "../tasks/use-side-panel";
import {
  type TaskConversation,
  type WorkTurnRow,
  type WorkWorkerBlock,
  workerCallIds,
  workerChoice,
  workerJob,
  workerOf,
  workFailed,
  workRowsOf,
} from "../tasks/work-model";
import { Tooltip } from "../tooltip";
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
 * the Call tab, the "+", or a delegation's row in an agent's tab, one tab
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
const NO_CODE_LINE = "No code yet.";

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

/** A plan with no page, the same array every render. */
const NO_PAGES: readonly PageLine[] = [];

/**
 * What the panel stands beside: a plan's page, whose panel holds every kind
 * of tab, or the page of an agent no plan holds, whose panel holds that
 * agent's workers, its Changes, and its Terminal, and no plan's Board,
 * Code, Call, files, or pages. A tab of an agent's page is no plan's to
 * pin, so none is offered.
 */
export const SIDE_PANEL_HOLDER = {
  PLAN: "plan",
  AGENT: "agent",
} as const;

type SidePanelHolder = (typeof SIDE_PANEL_HOLDER)[keyof typeof SIDE_PANEL_HOLDER];

/** No fixed kind, the same array every render. */
const NO_KINDS: readonly FixedSidePanelTab[] = [];

/** The fixed kinds each holder's panel offers. */
const HOLDER_KINDS = {
  [SIDE_PANEL_HOLDER.PLAN]: SIDE_PANEL_TABS,
  [SIDE_PANEL_HOLDER.AGENT]: NO_KINDS,
} as const satisfies Record<SidePanelHolder, readonly FixedSidePanelTab[]>;

/** Which of a page's two columns holds the window's focus, which ⌘T, ⌘W, and ⌘F answer to: its own, or the side panel beside it. */
export const COLUMN = {
  MAIN: "main",
  SIDE: "side",
} as const;

type Column = (typeof COLUMN)[keyof typeof COLUMN];

/** The column holding the keys, the door its page's area is handed through, and the door a press that hands the keys over goes through. */
export interface ColumnFocus {
  readonly onArea: (area: HTMLDivElement | null) => void;
  readonly focus: Column;
  readonly setFocus: (column: Column) => void;
}

/**
 * The column of a page with a side panel that holds the keys: the one the
 * pointer or the focus last went into, and the door a press that hands the
 * keys over goes through. Note that it is heard on the page's area, handed
 * through `onArea`, as it bubbles, because the columns are no controls of
 * their own to hear it.
 */
export function useColumnFocus(): ColumnFocus {
  const [focus, setFocus] = useState<Column>(COLUMN.MAIN);
  const [area, onArea] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (area === null) return;
    const hear = (event: Event) => {
      const side = event.target instanceof Element && event.target.closest(".side-panel") !== null;
      setFocus(side ? COLUMN.SIDE : COLUMN.MAIN);
    };
    area.addEventListener("pointerdown", hear);
    area.addEventListener("focusin", hear);
    return () => {
      area.removeEventListener("pointerdown", hear);
      area.removeEventListener("focusin", hear);
    };
  }, [area]);
  return { onArea, focus, setFocus };
}

/** The "+" menu's sections after the fixed kinds, which the plan's summary lists under the same headings. */
export const ADD_SECTION = {
  SUBAGENTS: "Subagents",
  FILES: "Files",
  CHANGES: "Changes",
  PAGES: "Pages",
  TERMINAL: "Terminal",
} as const;

/** An agent's terminal as the "+" offers it: the agent, and whether ⌘J would open its Terminal tab from here. */
export interface TerminalOffer {
  readonly agent: CodingAgentSummary;
  readonly label: string;
  readonly showsOnChord: boolean;
}

/** An agent's Changes tab as the "+" offers it: the agent, its name as its own tab wears it, and the pull request the tab draws. */
export interface ChangesOffer {
  readonly agentId: string;
  readonly agent: CodingAgentSummary;
  readonly label: string;
  readonly pullRequest: CodingAgentPullRequest;
}

/** No Changes tab open on the plan, the same array every render. */
const NO_OPEN_CHANGES: readonly ChangesStripTab[] = [];

/**
 * The agent whose Changes tab stands for the agent's pull request: among the
 * agents on that pull request, in the order started, the first whose tab is
 * open on the plan (`open`), else the first; the agent itself where its pull
 * request is not yet held. Note that an open tab is preferred, because the
 * agents' pull requests are read apart, so a later agent's may land first
 * and its tab be opened before an earlier one shares it.
 */
function changesAgentOf(
  agents: CodingAgentsControl,
  agentId: string,
  open: readonly ChangesStripTab[],
): string {
  const url = agents.pullRequests.get(agentId)?.url;
  if (url === undefined) return agentId;
  const sharing = (agents.agents ?? []).filter(
    (agent) => agents.pullRequests.get(agent.id)?.url === url,
  );
  const opened = sharing.find((agent) => open.some((tab) => tab.changes === agent.id));
  return (opened ?? sharing[0])?.id ?? agentId;
}

/**
 * The plan's agents' Changes tabs on offer, in the order the agents
 * started: one for each agent with a pull request, its tab open in the
 * plan's column or not, and none for an agent that has opened none yet,
 * whose tab would only say so. Note that two agents on one pull request
 * offer it once, under the agent whose tab stands for it (`changesAgentOf`),
 * because a row is named by the pull request and both tabs would draw the
 * same files. `open` is the Changes tabs open on the plan.
 */
export function changesOffers(
  agents: CodingAgentsControl,
  open: readonly ChangesStripTab[] = NO_OPEN_CHANGES,
): readonly ChangesOffer[] {
  const offered = new Set<string>();
  return (agents.agents ?? []).flatMap((each) => {
    const pullRequest = agents.pullRequests.get(each.id);
    if (pullRequest === undefined || offered.has(pullRequest.url)) return [];
    offered.add(pullRequest.url);
    const agentId = changesAgentOf(agents, each.id, open);
    const agent = agents.agents?.find((other) => other.id === agentId) ?? each;
    // The row shows the pull request as the agent its tab stands for last read it, as its tab's card does.
    const shown = agents.pullRequests.get(agent.id) ?? pullRequest;
    const label = agentTabLabel(agent, agents.models);
    return [{ agentId: agent.id, agent, label, pullRequest: shown }];
  });
}

/**
 * The Changes tab an agent's Changes chip opens: the one that stands for its
 * pull request (`changesAgentOf`), as `changesOffers` offers it, so the chip
 * and the "+" never stand two tabs on one pull request's files, whichever
 * agent's read landed first. `open` is the Changes tabs open on the plan.
 */
export function changesTabOf(
  agents: CodingAgentsControl,
  agentId: string,
  open: readonly ChangesStripTab[],
): ChangesStripTab {
  return { changes: changesAgentOf(agents, agentId, open) };
}

/** The "+" menu's row for a kind: its glyph and its name, whether or not its tab is open. */
function kindRow(tab: FixedSidePanelTab): MenuRow {
  return { id: tab, ...tabLook({ kind: TAB_KIND.PANEL, tab }) };
}

/**
 * What the panel may open, as its "+" menu offers it, the plan's summary
 * lists it (`task-summary.tsx`), and ⌘K finds it: the fixed kinds given,
 * every one for the "+" and those the plan has used for the summary; then,
 * under Subagents, each subagent the plan's work holds; then, under Files,
 * each file Luke showed on the plan, by name with its folder beside it.
 * Each row wears its tab's own look (`tab-look.tsx`): a subagent its
 * model's mark wearing where the worker stands, and a file as every place
 * names a file (`file-ref.tsx`). Picking a row whose tab is open chooses
 * that tab rather than opening another, as a browser's tab search does, so
 * no row says it is open; a file not open opens through the panel's one
 * door for a file on the newest snippet of it. Then, under Changes, each
 * agent's pull request (`changesOffers`), named as its Changes tab is, with
 * the pull request's number beside it, found by its title and number too,
 * which opens the agent's Changes tab. The plan's coding agents are opened
 * from the plan's column's own "+" (`main-tabs.tsx`).
 */
export function panelEntries(input: {
  panel: SidePanelControl;
  kinds: readonly FixedSidePanelTab[];
  workers: readonly WorkWorkerBlock[];
  files: readonly ShownFile[];
  /** The agents' Changes tabs on offer; none where the caller offers none. */
  changes?: readonly ChangesOffer[];
  /** The plan's pages, each by its newest version, which the "+" offers; none where the caller offers none. */
  pages?: readonly PageLine[];
  /** The plan's agents' terminals on offer, and the door a row's pick asks a new shell through; none where the caller offers none. */
  terminals?: {
    readonly offers: readonly TerminalOffer[];
    readonly onNew: (agentId: string) => void;
  };
}): AddEntry[] {
  const { panel, workers, files, changes = [], pages = [] } = input;
  const kinds = input.kinds.map((kind) => ({
    row: kindRow(kind),
    onPick: () => panel.onChoose(kind),
  }));
  const subagentRows = workers.map((worker) => ({
    row: {
      id: worker.call.id,
      ...tabLook({
        kind: TAB_KIND.SUBAGENT,
        name: worker.session?.title ?? workerJob(worker.call),
        model: workerChoice(worker)?.model,
        state: workerStanding(worker).state,
      }),
      section: ADD_SECTION.SUBAGENTS,
    },
    onPick: () => panel.onChoose({ subagent: worker.call.id }),
  }));
  // Note that a file's row is named by its place in the list, because a path
  // may spell a kind's word or another row's id, and the list only grows.
  const fileRows = files.map((ref, at) => {
    const open = panel.files.some((file) => file.path === ref.path);
    return {
      row: { id: String(at), ...fileLook(ref.path), section: ADD_SECTION.FILES },
      onPick: () =>
        open ? panel.onOpenFile({ path: ref.path }) : panel.onOpenFile(ref, ref.commit),
    };
  });
  // Note that a pull request's row is named by its page, because an agent's
  // id already names the agent's own row in the plan's summary.
  const changesRows = changes.map(({ agentId, label, pullRequest }) => {
    const look = tabLook({ kind: TAB_KIND.CHANGES, agentName: label });
    const number = pullRequestNumberLabel(pullRequest);
    return {
      row: {
        id: pullRequest.url,
        ...look,
        detail: number,
        terms: [look.label, pullRequest.title, number],
        section: ADD_SECTION.CHANGES,
      },
      onPick: () => panel.onChoose({ changes: agentId }),
    };
  });
  const pageRows = pages.map((page) => ({
    row: {
      id: page.id,
      ...tabLook({ kind: TAB_KIND.PAGE, title: page.title }),
      section: ADD_SECTION.PAGES,
    },
    onPick: () => panel.onChoose({ page: page.id }),
  }));
  // A terminal's row adds a shell to its agent's sandbox, as New terminal
  // does; its words after the name say how the agent and its sandbox stand.
  // Note that it is named by the key its tab is drawn under, because the
  // agent's id names the agent's own row where the summary lists them.
  const terminalRows = (input.terminals?.offers ?? []).map(({ agent, label, showsOnChord }) => ({
    row: {
      id: tabKey({ terminal: agent.id }),
      ...tabLook({ kind: TAB_KIND.AGENT, name: label, agent }),
      detail: <TerminalStanding agent={agent} />,
      command: showsOnChord ? APP_COMMAND.SHOW_TERMINAL : undefined,
      section: ADD_SECTION.TERMINAL,
    },
    onPick: () => input.terminals?.onNew(agent.id),
  }));
  return [...kinds, ...subagentRows, ...fileRows, ...changesRows, ...pageRows, ...terminalRows];
}

/** Every subagent the plan's work holds, with where its session stands, in the order started. */
export function taskWorkers(workRows: readonly WorkTurnRow[]): readonly WorkWorkerBlock[] {
  return workerCallIds(workRows).flatMap((callId) => {
    const worker = workerOf(workRows, callId);
    return worker === undefined ? [] : [worker];
  });
}

/** An agent's Changes tab's look, named for the agent as the plan's agents last read it. */
function changesLook(agentId: string, agents: CodingAgentsControl): KindLook {
  const agent = agents.agents?.find((each) => each.id === agentId);
  const agentName = agent === undefined ? undefined : agentTabLabel(agent, agents.models);
  return tabLook({ kind: TAB_KIND.CHANGES, agentName });
}

/**
 * The plan's agents as the "+" offers their terminals, each marked where ⌘J
 * would open its Terminal tab from the panel's own tab (`terminal-entry.ts`).
 */
function terminalOffers(
  agents: CodingAgentsControl,
  panel: Pick<SidePanelControl, "tab" | "lastTerminal">,
): readonly TerminalOffer[] {
  const listed = agents.agents ?? [];
  const target = terminalTarget(TERMINAL_ASK.SHOW, {
    here: panel.tab === undefined ? undefined : agentOfTab(panel.tab),
    agents: listed.map((agent) => agent.id),
    lastUsed: panel.lastTerminal,
  });
  const chord = target.kind === TERMINAL_TARGET.AGENT ? target.agentId : undefined;
  return listed.map((agent) => ({
    agent,
    label: agentTabLabel(agent, agents.models),
    showsOnChord: agent.id === chord,
  }));
}

/** Nothing to move: what the panel opens from its own "+" stands where the keys already are. */
const noFocusMove = () => undefined;

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
  pages: readonly DrawnPage[];
  terminals: readonly TerminalStripTab[];
  /** Every code Luke showed on the plan, whose newest note on a file its tab's card says. */
  shown: readonly TaskCodeShowing[];
  /** The plan's repository, whose showings alone a file tab's card reads its note from. */
  repository: string | null;
  held: HeldTranscripts;
  copied: TranscriptCopier;
  /** Reads a planning worker's whole session for a copy, the plan standing in the agent's place. */
  readWorker: (callId: string) => Promise<readonly CodingAgentMessage[] | undefined>;
  /** Opens an agent's tab in the plan's column, as a card naming the agent offers. */
  onOpenAgent: (agentId: string) => void;
  /** The agent whose tab the plan's column shows, whose card follows its run. */
  shownAgent: string | undefined;
}): DrawnTab[] {
  const { panel, unread, agents, subagents, files, changes, pages, terminals, shown, held } = input;
  const { repository, copied, readWorker, onOpenAgent, shownAgent } = input;
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
    look: look(tab, tabLook({ kind: TAB_KIND.PANEL, tab })),
    close: () => panel.onClose(tab),
  }));
  const subagentTabs = subagents.map((drawn) => {
    const { tab, label, untitled, state, worker } = drawn;
    const { delegation } = tab;
    const choices = delegation && delegationChoices(delegation, tab.subagent, agents, held);
    const model =
      delegation === undefined
        ? worker && workerChoice(worker)?.model
        : (choices?.delegated?.model ?? choices?.own?.model);
    const readCard = subagentCardReading(drawn, agents, held, chosen(tab));
    const task = delegation?.task ?? worker?.task ?? "";
    const read = () =>
      (delegation === undefined
        ? readWorker(tab.subagent)
        : readWholeTranscript(agents.readTranscript, {
            agentId: delegation.agent,
            callId: tab.subagent,
          })
      ).then((messages) =>
        messages === undefined
          ? undefined
          : agentTranscript({ title: label, messages, brief: undefined, task }),
      );
    return {
      tab,
      look: look(tab, {
        ...tabLook({ kind: TAB_KIND.SUBAGENT, name: label, model, state }),
        endMark: stateEndMark(state, false),
        card: <AgentTabCard name={label} untitled={untitled} models={models} read={readCard} />,
      }),
      close: () => panel.onClose(tab),
      copy: copied(read),
    };
  });
  // A file's tab hangs the file's card, as every place naming the file does.
  const fileTabs = files.map(({ path, commit }) => {
    const note = newestFileNote(shown, path, { repository, commit });
    const card = <FileCard path={path} note={note} />;
    return {
      tab: { file: path },
      look: look(
        { file: path },
        { ...tabLook({ kind: TAB_KIND.FILE, path }), tooltip: path, card },
      ),
      close: () => panel.onClose({ file: path }),
    };
  });
  // A Changes tab hangs its pull request's card, naming the agent whose it is.
  const changesTabs = changes.map((tab) => {
    const subject = agentSubject(agents, tab.changes, held, shownAgent === tab.changes);
    const pullRequest = agents.pullRequests.get(tab.changes);
    const card =
      subject.agent === undefined || pullRequest === undefined ? undefined : (
        <ChangesCard
          subject={subject}
          models={agents.models}
          pullRequest={pullRequest}
          people={peopleOf(agents.changesPeople.get(tab.changes), pullRequest)}
          onOpenAgent={() => onOpenAgent(tab.changes)}
        />
      );
    return {
      tab,
      look: look(tab, { ...changesLook(tab.changes, agents), card }),
      close: () => panel.onClose(tab),
    };
  });
  const pageTabs = pages.map(({ tab, line }) => ({
    tab,
    look: look(tab, tabLook({ kind: TAB_KIND.PAGE, title: line.title })),
    close: () => panel.onClose(tab),
  }));
  // A Terminal tab wears its agent's glyph and name, and hangs its agent's
  // card, saying under a rule whose sandbox its shells run in.
  const terminalTabs = terminals.map((tab) => {
    const subject = agentSubject(agents, tab.terminal, held, false);
    const card = (
      <AgentTabCard
        name={subject.name}
        models={models}
        read={subject.read}
        foot={<TerminalCardFoot agentId={tab.terminal} />}
      />
    );
    return {
      tab,
      look: look(tab, {
        ...tabLook({ kind: TAB_KIND.TERMINAL, agent: subject.agent }),
        detail: subject.name,
        card,
      }),
      close: () => panel.onClose(tab),
    };
  });
  return [...fixed, ...subagentTabs, ...fileTabs, ...changesTabs, ...pageTabs, ...terminalTabs];
}

/**
 * The strip of tabs across the panel's top: the open fixed tabs, then the
 * subagents and the files, then the "+". A fixed tab's own word is all it
 * needs to say, so it hangs no pill, while a subagent's hangs a card naming
 * it whole with when it last moved and its latest step
 * (`agent-tab-card.tsx`), and a Changes tab its pull request's, naming the
 * agent whose it is (`ChangesCard`); no tab has a chord. A tab something arrived on
 * while another was shown reads in semibold until shown. Every tab, of
 * whatever kind, stands at the strip's end once opened, a subagent's
 * wearing the worker's glyph with a ring while it runs, until the developer
 * drags or steps any tab to any place, which the plan keeps
 * (`use-side-panel.ts`). A tab pinned to the sidebar is drawn and moved as
 * any other. Every tab's right-click offers Close, Close others, which
 * closes every tab but it and chooses it, and a fixed tab's, a file's, and
 * a Changes tab's Pin tab or Unpin tab, which puts it in the sidebar or takes it out; a
 * subagent's adds the two copies of its transcript, built from the rows the
 * tab draws (`transcript-copy.ts`) and answered with the window's toast,
 * which the bar's ⋯ also offers while the subagent's tab is the chosen one.
 * The "+" stands after all of them, apart from the strip, so it is never
 * dragged nor dropped before. ⌘W closes the chosen tab while the panel
 * holds the window's focus (`keys`).
 */
function PanelTabs({
  panel,
  holder,
  taskId: planId,
  keys,
  unread,
  agents,
  subagents,
  files,
  changes,
  pages,
  terminals,
  shown,
  repository,
  offers,
  held,
  readWorker,
  actionsSlot,
  onOpenAgent,
  shownAgent,
}: {
  panel: SidePanelControl;
  holder: SidePanelHolder;
  /** The open plan, which a tab's pin is of. */
  taskId: string;
  /** Whether the panel offers its keys: on screen, not on its way out, and holding the window's focus. */
  keys: boolean;
  unread: readonly StripTab[];
  agents: CodingAgentsControl;
  /** The open subagent tabs the plan draws, in the strip's order. */
  subagents: readonly DrawnSubagent[];
  /** The open file tabs of files shown on the plan, in the strip's order. */
  files: readonly OpenFile[];
  /** The open Changes tabs of the plan's agents, in the order opened. */
  changes: readonly ChangesStripTab[];
  /** The open page tabs of the plan's pages, in the order opened. */
  pages: readonly DrawnPage[];
  /** The open Terminal tabs of the plan's agents, in the order opened. */
  terminals: readonly TerminalStripTab[];
  /** Every code Luke showed on the plan, whose notes the file tabs' cards say. */
  shown: readonly TaskCodeShowing[];
  /** The plan's repository, whose showings alone the file tabs' cards read. */
  repository: string | null;
  /** What the "+" offers (`panelEntries`), which the empty panel offers too. */
  offers: readonly AddEntry[];
  /** What the agents' and the delegated workers' tabs last drew, which the workers' hover cards preview. */
  held: HeldTranscripts;
  /** Reads a planning worker's session past a cursor, the plan standing in the agent's place. */
  readWorker: TranscriptReader;
  /** The bar's slot the chosen tab's ⋯ stands in. */
  actionsSlot: HTMLElement | null;
  /** Opens an agent's tab in the plan's column, as a Changes tab's card offers. */
  onOpenAgent: (agentId: string) => void;
  /** The agent whose tab the plan's column shows, whose Changes card follows its run. */
  shownAgent: string | undefined;
}): React.JSX.Element {
  const copied = useTranscriptCopier();
  const kinds = stripTabs({
    panel,
    unread,
    agents,
    subagents,
    files,
    changes,
    pages,
    terminals,
    shown,
    repository,
    held,
    copied,
    readWorker: (callId) => readWholeTranscript(readWorker, { agentId: planId, callId }),
    onOpenAgent,
    shownAgent,
  });
  const strip = inTaskOrder(kinds, panel.order, (entry) => entry.tab);
  const copyLink = useCopyLinkItem();
  // ⌘W closes the tab chosen, as its menu's Close does; with none, the key
  // falls through to the menu bar, which closes the window (`app-menu.ts`).
  const chosen = strip.find((entry) => entry.look.selected);
  useAppCommand(APP_COMMAND.CLOSE_TAB, keys ? chosen?.close : undefined);
  const pinOf = ({ tab, look }: DrawnTab): TabPin | undefined => {
    if (holder !== SIDE_PANEL_HOLDER.PLAN || !isPinnable(tab)) return undefined;
    const pinned = panel.pins.some((pin) => pin.task === planId && sameTab(pin.tab, tab));
    return {
      pinned,
      onToggle: () => (pinned ? panel.onUnpin(planId, tab) : panel.onPin(tab, look.label)),
    };
  };
  const doorsOf = (entry: DrawnTab, at: number): TabDoors => {
    const others = strip.filter((_, place) => place !== at);
    // Note that only a task's panel names its tabs by the task: an agent's page holds its panel under the agent's id.
    const linked = holder === SIDE_PANEL_HOLDER.PLAN ? panelTabPlace(planId, entry.tab) : undefined;
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
      copyLink: linked === undefined ? undefined : copyLink(linked),
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
          <DoorsTab
            key={tabKey(entry.tab)}
            look={entry.look}
            doors={doorsOf(entry, at)}
            slot={actionsSlot}
          />
        ))}
      </TabStrip>
      <AddTabButton
        label="Open a tab"
        placeholder="Search tabs"
        noMatch="No tabs match"
        entries={offers}
        onOpen={undefined}
        asked={panel.newTabAsked}
        answers={keys}
        onAnswered={panel.onNewTabAnswered}
      />
    </div>
  );
}

/** The panel with every tab closed: every row its "+" menu offers, under the menu's own headings, each opening what it names as its row there does. */
function NoTabs({ entries }: { entries: readonly AddEntry[] }): React.JSX.Element {
  return (
    <div className="side-panel-no-tabs">
      <p className="side-panel-no-tabs-line">No tabs open</p>
      <MenuRowList
        rows={entries.map((entry) => entry.row)}
        onPick={(id) => entries.find((entry) => entry.row.id === id)?.onPick()}
      />
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
  conversation: TaskConversation;
  callLive: boolean;
  onLoadEarlier: () => Promise<void>;
  /** Reads a planning worker's session past a cursor, as an agent's worker's tab reads its own, the plan standing in the agent's place. */
  readWorker: TranscriptReader;
  /** The moment whose turn a version's Open asked to bring into view. */
  reveal?: { readonly at: number; readonly onRevealed: () => void } | undefined;
}

/** An open page tab the plan draws, with the page as the plan lists it. */
interface DrawnPage {
  tab: PageStripTab;
  line: PageLine;
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
  let state: GlyphState = GLYPH_STATE.REST;
  if (worker.call.running) state = GLYPH_STATE.WORKING;
  else if (workFailed(worker.session?.record)) state = GLYPH_STATE.FAILED;
  return {
    state,
    stateWords: glyphStateWords(state, worker.call.state === TASK_WORK_STATE.FAILED),
  };
}

/**
 * What a planning worker's card says: where it stands and when it last
 * moved, the model it ran on, and its latest step, from the session the
 * plan's work holds. Its tab's card and its row's in the plan's summary both
 * say it. A worker the work no longer holds says nothing, as its tab is
 * then not drawn (`drawnSubagents`).
 */
export function workerCardReading(
  worker: WorkWorkerBlock | undefined,
  held: HeldTranscripts,
  chosen = false,
): CardReading {
  const { state, stateWords } =
    worker === undefined
      ? { state: GLYPH_STATE.REST, stateWords: undefined }
      : workerStanding(worker);
  const writing = state === GLYPH_STATE.WORKING;
  // Its session is what its own tab last read, as a delegated worker's is.
  const drawn = worker === undefined ? undefined : held.workers.get(worker.call.id);
  const messages = heldLatest(drawn, { writing, runStartedAt: drawn?.runStartedAt }, chosen);
  return {
    corner: cardCorner({
      writing,
      startedAt: worker?.session?.startedAt ?? drawn?.runStartedAt,
      movedAt: lastFinished(messages),
      state: stateWords,
    }),
    choice: worker && workerChoice(worker),
    transcript:
      worker &&
      messages &&
      agentTranscript({
        title: worker.session?.title ?? workerJob(worker.call),
        messages,
        brief: undefined,
        task: worker.task,
      }),
  };
}

/**
 * A subagent as its tab draws it, `status` saying where a delegated worker
 * stands; nothing for a planning worker the work no longer holds.
 */
function drawnSubagent(
  tab: SubagentStripTab,
  workRows: readonly WorkTurnRow[],
  status: CodingAgentStatus,
  held: HeldTranscripts,
): DrawnSubagent | undefined {
  const { delegation, subagent } = tab;
  if (delegation !== undefined) {
    // Its own page says its title, and its agent's pages say every worker's.
    const title =
      held.workers.get(subagent)?.title ??
      held.agents.get(delegation.agent)?.subagentTitles.get(subagent);
    return {
      tab,
      label: title ?? cardTitle(delegation.task),
      untitled: title === undefined,
      state: agentGlyphState(status),
      stateWords: agentStateWords(status),
      worker: undefined,
    };
  }
  const worker = workerOf(workRows, subagent);
  if (worker === undefined) return undefined;
  const title = worker.session?.title;
  const label = title ?? workerJob(worker.call);
  return { tab, label, untitled: title === undefined, ...workerStanding(worker), worker };
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
    const status = standings.get(tab.subagent) ?? CODING_AGENT_STATUS.RUNNING;
    const subagent = drawnSubagent(tab, workRows, status, held);
    return subagent === undefined ? [] : [subagent];
  });
}

/** What a delegated worker runs on: its agent's own pair, and the one the call that started it says. */
interface DelegationChoices {
  readonly own: ModelChoice | undefined;
  readonly delegated: ModelChoice | undefined;
}

/**
 * The pair a delegated worker runs on: its agent's own, and the pair the
 * call that started it says, a half it left out being its agent's own.
 * Note that the call is read among what its agent's tab last held,
 * whatever turn that was, because the call says it once and for good; its
 * agent's own pair stands in until that call is held.
 */
function delegationChoices(
  delegation: NonNullable<SubagentStripTab["delegation"]>,
  subagent: string,
  agents: CodingAgentsControl,
  held: HeldTranscripts,
): DelegationChoices {
  const parent = agents.agents?.find((agent) => agent.id === delegation.agent);
  const own = parent === undefined ? undefined : { model: parent.model, effort: parent.effort };
  const started = held.agents.get(delegation.agent)?.messages;
  return { own, delegated: own && delegatedChoice(started, subagent, own) };
}

/**
 * What a subagent's card says, its tab's and its row's in a transcript
 * alike: a planning worker's from the session the plan's work holds
 * (`workerCardReading`), a delegated worker's from what its own tab last
 * held, its pair as the call that started it says it. A worker runs one
 * turn, so the run its tab last read is its run for good.
 */
function subagentCardReading(
  drawn: DrawnSubagent,
  agents: CodingAgentsControl,
  held: HeldTranscripts,
  chosen: boolean,
): () => CardReading {
  const { tab, label, state, stateWords, worker } = drawn;
  const { delegation } = tab;
  return () => {
    if (delegation === undefined) return workerCardReading(worker, held, chosen);
    const running = state === GLYPH_STATE.WORKING;
    const own = held.workers.get(tab.subagent);
    const messages = heldLatest(own, { writing: running, runStartedAt: own?.runStartedAt }, chosen);
    return {
      corner: cardCorner({
        writing: running,
        startedAt: own?.runStartedAt,
        movedAt: lastFinished(messages),
        state: stateWords,
      }),
      choice: delegationChoices(delegation, tab.subagent, agents, held).delegated,
      transcript:
        messages &&
        agentTranscript({ title: label, messages, brief: undefined, task: delegation.task }),
    };
  };
}

/**
 * Brings a call's row to the middle of the plan column's transcript once the
 * column draws it, as a worker's sender line opens its agent at the call
 * that started the worker; a row folded away, or never drawn, is left be.
 */
function seekCall(callId: string): void {
  focusSeek({
    find: () =>
      document.querySelector<HTMLElement>(
        `.desktop-task-column [role="log"] [data-call-id="${CSS.escape(callId)}"]`,
      ),
    ready: drawnVisibly,
    act: (row) => {
      const log = row.closest<HTMLElement>('[role="log"]');
      if (log !== null) centreWithin(log, row);
    },
  });
}

/** What a transcript's rows hang, by where they stand: the Call tab's, whose workers are the plan's own, and an agent's transcript's, whose workers are its delegations. */
export interface TaskCards {
  readonly call: TranscriptCards;
  readonly agent: (agentId: string) => TranscriptCards;
}

/**
 * The cards a transcript's rows hang, each the card of the tab the row
 * opens: a call about an agent the agent's (`agent-ref.tsx`), code shown
 * the file's, with Luke's note on the lines (`file-ref.tsx`), and a
 * subagent's row its worker's, read as its tab reads its own, `chosen`
 * telling whether that tab is the one shown, whose transcript follows the
 * run. A worker the plan's work no longer holds hangs none. An agent's
 * transcript also names the task whose plan it was handed, by `task`, and
 * every transcript names an agent a call is about by its tab's tile and
 * name, by `agent`.
 */
export function taskCards(input: {
  agents: CodingAgentsControl;
  workRows: readonly WorkTurnRow[];
  held: HeldTranscripts;
  chosen: (tab: StripTab) => boolean;
  /** Every code Luke showed on the plan, whose note on a `show_code` call's lines its row's card says. */
  shownCode: readonly TaskCodeShowing[];
  /** The plan's task, which an agent's plan card names as its sender. */
  task?: BriefTask | undefined;
}): TaskCards {
  const { agents, workRows, held, chosen, shownCode, task } = input;
  const target = (opened: ToolTarget) => {
    if (opened.kind === TOOL_TARGET.SHOWN_CODE) {
      const note = shownCode.find((each) => each.callId === opened.call)?.code.note;
      return <FileCard path={opened.ref.path} note={note} />;
    }
    if (opened.kind !== TOOL_TARGET.AGENT) return undefined;
    const tab = { agent: opened.agent };
    const subject = agentSubject(agents, opened.agent, held, chosen(tab));
    return <AgentCard subject={subject} models={agents.models} />;
  };
  // An agent the plan lists is named on a call's row as its tab wears it; one it does not is left to the call's answer.
  const agent = (agentId: string) => {
    const subject = agentSubject(agents, agentId, held, false);
    return subject.agent === undefined ? undefined : subject.tile;
  };
  const card = (drawn: DrawnSubagent | undefined) =>
    drawn && (
      <AgentTabCard
        name={drawn.label}
        untitled={drawn.untitled}
        models={agents.models ?? []}
        read={subagentCardReading(drawn, agents, held, chosen(drawn.tab))}
      />
    );
  return {
    call: {
      target,
      agent,
      worker: ({ callId, status }) =>
        card(drawnSubagent({ subagent: callId }, workRows, status, held)),
    },
    agent: (agentId) => ({
      target,
      agent,
      task,
      worker: ({ callId, task, status }) =>
        card(
          drawnSubagent(
            { subagent: callId, delegation: { agent: agentId, task } },
            workRows,
            status,
            held,
          ),
        ),
    }),
  };
}

/** Where a planning worker stands, as its tab's working line reads it: running while it moves, failed where it failed, and done otherwise. */
function workerStatus(worker: WorkWorkerBlock): CodingAgentStatus {
  if (worker.call.running) return CODING_AGENT_STATUS.RUNNING;
  return worker.call.state === TASK_WORK_STATE.FAILED
    ? CODING_AGENT_STATUS.FAILED
    : CODING_AGENT_STATUS.COMPLETED;
}

/** What the chosen tab shows. */
function TabContent({
  tab,
  taskId,
  repository,
  board,
  shownCode,
  files,
  pages,
  transcript,
  work,
  workRows,
  agents,
  standings,
  shown,
  findActive,
  onOpenSubagent,
  onOpenTarget,
  cards,
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
  onCloseTab,
  shellsList,
  summary,
}: {
  tab: SidePanelTab;
  taskId: string;
  /** The plan's summary, which its Summary tab draws (`task-summary.tsx`); none where the panel offers no such tab. */
  summary: React.JSX.Element | undefined;
  /** The plan's repository, which a file's tab is read from as it stands now. */
  repository: string | null;
  board: Board | undefined;
  shownCode: readonly TaskCodeShowing[] | undefined;
  /** The open file tabs, which a file's tab reads its lit lines from. */
  files: readonly OpenFile[];
  /** The plan's pages, which a page's tab draws its newest version of. */
  pages: readonly PageLine[];
  transcript: SidePanelTranscript;
  work: SidePanelWork;
  /** The plan's work as rows, which a subagent's tab reads its session from. */
  workRows: readonly WorkTurnRow[];
  agents: CodingAgentsControl;
  standings: WorkerStandings;
  /** Whether the panel is on screen, so a subagent's tab knows to follow its transcript. */
  shown: boolean;
  /** Whether the panel holds the window's keys, so a page's tab finds in its source. */
  findActive: boolean;
  /** Opens a planning worker's session in a tab of its own, by the call that started it. */
  onOpenSubagent: (callId: string) => void;
  /** Opens what a call on the Call tab is about in the tab that draws it, as a start's row opens its agent's tab in the plan's column. */
  onOpenTarget: (target: ToolTarget) => void;
  /** The cards the Call tab's rows that open a tab hang. */
  cards: TranscriptCards;
  /** A delegated worker's page said where it stands now. */
  onWorkerStatus: (callId: string, status: CodingAgentStatus) => void;
  /** A delegated worker's tab drew its transcript anew, by the call that started it. */
  onWorkerHeld: TabViews["onWorkerHeld"];
  /** Opens a file of the plan's repository in a tab of its own, the reference's lines lit. */
  onOpenFile: (ref: CodeRef, commit?: string) => void;
  /** Whether a File or Changes tab's tree is open, which holds for every one of them alike, and its toggle. */
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
  /** Closes a tab whose subject is gone, as an archived agent's Terminal tab closes. */
  onCloseTab: (tab: SidePanelTab) => void;
  /** Whether a Terminal tab's shells list is open, which holds for every one of them alike, and its toggle. */
  shellsList: { readonly open: boolean; readonly onToggle: () => void };
}): React.JSX.Element {
  const { act, tell } = useAct();
  if (isTerminalTab(tab)) {
    return (
      <TerminalTab
        key={tab.terminal}
        agentId={tab.terminal}
        agents={agents}
        shown={shown}
        onOpenAgent={() => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent: tab.terminal })}
        onClose={() => onCloseTab(tab)}
        shells={shellsList}
      />
    );
  }
  if (isPageTab(tab)) {
    const page = pages.find((each) => each.id === tab.page);
    // The tab stands for a page the plan no longer lists only until the panel moves on, a render away.
    return page === undefined ? (
      <SpinnerRegion label="Loading page" />
    ) : (
      <PagePane
        key={page.id}
        taskId={taskId}
        page={page}
        readSource={(version) =>
          act(ACT_KIND.TASKS_PAGE_SOURCE, { taskId: taskId, pageId: page.id, version })
        }
        findActive={findActive}
      />
    );
  }
  if (isChangesTab(tab)) {
    return (
      <AgentChangesTab
        key={tab.changes}
        agentId={tab.changes}
        control={agents}
        shown={shown}
        repository={repository}
        tree={fileTree}
      />
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
          taskId={taskId}
          repository={repository}
          file={file}
          snippet={snippetOf(shownCode, file)}
          shownCode={shownCode}
          readFile={(window) => act(ACT_KIND.TASKS_FILE, { taskId: taskId, ...window })}
          readFolder={(path) => act(ACT_KIND.TASKS_TREE, { planId: taskId, path })}
          readWhole={() => act(ACT_KIND.TASKS_TREE, { planId: taskId, path: "", recursive: true })}
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
    // A planning worker's tab is an agent's worker's own, reading its session under the plan.
    const tasksWorkers = { ...agents, readTranscript: work.readWorker };
    if (tab.delegation !== undefined) {
      const parent: ToolTarget = { kind: TOOL_TARGET.AGENT, agent: tab.delegation.agent };
      const { subagent } = tab;
      return (
        <AgentSubagentTab
          key={tab.subagent}
          sender={
            <AgentActorRef
              subject={agentSubject(agents, parent.agent, NOTHING_HELD, false)}
              models={agents.models}
              onOpen={() => {
                onOpenTarget(parent);
                seekCall(subagent);
              }}
            />
          }
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
      <AgentSubagentTab
        key={tab.subagent}
        agentId={taskId}
        callId={tab.subagent}
        task={worker.task}
        status={workerStatus(worker)}
        control={tasksWorkers}
        shown={shown}
        // Where a planning worker stands is the plan's pages' to say, beside its call.
        onStatus={() => undefined}
        onHeld={onWorkerHeld}
      />
    );
  }
  switch (tab) {
    // Note that only a plan's panel offers the Summary, and it hands the panel the plan's.
    case SIDE_PANEL_TAB.SUMMARY:
      return summary ?? <SpinnerRegion label="Loading summary" />;
    case SIDE_PANEL_TAB.BOARD:
      // An archived plan's board only shows, as its agents only read.
      return (
        <TaskBoard taskId={taskId} board={board} viewOnly={agents.onUnarchive !== undefined} />
      );
    case SIDE_PANEL_TAB.CODE:
      return shownCode === undefined || shownCode.length === 0 ? (
        <EmptyState icon={tabLook({ kind: TAB_KIND.PANEL, tab: SIDE_PANEL_TAB.CODE }).icon}>
          {NO_CODE_LINE}
        </EmptyState>
      ) : (
        <CodePane
          shown={shownCode}
          calls={transcript.region.kind === TRANSCRIPT_REGION.READY ? transcript.region.calls : []}
          onOpenFile={onOpenFile}
          reveal={codeReveal}
          onRevealed={onRevealed}
        />
      );
    case SIDE_PANEL_TAB.CALL:
      return (
        <TaskCall
          region={transcript.region}
          onRetry={transcript.onRetry}
          conversation={work.conversation}
          callLive={work.callLive}
          onLoadEarlier={work.onLoadEarlier}
          onOpenSubagent={onOpenSubagent}
          onOpenTarget={onOpenTarget}
          cards={cards}
          shown={shown}
          models={agents.models}
          reveal={transcript.reveal ?? work.reveal}
          video={<CallTabVideo planId={taskId} />}
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
  holder,
  planId,
  repository,
  board,
  shownCode,
  pages,
  transcript,
  work,
  agents,
  openAgents,
  shownAgent,
  views,
  shown,
  focused,
  onOpenTarget,
  cards,
  banner,
  summary,
}: SidePanelDrawing & {
  panel: SidePanelControl;
  /** The tabs holding something that arrived while another was shown, each in semibold until it is shown. */
  unread: readonly StripTab[];
  holder: SidePanelHolder;
  /** The plan the panel stands beside, or the agent where it stands beside the agent's own page. */
  planId: string;
  /** The plan's repository, `owner/name`, or none before one is chosen. */
  repository: string | null;
  board: Board | undefined;
  /** Every code Luke showed on the plan, oldest first. */
  shownCode: readonly TaskCodeShowing[] | undefined;
  /** The pages agents wrote for the plan, each by its newest version; none where it has none. */
  pages: readonly PageLine[] | undefined;
  transcript: SidePanelTranscript;
  work: SidePanelWork;
  agents: CodingAgentsControl;
  /** The plan's agents whose tabs stand open in the plan's column, whose workers' tabs stand here; nothing while unread. */
  openAgents: readonly string[] | undefined;
  /** The agent whose tab follows its run in the plan's column, whose card previews its latest step (`followedAgent`); none while another tab is shown or the column is out of sight. */
  shownAgent: string | undefined;
  /** What the agents' and the workers' tabs last drew and said, which the workers' tabs and cards read. */
  views: TabViews;
  /** Whether the plan's page is on screen, which a subagent's tab follows its transcript under. */
  shown: boolean;
  /** Whether the panel holds the window's focus, which its ⌘W, ⌘T, and ⌘F answer to. */
  focused: boolean;
  /** Opens what a call on the Call tab is about in the tab that draws it, as a start's row opens its agent's tab in the plan's column. */
  onOpenTarget: (target: ToolTarget) => void;
  /** The cards the Call tab's rows that open a tab hang, as those tabs hang them. */
  cards: TaskCards;
  /** The plan's banner, where one stands (`task-banner.tsx`), drawn under the bar while the panel fills the window and covers the column that draws it otherwise. */
  banner?: React.ReactNode;
  /** The plan's summary, which its Summary tab draws; none where the panel offers no such tab. */
  summary?: React.JSX.Element;
}): React.JSX.Element {
  const aside = useRef<HTMLElement>(null);
  const room = useRef<HTMLDivElement>(null);
  // The one slot the bar keeps for the chosen tab's ⋯, drawn there from the tab (`strip-tabs.tsx`).
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const { tab } = panel;
  // Whether a File or Changes tab's tree is open, for every one of them
  // alike and for the window's life, as an editor's explorer stands across
  // its tabs.
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
  const fileTree = useMemo(
    () => ({ open: fileTreeOpen, onToggle: () => setFileTreeOpen((was) => !was) }),
    [fileTreeOpen],
  );
  // Whether a Terminal tab's shells list is open, for every one of them alike
  // and for the window's life, as the File tabs' tree is.
  const [shellsOpen, setShellsOpen] = useState(true);
  const shellsList = useMemo(
    () => ({ open: shellsOpen, onToggle: () => setShellsOpen((was) => !was) }),
    [shellsOpen],
  );
  // Every subagent the plan's work holds, and those with a tab open, each
  // with its session, in the order started and the strip's order; a
  // delegated worker's tab stands while its agent's does.
  const workRows = workRowsOf(work.conversation, work.callLive);
  const workers = taskWorkers(workRows);
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
  // An agent's Changes tab stands while the agent is the plan's.
  const changes = panel.changes.filter((each) =>
    drawsChanges(each, { taskAgents: agents.agentIds }),
  );
  // An agent's Terminal tab stands while the agent is the plan's, as its Changes tab does.
  const terminals = panel.terminals.filter((each) =>
    drawsTerminal(each, { taskAgents: agents.agentIds }),
  );
  // A page's tab stands while the plan lists the page.
  const taskPages = pages ?? NO_PAGES;
  const pageTabs = panel.pages.flatMap((tab) => {
    const line = taskPages.find((each) => each.id === tab.page);
    return line === undefined ? [] : [{ tab, line }];
  });
  const label =
    tab === undefined
      ? undefined
      : isSubagentTab(tab)
        ? subagents.find((each) => sameTab(each.tab, tab))?.label
        : isFileTab(tab)
          ? tab.file
          : isChangesTab(tab)
            ? changesLook(tab.changes, agents).label
            : isPageTab(tab)
              ? pageTabs.find((each) => sameTab(each.tab, tab))?.line.title
              : isTerminalTab(tab)
                ? TAB_WORDS.TERMINAL
                : tabLook({ kind: TAB_KIND.PANEL, tab }).label;
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
  // The panel's "+" asks for a new shell where the panel already holds the keys.
  const openTerminal = useOpenTerminal(panel, noFocusMove);
  const offers = panelEntries({
    panel,
    kinds: HOLDER_KINDS[holder],
    workers,
    files: offered,
    changes: changesOffers(agents, changes),
    pages: taskPages,
    terminals: {
      offers: terminalOffers(agents, panel),
      onNew: (agentId) => openTerminal(agentId, TERMINAL_ASK.NEW),
    },
  });
  // Something on offer past the fixed kinds, which an empty panel offers in place as a closed kind is.
  const offersMore = offers.some((entry) => entry.row.section !== undefined);

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
            holder={holder}
            taskId={planId}
            keys={keys && focused}
            unread={unread}
            agents={agents}
            subagents={subagents}
            files={files}
            changes={changes}
            pages={pageTabs}
            terminals={terminals}
            shown={shownCode ?? []}
            repository={repository}
            offers={offers}
            held={drawnTranscripts}
            readWorker={work.readWorker}
            actionsSlot={actionsSlot}
            onOpenAgent={(agent) => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent })}
            shownAgent={shownAgent}
          />
          <span ref={setActionsSlot} className="toolbar-tab-actions" />
          <FullScreenToggle
            fullScreen={panel.fullScreen}
            leaving={leaving !== PANEL_LEAVING.NONE}
            onToggle={panel.onToggleFullScreen}
          />
        </div>
        {panel.fullScreen ? banner : null}
        {/* A panel with nothing to offer but kinds it has never closed stands
            empty, the "+" above offering any; otherwise every tab closed, it
            offers in place all that the "+" offers. */}
        {tab === undefined ? (
          <div className="side-panel-content">
            {panel.closedTabs.length === 0 && !offersMore ? null : <NoTabs entries={offers} />}
          </div>
        ) : (
          // The Board is drawn on a canvas, which keeps a find of its own, and
          // a page's words stand in a sandboxed frame no find of the window
          // reaches, so a page's tab finds in its source alone, itself.
          <FindScope
            className="side-panel-content"
            role="tabpanel"
            aria-label={label}
            active={keys && focused && tab !== SIDE_PANEL_TAB.BOARD && !isPageTab(tab)}
            subject={{ task: planId, tab }}
          >
            <TabContent
              tab={tab}
              taskId={planId}
              repository={repository}
              board={board}
              shownCode={shownCode}
              files={files}
              pages={taskPages}
              transcript={transcript}
              work={work}
              workRows={workRows}
              agents={agents}
              standings={standings}
              shown={keys}
              findActive={keys && focused}
              onOpenSubagent={openSubagent}
              onOpenTarget={onOpenTarget}
              cards={cards.call}
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
              onCloseTab={panel.onClose}
              shellsList={shellsList}
              summary={summary}
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
