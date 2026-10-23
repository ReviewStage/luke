import type { AgentBrowserTab } from "@luke/features/agent-browser-tab-wire";
import type { Board } from "@luke/features/board-wire";
import {
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import type { ModelChoice } from "@luke/features/models-wire";
import type { PageLine, PagePlace } from "@luke/features/page-wire";
import type { CodeRef } from "@luke/features/task-wire";
import type { TaskCodeShowing } from "@luke/features/tasks-view";
import { TERMINAL_ASK, TERMINAL_TARGET, terminalTarget } from "@luke/features/terminal-entry";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT, HOST_CAPABILITY } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  CloseIcon,
  CollapseIcon,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  ExpandIcon,
  Fill,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  IconButton,
  LIST_DENSITY,
  List,
  ListRow,
  RESIZE_EDGE_SIDE,
  ResizeEdge,
  type ResizeEdgeHandle,
  RowHint,
  RowHintOptions,
  SCROLL_SIZE,
  ScrollArea,
  SidePanelIcon,
  SpinnerRegion,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Tooltip,
  useResizeEdge,
} from "@luke/ui";
import { LUKE_ACTOR } from "@luke/ui/actor-model";
import {
  agentOfTab,
  type ChangesStripTab,
  inTaskOrder,
  isChangesTab,
  isCloudBrowserTab,
  isFileTab,
  isMacTerminalTab,
  isPageTab,
  isSubagentTab,
  isTerminalTab,
  isTranscriptTab,
  type PageStripTab,
  type StripTab,
  type SubagentStripTab,
  sameTab,
  TAB_WORDS,
  type TerminalStripTab,
  tabKey,
} from "@luke/ui/tab-strip-model";
import type { CodeFeedCallSource } from "@luke/voice/code-pane-model";
import { type ShownFile, shownFiles } from "@luke/voice/code-pane-model";
import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useAct } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { appPlatform } from "../app-platform.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { DraftMark } from "../draft-mark.js";
import { FindScope } from "../find-in-tab.js";
import { drawnVisibly, focusSeek } from "../focus-seek.js";
import { panelTabPlace } from "../links-at-hand.js";
import { useMemberDirectory } from "../member-directory.js";
import { type MenuRow, MenuRowList } from "../searchable-menu.js";
import { GLYPH_STATE, type GlyphState, stateEndMark } from "../state-glyph.js";
import { AgentActorRef, AgentCard, agentSubject, NOTHING_HELD } from "../tasks/agent-ref.js";
import { AgentSubagentTab, type BriefTask, type TranscriptCards } from "../tasks/agent-tab.js";
import {
  AgentTabCard,
  type CardReading,
  cardCorner,
  delegatedChoice,
  heldLatest,
  lastFinished,
} from "../tasks/agent-tab-card.js";
import { ChangesCard, peopleOf } from "../tasks/changes-card.js";
import { TaskChipCard } from "../tasks/chip-cards.js";
import {
  browserOf,
  CloudBrowserDraftPane,
  type CloudBrowserOwner,
  CloudBrowserPane,
} from "../tasks/cloud-browser-pane.js";
import {
  type CloudBrowserDraft,
  discardCloudDraft,
  startCloudDraft,
  useCloudBrowserDrafts,
  useCloudBrowserTabs,
} from "../tasks/cloud-browser-tabs.js";
import { CodePane, centreWithin } from "../tasks/code-pane.js";
import {
  agentGlyphState,
  agentStateWords,
  agentTabLabel,
  subagentActor,
} from "../tasks/coding-agent-model.js";
import { FileCard, fileLook, newestFileNote } from "../tasks/file-ref.js";
import { snippetOf } from "../tasks/file-tab-model.js";
import { FileView, type TreeShown } from "../tasks/file-view.js";
import { MacTerminalTab } from "../tasks/mac-terminal-tab.js";
import { PageCard } from "../tasks/page-card.js";
import { PagePane } from "../tasks/page-pane.js";
import { PlanCommentsTab } from "../tasks/plan-comments.js";
import { ofPullRequestTab, pullRequestOfTab } from "../tasks/pull-request-number.js";
import {
  AgentGlyph,
  type KindLook,
  type PlanStanding,
  TAB_KIND,
  tabLook,
} from "../tasks/tab-look.js";
import { TaskBoard } from "../tasks/task-board.js";
import { useOpenTerminal } from "../tasks/terminal-commands.js";
import { TerminalCardFoot, TerminalStanding } from "../tasks/terminal-shells.js";
import { TerminalTab } from "../tasks/terminal-tab.js";
import { cardTitle, TOOL_TARGET, type ToolTarget } from "../tasks/tool-call-model.js";
import {
  agentTranscript,
  readWholeTranscript,
  type TranscriptCopy,
} from "../tasks/transcript-copy.js";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import { PullRequestsOnGitHub } from "../tasks/use-open-link.js";
import {
  type DrawnTabs,
  drawsChanges,
  drawsSubagent,
  drawsTerminal,
  type FileHistoryStep,
  type FixedSidePanelTab,
  isPinnable,
  type OpenFile,
  PULL_REQUEST_VIEW,
  type PullRequestView,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
  type SidePanelControl,
  type SidePanelTab,
} from "../tasks/use-side-panel.js";
import { useCapability, useExperiment } from "../use-app-state.js";
import type { MenuAction } from "./action-menu.js";
import { useAgentTerminalDoors } from "./agent-actions.js";
import { useFileTreeWidth } from "./folded-groups.js";
import { PULL_REQUEST_TAB } from "./pages-on-demand.js";
import { paneTiming } from "./pane-motion.js";
import {
  type AddEntry,
  AddTabButton,
  contentActionGroups,
  DoorsTab,
  type HeldTranscripts,
  type TabDoors,
  type TabLook,
  type TabPin,
  type TabViews,
  type TranscriptCopier,
  useTranscriptCopier,
  type WorkerStandings,
} from "./strip-tabs.js";
import { LOOK_STRIP, useStripLooks } from "./switcher-looks.js";
import { TabStrip } from "./tab-strip.js";

/**
 * What a phone's header is handed of the tab the panel shows (`task-pane-switcher.tsx`):
 * what it is called, and, read as the header's ⋯ opens, what it offers on what
 * it shows, which its own ⋯ offers where the panel's bar stands.
 */
export interface ShownTab {
  readonly label: string;
  readonly groups: () => MenuAction[][];
}

/** A phone's Activity, as the panel's strip is handed it: where it lists the tabs, how a row's press leaves the list, and where the tab shown is handed on. */
interface StripActivity {
  readonly slot: HTMLElement | null;
  readonly onListed: (listed: boolean) => void;
  readonly onShown: (shown: ShownTab | undefined) => void;
}

/**
 * side-panel.tsx -- the open task's side panel at the window's right: its toggle, its tabs and their "+", its full-screen button, the tab shown, and the edge it is resized by.
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
 * opened, at the strip's end, and a task that has used none, and has no agent, says
 * so in the panel's body under the "+". The task's coding agents follow, one tab each, named by model and wearing
 * its harness's mark for where the agent stands; after them stand the subagents opened from
 * the Call tab, the "+", or a delegation's row in an agent's tab, one tab
 * each, named by job. A draft agent opened from the "+" stands after the
 * agents until its first message starts it. Every tab closes, and closing
 * an agent's or a subagent's closes only the view: the agent goes on as it
 * was, and the "+" opens its tab again; closing a draft's lets the draft
 * go, nothing of it having been started. Every tab's right-click offers
 * Close and Close others, a fixed tab's, an agent's, and a file's Pin to the
 * sidebar, and a transcript's tab its two copies. The task's own actions stay in
 * the task's toolbar and never come into the panel. Where a delegated
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

/** What the Code tab says while Luke has shown no code on the task. */
const NO_CODE_LINE = "No code yet.";

/** What the Code tab says where the task's code could not be read and none is held. */
const UNREAD_CODE_LINE = "The code could not be read.";

/**
 * The calls the Code tab's feed groups its code under: none, since every
 * call is an agent's now and drawn in that agent's tab, so the feed heads
 * each code by the turn that showed it.
 */
const NO_CODE_CALLS: readonly CodeFeedCallSource[] = [];

/** The task's code read that did not land, and its retry, which the Code tab offers while it holds no code. */
interface CodeFailed {
  readonly onRetry: () => void;
}

/**
 * What the panel leaves the document beside it, as desktop.css declares it
 * on the task's area: the panel is dragged no wider than the area less this,
 * and has no greatest width of its own. `.side-panel`'s `max-width` holds the
 * same room while the window narrows.
 */
const DOCUMENT_RESERVE_PROPERTY = "--document-reserve";

/**
 * The room the document keeps in the task's area, in CSS pixels. Where the
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

/** A task with no page, the same array every render. */
const NO_PAGES: readonly PageLine[] = [];

/**
 * What the panel stands beside: a plan's page, whose panel holds every kind
 * of tab, or the page of an agent no plan holds, whose panel holds that
 * agent's workers, its Pull request, and its Terminal, the Code a call
 * into it showed where it has no task to hold it, and no plan's Board,
 * Call, files, or pages. A tab of an agent's page is no plan's to
 * pin, so none is offered. Beside the window's Inbox it stands for the
 * chosen item's task, holding what the item opened there, the task's
 * files, pages, and Pull requests, and none of the kinds its page draws
 * from what it holds, the fixed three and Terminal; nor is a tab of it
 * pinned there, since the Inbox is no plan's page.
 */
export const SIDE_PANEL_HOLDER = {
  TASK: "plan",
  AGENT: "agent",
  INBOX: "inbox",
} as const;

type SidePanelHolder = (typeof SIDE_PANEL_HOLDER)[keyof typeof SIDE_PANEL_HOLDER];

/** What the panel's pages stand on: the agent on no task an agent's page holds the panel under, else the task. */
function pagePlaceOf(holder: SidePanelHolder, id: string): PagePlace {
  return holder === SIDE_PANEL_HOLDER.AGENT ? { agentId: id } : { taskId: id };
}

/** No fixed kind, the same array every render. */
const NO_KINDS: readonly FixedSidePanelTab[] = [];

/** No Terminal tab, as the Inbox's panel draws. */
const NO_TERMINALS: readonly TerminalStripTab[] = [];

/** The Code tab alone, which an agent's page offers while a call into it showed code. */
const CODE_KINDS: readonly FixedSidePanelTab[] = [SIDE_PANEL_TAB.CODE];

/** The fixed kinds each holder's panel offers. */
const HOLDER_KINDS = {
  [SIDE_PANEL_HOLDER.TASK]: SIDE_PANEL_TABS,
  [SIDE_PANEL_HOLDER.AGENT]: CODE_KINDS,
  [SIDE_PANEL_HOLDER.INBOX]: NO_KINDS,
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

/** No worker's tab stands but a delegated one's, which its agent's open tab keeps (`drawsSubagent`). */
const NO_SUBAGENTS: readonly string[] = [];

/** The "+" menu's sections after the fixed kinds, which the task's summary lists under the same headings. */
export const ADD_SECTION = {
  FILES: "Files",
  PULL_REQUESTS: "Pull requests",
  PAGES: "Pages",
  TERMINAL: "Terminal",
  BROWSER: "Browser",
} as const;

/** A coding agent whose cloud browser the "+" offers a new tab in: the agent, and whose browser it is as the tab will say. */
interface CloudBrowserOffer {
  readonly agentId: string;
  readonly owner: CloudBrowserOwner;
}

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

/** What the chosen tab's body hands its toolbar's ⋯ (`useHandedTabActions`), and the tab it was drawn for, which alone offers them. */
interface HandedTabActions {
  readonly tab: SidePanelTab;
  readonly actions: MenuAction[];
}

/** What the "+" calls the row that opens a Browser tab. */
const NEW_BROWSER_TAB = "New Browser tab";

/**
 * One of the task's agents' cloud Browser tabs as the panel draws it, by
 * the id the strip keeps it under: the tab the service lists, or a draft
 * this window holds that opens nothing yet; and whose browser it is in.
 */
type DrawnCloudBrowser = { readonly id: string; readonly owner: CloudBrowserOwner } & (
  | { readonly tab: AgentBrowserTab }
  | { readonly draft: CloudBrowserDraft }
);

/** No cloud Browser tab on the task, the same array every render. */
const NO_CLOUD_BROWSERS: readonly DrawnCloudBrowser[] = [];

/** Whose browser a cloud Browser tab of the task's own is in. */
const LUKE_NAME = "Luke";

/** What a draft of a tab in an agent's browser is called, until it opens a page. */
const NEW_CLOUD_TAB = "New tab";

/** What a cloud Browser tab is called: its page's title, its address's host until it has one, and the word for a Browser tab before either; a draft's own words. */
function cloudBrowserTitleOf(drawn: DrawnCloudBrowser): string {
  if (!("tab" in drawn)) return NEW_CLOUD_TAB;
  const { tab } = drawn;
  if (tab.title.length > 0) return tab.title;
  return (URL.canParse(tab.address) ? new URL(tab.address).host : "") || TAB_WORDS.BROWSER;
}

/** A cloud Browser tab's card: its title, under the glyph of whose browser it lives in, which the line under says, then its address once it has one. */
function CloudBrowserCard({ drawn }: { drawn: DrawnCloudBrowser }): React.JSX.Element {
  const address = "tab" in drawn ? drawn.tab.address : "";
  return (
    <HoverCard data-tab-card="">
      <HoverCardHead
        glyph={drawn.owner.icon}
        name={cloudBrowserTitleOf(drawn)}
        sub={`In ${browserOf(drawn.owner.name)}`}
      />
      {address.length === 0 ? null : <HoverCardNote oneLine>{address}</HoverCardNote>}
    </HoverCard>
  );
}

/** No Changes tab open on the task, the same array every render. */
const NO_OPEN_CHANGES: readonly ChangesStripTab[] = [];

/**
 * The task's agents in the order started, an archived one among them, since
 * the pull request an agent opened, merged or not, stays the task's once the
 * agent is archived.
 */
function everyTaskAgent(
  agents: Pick<CodingAgentsControl, "agents" | "archived">,
): readonly CodingAgentSummary[] {
  const listed = agents.agents ?? [];
  // Note that an agent's own page lists its agent among `agents` archived or not, so each is taken once.
  const archived = (agents.archived ?? []).filter(
    (agent) => !listed.some((each) => each.id === agent.id),
  );
  if (archived.length === 0) return listed;
  return [...listed, ...archived].sort((one, other) => one.createdAt - other.createdAt);
}

/**
 * The agent whose Changes tab stands for the agent's pull request: among the
 * agents on that pull request, in the order started, the first whose tab is
 * open on the task (`open`), else the first; the agent itself where its pull
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
  const sharing = everyTaskAgent(agents).filter(
    (agent) => agents.pullRequests.get(agent.id)?.url === url,
  );
  const opened = sharing.find((agent) =>
    open.some((tab) => tab.changes === agent.id && tab.number === undefined),
  );
  return (opened ?? sharing[0])?.id ?? agentId;
}

/**
 * The task's agents' Changes tabs on offer, in the order the agents
 * started, an archived one among them (`everyTaskAgent`): one for each
 * agent with a pull request, merged or not, its tab open in the
 * task's column or not, and none for an agent that has opened none yet,
 * whose tab would only say so. Note that two agents on one pull request
 * offer it once, under the agent whose tab stands for it (`changesAgentOf`),
 * because a row is named by the pull request and both tabs would draw the
 * same files. `open` is the Changes tabs open on the task.
 */
export function changesOffers(
  agents: CodingAgentsControl,
  open: readonly ChangesStripTab[] = NO_OPEN_CHANGES,
): readonly ChangesOffer[] {
  const offered = new Set<string>();
  const every = everyTaskAgent(agents);
  return every.flatMap((each) => {
    const pullRequest = agents.pullRequests.get(each.id);
    if (pullRequest === undefined || offered.has(pullRequest.url)) return [];
    offered.add(pullRequest.url);
    const agentId = changesAgentOf(agents, each.id, open);
    const agent = every.find((other) => other.id === agentId) ?? each;
    // The row shows the pull request as the agent its tab stands for last read it, as its tab's card does.
    const shown = agents.pullRequests.get(agent.id) ?? pullRequest;
    const label = agentTabLabel(agent, agents.models);
    return [{ agentId: agent.id, agent, label, pullRequest: shown }];
  });
}

/**
 * The Pull request tab an agent's pull request chip opens: the one that stands for its
 * pull request (`changesAgentOf`), as `changesOffers` offers it, so the chip
 * and the "+" never stand two tabs on one pull request's files, whichever
 * agent's read landed first. `open` is the Changes tabs open on the task.
 */
export function changesTabOf(
  agents: CodingAgentsControl,
  agentId: string,
  open: readonly ChangesStripTab[],
  number?: number,
): ChangesStripTab {
  // A pull request named by its number that is the agent's own is its own tab, so it never stands in two.
  if (number !== undefined && agents.pullRequests.get(agentId)?.number !== number) {
    return { changes: agentId, number };
  }
  return { changes: changesAgentOf(agents, agentId, open) };
}

/**
 * Opens an agent's Pull request tab, the one that stands for its pull
 * request (`changesTabOf`), on the view given: the conversation its pull
 * request's chip asks for, or the files a link to its changes does. A chip
 * is a link, so the tab opens as the panel's preview (`onPreview`).
 */
export function showPullRequest(
  panel: Pick<SidePanelControl, "changes" | "onPreview" | "onPullRequestView">,
  agents: CodingAgentsControl,
  agentId: string,
  view: PullRequestView,
  number?: number,
): void {
  const tab = changesTabOf(agents, agentId, panel.changes, number);
  panel.onPullRequestView(tab, view);
  panel.onPreview(tab);
}

/**
 * The "+" menu's New Browser tab, opened afresh each time, as a browser's
 * new tab is, so its row names no tab, and always in a coding agent's cloud
 * browser: on a task with one agent, a draft in its browser at once; on a
 * task with several, a submenu of whose browser, each wearing its glyph, the
 * one viewed first; and no row at all on a task with none.
 */
function browserEntries(browsers: Parameters<typeof panelEntries>[0]["browsers"]): AddEntry[] {
  const [only, ...more] = browsers?.agents ?? [];
  if (browsers === undefined || only === undefined) return [];
  const look = tabLook({ kind: TAB_KIND.BROWSER, title: NEW_BROWSER_TAB });
  const base = { id: ADD_SECTION.BROWSER, ...look, section: ADD_SECTION.BROWSER };
  if (more.length === 0) {
    // Note that the one agent's name is searched by too, as the submenu's choices are.
    const row = { ...base, terms: [only.owner.name] };
    return [{ row, onPick: () => browsers.onAgent(only.agentId) }];
  }
  const submenu = {
    label: "Open the tab in",
    rows: browsers.agents.map(({ agentId, owner }) => ({
      id: agentId,
      label: owner.name,
      icon: owner.icon,
    })),
    value: undefined,
    onPick: browsers.onAgent,
  };
  // Note that a pick of the row itself opens its submenu, so its own press does nothing.
  return [{ row: { ...base, submenu }, onPick: () => undefined }];
}

/** The "+" menu's row for a kind: its glyph and its name, whether or not its tab is open, the Plan's the task's own where it is known. */
function kindRow(tab: FixedSidePanelTab, plan: PlanStanding | undefined): MenuRow {
  return { id: tab, ...tabLook({ kind: TAB_KIND.PANEL, tab, plan }) };
}

/**
 * What the panel may open, as its "+" menu offers it, the task's summary
 * lists it (`task-summary.tsx`), and ⌘K finds it: the fixed kinds given,
 * every one for the "+" and those the task has used for the summary; then,
 * under Files, each file an agent showed on the task, by name with its
 * folder beside it. Each row wears its tab's own look (`tab-look.tsx`): a
 * file as every place names a file (`file-ref.tsx`). Picking a row whose tab is open chooses
 * that tab rather than opening another, as a browser's tab search does, so
 * no row says it is open; a file not open opens through the panel's one
 * door for a file on the newest snippet of it. Then, under Pull requests,
 * each agent's pull request (`changesOffers`), named as its Pull request tab
 * is, by its number and title (a kind still spelled `changes`, as the tab
 * of its files alone was), with the agent whose it is beside it, found by
 * the agent's name too, which opens the agent's Pull request tab. The task's coding agents are opened
 * from the task's column's own "+" (`main-tabs.tsx`).
 */
export function panelEntries(input: {
  panel: SidePanelControl;
  kinds: readonly FixedSidePanelTab[];
  files: readonly ShownFile[];
  /** The agents' Changes tabs on offer; none where the caller offers none. */
  changes?: readonly ChangesOffer[];
  /** The plan's pages, each by its newest version, which the "+" offers; none where the caller offers none. */
  pages?: readonly PageLine[];
  /** The task's agents' terminals on offer, and the door a row's pick asks a new shell through; none where the caller offers none. */
  terminals?: {
    readonly offers: readonly TerminalOffer[];
    readonly onNew: (agentId: string) => void;
  };
  /**
   * Where a new Browser tab may open, while the Browser tab experiment is
   * on: each of the task's coding agents' cloud browsers, the one viewed
   * first, drafted through `onAgent`; none where the caller offers none.
   */
  browsers?: {
    readonly agents: readonly CloudBrowserOffer[];
    readonly onAgent: (agentId: string) => void;
  };
  /** The task the panel stands beside, whose name and status the Plan's row wears; none where the caller does not know it. */
  plan?: PlanStanding | undefined;
}): AddEntry[] {
  const { panel, files, changes = [], pages = [] } = input;
  const kinds = input.kinds.map((kind) => ({
    row: kindRow(kind, input.plan),
    onPick: () => panel.onChoose(kind),
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
  // id already names the agent's own row in the task's summary.
  const changesRows = changes.map(({ agentId, label, pullRequest }) => {
    const look = tabLook({ kind: TAB_KIND.CHANGES, pullRequest });
    return {
      row: {
        id: pullRequest.url,
        ...look,
        detail: label,
        terms: [look.label, label],
        section: ADD_SECTION.PULL_REQUESTS,
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
  const browserRows = browserEntries(input.browsers);
  return [...kinds, ...fileRows, ...changesRows, ...pageRows, ...terminalRows, ...browserRows];
}

/**
 * The Plan tab's card: the task's own card, as its sidebar row and a chip
 * naming it hang it (`TaskChipCard`), or its glyph and name where the
 * window lists no such task; none where the panel knows no task. The plan's
 * summary row hangs the same (`task-summary.tsx`).
 */
export function planTabCard(
  planId: string | undefined,
  plan: PlanStanding | undefined,
): React.ReactNode {
  if (planId === undefined || plan === undefined) return undefined;
  const { icon, label } = tabLook({ kind: TAB_KIND.PLAN, ...plan });
  const fallback = (
    <HoverCard>
      <HoverCardHead glyph={icon} name={label} />
    </HoverCard>
  );
  return <TaskChipCard taskId={planId} fallback={fallback} />;
}

/** A Pull request tab's look, named by its pull request's number and title as the task's agents last read it, wearing its mark for where it stands. */
function changesLook(tab: ChangesStripTab, agents: CodingAgentsControl): KindLook {
  return tabLook({ kind: TAB_KIND.CHANGES, pullRequest: pullRequestOfTab(agents, tab) });
}

/**
 * The task's agents as the "+" offers their terminals, each marked where ⌘J
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
export interface DrawnTab {
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
 * holds it only while shown. A subagent's tab hangs a card on hover,
 * previewing its latest step from what its tab last held (`heldLatest`),
 * and never reading the service for it. A page's tab hangs the
 * page's card, a preview of its newest version under its title
 * (`page-card.tsx`).
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
  /** The task's agents' cloud Browser tabs, as the service lists them. */
  cloudBrowsers: readonly DrawnCloudBrowser[];
  /** Every code Luke showed on the task, whose newest note on a file its tab's card says. */
  shown: readonly TaskCodeShowing[];
  /** The task's repository, whose showings alone a file tab's card reads its note from. */
  repository: string | null;
  held: HeldTranscripts;
  copied: TranscriptCopier;
  /** Opens an agent's tab in the plan's column, as a card naming the agent offers. */
  onOpenAgent: (agentId: string) => void;
  /** The agent whose tab the plan's column shows, whose card follows its run. */
  shownAgent: string | undefined;
  /** The open plan, or the agent on no task, whose pages a page tab's card previews. */
  pagePlace: PagePlace;
  /** The task the panel stands beside, whose name and status its Plan tab wears; none where it is not known. */
  plan: PlanStanding | undefined;
  /** The task's id, whose card its Plan tab hangs; none beside an agent's own page. */
  planId: string | undefined;
  /** How many of the task's inbox items wait on the developer, which its Inbox tab counts. */
  inboxWaiting: number;
  /** Whether a card of the task's Inbox holds a draft, which its tab marks while another is chosen. */
  inboxDrafted: boolean;
}): DrawnTab[] {
  const { panel, unread, agents, subagents, files, changes, pages, terminals, shown, held } = input;
  const { repository, copied, onOpenAgent, shownAgent, pagePlace } = input;
  const { cloudBrowsers } = input;
  const chosen = (tab: SidePanelTab) => panel.tab !== undefined && sameTab(tab, panel.tab);
  const models = agents.models ?? [];
  const look = (tab: SidePanelTab, drawn: Omit<TabLook, "selected" | "onSelect">) => ({
    ...drawn,
    unread: unread.some((each) => sameTab(each, tab)),
    selected: chosen(tab),
    preview: panel.preview !== undefined && sameTab(tab, panel.preview),
    onSelect: () => panel.onChoose(tab),
    onKeep: () => panel.onKeep(tab),
  });
  // The Inbox counts what waits on the developer after its name, dimmed as a
  // model's effort is after the model's, so an item posted while the
  // developer reads elsewhere is seen from any tab, and wears the Draft
  // pencil at its end while a card's answer waits unsent and another tab is
  // chosen (`draft-mark.tsx`).
  const { inboxWaiting, inboxDrafted } = input;
  const fixed = panel.tabs.map((tab) => ({
    tab,
    look: look(tab, {
      ...tabLook({ kind: TAB_KIND.PANEL, tab, plan: input.plan }),
      detail: tab === SIDE_PANEL_TAB.INBOX && inboxWaiting > 0 ? String(inboxWaiting) : undefined,
      endMark:
        tab === SIDE_PANEL_TAB.INBOX && inboxDrafted && !chosen(tab) ? <DraftMark /> : undefined,
      card: tab === SIDE_PANEL_TAB.PLAN ? planTabCard(input.planId, input.plan) : undefined,
    }),
    close: () => panel.onClose(tab),
  }));
  const subagentTabs = subagents.map((drawn) => {
    const { tab, label, untitled, state, delegation } = drawn;
    const choices = delegationChoices(delegation, tab.subagent, agents, held);
    const model = choices.delegated?.model ?? choices.own?.model;
    const readCard = subagentCardReading(drawn, agents, held, chosen(tab));
    const { task } = delegation;
    const read = () =>
      readWholeTranscript(agents.readTranscript, {
        agentId: delegation.agent,
        callId: tab.subagent,
      }).then((messages) =>
        messages === undefined
          ? undefined
          : agentTranscript({
              title: label,
              messages,
              brief: undefined,
              task,
              chatOn: agents.chatOn,
            }),
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
    const pullRequest = pullRequestOfTab(agents, tab);
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
      look: look(tab, { ...changesLook(tab, agents), card }),
      close: () => panel.onClose(tab),
    };
  });
  // A page's tab hangs the page's card, previewing its newest version.
  const pageTabs = pages.map(({ tab, line }) => ({
    tab,
    look: look(tab, {
      ...tabLook({ kind: TAB_KIND.PAGE, title: line.title }),
      card: <PageCard place={pagePlace} page={line} />,
    }),
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
  // A terminal of this Mac's tab names the repository it runs beside its word.
  const macTerminalTabs = panel.strip.filter(isMacTerminalTab).map((tab) => ({
    tab,
    look: look(tab, { ...tabLook({ kind: TAB_KIND.MAC_TERMINAL }), detail: tab.repository }),
    close: () => panel.onClose(tab),
  }));
  // A cloud Browser tab is named by its page's title, wearing the glyph of whose browser it is in,
  // and hangs a card saying whose browser that is, with its address; a draft closed is discarded.
  const cloudBrowserTabs = panel.strip.filter(isCloudBrowserTab).flatMap((tab) => {
    const drawn = cloudBrowsers.find((each) => each.id === tab.cloudBrowser);
    if (drawn === undefined) return [];
    return [
      {
        tab,
        look: look(tab, {
          icon: drawn.owner.icon,
          label: cloudBrowserTitleOf(drawn),
          card: <CloudBrowserCard drawn={drawn} />,
        }),
        close: () => {
          if ("draft" in drawn && input.planId !== undefined) {
            discardCloudDraft(input.planId, drawn.id);
          }
          panel.onClose(tab);
        },
      },
    ];
  });
  // An agent's transcript beside the Inbox wears the agent's tab as its column draws it, and hangs its card.
  const transcriptTabs = panel.strip.filter(isTranscriptTab).flatMap((tab) => {
    const agent = agents.agents?.find((each) => each.id === tab.transcript);
    if (agent === undefined) return [];
    const { name, read } = agentSubject(agents, agent.id, held, chosen(tab));
    return [
      {
        tab,
        look: look(tab, {
          ...tabLook({ kind: TAB_KIND.AGENT, name, agent }),
          card: <AgentTabCard name={name} models={models} read={read} />,
        }),
        close: () => panel.onClose(tab),
      },
    ];
  });
  return [
    ...fixed,
    ...transcriptTabs,
    ...subagentTabs,
    ...fileTabs,
    ...changesTabs,
    ...pageTabs,
    ...terminalTabs,
    ...macTerminalTabs,
    ...cloudBrowserTabs,
  ];
}

/**
 * The strip of tabs across the panel's top: the open fixed tabs, then the
 * subagents and the files, then the "+". A fixed tab's own word is all it
 * needs to say, so it hangs no pill, but the Plan tab, which hangs the
 * task's card as its sidebar row does (`planTabCard`), while a subagent's hangs a card naming
 * it whole with when it last moved and its latest step
 * (`agent-tab-card.tsx`), and a Changes tab its pull request's, naming the
 * agent whose it is (`ChangesCard`), and a page's a preview of the page
 * (`PageCard`); no tab has a chord. A tab something arrived on
 * while another was shown reads in semibold until shown. Every tab, of
 * whatever kind, stands at the strip's end once opened, a subagent's
 * wearing the worker's glyph with a ring while it runs, until the developer
 * drags or steps any tab to any place, which the task keeps
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
  taskId,
  task,
  keys,
  unread,
  agents,
  subagents,
  files,
  changes,
  pages,
  terminals,
  cloudBrowsers,
  shown,
  repository,
  offers,
  held,
  actionsSlot,
  handed,
  onOpenAgent,
  shownAgent,
  inboxWaiting,
  inboxDrafted,
  activity,
}: {
  panel: SidePanelControl;
  holder: SidePanelHolder;
  /** The open task, which a tab's pin is of. */
  taskId: string;
  /** The task's name and status, which its Plan tab wears; none where they are not known. */
  task: PlanStanding | undefined;
  /** Whether the panel offers its keys: on screen, not on its way out, and holding the window's focus. */
  keys: boolean;
  unread: readonly StripTab[];
  agents: CodingAgentsControl;
  /** The open subagent tabs the task draws, in the strip's order. */
  subagents: readonly DrawnSubagent[];
  /** The open file tabs of files shown on the task, in the strip's order. */
  files: readonly OpenFile[];
  /** The open Changes tabs of the task's agents, in the order opened. */
  changes: readonly ChangesStripTab[];
  /** The open page tabs of the plan's pages, in the order opened. */
  pages: readonly DrawnPage[];
  /** The open Terminal tabs of the task's agents, in the order opened. */
  terminals: readonly TerminalStripTab[];
  /** The task's agents' cloud Browser tabs, as the service lists them. */
  cloudBrowsers: readonly DrawnCloudBrowser[];
  /** Every code Luke showed on the task, whose notes the file tabs' cards say. */
  shown: readonly TaskCodeShowing[];
  /** The task's repository, whose showings alone the file tabs' cards read. */
  repository: string | null;
  /** What the "+" offers (`panelEntries`), which the empty panel offers too. */
  offers: readonly AddEntry[];
  /** What the agents' and the delegated workers' tabs last drew, which the workers' hover cards preview. */
  held: HeldTranscripts;
  /** The bar's slot the chosen tab's ⋯ stands in. */
  actionsSlot: HTMLElement | null;
  /** What the chosen tab's body hands its ⋯, under the tab it was drawn for (`useHandedTabActions`). */
  handed: HandedTabActions | undefined;
  /** Opens an agent's tab in the plan's column, as a Changes tab's card offers. */
  onOpenAgent: (agentId: string) => void;
  /** The agent whose tab the plan's column shows, whose Changes card follows its run. */
  shownAgent: string | undefined;
  /** How many of the task's inbox items wait on the developer, which its Inbox tab counts. */
  inboxWaiting: number;
  /** Whether a card of the task's Inbox holds a draft, which its tab marks while another is chosen. */
  inboxDrafted: boolean;
  /** Where a phone's Activity lists the tabs in the strip's place, how a row's press leaves the list, and where the tab shown is handed on; none where the strip is the way between them. */
  activity?: StripActivity | undefined;
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
    cloudBrowsers,
    shown,
    repository,
    held,
    copied,
    onOpenAgent,
    shownAgent,
    pagePlace: pagePlaceOf(holder, taskId),
    plan: task,
    planId: holder === SIDE_PANEL_HOLDER.TASK ? taskId : undefined,
    inboxWaiting,
    inboxDrafted,
  });
  const strip = inTaskOrder(kinds, panel.order, (entry) => entry.tab);
  // Note that only a task's panel hands its looks over, since an agent's page holds its panel under the agent's id.
  useStripLooks(LOOK_STRIP.PANEL, holder === SIDE_PANEL_HOLDER.TASK ? taskId : undefined, strip);
  const copyLink = useCopyLinkItem();
  // ⌘W closes the tab chosen, as its menu's Close does; with none, the key
  // falls through to the menu bar, which closes the window (`app-menu.ts`).
  const chosen = strip.find((entry) => entry.look.selected);
  useAppCommand(APP_COMMAND.CLOSE_TAB, keys ? chosen?.close : undefined);
  const pinOf = ({ tab, look }: DrawnTab): TabPin | undefined => {
    if (holder !== SIDE_PANEL_HOLDER.TASK || !isPinnable(tab)) return undefined;
    const pinned = panel.pins.some((pin) => pin.task === taskId && sameTab(pin.tab, tab));
    return {
      pinned,
      onToggle: () => (pinned ? panel.onUnpin(taskId, tab) : panel.onPin(tab, look.label)),
    };
  };
  const doorsOf = (entry: DrawnTab, at: number): TabDoors => {
    const others = strip.filter((_, place) => place !== at);
    // Note that only a task's panel names its tabs by the task: an agent's page holds its panel under the agent's id, and names only its pages by it.
    const linked =
      holder === SIDE_PANEL_HOLDER.TASK
        ? panelTabPlace(taskId, entry.tab)
        : holder === SIDE_PANEL_HOLDER.AGENT && isPageTab(entry.tab)
          ? ({ kind: LINK_PLACE.PAGE, agentId: taskId, pageId: entry.tab.page } as const)
          : undefined;
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
      handed:
        entry.look.selected && handed !== undefined && sameTab(handed.tab, entry.tab)
          ? handed.actions
          : undefined,
    };
  };
  useShownTab(activity?.onShown, strip, doorsOf);
  return (
    <div className="side-panel-tabs">
      {activity?.slot
        ? createPortal(
            <ActivityList strip={strip} offers={offers} onListed={activity.onListed} />,
            activity.slot,
          )
        : null}
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
            slot={activity === undefined ? actionsSlot : null}
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

/**
 * Hands a phone's header the tab the strip shows, past the plan, which the
 * header names itself by: its name as it changes, and what it offers on what
 * it shows, read as the header's ⋯ opens, since those actions are made anew
 * on every draw; and none once no tab past the plan is shown, or the strip
 * is gone.
 */
function useShownTab(
  onShown: ((shown: ShownTab | undefined) => void) | undefined,
  strip: readonly DrawnTab[],
  doorsOf: (entry: DrawnTab, at: number) => TabDoors,
): void {
  const at = strip.findIndex((entry) => entry.look.selected);
  const chosen = strip[at];
  const groups = useRef<MenuAction[][]>([]);
  useLayoutEffect(() => {
    groups.current = chosen === undefined ? [] : contentActionGroups(doorsOf(chosen, at));
  });
  const label =
    chosen === undefined || chosen.tab === SIDE_PANEL_TAB.PLAN ? undefined : chosen.look.label;
  useEffect(() => {
    onShown?.(label === undefined ? undefined : { label, groups: () => groups.current });
  }, [onShown, label]);
  useEffect(() => () => onShown?.(undefined), [onShown]);
}

/**
 * A phone's Activity: every tab the panel holds but the plan's, each a row of
 * its glyph, its name, and what its tab says after it, newest arrivals in
 * the strip's own order, a press showing it across the panel; under them,
 * what the "+" offers, as the empty panel offers it, since a phone draws no
 * "+". With nothing open past the plan it says so over the offers.
 */
export function ActivityList({
  strip,
  offers,
  onListed,
}: {
  strip: readonly DrawnTab[];
  offers: readonly AddEntry[];
  onListed: (listed: boolean) => void;
}): React.JSX.Element {
  const open = strip.filter((entry) => entry.tab !== SIDE_PANEL_TAB.PLAN);
  // Note that a fixed kind already listed above, or the plan, its own view, is not offered again.
  const more = offers.filter(
    (entry) =>
      entry.row.section !== undefined ||
      (entry.row.id !== SIDE_PANEL_TAB.PLAN && !strip.some((each) => each.tab === entry.row.id)),
  );
  return (
    <ScrollArea size={SCROLL_SIZE.CONTENT}>
      <div className="side-panel-activity">
        {open.length === 0 ? (
          <div className="side-panel-no-tabs-line">
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              Nothing open past the plan
            </Text>
          </div>
        ) : (
          // Note that the open tabs are dense rows, as the offers under them (`MenuRowList`) are, so both read down one edge in one type.
          <List label="Activity" density={LIST_DENSITY.DENSE}>
            {open.map((entry) => (
              // Note that a tab's card hangs on its row as it hangs on the tab in the strip, since a row drops nothing its tab carries.
              <RowHintOptions key={tabKey(entry.tab)} card={entry.look.card} cardBeside>
                <ListRow
                  leading={entry.look.icon}
                  title={entry.look.label}
                  meta={entry.look.detail}
                  unread={entry.look.unread}
                  hint={
                    entry.look.card === undefined
                      ? undefined
                      : { Hint: RowHint, label: entry.look.label }
                  }
                  actions={
                    <IconButton
                      icon={<CloseIcon />}
                      label={`Close ${entry.look.label}`}
                      onClick={entry.close}
                    />
                  }
                  onPress={() => {
                    onListed(false);
                    entry.look.onSelect();
                  }}
                />
              </RowHintOptions>
            ))}
          </List>
        )}
        {more.length === 0 ? null : (
          <div className="side-panel-no-tabs-line">
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              Open more
            </Text>
          </div>
        )}
        {more.length === 0 ? null : (
          <MenuRowList
            label="Open a tab"
            rows={more.map((entry) => entry.row)}
            onPick={(id) => {
              onListed(false);
              more.find((entry) => entry.row.id === id)?.onPick();
            }}
          />
        )}
      </div>
    </ScrollArea>
  );
}

/**
 * The panel shown on purpose with every tab closed: every row its "+" menu
 * offers, under the menu's own headings, each opening what it names as its
 * row there does. Note that a plan's page reaches it by ⌘T alone, since its
 * Show panel opens a tab first (`useTasksTab`), while an agent's page, which
 * has no summary to list its tabs, reaches it by its toggle too.
 */
function NoTabs({ entries }: { entries: readonly AddEntry[] }): React.JSX.Element {
  return (
    <ScrollArea size={SCROLL_SIZE.CONTENT}>
      <div className="side-panel-no-tabs">
        <div className="side-panel-no-tabs-line">
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            No tabs open
          </Text>
        </div>
        <MenuRowList
          label="Open a tab"
          rows={entries.map((entry) => entry.row)}
          onPick={(id) => entries.find((entry) => entry.row.id === id)?.onPick()}
        />
      </div>
    </ScrollArea>
  );
}

/** An open page tab the task draws, with the page as the plan lists it. */
interface DrawnPage {
  tab: PageStripTab;
  line: PageLine;
}

/** An open subagent tab the task draws: its tab, the delegation that started it, what the strip calls it, and where its glyph says it stands. */
interface DrawnSubagent {
  tab: SubagentStripTab;
  delegation: NonNullable<SubagentStripTab["delegation"]>;
  /** Its title, or its task's first line until it has one. */
  label: string;
  untitled: boolean;
  state: GlyphState;
  /** What its hint says of where it stands, as its own tab's transcript says it. */
  stateWords: string | undefined;
}

/**
 * A subagent as its tab draws it, `status` saying where the delegated
 * worker stands; nothing for a tab no delegation started, which a task's
 * own Luke's worker was.
 */
function drawnSubagent(
  tab: SubagentStripTab,
  status: CodingAgentStatus,
  held: HeldTranscripts,
): DrawnSubagent | undefined {
  const { delegation, subagent } = tab;
  if (delegation === undefined) return undefined;
  // Its own page says its title, and its agent's pages say every worker's.
  const title =
    held.workers.get(subagent)?.title ??
    held.agents.get(delegation.agent)?.subagentTitles.get(subagent);
  return {
    tab,
    delegation,
    label: title ?? cardTitle(delegation.task),
    untitled: title === undefined,
    state: agentGlyphState(status),
    stateWords: agentStateWords(status),
  };
}

/** The open subagent tabs the task draws now (`drawsSubagent`), in the strip's order: each delegated worker whose agent's tab is open. */
function drawnSubagents(
  tabs: readonly SubagentStripTab[],
  standings: WorkerStandings,
  held: HeldTranscripts,
  drawn: Pick<DrawnTabs, "agents" | "subagents">,
): readonly DrawnSubagent[] {
  return tabs.flatMap((tab): DrawnSubagent[] => {
    if (!drawsSubagent(tab, drawn)) return [];
    const status = standings.get(tab.subagent) ?? CODING_AGENT_STATUS.RUNNING;
    const subagent = drawnSubagent(tab, status, held);
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
 * alike: from what its own tab last held, its pair as the call that started
 * it says it. A worker runs one
 * turn, so the run its tab last read is its run for good.
 */
function subagentCardReading(
  drawn: DrawnSubagent,
  agents: CodingAgentsControl,
  held: HeldTranscripts,
  chosen: boolean,
): () => CardReading {
  const { tab, delegation, label, state, stateWords } = drawn;
  return () => {
    const running = state === GLYPH_STATE.WORKING;
    const own = held.workers.get(tab.subagent);
    const messages = heldLatest(own, { writing: running, runStartedAt: own?.runStartedAt }, chosen);
    const choices = delegationChoices(delegation, tab.subagent, agents, held);
    return {
      corner: cardCorner({
        writing: running,
        startedAt: own?.runStartedAt,
        movedAt: lastFinished(messages),
        state: stateWords,
      }),
      choice: choices.delegated,
      // Note that the tile falls back on its agent's model, as the worker's tab does, until the call that started it is held.
      tile: subagentActor((choices.delegated ?? choices.own)?.model, state, label),
      transcript:
        messages &&
        agentTranscript({
          title: label,
          messages,
          brief: undefined,
          task: delegation.task,
          chatOn: agents.chatOn,
        }),
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

/** What a transcript's rows hang, by where they stand: a call's, and an agent's transcript's, whose workers are its delegations. */
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
 * run. A call's own rows name no worker, and hang none for one. An agent's
 * transcript also names the task whose plan it was handed, by `task`, and
 * every transcript names an agent a call is about by its tab's tile and
 * name, by `agent`.
 */
export function taskCards(input: {
  agents: CodingAgentsControl;
  held: HeldTranscripts;
  chosen: (tab: StripTab) => boolean;
  /** Every code Luke showed on the task, whose note on a `show_code` call's lines its row's card says. */
  shownCode: readonly TaskCodeShowing[];
  /** The plan's task, which an agent's plan card names as its sender. */
  task?: BriefTask | undefined;
}): TaskCards {
  const { agents, held, chosen, shownCode, task } = input;
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
  // Note that each agent's cards are the same value for as long as these are, so a transcript handed them draws nothing again for them.
  const byAgent = new Map<string, TranscriptCards>();
  return {
    call: { target, agent, worker: () => undefined },
    agent: (agentId) => {
      const known = byAgent.get(agentId);
      if (known !== undefined) return known;
      const cards: TranscriptCards = {
        target,
        agent,
        task,
        worker: ({ callId, task: job, status }) =>
          card(
            drawnSubagent(
              { subagent: callId, delegation: { agent: agentId, task: job } },
              status,
              held,
            ),
          ),
      };
      byAgent.set(agentId, cards);
      return cards;
    },
  };
}

/** An agent on the task as its tab names it, which heads the code it showed and its notes on it; none for an agent the task does not list. */
function taskAgentLabel(agents: CodingAgentsControl, agentId: string): string | undefined {
  const agent = agents.agents?.find((each) => each.id === agentId);
  return agent === undefined ? undefined : agentTabLabel(agent, agents.models);
}

/** What the chosen tab shows. */
function TabContent({
  tab,
  taskId,
  codeFilesRead,
  pagePlace,
  repository,
  board,
  shownCode,
  codeFailed,
  files,
  pages,
  agents,
  standings,
  shown,
  findActive,
  onOpenTarget,
  onWorkerStatus,
  onWorkerHeld,
  onOpenFile,
  fileTree,
  onBrowseFile,
  onFileHistory,
  onFoldNote,
  onCloseTab,
  pullRequestViews,
  onPullRequestView,
  shellsList,
  cloudBrowsers,
  cloudDrafts,
  plan,
  inbox,
  chat,
  transcript,
  onTabActions,
  onRunOnMac,
}: {
  tab: SidePanelTab;
  taskId: string;
  /** What the panel's pages stand on: the task, or the agent on no task whose page holds the panel. */
  pagePlace: PagePlace;
  /** The task's repository, which a file's tab is read from as it stands now. */
  repository: string | null;
  board: Board | undefined;
  shownCode: readonly TaskCodeShowing[] | undefined;
  /** Whether a File tab reads the files code was shown in: a task's panel's does, and an agent's page's, with no task to read them by, does not. */
  codeFilesRead: boolean;
  /** The task's code read that did not land, where the last did not. */
  codeFailed: CodeFailed | undefined;
  /** The open file tabs, which a file's tab reads its lit lines from. */
  files: readonly OpenFile[];
  /** The plan's pages, which a page's tab draws its newest version of. */
  pages: readonly PageLine[];
  agents: CodingAgentsControl;
  standings: WorkerStandings;
  /** Whether the panel is on screen, so a subagent's tab knows to follow its transcript. */
  shown: boolean;
  /** Whether the panel holds the window's keys, so a page's tab finds in its source. */
  findActive: boolean;
  /** Opens what a row of a tab is about in the tab that draws it, as the Comments tab's opens the plan or an agent's tab. */
  onOpenTarget: (target: ToolTarget) => void;
  /** A delegated worker's page said where it stands now. */
  onWorkerStatus: (callId: string, status: CodingAgentStatus) => void;
  /** A delegated worker's tab drew its transcript anew, by the call that started it. */
  onWorkerHeld: TabViews["onWorkerHeld"];
  /** Opens a file of the task's repository in a tab of its own, the reference's lines lit. */
  onOpenFile: (ref: CodeRef, commit?: string) => void;
  /** Whether a File or Changes tab's tree is open, which holds for every one of them alike, and its toggle. */
  fileTree: TreeShown;
  /** Shows a file browsed to from a File tab's tree or breadcrumbs (`SidePanelControl.onBrowseFile`). */
  onBrowseFile: (from: string, path: string, newTab: boolean) => void;
  /** Walks a File tab's history a step (`SidePanelControl.onFileHistory`). */
  onFileHistory: (from: string, step: FileHistoryStep) => void;
  /** Folds or opens a note on a File tab (`SidePanelControl.onFoldNote`). */
  onFoldNote: (path: string, callId: string, folded: boolean) => void;
  /** Closes a tab whose subject is gone, as an archived agent's Terminal tab closes. */
  onCloseTab: (tab: SidePanelTab) => void;
  /** What each Pull request tab shows, by agent and number (`SidePanelControl.pullRequestViews`). */
  pullRequestViews: SidePanelControl["pullRequestViews"];
  /** Chooses what an agent's Pull request tab shows. */
  onPullRequestView: SidePanelControl["onPullRequestView"];
  /** Whether a Terminal tab's shells list is open, which holds for every one of them alike, and its toggle. */
  shellsList: { readonly open: boolean; readonly onToggle: () => void };
  /** The task's agents' cloud Browser tabs, which a cloud Browser tab reads its tab from. */
  cloudBrowsers: readonly DrawnCloudBrowser[];
  /** Lands on the tab a draft opened, the draft let go of; or discards a draft. */
  cloudDrafts: {
    readonly onOpened: (draftId: string, tab: AgentBrowserTab) => void;
    readonly onDiscard: (draftId: string) => void;
  };
  /** The plan's document, drawn by the task's page that holds what it reads (`desktop-tasks.tsx`). */
  plan: React.ReactNode;
  /** The task's Inbox, drawn by the task's page on the same terms. */
  inbox: React.ReactNode;
  /** The task's Chat, its channel, drawn by the task's page on the same terms. */
  chat: React.ReactNode;
  /** An agent's transcript and composer, drawn by the panel's holder: the Inbox's, beside an item. */
  transcript: ((agentId: string) => React.ReactNode) | undefined;
  /** Hears what a tab's body offers its toolbar's ⋯, under the tab it is drawn for (`useHandedTabActions`). */
  onTabActions: (tab: SidePanelTab, actions: MenuAction[] | undefined) => void;
  /** Runs an agent's branch in a terminal of this Mac in this panel, which its Pull request tab's Run offers; none where no repository is known or the platform has no Mac terminal. */
  onRunOnMac: ((agentId: string) => void) | undefined;
}): React.JSX.Element {
  const { act } = useAct();
  const directory = useMemberDirectory();
  if (isTranscriptTab(tab)) return <>{transcript?.(tab.transcript)}</>;
  if (isMacTerminalTab(tab)) {
    return <MacTerminalTab key={tab.macTerminal} tab={tab} />;
  }
  if (isCloudBrowserTab(tab)) {
    const drawn = cloudBrowsers.find((each) => each.id === tab.cloudBrowser);
    // The tab stands for one the service no longer lists only until the panel moves on, a render away.
    if (drawn === undefined) return <SpinnerRegion delay label="Loading page" />;
    if ("draft" in drawn) {
      return (
        <CloudBrowserDraftPane
          key={drawn.id}
          taskId={taskId}
          draft={drawn.draft}
          owner={drawn.owner}
          onOpened={(opened) => cloudDrafts.onOpened(drawn.id, opened)}
          onDiscard={() => cloudDrafts.onDiscard(drawn.id)}
        />
      );
    }
    return (
      <CloudBrowserPane
        key={tab.cloudBrowser}
        taskId={taskId}
        tab={drawn.tab}
        owner={drawn.owner}
        shown={shown}
        memberName={(userId) => directory.members?.find((member) => member.userId === userId)?.name}
      />
    );
  }
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
      <SpinnerRegion delay label="Loading page" />
    ) : (
      <PagePane
        key={page.id}
        place={pagePlace}
        page={page}
        readSource={(version) =>
          act(ACT_KIND.TASKS_PAGE_SOURCE, { ...pagePlace, pageId: page.id, version })
        }
        findActive={findActive}
      />
    );
  }
  if (isChangesTab(tab)) {
    // Note that a link in a pull request's own tab, to its earlier entries or a reply, leaves for GitHub, because the tab already is that pull request.
    return (
      <PullRequestsOnGitHub key={tabKey(tab)}>
        {/* The tab is a chunk of its own, read the first time one is drawn or its card hangs (`pages-on-demand.ts`). */}
        <Suspense fallback={<SpinnerRegion delay label="Loading pull request" />}>
          <PULL_REQUEST_TAB.Route
            agentId={tab.changes}
            number={tab.number}
            control={agents}
            shown={shown}
            repository={repository}
            tree={fileTree}
            view={ofPullRequestTab(pullRequestViews, tab) ?? PULL_REQUEST_VIEW.CONVERSATION}
            onView={(view) => onPullRequestView(tab, view)}
            onActions={(actions) => onTabActions(tab, actions)}
            // Note that Run reads the agent's own branch, so a tab naming another pull request by its number offers none.
            onRun={
              onRunOnMac === undefined || tab.number !== undefined
                ? undefined
                : () => onRunOnMac(tab.changes)
            }
          />
        </Suspense>
      </PullRequestsOnGitHub>
    );
  }
  if (isFileTab(tab)) {
    const file = files.find((each) => each.path === tab.file);
    // The tab stands for a file no longer open only until the panel moves
    // on, a render away.
    // Note that the task given another repository draws the file afresh,
    // because the lines held were read from the one before.
    return file === undefined ? (
      <SpinnerRegion delay label="Loading file" />
    ) : (
      <Fragment key={repository ?? undefined}>
        <FileView
          taskId={taskId}
          repository={repository}
          file={file}
          snippet={snippetOf(shownCode, file)}
          shownCode={shownCode}
          readFile={(window) => act(ACT_KIND.TASKS_FILE, { taskId, ...window })}
          readFolder={(path) => act(ACT_KIND.TASKS_TREE, { planId: taskId, path })}
          readWhole={() => act(ACT_KIND.TASKS_TREE, { planId: taskId, path: "", recursive: true })}
          openGitHub={(url) => appPlatform().openGitHub(url)}
          treeOpen={fileTree.open}
          onToggleTree={fileTree.onToggle}
          treeWidth={fileTree.width}
          onBrowse={(path, newTab) => onBrowseFile(file.path, path, newTab)}
          history={{
            canGoBack: (file.back?.length ?? 0) > 0,
            canGoForward: (file.forward?.length ?? 0) > 0,
            onStep: (step) => onFileHistory(file.path, step),
          }}
          onFoldNote={(callId, folded) => onFoldNote(file.path, callId, folded)}
          agentLabel={(agentId) => taskAgentLabel(agents, agentId)}
        />
      </Fragment>
    );
  }
  if (isSubagentTab(tab)) {
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
    // A tab no delegation started, a task's own Luke's worker's, stands only until the panel moves back to the board, a render away.
    return <SpinnerRegion delay label="Loading subagent" />;
  }
  switch (tab) {
    case SIDE_PANEL_TAB.PLAN:
      // The plan is drawn by the panel itself, mounted across tab switches (`SidePanel`).
      return <>{plan}</>;
    case SIDE_PANEL_TAB.INBOX:
      return <>{inbox}</>;
    case SIDE_PANEL_TAB.CHAT:
      return <>{chat}</>;
    case SIDE_PANEL_TAB.BOARD:
      // An archived task's board only shows, as its agents only read.
      return (
        <TaskBoard taskId={taskId} board={board} viewOnly={agents.onUnarchive !== undefined} />
      );
    case SIDE_PANEL_TAB.CODE:
      // Note that no code read yet is a wait, and only code read as none says so.
      if (shownCode === undefined && codeFailed !== undefined) {
        return (
          <ErrorState onRetry={codeFailed.onRetry} placement={ERROR_STATE_PLACEMENT.CENTRED}>
            {UNREAD_CODE_LINE}
          </ErrorState>
        );
      }
      if (shownCode === undefined) return <SpinnerRegion delay label="Loading code" />;
      return shownCode.length === 0 ? (
        <EmptyState icon={tabLook({ kind: TAB_KIND.PANEL, tab: SIDE_PANEL_TAB.CODE }).icon}>
          {NO_CODE_LINE}
        </EmptyState>
      ) : (
        <CodePane
          shown={shownCode}
          calls={NO_CODE_CALLS}
          taskId={codeFilesRead ? taskId : undefined}
          agentLabel={(agentId) => taskAgentLabel(agents, agentId)}
          onOpenFile={codeFilesRead ? onOpenFile : undefined}
        />
      );
    case SIDE_PANEL_TAB.COMMENTS:
      return (
        <PlanCommentsTab
          doors={{
            agents: {
              control: agents,
              onOpen: (agent) => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent }),
            },
            me: agents.me,
          }}
          onShowDocument={() => onOpenTarget({ kind: TOOL_TARGET.PLAN })}
        />
      );
  }
}

/**
 * Shows and hides the panel. It stands at the window's top right, beside
 * neither top row it serves, the way the sidebar's toggle stands beside the
 * traffic lights: one button in one place whether the panel is hidden,
 * beside the document, full screen, or still sliding, so a press lands on
 * it however fast the presses come. Where the room holds the panel only full
 * screen, a narrow one's, it reads Close panel while the panel is open, since the
 * panel covers everything else. It stands on every task's page, so it
 * is also what offers the panel's shortcut. ⌘T is the task's page's, which hands it to the column
 * holding the window's focus (desktop-tasks.tsx). While the task is not
 * drawn there is no panel to show, so it is disabled and offers none.
 */
export function SidePanelToggle({
  panel,
  disabled,
}: {
  panel: SidePanelControl;
  disabled: boolean;
}): React.JSX.Element {
  // A panel standing only full screen covers the whole window, so its toggle is the way out of it.
  const closes = panel.open && panel.fullScreenOnly;
  const label = closes ? "Close panel" : panel.open ? "Hide panel" : "Show panel";
  const offer = (run: () => void) => (disabled ? undefined : run);
  useAppCommand(APP_COMMAND.TOGGLE_SIDE_PANEL, offer(panel.onToggle));
  return (
    <Tooltip label={label} command={APP_COMMAND.TOGGLE_SIDE_PANEL}>
      <IconButton
        icon={closes ? <CloseIcon /> : <SidePanelIcon />}
        label={label}
        aria-expanded={panel.open}
        disabled={disabled}
        onClick={panel.onToggle}
      />
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
      <IconButton
        icon={fullScreen ? <CollapseIcon /> : <ExpandIcon />}
        label={label}
        pressed={fullScreen}
        onClick={onToggle}
      />
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
  edge: ResizeEdgeHandle;
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
 * The panel the task's page draws for the one asked for, and the edge it is
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
  const edge = useResizeEdge({
    side: RESIZE_EDGE_SIDE.LEFT,
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
  taskId,
  repository,
  board,
  shownCode,
  codeFailed,
  pages,
  agents,
  openAgents,
  shownAgent,
  views,
  shown,
  focused,
  onOpenTarget,
  banner,
  plan,
  task,
  inbox,
  chat,
  transcript,
  activity,
}: SidePanelDrawing & {
  panel: SidePanelControl;
  /** The tabs holding something that arrived while another was shown, each in semibold until it is shown. */
  unread: readonly StripTab[];
  holder: SidePanelHolder;
  /** The plan the panel stands beside, or the agent where it stands beside the agent's own page. */
  taskId: string;
  /** The task's repository, `owner/name`, or none before one is chosen. */
  repository: string | null;
  board: Board | undefined;
  /** Every code Luke showed on the task, oldest first. */
  shownCode: readonly TaskCodeShowing[] | undefined;
  /** The task's code read that did not land, where the last did not; none where the panel reads no task's code. */
  codeFailed: CodeFailed | undefined;
  /** The pages agents wrote for the plan, each by its newest version; none where it has none. */
  pages: readonly PageLine[] | undefined;
  agents: CodingAgentsControl;
  /** The task's agents whose tabs stand open in the task's column, whose workers' tabs stand here; nothing while unread. */
  openAgents: readonly string[] | undefined;
  /** The agent whose tab follows its run in the plan's column, whose card previews its latest step (`followedAgent`); none while another tab is shown or the column is out of sight. */
  shownAgent: string | undefined;
  /** What the agents' and the workers' tabs last drew and said, which the workers' tabs and cards read. */
  views: TabViews;
  /** Whether the task's page is on screen, which a subagent's tab follows its transcript under. */
  shown: boolean;
  /** Whether the panel holds the window's focus, which its ⌘W, ⌘T, and ⌘F answer to. */
  focused: boolean;
  /** Opens what a row of a tab is about in the tab that draws it, as an agent's card opens its tab in the task's column. */
  onOpenTarget: (target: ToolTarget) => void;
  /** The task's banner, where one stands (`task-banner.tsx`), drawn under the bar while the panel fills the window and covers the column that draws it otherwise. */
  banner?: React.ReactNode;
  /** The plan's document, which its Plan tab shows; none beside anything but a task's page. */
  plan?: React.ReactNode;
  /** The task whose plan that is, whose name and status its Plan tab wears; none beside anything but a task's page. */
  task?: PlanStanding | undefined;
  /** The task's Inbox, which its Inbox tab shows, how many of its items wait on the developer, which the tab counts, and whether a card holds a draft, which the tab marks; none beside anything but a task's page. */
  inbox?:
    | { readonly body: React.ReactNode; readonly waiting: number; readonly drafted: boolean }
    | undefined;
  /** The task's Chat, its channel, which its Chat tab shows; none where Chat is off or beside anything but a task's page. */
  chat?: React.ReactNode;
  /** An agent's transcript and composer, which its transcript tab shows beside the Inbox; none elsewhere, where the agent's column shows them. */
  transcript?: ((agentId: string) => React.ReactNode) | undefined;
  /**
   * A phone's Activity (`task-pane-switcher.tsx`): whether the panel lists
   * its tabs rather than showing one, and the way to ask for the list or
   * leave it. Where it is handed and the panel stands only full screen, the
   * panel's bar is not drawn, the list standing for its strip and its "+",
   * and the phone's header for the rest: the way back to the list, the tab's
   * name, and its ⋯, which the tab shown is handed up for; none beside
   * anything but a task's page.
   */
  activity?:
    | {
        readonly listed: boolean;
        readonly onListed: (listed: boolean) => void;
        /** Hands the header the tab shown past the plan, or none (`ShownTab`). */
        readonly onShown: (shown: ShownTab | undefined) => void;
      }
    | undefined;
}): React.JSX.Element {
  // The one slot the bar keeps for the chosen tab's ⋯, drawn there from the tab (`strip-tabs.tsx`).
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  // Where a phone's Activity lists the tabs, drawn there from the strip, which holds how each tab looks.
  const [activitySlot, setActivitySlot] = useState<HTMLElement | null>(null);
  const switched = activity !== undefined && panel.fullScreenOnly;
  const listing = switched && activity.listed;
  // What the chosen tab's body offers that ⋯ beyond what the strip does, let go only by the tab that handed it.
  const [handed, setHanded] = useState<HandedTabActions | undefined>(undefined);
  const handTabActions = useCallback((tab: SidePanelTab, actions: MenuAction[] | undefined) => {
    setHanded((was) =>
      actions !== undefined
        ? { tab, actions }
        : was !== undefined && sameTab(was.tab, tab)
          ? undefined
          : was,
    );
  }, []);
  const { tab } = panel;
  // A Pull request tab naming another pull request by its number is named by
  // that pull request, read once for each such tab the strip draws, since
  // only the tab shown reads it on its own.
  const { readNumberedPullRequest, numberedPullRequests } = agents;
  // Note that a read that named none, or failed, is let go, so the tab opened again, or another
  // change of the open tabs, asks again, while the tab standing open asks nothing more.
  const numberedRead = useRef(new Map<string, Set<number>>());
  useEffect(() => {
    for (const each of panel.changes) {
      const { changes: agentId, number } = each;
      if (number === undefined || ofPullRequestTab(numberedPullRequests, each) !== undefined) {
        continue;
      }
      const asked = numberedRead.current.get(agentId) ?? new Set<number>();
      if (asked.has(number)) continue;
      numberedRead.current.set(agentId, asked.add(number));
      const forget = () => numberedRead.current.get(agentId)?.delete(number);
      readNumberedPullRequest(agentId, number).then(
        (found) => (found ? undefined : forget()),
        forget,
      );
    }
  }, [panel.changes, numberedPullRequests, readNumberedPullRequest]);
  // Whether a File or Changes tab's tree is open, for every one of them
  // alike and for the window's life, as an editor's explorer stands across
  // its tabs.
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
  // How wide the tree stands, kept across launches as the Inbox's list's width is.
  const fileTreeWidth = useFileTreeWidth();
  const { width: treeWidth, onResize: onTreeResize } = fileTreeWidth;
  const fileTree = useMemo(
    () => ({
      open: fileTreeOpen,
      onToggle: () => setFileTreeOpen((was) => !was),
      width: { width: treeWidth, onResize: onTreeResize },
    }),
    [fileTreeOpen, treeWidth, onTreeResize],
  );
  // Whether a Terminal tab's shells list is open, for every one of them alike
  // and for the window's life, as the File tabs' tree is.
  const [shellsOpen, setShellsOpen] = useState(true);
  const shellsList = useMemo(
    () => ({ open: shellsOpen, onToggle: () => setShellsOpen((was) => !was) }),
    [shellsOpen],
  );
  // The subagents with a tab open, in the strip's order: a delegated worker's tab stands while its agent's does.
  const { held: drawnTranscripts, standings } = views;
  const subagents = drawnSubagents(panel.subagents, standings, drawnTranscripts, {
    agents: openAgents,
    subagents: NO_SUBAGENTS,
  });
  // The file tabs of files shown on the task or browsed to on it, in the strip's order.
  const offered = shownFiles(shownCode ?? []);
  const files = panel.files.filter(
    (file) => file.browsedOn === taskId || offered.some((ref) => ref.path === file.path),
  );
  // An agent's Changes tab stands while the agent is the task's, archived or not, as its pull request does.
  const changes = panel.changes.filter((each) =>
    drawsChanges(each, { taskAgents: agents.heldIds }),
  );
  // An agent's Terminal tab stands while the agent is the task's, as its Changes tab does, and never beside the Inbox or where the platform runs no terminals.
  const terminalsOffered = useCapability(HOST_CAPABILITY.TERMINALS);
  const terminalsHere = terminalsOffered && holder !== SIDE_PANEL_HOLDER.INBOX;
  const terminals = !terminalsHere
    ? NO_TERMINALS
    : panel.terminals.filter((each) => drawsTerminal(each, { taskAgents: agents.agentIds }));
  const browserOn = useExperiment(EXPERIMENT.BROWSER);
  // The task's agents' cloud Browser tabs stand while the experiment is on,
  // on every platform, since the page draws them from the service and needs
  // nothing of main's; on a task's own panel alone, never an agent's page's or
  // the Inbox's, which borrows its task's panel.
  const cloudListing = browserOn && holder === SIDE_PANEL_HOLDER.TASK;
  const cloudListed = useCloudBrowserTabs(taskId, cloudListing);
  // A draft of a tab in an agent's browser stands after the tabs the service lists, until it opens one.
  const cloudDraftsHeld = useCloudBrowserDrafts(taskId, cloudListing);
  const cloudBrowsers = useMemo(() => {
    const ownerOf = (agentId: string | null): CloudBrowserOwner => {
      if (agentId === null) {
        return { name: LUKE_NAME, icon: <ActorMark actor={LUKE_ACTOR} size={ACTOR_SIZE.INLINE} /> };
      }
      const subject = agentSubject(agents, agentId, drawnTranscripts, false);
      return { name: subject.name, icon: <AgentGlyph agent={subject.agent} /> };
    };
    const drawn: DrawnCloudBrowser[] = [
      ...(cloudListed ?? []).map((tab) => ({ id: tab.id, tab, owner: ownerOf(tab.agentId) })),
      ...cloudDraftsHeld.map((draft) => ({ id: draft.id, draft, owner: ownerOf(draft.agentId) })),
    ];
    return drawn.length === 0 ? NO_CLOUD_BROWSERS : drawn;
  }, [cloudListed, cloudDraftsHeld, agents, drawnTranscripts]);
  const cloudBrowserLabel = (id: string) => {
    const drawn = cloudBrowsers.find((each) => each.id === id);
    return drawn === undefined ? TAB_WORDS.BROWSER : cloudBrowserTitleOf(drawn);
  };
  // The "+" offers a new tab in each of the task's coding agents' cloud browsers, the one viewed first.
  const viewedAgent = shownAgent ?? (panel.tab === undefined ? undefined : agentOfTab(panel.tab));
  const cloudOffers: readonly CloudBrowserOffer[] = !cloudListing
    ? []
    : [...(agents.agents ?? [])]
        .sort((a, b) => Number(b.id === viewedAgent) - Number(a.id === viewedAgent))
        .map((agent) => {
          const subject = agentSubject(agents, agent.id, drawnTranscripts, false);
          return {
            agentId: agent.id,
            owner: { name: subject.name, icon: <AgentGlyph agent={subject.agent} /> },
          };
        });
  const cloudDrafts = {
    onOpened: (draftId: string, opened: AgentBrowserTab) => {
      discardCloudDraft(taskId, draftId);
      panel.onChoose({ cloudBrowser: opened.id });
    },
    onDiscard: (draftId: string) => discardCloudDraft(taskId, draftId),
  };
  // A page's tab stands while the plan lists the page.
  const taskPages = pages ?? NO_PAGES;
  const pageTabs = panel.pages.flatMap((tab) => {
    const line = taskPages.find((each) => each.id === tab.page);
    return line === undefined ? [] : [{ tab, line }];
  });
  const label =
    tab === undefined
      ? undefined
      : isTranscriptTab(tab)
        ? (taskAgentLabel(agents, tab.transcript) ?? TAB_WORDS.CODING_AGENT)
        : isSubagentTab(tab)
          ? subagents.find((each) => sameTab(each.tab, tab))?.label
          : isFileTab(tab)
            ? tab.file
            : isChangesTab(tab)
              ? changesLook(tab, agents).label
              : isPageTab(tab)
                ? pageTabs.find((each) => sameTab(each.tab, tab))?.line.title
                : isTerminalTab(tab)
                  ? TAB_WORDS.TERMINAL
                  : isMacTerminalTab(tab)
                    ? TAB_WORDS.MAC_TERMINAL
                    : isCloudBrowserTab(tab)
                      ? cloudBrowserLabel(tab.cloudBrowser)
                      : tabLook({ kind: TAB_KIND.PANEL, tab, plan: task }).label;
  const keys = shown && leaving === PANEL_LEAVING.NONE;
  // The panel's "+" asks for a new shell where the panel already holds the keys.
  const openTerminal = useOpenTerminal(panel, noFocusMove);
  // A Pull request tab's Run opens the agent's branch on this Mac in this panel, which already holds the keys.
  const macTerminalDoors = useAgentTerminalDoors(panel, repository, noFocusMove);
  // The Inbox is offered only on a task holding an agent, an archived one among them, since only an agent posts.
  const inboxOffered =
    (agents.heldIds?.length ?? 0) > 0 || panel.tabs.includes(SIDE_PANEL_TAB.INBOX);
  const offers = panelEntries({
    panel,
    // The Chat is offered only where the task's page draws one, which it does while Chat is on.
    // An agent's page offers Code only while a call into its agent showed some.
    kinds: HOLDER_KINDS[holder].filter(
      (kind) =>
        (kind !== SIDE_PANEL_TAB.INBOX || inboxOffered) &&
        (kind !== SIDE_PANEL_TAB.CHAT || chat !== undefined) &&
        (kind !== SIDE_PANEL_TAB.CODE ||
          holder === SIDE_PANEL_HOLDER.TASK ||
          (shownCode?.length ?? 0) > 0),
    ),
    files: offered,
    changes: changesOffers(agents, changes),
    pages: taskPages,
    // Note that a panel that draws no Terminal, the Inbox's among them, offers none.
    ...(!terminalsHere
      ? undefined
      : {
          terminals: {
            offers: terminalOffers(agents, panel),
            onNew: (agentId: string) => openTerminal(agentId, TERMINAL_ASK.NEW),
          },
        }),
    browsers: {
      agents: cloudOffers,
      onAgent: (agentId: string) =>
        panel.onChoose({ cloudBrowser: startCloudDraft(taskId, agentId).id }),
    },
    plan: task,
  });
  // Something on offer past the fixed kinds, which an empty panel offers in place as a closed kind is.
  const offersMore = offers.some((entry) => entry.row.section !== undefined);

  return (
    <PanelFrame
      panel={panel}
      leaving={leaving}
      onLeft={onLeft}
      edge={edge}
      label="Panel"
      banner={banner}
      switched={switched}
      tabs={
        <PanelTabs
          panel={panel}
          holder={holder}
          taskId={taskId}
          keys={keys && focused}
          unread={unread}
          agents={agents}
          subagents={subagents}
          files={files}
          changes={changes}
          pages={pageTabs}
          terminals={terminals}
          cloudBrowsers={cloudBrowsers}
          shown={shownCode ?? []}
          repository={repository}
          offers={offers}
          held={drawnTranscripts}
          actionsSlot={actionsSlot}
          handed={handed}
          onOpenAgent={(agent) => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent })}
          shownAgent={shownAgent}
          inboxWaiting={inbox?.waiting ?? 0}
          inboxDrafted={inbox?.drafted ?? false}
          task={task}
          activity={
            switched
              ? {
                  slot: listing ? activitySlot : null,
                  onListed: activity.onListed,
                  onShown: activity.onShown,
                }
              : undefined
          }
        />
      }
      actions={<span ref={setActionsSlot} className="toolbar-tab-actions" />}
    >
      {/* A panel with nothing to offer but kinds it has never closed stands
            empty, the "+" above offering any; otherwise every tab closed, it
            offers in place all that the "+" offers. */}
      {/* The plan stays mounted while another tab is shown, hidden, so an
          edit not yet saved is neither sent on a tab switch nor lost with it,
          as it stayed in the column before it stood here. */}
      {plan === undefined ? null : (
        <FindScope
          className="side-panel-content"
          role="tabpanel"
          aria-label={tabLook({ kind: TAB_KIND.PANEL, tab: SIDE_PANEL_TAB.PLAN, plan: task }).label}
          hidden={listing || tab !== SIDE_PANEL_TAB.PLAN}
          active={keys && focused && !listing && tab === SIDE_PANEL_TAB.PLAN}
          subject={{ task: taskId, tab: SIDE_PANEL_TAB.PLAN }}
        >
          {plan}
        </FindScope>
      )}
      {listing ? (
        <Fill ref={setActivitySlot} className="side-panel-content" />
      ) : tab === SIDE_PANEL_TAB.PLAN && plan !== undefined ? null : tab === undefined ? (
        <Fill className="side-panel-content">
          {panel.closedTabs.length === 0 && !offersMore ? null : <NoTabs entries={offers} />}
        </Fill>
      ) : (
        // The Board is drawn on a canvas, which keeps a find of its own, and
        // a page's words stand in a sandboxed frame no find of the window
        // reaches, so a page's tab finds itself, through its frame or in its
        // source; a cloud Browser tab's page is drawn on a canvas, which no
        // find of the window reaches either.
        <FindScope
          className="side-panel-content"
          role="tabpanel"
          aria-label={label}
          active={
            keys &&
            focused &&
            tab !== SIDE_PANEL_TAB.BOARD &&
            !isPageTab(tab) &&
            !isCloudBrowserTab(tab)
          }
          subject={{ task: taskId, tab }}
        >
          {/* Typing into a preview, as a review's comment or a terminal's line, keeps it as a tab of its own. */}
          <div
            className="side-panel-keeps"
            onInputCapture={() => {
              if (panel.preview !== undefined && sameTab(panel.preview, tab)) panel.onKeep(tab);
            }}
          >
            <TabContent
              tab={tab}
              taskId={taskId}
              codeFilesRead={holder === SIDE_PANEL_HOLDER.TASK}
              pagePlace={pagePlaceOf(holder, taskId)}
              repository={repository}
              board={board}
              shownCode={shownCode}
              codeFailed={codeFailed}
              files={files}
              pages={taskPages}
              agents={agents}
              standings={standings}
              shown={keys}
              findActive={keys && focused}
              onOpenTarget={onOpenTarget}
              onWorkerStatus={views.onWorkerStatus}
              onWorkerHeld={views.onWorkerHeld}
              onOpenFile={panel.onPreviewFile}
              fileTree={fileTree}
              onBrowseFile={panel.onBrowseFile}
              onFileHistory={panel.onFileHistory}
              onFoldNote={panel.onFoldNote}
              onCloseTab={panel.onClose}
              pullRequestViews={panel.pullRequestViews}
              onPullRequestView={panel.onPullRequestView}
              shellsList={shellsList}
              cloudBrowsers={cloudBrowsers}
              cloudDrafts={cloudDrafts}
              plan={plan}
              inbox={inbox?.body}
              chat={chat}
              transcript={transcript}
              onTabActions={handTabActions}
              onRunOnMac={macTerminalDoors.onOpenOnMac}
            />
          </div>
        </FindScope>
      )}
    </PanelFrame>
  );
}

/**
 * The frame every side panel stands in, the task's, an agent's page's, and
 * the Inbox's: the panel's pane at the window's
 * right, its width the window's, over its top row of `tabs`, the chosen
 * tab's `actions`, and its full-screen button, with what it shows under the
 * row and its resize edge at its left. Full screen, it covers what it stood
 * beside rather than taking its place, and an empty room holds the panel's
 * own width beside it, so what is beneath keeps its layout and is there to
 * be uncovered as the panel goes back. Where the room holds it only full
 * screen it has neither the button nor the edge, and keeps no room. It plays its own exits (`playExit`);
 * its arrival is played by the pane motion around it (`pane-motion.tsx`).
 */
function PanelFrame({
  panel,
  leaving,
  onLeft,
  edge,
  label,
  tabs,
  actions,
  banner,
  switched = false,
  children,
}: Omit<SidePanelDrawing, "panel"> & {
  panel: Pick<SidePanelControl, "width" | "fullScreen" | "fullScreenOnly" | "onToggleFullScreen">;
  /** What the pane is called to a reader. */
  label: string;
  /** The row's tabs, which take what the row leaves beside the actions and the full-screen button. */
  tabs: React.ReactNode;
  /** The chosen tab's own actions, its ⋯, before the full-screen button. */
  actions: React.ReactNode;
  /** Drawn under the row while the panel fills the window and covers what draws it otherwise. */
  banner?: React.ReactNode;
  /** Whether a phone's header stands for the bar, which is then not drawn (`task-pane-switcher.tsx`). */
  switched?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const aside = useRef<HTMLElement>(null);
  const room = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (leaving === PANEL_LEAVING.NONE || aside.current === null) return;
    return playExit(aside.current, room.current, leaving, onLeft);
  }, [leaving, onLeft]);
  return (
    <>
      {/* Shut, it gives the document its room back at once, to glide into. A
          panel only ever full screen is never uncovered beside it, so it keeps none. */}
      {panel.fullScreen && !panel.fullScreenOnly && leaving !== PANEL_LEAVING.CLOSE ? (
        <div ref={room} className="side-panel-room" style={{ width: panel.width }} />
      ) : null}
      <aside
        ref={aside}
        className="side-panel"
        aria-label={label}
        inert={leaving !== PANEL_LEAVING.NONE}
        data-full-screen={String(panel.fullScreen)}
        data-pane-switch={switched ? "" : undefined}
        data-leaving={leaving === PANEL_LEAVING.NONE ? undefined : leaving}
        data-popover-room=""
        style={panel.fullScreen ? undefined : { width: panel.width }}
      >
        {/* The row is a drag region and each control in it is not; Chromium
            takes regions in document order, so the controls follow it. */}
        <div className="side-panel-bar">
          {tabs}
          {actions}
          {panel.fullScreenOnly ? null : (
            <FullScreenToggle
              fullScreen={panel.fullScreen}
              leaving={leaving !== PANEL_LEAVING.NONE}
              onToggle={panel.onToggleFullScreen}
            />
          )}
        </div>
        {panel.fullScreen ? banner : null}
        {children}
        {/* Last, so the drag region of the row above does not take the
            edge's top from it. Full screen has no edge to drag. */}
        {panel.fullScreen ? null : <ResizeEdge edge={edge} />}
      </aside>
    </>
  );
}
