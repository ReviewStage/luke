import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { AgentBrowserTab } from "@repo/features/agent-browser-tab-wire";
import {
  AGENT_MACHINE,
  AGENT_STATUS,
  type AgentPullRequest,
  type AgentStatus,
  type AgentSummary,
} from "@repo/features/agent-wire";
import { LINK_PLACE } from "@repo/features/link-grammar";
import type { ModelChoice } from "@repo/features/models-wire";
import { type PageLine, type PagePlace, pagePlaceId } from "@repo/features/page-wire";
import type { TaskStatus } from "@repo/features/task-wire";
import { TERMINAL_ASK, TERMINAL_TARGET, terminalTarget } from "@repo/features/terminal-entry";
import { readingWords } from "@repo/features/words";
import { HOST_CAPABILITY } from "@repo/settings";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  Button,
  CloseIcon,
  CollapseIcon,
  ExpandIcon,
  Fill,
  HoverCard,
  HoverCardHead,
  IconButton,
  INLINE_REF_LOOK,
  InlineRef,
  LIST_DENSITY,
  List,
  ListRow,
  type MenuRow,
  MenuRowList,
  POPOVER_ALIGN,
  POPOVER_BOUNDS,
  RESIZE_EDGE_SIDE,
  ResizeEdge,
  type ResizeEdgeHandle,
  RowHint,
  RowHintOptions,
  SCROLL_SIZE,
  ScrollArea,
  SearchableMenu,
  SidePanelIcon,
  SpinnerRegion,
  TabNotice,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Tooltip,
  useResizeEdge,
} from "@repo/ui";
import { ListIcon } from "@repo/ui/icons";
import { ReplayUnmask, ReplayWords } from "@repo/ui/session-replay-marks";
import {
  agentOfTab,
  type ChangesStripTab,
  inTaskOrder,
  isChangesTab,
  isCloudBrowserTab,
  isFileTab,
  isLocalTab,
  isPageTab,
  isSubagentTab,
  isTerminalTab,
  isTranscriptTab,
  type LocalStripTab,
  type PageStripTab,
  type StripTab,
  type SubagentStripTab,
  sameTab,
  TAB_WORDS,
  type TerminalStripTab,
  tabKey,
} from "@repo/ui/tab-strip-model";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { useQueries, useQuery } from "@tanstack/react-query";
import * as Atom from "effect/reactivity/Atom";
import {
  Fragment,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FOCUSED_OFFER, useAppCommand } from "../app-commands.js";
import { appPlatform } from "../app-platform.js";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { FindScope } from "../find-in-tab.js";
import { drawnVisibly, focusSeek } from "../focus-seek.js";
import { panelTabPlace } from "../links-at-hand.js";
import { pagesQuery, pullRequestPublishedQuery } from "../live-reads.js";
import { useMemberDirectory } from "../member-directory.js";
import { ADDRESS, type Address } from "../route.js";
import { centerWithin } from "../scroll-within.js";
import { GLYPH_STATE, type GlyphState, stateEndMark } from "../state-glyph.js";
import { useSteadyDoors } from "../steady-door.js";
import {
  agentGlyphState,
  agentName,
  agentStateWords,
  subagentActor,
} from "../tasks/agent-model.js";
import { AgentActorRef, agentSubject, NOTHING_HELD } from "../tasks/agent-ref.js";
import { AgentSubagentTab, type BriefTask, type TranscriptCards } from "../tasks/agent-tab.js";
import {
  AgentTabCard,
  type CardReading,
  cardCorner,
  delegatedChoice,
  heldLatest,
  lastFinished,
} from "../tasks/agent-tab-card.js";
import { useAgentsElsewhere } from "../tasks/agents-elsewhere.js";
import { useChangesPeopleOf } from "../tasks/changes-people.js";
import { TaskChipCard } from "../tasks/chip-cards.js";
import {
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
import { FileView, type TreeShown } from "../tasks/file-view.js";
import { LocalStanding } from "../tasks/local-shells.js";
import { LocalTab } from "../tasks/local-tab.js";
import { OpenFileTabProvider } from "../tasks/open-file-tab.js";
import { PagePane } from "../tasks/page-pane.js";
import { peopleOf } from "../tasks/pull-request-card.js";
import { ofPullRequestTab, pullRequestOfTab } from "../tasks/pull-request-number.js";
import {
  AgentGlyph,
  agentEndMark,
  type KindLook,
  PlanGlyph,
  type PlanStanding,
  TAB_KIND,
  tabLook,
} from "../tasks/tab-look.js";
import { useOpenTerminal } from "../tasks/terminal-commands.js";
import { TerminalStanding } from "../tasks/terminal-shells.js";
import { TerminalTab } from "../tasks/terminal-tab.js";
import { cardTitle, TOOL_TARGET, type ToolTarget } from "../tasks/tool-call-model.js";
import {
  agentTranscript,
  readWholeTranscript,
  TRANSCRIPT_COPY,
  type TranscriptCopy,
} from "../tasks/transcript-copy.js";
import type { AgentsControl, HeldPeople } from "../tasks/use-agents.js";
import { useDescriptionComments } from "../tasks/use-description-comments.js";
import { useOpenLocal } from "../tasks/use-local-session.js";
import { OnLeavingHere, PullRequestsOnGitHub } from "../tasks/use-open-link.js";
import {
  DRAWN_KINDS,
  type DrawnTabs,
  drawsChanges,
  drawsLocal,
  drawsSubagent,
  drawsTerminal,
  type FileHistoryStep,
  type FileReadPlace,
  type FileReads,
  type FixedSidePanelTab,
  isPinnable,
  type OpenFile,
  type OpenPage,
  type PinHolder,
  PULL_REQUEST_VIEW,
  type PullRequestView,
  SIDE_PANEL_TAB,
  SIDE_PANEL_WIDTH,
  type SidePanelControl,
  type SidePanelTab,
  sameHolder,
} from "../tasks/use-side-panel.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";
import { useFileTreeWidth } from "./folded-groups.js";
import { AgentMenuTab, ROW_COUNT } from "./main-tabs.js";
import { PULL_REQUEST_TAB } from "./pages-on-demand.js";
import { paneTiming, pastRightEdge } from "./pane-motion.js";
import { PhoneBack, PhoneHead, PlaceMore, phoneFindGroups } from "./phone-head.js";
import {
  type AddEntry,
  AddTabButton,
  DoorsTab,
  entryRow,
  HandTabActionsContext,
  type HeldTranscripts,
  handedCommand,
  type ShownTab,
  type TabActionGroups,
  type TabDoors,
  type TabLook,
  type TabPin,
  type TabViews,
  type TranscriptCopier,
  useTranscriptCopier,
  type WorkerStandings,
} from "./strip-tabs.js";
import { LOOK_STRIP, useStripLooks } from "./switcher-looks.js";
import { type CardSubject, tabCard } from "./tab-card.js";
import { TabStrip } from "./tab-strip.js";

interface StripActivity {
  readonly slot: HTMLElement | null;
  readonly onListed: ((listed: boolean) => void) | undefined;
  readonly onShown: (shown: ShownTab | undefined) => void;
}

const DOCUMENT_RESERVE_PROPERTY = "--document-reserve";

function documentReserve(area: HTMLElement): number {
  const declared = Number.parseFloat(
    getComputedStyle(area).getPropertyValue(DOCUMENT_RESERVE_PROPERTY),
  );
  return Number.isFinite(declared) ? declared : SIDE_PANEL_WIDTH.MIN;
}

const PANEL_LEAVING = {
  NONE: "none",
  CLOSE: "close",
  FULL_SCREEN: "full-screen",
} as const;

type PanelLeaving = (typeof PANEL_LEAVING)[keyof typeof PANEL_LEAVING];

const NO_PAGES: readonly PageLine[] = [];

export const SIDE_PANEL_HOLDER = {
  TASK: "plan",
  AGENT: "agent",
  INBOX: "inbox",
} as const;

export type SidePanelHolder = (typeof SIDE_PANEL_HOLDER)[keyof typeof SIDE_PANEL_HOLDER];

function holderPlaceOf(holder: SidePanelHolder, id: string): PagePlace {
  return holder === SIDE_PANEL_HOLDER.AGENT ? { agentId: id } : { taskId: id };
}

function sameReadPlace(a: FileReadPlace, b: FileReadPlace): boolean {
  if ("taskId" in a) return "taskId" in b && a.taskId === b.taskId;
  return !("taskId" in b) && a.workspaceId === b.workspaceId && a.repository === b.repository;
}

function fileReadsOf(file: OpenFile, own: FileReads): FileReads {
  const saved = file.reads;
  return saved === undefined || sameReadPlace(saved.place, own.place) ? own : saved;
}

const NO_PLACES: readonly PagePlace[] = [];

function pageStandsOn(tab: OpenPage, place: PagePlace): boolean {
  return tab.place === undefined || pagePlaceId(tab.place) === pagePlaceId(place);
}

function placesBeside(tabs: readonly OpenPage[], own: PagePlace): readonly PagePlace[] {
  const places = new Map<string, PagePlace>();
  for (const tab of tabs) {
    if (tab.place !== undefined && !pageStandsOn(tab, own)) {
      places.set(pagePlaceId(tab.place), tab.place);
    }
  }
  return places.size === 0 ? NO_PLACES : [...places.values()];
}

const BESIDE_WORDS = {
  OPEN_TASK: "Open task",
} as const;

export interface TaskOfTab {
  readonly tasks: readonly {
    readonly id: string;
    readonly name: string;
    readonly status?: TaskStatus | undefined;
  }[];
  readonly onShowPanelTab: (taskId: string, tab: SidePanelTab) => void;
}

function tabTaskOf(
  tab: SidePanelTab,
  pages: readonly OpenPage[],
  files: readonly OpenFile[],
): string | undefined {
  if (isPageTab(tab)) {
    const place = pages.find((each) => sameTab(each, tab))?.place;
    return place !== undefined && "taskId" in place ? place.taskId : undefined;
  }
  if (!isFileTab(tab)) return undefined;
  const place = files.find((each) => each.path === tab.file)?.reads?.place;
  return place !== undefined && "taskId" in place ? place.taskId : undefined;
}

export interface PanelRepositoryPlace {
  readonly workspaceId: string;
  readonly repository: string;
}

const NO_KINDS: readonly FixedSidePanelTab[] = [];

const NO_TERMINALS: readonly TerminalStripTab[] = [];
const NO_LOCALS: readonly LocalStripTab[] = [];

const HOLDER_KINDS = {
  [SIDE_PANEL_HOLDER.TASK]: DRAWN_KINDS,
  [SIDE_PANEL_HOLDER.AGENT]: NO_KINDS,
  [SIDE_PANEL_HOLDER.INBOX]: NO_KINDS,
} as const satisfies Record<SidePanelHolder, readonly FixedSidePanelTab[]>;

export function offeredPanelKinds(holder: SidePanelHolder): readonly FixedSidePanelTab[] {
  return HOLDER_KINDS[holder];
}

export const COLUMN = {
  MAIN: "main",
  SIDE: "side",
} as const;

type Column = (typeof COLUMN)[keyof typeof COLUMN];

export interface ColumnFocus {
  readonly onArea: (area: HTMLDivElement | null) => void;
  readonly focus: Column;
  readonly setFocus: (column: Column) => void;
}

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

const NO_SUBAGENTS: readonly string[] = [];

export const ADD_SECTION = {
  PULL_REQUESTS: "Pull requests",
  PAGES: "Pages",
  TERMINAL: "Terminal",
  LOCAL: "Local",
  BROWSER: "Browser",
} as const;

interface CloudBrowserOffer {
  readonly agentId: string;
  readonly agent: AgentSummary;
  readonly owner: CloudBrowserOwner;
}

interface ListedCloudBrowser {
  readonly id: string;
  readonly title: string;
  readonly address: string;
  readonly owner: CloudBrowserOwner;
}

export interface TerminalOffer {
  readonly agent: AgentSummary;
  readonly label: string;
  readonly showsOnChord: boolean;
}

export interface ChangesOffer {
  readonly agentId: string;
  readonly agent: AgentSummary;
  readonly label: string;
  readonly pullRequest: AgentPullRequest;
}

interface HandedTabActions {
  readonly tab: SidePanelTab;
  readonly actions: TabActionGroups;
}

const NEW_BROWSER_TAB = "New browser tab";

type DrawnCloudBrowser = { readonly id: string; readonly owner: CloudBrowserOwner } & (
  | { readonly tab: AgentBrowserTab }
  | { readonly draft: CloudBrowserDraft }
);

const NO_CLOUD_BROWSERS: readonly DrawnCloudBrowser[] = [];

const NEW_CLOUD_TAB = "New tab";

function cloudBrowserTitleOf(drawn: DrawnCloudBrowser): string {
  if (!("tab" in drawn)) return NEW_CLOUD_TAB;
  const { tab } = drawn;
  if (tab.title.length > 0) return tab.title;
  return (URL.canParse(tab.address) ? new URL(tab.address).host : "") || TAB_WORDS.BROWSER;
}

const NO_OPEN_CHANGES: readonly ChangesStripTab[] = [];

function everyTaskAgent(
  agents: Pick<AgentsControl, "agents" | "archived">,
): readonly AgentSummary[] {
  const listed = agents.agents ?? [];
  const archived = (agents.archived ?? []).filter(
    (agent) => !listed.some((each) => each.id === agent.id),
  );
  if (archived.length === 0) return listed;
  return [...listed, ...archived].sort((one, other) => one.createdAt - other.createdAt);
}

function changesAgentOf(
  agents: AgentsControl,
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

export function changesOffers(
  agents: AgentsControl,
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
    const shown = agents.pullRequests.get(agent.id) ?? pullRequest;
    const label = agentName(agent, agents.models);
    return [{ agentId: agent.id, agent, label, pullRequest: shown }];
  });
}

export function changesTabOf(
  agents: AgentsControl,
  agentId: string,
  open: readonly ChangesStripTab[],
  number?: number,
): ChangesStripTab {
  if (number !== undefined && agents.pullRequests.get(agentId)?.number !== number) {
    return { changes: agentId, number };
  }
  return { changes: changesAgentOf(agents, agentId, open) };
}

export function showPullRequest(
  panel: Pick<SidePanelControl, "changes" | "onPreview" | "onPullRequestView">,
  agents: AgentsControl,
  agentId: string,
  view: PullRequestView,
  number?: number,
): void {
  const tab = changesTabOf(agents, agentId, panel.changes, number);
  panel.onPullRequestView(tab, view);
  panel.onPreview(tab);
}

export interface PanelCards {
  readonly agents: AgentsControl;
  readonly held: HeldTranscripts;
  readonly pagePlace: PagePlace;
  readonly shownAgent: string | undefined;
  readonly onOpenAgent: (agentId: string) => void;
  readonly people: ReadonlyMap<string, HeldPeople>;
}

function agentRowCard(
  agent: AgentSummary,
  label: string,
  cards: PanelCards | undefined,
): React.ReactNode {
  if (cards === undefined) return undefined;
  const { agents, held, shownAgent } = cards;
  const subject = agentSubject(agents, agent.id, held, shownAgent === agent.id);
  return hungCard({
    kind: TAB_KIND.AGENT,
    subject: { ...subject, name: label },
    models: agents.models,
  });
}

function browserEntries(
  browsers: Parameters<typeof panelEntries>[0]["browsers"],
  cards: PanelCards | undefined,
): AddEntry[] {
  const listed = (browsers?.listed ?? []).map((tab) => ({
    row: {
      id: tab.id,
      icon: tab.owner.icon,
      label: tab.title,
      detail: tab.owner.name,
      terms: [tab.title, tab.owner.name],
      section: ADD_SECTION.BROWSER,
      replayMasked: true,
    },
    card: hungCard({
      kind: TAB_KIND.BROWSER,
      owner: tab.owner,
      title: tab.title,
      address: tab.address,
    }),
    onPick: () => browsers?.onOpen(tab.id),
  }));
  const [only, ...more] = browsers?.agents ?? [];
  if (browsers === undefined || only === undefined) return listed;
  const look = tabLook({ kind: TAB_KIND.BROWSER, title: NEW_BROWSER_TAB });
  const base = { id: ADD_SECTION.BROWSER, ...look, section: ADD_SECTION.BROWSER };
  if (more.length === 0) {
    const row = { ...base, terms: [only.owner.name] };
    return [...listed, { row, onPick: () => browsers.onAgent(only.agentId) }];
  }
  const submenu = {
    label: "Open the tab in",
    rows: browsers.agents.map(({ agentId, agent, owner }) => ({
      id: agentId,
      label: owner.name,
      icon: owner.icon,
      end: agentEndMark(agent, true),
      card: agentRowCard(agent, owner.name, cards),
      replayMasked: true,
    })),
    value: undefined,
    onPick: browsers.onAgent,
  };
  return [...listed, { row: { ...base, submenu }, onPick: () => undefined }];
}

function kindRow(tab: FixedSidePanelTab, plan: PlanStanding | undefined): MenuRow {
  return {
    id: tab,
    ...tabLook({ kind: TAB_KIND.PANEL, tab, plan }),
    replayMasked: tab === SIDE_PANEL_TAB.DESCRIPTION && plan !== undefined,
  };
}

export function panelEntries(input: {
  panel: SidePanelControl;
  kinds: readonly FixedSidePanelTab[];
  changes?: readonly ChangesOffer[];
  pages?: readonly PageLine[];
  terminals?: {
    readonly offers: readonly TerminalOffer[];
    readonly onNew: (agentId: string) => void;
  };
  locals?: {
    readonly offers: readonly TerminalOffer[];
    readonly onNew: (agentId: string) => void;
  };
  browsers?: {
    readonly agents: readonly CloudBrowserOffer[];
    readonly onAgent: (agentId: string) => void;
    readonly listed?: readonly ListedCloudBrowser[] | undefined;
    readonly onOpen: (id: string) => void;
  };
  plan?: PlanStanding | undefined;
  cards?: PanelCards | undefined;
}): AddEntry[] {
  const { panel, changes = [], pages = [], cards } = input;
  const kinds = input.kinds.map((kind) => ({
    row: kindRow(kind, input.plan),
    onPick: () => panel.onChoose(kind),
  }));
  const changesRows = changes.map(({ agentId, label, pullRequest }) => {
    const look = tabLook({ kind: TAB_KIND.CHANGES, pullRequest });
    const card =
      cards === undefined
        ? undefined
        : hungCard({
            kind: TAB_KIND.CHANGES,
            subject: agentSubject(cards.agents, agentId, cards.held, cards.shownAgent === agentId),
            models: cards.agents.models,
            pullRequest,
            people: peopleOf(cards.people.get(agentId), pullRequest),
            onOpenAgent: () => cards.onOpenAgent(agentId),
          });
    return {
      row: {
        id: pullRequest.url,
        ...look,
        detail: label,
        terms: [look.label, label],
        section: ADD_SECTION.PULL_REQUESTS,
        replayMasked: true,
      },
      card,
      onPick: () => panel.onChoose({ changes: agentId }),
    };
  });
  const pageRows = pages.map((page) => ({
    row: {
      id: page.id,
      ...tabLook({ kind: TAB_KIND.PAGE, title: page.title }),
      section: ADD_SECTION.PAGES,
      replayMasked: true,
    },
    card:
      cards === undefined
        ? undefined
        : hungCard({
            kind: TAB_KIND.PAGE,
            place: cards.pagePlace,
            pageId: page.id,
            name: page.title,
            page,
          }),
    onPick: () => panel.onChoose({ page: page.id }),
  }));
  const terminalRows = (input.terminals?.offers ?? []).map(({ agent, label, showsOnChord }) => ({
    row: {
      id: tabKey({ terminal: agent.id }),
      ...tabLook({ kind: TAB_KIND.AGENT, name: label, agent }),
      detail: <TerminalStanding agent={agent} />,
      command: showsOnChord ? APP_COMMAND.SHOW_TERMINAL : undefined,
      section: ADD_SECTION.TERMINAL,
      replayMasked: true,
    },
    endMark: agentEndMark(agent, true),
    card:
      cards === undefined
        ? undefined
        : hungCard({
            kind: TAB_KIND.TERMINAL,
            agentId: agent.id,
            subject: agentSubject(
              cards.agents,
              agent.id,
              cards.held,
              cards.shownAgent === agent.id,
            ),
            models: cards.agents.models,
          }),
    onPick: () => input.terminals?.onNew(agent.id),
  }));
  const localRows = (input.locals?.offers ?? []).map(({ agent, label }) => ({
    row: {
      id: tabKey({ local: agent.id }),
      ...tabLook({ kind: TAB_KIND.AGENT, name: label, agent }),
      detail: <LocalStanding agentId={agent.id} />,
      section: ADD_SECTION.LOCAL,
      replayMasked: true,
    },
    endMark: agentEndMark(agent, true),
    card:
      cards === undefined
        ? undefined
        : hungCard({
            kind: TAB_KIND.LOCAL,
            subject: agentSubject(
              cards.agents,
              agent.id,
              cards.held,
              cards.shownAgent === agent.id,
            ),
            models: cards.agents.models,
          }),
    onPick: () => input.locals?.onNew(agent.id),
  }));
  const browserRows = browserEntries(input.browsers, cards);
  return [...kinds, ...changesRows, ...pageRows, ...terminalRows, ...localRows, ...browserRows];
}

export function panelOffers(input: {
  holder: SidePanelHolder;
  taskId: string;
  panel: SidePanelControl;
  agents: AgentsControl;
  pages: readonly PageLine[];
  onNewTerminal: ((agentId: string) => void) | undefined;
  onNewLocal?: ((agentId: string) => void) | undefined;
  viewedAgent: string | undefined;
  listedBrowsers?: readonly ListedCloudBrowser[] | undefined;
  plan?: PlanStanding | undefined;
  cards: PanelCards;
}): AddEntry[] {
  const { holder, taskId, panel, agents, onNewTerminal, cards } = input;
  const changes = panel.changes.filter((each) =>
    drawsChanges(each, { taskAgents: agents.heldIds }),
  );
  const ownerOf = (agentId: string): CloudBrowserOwner => {
    const subject = agentSubject(agents, agentId, cards.held, false);
    return { name: subject.name, icon: <AgentGlyph agent={subject.agent} /> };
  };
  const cloudOffers: readonly CloudBrowserOffer[] =
    holder === SIDE_PANEL_HOLDER.INBOX
      ? []
      : (agents.agents ?? [])
          .filter((agent) => agent.machine !== AGENT_MACHINE.DEVICE)
          .filter((agent) => holder !== SIDE_PANEL_HOLDER.AGENT || agent.id === taskId)
          .sort((a, b) => Number(b.id === input.viewedAgent) - Number(a.id === input.viewedAgent))
          .map((agent) => ({ agentId: agent.id, agent, owner: ownerOf(agent.id) }));
  return panelEntries({
    panel,
    kinds: offeredPanelKinds(holder),
    changes: changesOffers(agents, changes),
    pages: input.pages,
    ...(onNewTerminal === undefined || holder === SIDE_PANEL_HOLDER.INBOX
      ? undefined
      : { terminals: { offers: terminalOffers(agents, panel), onNew: onNewTerminal } }),
    ...(input.onNewLocal === undefined || holder === SIDE_PANEL_HOLDER.INBOX
      ? undefined
      : {
          locals: {
            offers: terminalOffers(agents, panel).filter(
              ({ agent }) => agent.machine !== AGENT_MACHINE.DEVICE,
            ),
            onNew: input.onNewLocal,
          },
        }),
    browsers: {
      agents: cloudOffers,
      onAgent: (agentId: string) =>
        panel.onChoose({
          cloudBrowser: startCloudDraft(holderPlaceOf(holder, taskId), agentId).id,
        }),
      listed: input.listedBrowsers,
      onOpen: (id: string) => panel.onChoose({ cloudBrowser: id }),
    },
    plan: input.plan,
    cards,
  });
}

function hungCard(subject: CardSubject): ReactNode {
  return tabCard(subject) ?? undefined;
}

function changesLook(tab: ChangesStripTab, agents: AgentsControl): KindLook {
  return tabLook({ kind: TAB_KIND.CHANGES, pullRequest: pullRequestOfTab(agents, tab) });
}

function terminalOffers(
  agents: AgentsControl,
  panel: Pick<SidePanelControl, "tab" | "lastTerminal">,
): readonly TerminalOffer[] {
  const listed = agents.agents ?? [];
  const target = terminalTarget({
    here: panel.tab === undefined ? undefined : agentOfTab(panel.tab),
    agents: listed.map((agent) => agent.id),
    lastUsed: panel.lastTerminal,
  });
  const chord = target.kind === TERMINAL_TARGET.AGENT ? target.agentId : undefined;
  return listed.map((agent) => ({
    agent,
    label: agentName(agent, agents.models),
    showsOnChord: agent.id === chord,
  }));
}

const noFocusMove = () => undefined;

export interface DrawnTab {
  tab: SidePanelTab;
  look: TabLook;
  close: () => void;
  copy?: ((copy: TranscriptCopy) => void) | undefined;
  agent?: AgentSummary | undefined;
}

function stripTabs(input: {
  panel: SidePanelControl;
  unread: readonly StripTab[];
  agents: AgentsControl;
  agentsOf: (agentId: string) => AgentsControl;
  subagents: readonly DrawnSubagent[];
  files: readonly OpenFile[];
  changes: readonly ChangesStripTab[];
  pages: readonly DrawnPage[];
  terminals: readonly TerminalStripTab[];
  locals: readonly LocalStripTab[];
  cloudBrowsers: readonly DrawnCloudBrowser[];
  held: HeldTranscripts;
  copied: TranscriptCopier;
  onOpenAgent: (agentId: string) => void;
  shownAgent: string | undefined;
  pagePlace: PagePlace;
  thread: boolean;
  people: ReadonlyMap<string, HeldPeople>;
}): DrawnTab[] {
  const { panel, unread, agents, subagents, files, changes, pages, terminals, locals, held } =
    input;
  const { copied, onOpenAgent, shownAgent, agentsOf } = input;
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
  const fixed = panel.tabs.map((tab) => ({
    tab,
    look: look(tab, {
      ...tabLook({ kind: TAB_KIND.PANEL, tab, thread: input.thread }),
      labelReplayUnmasked: true,
      card: hungCard({ kind: TAB_KIND.PANEL, tab }),
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
        "unread" in messages
          ? messages
          : agentTranscript({
              title: label,
              messages,
              brief: undefined,
              task,
            }),
      );
    return {
      tab,
      look: look(tab, {
        ...tabLook({ kind: TAB_KIND.SUBAGENT, name: label, model, state }),
        endMark: stateEndMark(state, false),
        card: hungCard({ kind: TAB_KIND.SUBAGENT, name: label, untitled, models, read: readCard }),
      }),
      close: () => panel.onClose(tab),
      copy: copied(read),
    };
  });
  const fileTabs = files.map(({ path }) => ({
    tab: { file: path },
    look: look(
      { file: path },
      { ...tabLook({ kind: TAB_KIND.FILE, path }), card: hungCard({ kind: TAB_KIND.FILE, path }) },
    ),
    close: () => panel.onClose({ file: path }),
  }));
  const changesTabs = changes.map((tab) => {
    const own = agentsOf(tab.changes);
    const subject = agentSubject(own, tab.changes, held, shownAgent === tab.changes);
    const pullRequest = pullRequestOfTab(own, tab);
    const changesCard = hungCard({
      kind: TAB_KIND.CHANGES,
      subject,
      models,
      pullRequest,
      people:
        pullRequest === undefined
          ? undefined
          : peopleOf(input.people.get(tab.changes), pullRequest),
      onOpenAgent: () => onOpenAgent(tab.changes),
    });
    return {
      tab,
      look: look(tab, {
        ...changesLook(tab, own),
        labelReplayUnmasked: pullRequest === undefined,
        card: changesCard,
      }),
      close: () => panel.onClose(tab),
    };
  });
  const pageTabs = pages.map(({ tab, line, place }) => ({
    tab,
    look: look(tab, {
      ...tabLook({ kind: TAB_KIND.PAGE, title: line.title }),
      card: hungCard({
        kind: TAB_KIND.PAGE,
        place,
        pageId: line.id,
        name: line.title,
        page: line,
      }),
    }),
    close: () => panel.onClose(tab),
  }));
  const terminalTabs = terminals.map((tab) => {
    const subject = agentSubject(agentsOf(tab.terminal), tab.terminal, held, false);
    return {
      tab,
      look: look(tab, {
        ...tabLook({ kind: TAB_KIND.TERMINAL, agent: subject.agent }),
        detail: subject.name,
        card: hungCard({ kind: TAB_KIND.TERMINAL, agentId: tab.terminal, subject, models }),
      }),
      close: () => panel.onClose(tab),
    };
  });
  const localTabs = locals.map((tab) => {
    const subject = agentSubject(agentsOf(tab.local), tab.local, held, false);
    return {
      tab,
      look: look(tab, {
        ...tabLook({ kind: TAB_KIND.LOCAL, agent: subject.agent }),
        detail: subject.name,
        card: hungCard({ kind: TAB_KIND.LOCAL, subject, models }),
      }),
      close: () => panel.onClose(tab),
    };
  });
  const cloudBrowserTabs = panel.strip.filter(isCloudBrowserTab).flatMap((tab) => {
    const drawn = cloudBrowsers.find((each) => each.id === tab.cloudBrowser);
    if (drawn === undefined) return [];
    return [
      {
        tab,
        look: look(tab, {
          icon: drawn.owner.icon,
          label: cloudBrowserTitleOf(drawn),
          labelReplayUnmasked: !("tab" in drawn),
          card: hungCard({
            kind: TAB_KIND.BROWSER,
            owner: drawn.owner,
            title: cloudBrowserTitleOf(drawn),
            address: "tab" in drawn ? drawn.tab.address : "",
          }),
        }),
        close: () => {
          if ("draft" in drawn) discardCloudDraft(input.pagePlace, drawn.id);
          panel.onClose(tab);
        },
      },
    ];
  });
  const transcriptTabs = panel.strip.filter(isTranscriptTab).flatMap((tab) => {
    const agent = agents.agents?.find((each) => each.id === tab.transcript);
    if (agent === undefined) return [];
    const subject = agentSubject(agents, agent.id, held, chosen(tab));
    return [
      {
        tab,
        look: look(tab, {
          ...tabLook({ kind: TAB_KIND.AGENT, name: subject.name, agent }),
          card: hungCard({ kind: TAB_KIND.AGENT, subject, models }),
        }),
        close: () => panel.onClose(tab),
        agent,
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
    ...localTabs,
    ...cloudBrowserTabs,
  ];
}

export interface TranscriptDoors {
  readonly onOpenInTask: (agentId: string) => void;
  readonly onOpenTerminal: ((agentId: string) => void) | undefined;
}

interface PanelWiring {
  readonly tab: string;
  readonly panel: string;
}

function PanelTabs({
  panel,
  holder,
  taskId,
  pinOn,
  keys,
  unread,
  agents,
  agentsOf,
  subagents,
  files,
  changes,
  pages,
  terminals,
  locals,
  cloudBrowsers,
  offers,
  held,
  handed,
  onOpenAgent,
  shownAgent,
  activity,
  wiring,
  shown,
  transcriptDoors,
  pagePlace,
}: {
  panel: SidePanelControl;
  holder: SidePanelHolder;
  taskId: string;
  pagePlace: PagePlace;
  pinOn: PinHolder | undefined;
  keys: boolean;
  unread: readonly StripTab[];
  agents: AgentsControl;
  agentsOf: (agentId: string) => AgentsControl;
  subagents: readonly DrawnSubagent[];
  files: readonly OpenFile[];
  changes: readonly ChangesStripTab[];
  pages: readonly DrawnPage[];
  terminals: readonly TerminalStripTab[];
  locals: readonly LocalStripTab[];
  cloudBrowsers: readonly DrawnCloudBrowser[];
  offers: readonly AddEntry[];
  held: HeldTranscripts;
  handed: HandedTabActions | undefined;
  onOpenAgent: (agentId: string) => void;
  shownAgent: string | undefined;
  activity?: StripActivity | undefined;
  wiring: PanelWiring | undefined;
  shown: boolean;
  transcriptDoors: TranscriptDoors | undefined;
}): React.JSX.Element {
  const copied = useTranscriptCopier();
  const people = useChangesPeopleOf(useMemo(() => changes.map((tab) => tab.changes), [changes]));
  const kinds = stripTabs({
    panel,
    unread,
    agents,
    agentsOf,
    subagents,
    files,
    changes,
    pages,
    terminals,
    locals,
    cloudBrowsers,
    held,
    copied,
    onOpenAgent,
    shownAgent,
    pagePlace,
    thread: holder === SIDE_PANEL_HOLDER.INBOX,
    people,
  });
  const strip = inTaskOrder(kinds, panel.order, (entry) => entry.tab);
  useStripLooks(LOOK_STRIP.PANEL, holder === SIDE_PANEL_HOLDER.TASK ? taskId : undefined, strip);
  const copyLink = useCopyLinkItem();
  const closeOthersOf = (entry: DrawnTab, at: number): (() => void) | undefined => {
    const others = strip.filter((_, place) => place !== at);
    if (others.length === 0) return undefined;
    return () => {
      for (const other of others) other.close();
      panel.onChoose(entry.tab);
    };
  };
  const chosen = strip.find((entry) => entry.look.selected);
  useAppCommand(APP_COMMAND.CLOSE_TAB, keys ? chosen?.close : undefined);
  const closeOthers =
    chosen === undefined ? undefined : closeOthersOf(chosen, strip.indexOf(chosen));
  useAppCommand(APP_COMMAND.CLOSE_OTHER_TABS, keys ? closeOthers : undefined);
  const copyChosen = keys ? chosen?.copy : undefined;
  useAppCommand(
    APP_COMMAND.COPY_CONTENT,
    copyChosen === undefined ? undefined : () => copyChosen(TRANSCRIPT_COPY.CONCISE),
    FOCUSED_OFFER,
  );
  useAppCommand(
    APP_COMMAND.COPY_FULL_TRANSCRIPT,
    copyChosen === undefined ? undefined : () => copyChosen(TRANSCRIPT_COPY.FULL),
    FOCUSED_OFFER,
  );
  const openOnGitHub =
    keys && chosen !== undefined && handed !== undefined && sameTab(handed.tab, chosen.tab)
      ? handedCommand(handed.actions, APP_COMMAND.OPEN_ON_GITHUB)
      : undefined;
  useAppCommand(APP_COMMAND.OPEN_ON_GITHUB, openOnGitHub, FOCUSED_OFFER);
  const pinOf = ({ tab, look }: DrawnTab): TabPin | undefined => {
    const on: PinHolder | undefined =
      holder === SIDE_PANEL_HOLDER.TASK
        ? { task: taskId }
        : holder === SIDE_PANEL_HOLDER.AGENT
          ? pinOn
          : undefined;
    if (on === undefined || !isPinnable(tab)) return undefined;
    const pinned = panel.pins.some((pin) => sameHolder(pin, on) && sameTab(pin.tab, tab));
    return {
      pinned,
      onToggle: () => (pinned ? panel.onUnpin(on, tab) : panel.onPin(on, tab, look.label)),
    };
  };
  const doorsOf = (entry: DrawnTab, at: number): TabDoors => {
    const { agent } = entry;
    const linked =
      holder === SIDE_PANEL_HOLDER.INBOX
        ? undefined
        : panelTabPlace(holderPlaceOf(holder, taskId), entry.tab);
    return {
      chosen: entry.look.selected,
      onClose: entry.close,
      onCloseOthers: closeOthersOf(entry, at),
      pin: pinOf(entry),
      onCopy: entry.copy,
      copyLink: linked === undefined ? undefined : copyLink(linked),
      onOpenInTask:
        agent === undefined || transcriptDoors === undefined
          ? undefined
          : () => transcriptDoors.onOpenInTask(agent.id),
      handed:
        entry.look.selected && handed !== undefined && sameTab(handed.tab, entry.tab)
          ? handed.actions
          : undefined,
    };
  };
  return (
    <PanelTabsRow>
      {activity?.slot && activity.onListed !== undefined
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
        {strip.map((entry, at) => {
          const look =
            entry.look.selected && wiring !== undefined
              ? { ...entry.look, id: wiring.tab, controls: wiring.panel }
              : entry.look;
          const onShown = activity?.onShown;
          return entry.agent === undefined || transcriptDoors === undefined ? (
            <DoorsTab
              key={tabKey(entry.tab)}
              look={look}
              doors={doorsOf(entry, at)}
              onShown={onShown}
            />
          ) : (
            <AgentMenuTab
              key={tabKey(entry.tab)}
              agent={entry.agent}
              agents={agents}
              look={look}
              doors={doorsOf(entry, at)}
              shown={shown}
              keys={keys}
              terminals={{ onOpenTerminal: transcriptDoors.onOpenTerminal }}
              onShown={onShown}
            />
          );
        })}
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
    </PanelTabsRow>
  );
}

export function ActivityList({
  strip,
  offers,
  onListed,
}: {
  strip: readonly DrawnTab[];
  offers: readonly AddEntry[];
  onListed: (listed: boolean) => void;
}): React.JSX.Element {
  const more = offers.filter(
    (entry) => entry.row.section !== undefined || !strip.some((each) => each.tab === entry.row.id),
  );
  return (
    <ScrollArea size={SCROLL_SIZE.CONTENT}>
      <div className="side-panel-activity flex flex-col gap-section-gap px-column-inset py-row-inset">
        {strip.length === 0 ? (
          <div className="mb-control-gap px-row-inset">
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              <ReplayUnmask>Nothing open beside Overview</ReplayUnmask>
            </Text>
          </div>
        ) : (
          <ReplayUnmask>
            <List label="Activity" density={LIST_DENSITY.DENSE}>
              {strip.map((entry) => (
                <RowHintOptions key={tabKey(entry.tab)} card={entry.look.card}>
                  <ListRow
                    leading={entry.look.icon}
                    title={entry.look.label}
                    titleReplayMasked={entry.look.labelReplayUnmasked !== true}
                    meta={
                      entry.look.detail === undefined ? undefined : (
                        <ReplayWords masked={entry.look.labelReplayUnmasked !== true}>
                          {entry.look.detailTone === undefined ? (
                            entry.look.detail
                          ) : (
                            <span className={ROW_COUNT} data-tone={entry.look.detailTone}>
                              {entry.look.detail}
                            </span>
                          )}
                        </ReplayWords>
                      )
                    }
                    unread={entry.look.unread}
                    hint={
                      entry.look.card === undefined
                        ? undefined
                        : { Hint: RowHint, label: entry.look.label }
                    }
                    actions={
                      <Tooltip label={`Close ${entry.look.label}`}>
                        <IconButton
                          icon={<CloseIcon />}
                          label={`Close ${entry.look.label}`}
                          onClick={entry.close}
                        />
                      </Tooltip>
                    }
                    onPress={() => {
                      onListed(false);
                      entry.look.onSelect();
                    }}
                  />
                </RowHintOptions>
              ))}
            </List>
          </ReplayUnmask>
        )}
        {more.length === 0 ? null : (
          <div className="side-panel-activity-more flex flex-col">
            <ReplayUnmask>
              <div className="pb-ui-4 px-row-inset">
                <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                  Open more
                </Text>
              </div>
              <MenuRowList
                label="Open a tab"
                rows={more.map(entryRow)}
                onPick={(id) => {
                  onListed(false);
                  more.find((entry) => entry.row.id === id)?.onPick();
                }}
              />
            </ReplayUnmask>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

const panelToggleRoomAtom = Atom.keepAlive(Atom.make<HTMLElement | null>(null));

export function usePanelToggleRoom(): (room: HTMLElement | null) => void {
  return useAtomSet(panelToggleRoomAtom);
}

function ToggleOffers({
  entries,
  onAnswered,
}: {
  entries: readonly AddEntry[];
  onAnswered: () => void;
}): React.JSX.Element | null {
  const toggle = useAtomValue(panelToggleRoomAtom);
  const [corner, setCorner] = useState<HTMLElement | null>(null);
  const room = toggle ?? corner;
  const [open, setOpen] = useState(true);
  const drawn = useDisclosure(open);
  const menuId = useId();
  useEffect(() => {
    if (!drawn.mounted) onAnswered();
  }, [drawn.mounted, onAnswered]);
  if (!drawn.mounted) return null;
  if (room === null) return <div ref={setCorner} className="panel-offers-corner" />;
  const close = () => {
    setOpen(false);
    room.querySelector<HTMLElement>("button")?.focus();
  };
  const menu = (
    <SearchableMenu
      leaving={drawn.leaving}
      ref={drawn.ref}
      id={menuId}
      label="Open a tab"
      placeholder="Search tabs"
      rows={entries.map(entryRow)}
      value={undefined}
      noMatch={entries.length === 0 ? "Nothing to open here" : "No tabs match"}
      align={POPOVER_ALIGN.END}
      bounds={POPOVER_BOUNDS.WINDOW}
      replayUnmasked
      onPick={(id) => {
        const entry = entries.find((each) => each.row.id === id);
        close();
        entry?.onPick();
      }}
      onClose={close}
      onLeave={(left) => {
        if (!(left instanceof Node && room.contains(left))) setOpen(false);
      }}
    />
  );
  return toggle === null ? (
    <div ref={setCorner} className="panel-offers-corner">
      {menu}
    </div>
  ) : (
    createPortal(menu, toggle)
  );
}

interface DrawnPage {
  tab: PageStripTab;
  line: PageLine;
  place: PagePlace;
}

interface DrawnSubagent {
  tab: SubagentStripTab;
  delegation: NonNullable<SubagentStripTab["delegation"]>;
  label: string;
  untitled: boolean;
  state: GlyphState;
  stateWords: string | undefined;
}

function drawnSubagent(
  tab: SubagentStripTab,
  status: AgentStatus,
  held: HeldTranscripts,
): DrawnSubagent | undefined {
  const { delegation, subagent } = tab;
  if (delegation === undefined) return undefined;
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

function drawnSubagents(
  tabs: readonly SubagentStripTab[],
  standings: WorkerStandings,
  held: HeldTranscripts,
  drawn: Pick<DrawnTabs, "agents" | "subagents">,
): readonly DrawnSubagent[] {
  return tabs.flatMap((tab): DrawnSubagent[] => {
    if (!drawsSubagent(tab, drawn)) return [];
    const status = standings.get(tab.subagent) ?? AGENT_STATUS.RUNNING;
    const subagent = drawnSubagent(tab, status, held);
    return subagent === undefined ? [] : [subagent];
  });
}

interface DelegationChoices {
  readonly own: ModelChoice | undefined;
  readonly delegated: ModelChoice | undefined;
}

function delegationChoices(
  delegation: NonNullable<SubagentStripTab["delegation"]>,
  subagent: string,
  agents: AgentsControl,
  held: HeldTranscripts,
): DelegationChoices {
  const parent = agents.agents?.find((agent) => agent.id === delegation.agent);
  const own = parent === undefined ? undefined : { model: parent.model, effort: parent.effort };
  const started = held.agents.get(delegation.agent)?.messages;
  return { own, delegated: own && delegatedChoice(started, subagent, own) };
}

function subagentCardReading(
  drawn: DrawnSubagent,
  agents: AgentsControl,
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
      tile: subagentActor((choices.delegated ?? choices.own)?.model, state, label),
      transcript:
        messages &&
        agentTranscript({
          title: label,
          messages,
          brief: undefined,
          task: delegation.task,
        }),
    };
  };
}

function seekCall(callId: string): void {
  focusSeek({
    find: () =>
      document.querySelector<HTMLElement>(
        `.desktop-task-column [role="log"] [data-call-id="${CSS.escape(callId)}"]`,
      ),
    ready: drawnVisibly,
    act: (row) => {
      const log = row.closest<HTMLElement>('[role="log"]');
      if (log !== null) centerWithin(log, row);
    },
  });
}

export interface TaskCards {
  readonly call: TranscriptCards;
  readonly agent: (agentId: string) => TranscriptCards;
}

export function taskCards(input: {
  agents: AgentsControl;
  held: HeldTranscripts;
  chosen: (tab: StripTab) => boolean;
  pages: PagePlace | undefined;
  task?: BriefTask | undefined;
}): TaskCards {
  const { agents, held, chosen, pages, task } = input;
  const taskId = pages !== undefined && "taskId" in pages ? pages.taskId : undefined;
  const subjectOf = (opened: ToolTarget, name: string | undefined): CardSubject | undefined => {
    switch (opened.kind) {
      case TOOL_TARGET.AGENT: {
        const subject = agentSubject(agents, opened.agent, held, chosen({ agent: opened.agent }));
        return { kind: TAB_KIND.AGENT, subject, models: agents.models };
      }
      case TOOL_TARGET.PAGE:
        return pages === undefined
          ? undefined
          : { kind: TAB_KIND.PAGE, place: pages, pageId: opened.page, name };
      case TOOL_TARGET.DESCRIPTION:
        return taskId === undefined
          ? undefined
          : { kind: TAB_KIND.PLAN, taskId, name: task?.name, status: task?.status };
      case TOOL_TARGET.TASK:
        return { kind: TAB_KIND.PLAN, taskId: opened.task, name };
      case TOOL_TARGET.INBOX:
        return { kind: TAB_KIND.PANEL, tab: SIDE_PANEL_TAB.INBOX };
    }
  };
  const target = (opened: ToolTarget, name?: string): ReactNode => {
    const subject = subjectOf(opened, name);
    return subject === undefined ? undefined : hungCard(subject);
  };
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
  const byAgent = new Map<string, TranscriptCards>();
  return {
    call: { target, agent, standsOn: pages, worker: () => undefined },
    agent: (agentId) => {
      const known = byAgent.get(agentId);
      if (known !== undefined) return known;
      const cards: TranscriptCards = {
        target,
        agent,
        task,
        standsOn: pages,
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

function taskAgentLabel(agents: AgentsControl, agentId: string): string | undefined {
  const agent = agents.agents?.find((each) => each.id === agentId);
  return agent === undefined ? undefined : agentName(agent, agents.models);
}

function TaskPagePane({
  doors,
  ...pane
}: Omit<Parameters<typeof PagePane>[0], "comments"> & {
  doors: NonNullable<Parameters<typeof PagePane>[0]["comments"]>["doors"];
}): React.JSX.Element {
  const taskId = "taskId" in pane.place ? pane.place.taskId : undefined;
  const pageId = pane.page.id;
  const control = useDescriptionComments(
    useMemo(() => (taskId === undefined ? undefined : { taskId, pageId }), [taskId, pageId]),
  );
  return <PagePane {...pane} comments={control === undefined ? undefined : { control, doors }} />;
}

function TabContent({
  tab,
  taskId,
  codeFilesRead,
  repositoryPlace,
  pagePlace,
  repository,
  files,
  pages,
  agents,
  agentsOf,
  standings,
  shown,
  findActive,
  onOpenTarget,
  cards,
  onWorkerStatus,
  onWorkerHeld,
  fileTree,
  onBrowseFile,
  onFileHistory,
  onCloseTab,
  pullRequestViews,
  onPullRequestView,
  shellsList,
  cloudBrowsers,
  cloudDrafts,
  transcript,
  onTabActions,
}: {
  tab: SidePanelTab;
  taskId: string;
  pagePlace: PagePlace;
  repository: string | null;
  codeFilesRead: boolean;
  repositoryPlace: PanelRepositoryPlace | undefined;
  files: readonly OpenFile[];
  pages: readonly DrawnPage[];
  agents: AgentsControl;
  agentsOf: (agentId: string) => AgentsControl;
  standings: WorkerStandings;
  shown: boolean;
  findActive: boolean;
  onOpenTarget: (target: ToolTarget) => void;
  cards: TaskCards;
  onWorkerStatus: (callId: string, status: AgentStatus) => void;
  onWorkerHeld: TabViews["onWorkerHeld"];
  fileTree: TreeShown;
  onBrowseFile: (from: string | undefined, path: string, newTab: boolean) => void;
  onFileHistory: (from: string, step: FileHistoryStep) => void;
  onCloseTab: (tab: SidePanelTab) => void;
  pullRequestViews: SidePanelControl["pullRequestViews"];
  onPullRequestView: SidePanelControl["onPullRequestView"];
  shellsList: { readonly open: boolean; readonly onToggle: () => void };
  cloudBrowsers: readonly DrawnCloudBrowser[];
  cloudDrafts: {
    readonly onOpened: (draftId: string, tab: AgentBrowserTab) => void;
    readonly onDiscard: (draftId: string) => void;
  };
  transcript: ((agentId: string) => React.ReactNode) | undefined;
  onTabActions: (tab: SidePanelTab, actions: TabActionGroups | undefined) => void;
}): React.JSX.Element | null {
  const directory = useMemberDirectory();
  if (isTranscriptTab(tab)) return <>{transcript?.(tab.transcript)}</>;
  if (isCloudBrowserTab(tab)) {
    const drawn = cloudBrowsers.find((each) => each.id === tab.cloudBrowser);
    if (drawn === undefined) return <SpinnerRegion delay label={readingWords("the browser")} />;
    if ("draft" in drawn) {
      return (
        <CloudBrowserDraftPane
          key={drawn.id}
          place={pagePlace}
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
        agents={agentsOf(tab.terminal)}
        shown={shown}
        onOpenAgent={() => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent: tab.terminal })}
        onClose={() => onCloseTab(tab)}
        shells={shellsList}
      />
    );
  }
  if (isLocalTab(tab)) {
    return (
      <LocalTab
        key={tab.local}
        agentId={tab.local}
        agents={agentsOf(tab.local)}
        shown={shown}
        onOpenAgent={() => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent: tab.local })}
        shells={shellsList}
      />
    );
  }
  if (isPageTab(tab)) {
    const drawn = pages.find((each) => each.tab.page === tab.page);
    if (drawn === undefined) return <SpinnerRegion delay label={readingWords("the page")} />;
    const { line: page, place } = drawn;
    return (
      <TaskPagePane
        key={page.id}
        place={place}
        page={page}
        findActive={findActive}
        doors={{
          agents: {
            control: agents,
            onOpen: (agent) => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent }),
          },
          me: agents.me,
        }}
      />
    );
  }
  if (isChangesTab(tab)) {
    return (
      <PullRequestsOnGitHub key={tabKey(tab)}>
        <OpenFileTabProvider
          value={codeFilesRead ? (path) => onBrowseFile(undefined, path, true) : undefined}
        >
          <Suspense fallback={<SpinnerRegion delay label={readingWords("the pull request")} />}>
            <PULL_REQUEST_TAB.Route
              agentId={tab.changes}
              number={tab.number}
              control={agentsOf(tab.changes)}
              shown={shown}
              repository={repository}
              tree={fileTree}
              view={ofPullRequestTab(pullRequestViews, tab) ?? PULL_REQUEST_VIEW.CONVERSATION}
              onView={(view) => onPullRequestView(tab, view)}
              onActions={(actions) => onTabActions(tab, actions)}
            />
          </Suspense>
        </OpenFileTabProvider>
      </PullRequestsOnGitHub>
    );
  }
  if (isFileTab(tab)) {
    const file = files.find((each) => each.path === tab.file);
    if (file === undefined) return <SpinnerRegion delay label={readingWords("the file")} />;
    const reads = fileReadsOf(file, { place: repositoryPlace ?? { taskId }, repository });
    const { place } = reads;
    return (
      <Fragment key={reads.repository ?? undefined}>
        <FileView
          place={place}
          repository={reads.repository}
          file={file}
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
          status={standings.get(tab.subagent) ?? AGENT_STATUS.RUNNING}
          control={agents}
          shown={shown}
          onStatus={(status) => onWorkerStatus(tab.subagent, status)}
          onHeld={onWorkerHeld}
          onOpenTarget={onOpenTarget}
          cards={cards.agent(tab.delegation.agent)}
        />
      );
    }
    return <SpinnerRegion delay label={readingWords("the worker")} />;
  }
  return null;
}

export function SidePanelToggle({
  panel,
  disabled,
}: {
  panel: SidePanelControl;
  disabled: boolean;
}): React.JSX.Element {
  const closes = panel.open && panel.fullScreenOnly;
  const label = closes ? "Close panel" : panel.open ? "Hide panel" : "Show panel";
  const offer = (run: () => void) => (disabled ? undefined : run);
  useAppCommand(APP_COMMAND.TOGGLE_SIDE_PANEL, offer(panel.onToggle));
  return (
    <Tooltip label={label} command={APP_COMMAND.TOGGLE_SIDE_PANEL}>
      <IconButton
        icon={closes ? <CloseIcon /> : <SidePanelIcon />}
        label={label}
        aria-expanded={panel.open || panel.toggleAsked}
        disabled={disabled}
        onClick={panel.onToggle}
      />
    </Tooltip>
  );
}

export function SidePanelChord({
  panel,
  disabled,
}: {
  panel: SidePanelControl;
  disabled: boolean;
}): null {
  useAppCommand(APP_COMMAND.TOGGLE_SIDE_PANEL, disabled ? undefined : panel.onToggle);
  return null;
}

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

export interface SidePanelDrawing {
  panel: SidePanelControl | undefined;
  leaving: PanelLeaving;
  onLeft: () => void;
  edge: ResizeEdgeHandle;
}

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

function drawnPanel(panel: SidePanelControl, held: HeldPanel | undefined): SidePanelControl {
  if (held?.leaving === PANEL_LEAVING.CLOSE) return held.panel;
  if (held?.leaving === PANEL_LEAVING.FULL_SCREEN) return { ...panel, fullScreen: true };
  return panel;
}

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
  if (panel.open && (held?.leaving === PANEL_LEAVING.CLOSE || panel.fullScreen)) return undefined;
  return held;
}

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
      ? [{ transform: drawn.transform }, { transform: pastRightEdge(aside) }]
      : [
          { clipPath: drawn.clipPath === "none" ? "inset(0)" : drawn.clipPath },
          { clipPath: `inset(0 0 0 ${beside}px)` },
        ];
  for (const running of aside.getAnimations()) running.cancel();
  const exit = aside.animate(keyframes, { ...timing, fill: "forwards" });
  exit.onfinish = onLeft;
  return () => exit.cancel();
}

export function SidePanel({
  panel,
  leaving,
  onLeft,
  edge,
  unread,
  holder,
  taskId,
  pinOn,
  onAgent = false,
  repository,
  repositoryPlace,
  pages,
  agents,
  openAgents,
  shownAgent,
  views,
  shown,
  focused,
  onOpenTarget,
  banner,
  transcript,
  transcriptDoors,
  activity: taskActivity,
  phone,
  taskOfTab,
}: SidePanelDrawing & {
  panel: SidePanelControl;
  unread: readonly StripTab[];
  holder: SidePanelHolder;
  taskId: string;
  pinOn?: PinHolder | undefined;
  onAgent?: boolean;
  repository: string | null;
  repositoryPlace?: PanelRepositoryPlace | undefined;
  pages: readonly PageLine[] | undefined;
  agents: AgentsControl;
  openAgents: readonly string[] | undefined;
  shownAgent: string | undefined;
  views: TabViews;
  shown: boolean;
  focused: boolean;
  onOpenTarget: (target: ToolTarget) => void;
  banner?: React.ReactNode;
  transcript?: ((agentId: string) => React.ReactNode) | undefined;
  transcriptDoors?: TranscriptDoors | undefined;
  activity?:
    | {
        readonly listed?: boolean | undefined;
        readonly onListed?: ((listed: boolean) => void) | undefined;
        readonly onShown: (shown: ShownTab | undefined) => void;
      }
    | undefined;
  phone?: { readonly back: string; readonly onBack: () => void } | undefined;
  taskOfTab?: TaskOfTab | undefined;
}): React.JSX.Element | null {
  const [ownListed, setOwnListed] = useState(false);
  const [ownShown, setOwnShown] = useState<ShownTab | undefined>(undefined);
  if (ownListed && !panel.open) setOwnListed(false);
  const ownActivity =
    phone !== undefined && taskActivity === undefined
      ? { listed: ownListed, onListed: setOwnListed, onShown: setOwnShown }
      : undefined;
  const activity = taskActivity ?? ownActivity;
  const [activitySlot, setActivitySlot] = useState<HTMLElement | null>(null);
  const switched = activity !== undefined && panel.fullScreenOnly;
  const listing = switched && activity.listed === true;
  const [handed, setHanded] = useState<HandedTabActions | undefined>(undefined);
  const handTabActions = useCallback((tab: SidePanelTab, actions: TabActionGroups | undefined) => {
    setHanded((was) =>
      actions !== undefined
        ? { tab, actions }
        : was !== undefined && sameTab(was.tab, tab)
          ? undefined
          : was,
    );
  }, []);
  const { tab } = panel;
  const numberedTabs = useSteadyDoors(
    panel.changes.flatMap(({ changes: agentId, number }) =>
      number === undefined ? [] : [{ agentId, number }],
    ),
  );
  useQueries({ queries: numberedTabs.map((key) => pullRequestPublishedQuery(key)) });
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
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
  const [shellsOpen, setShellsOpen] = useState(true);
  const shellsList = useMemo(
    () => ({ open: shellsOpen, onToggle: () => setShellsOpen((was) => !was) }),
    [shellsOpen],
  );
  const { held: drawnTranscripts, standings } = views;
  const subagents = drawnSubagents(panel.subagents, standings, drawnTranscripts, {
    agents: openAgents,
    subagents: NO_SUBAGENTS,
  });
  const chosenTab = panel.tab;
  const pagePlace = useMemo(
    () => (onAgent ? { agentId: taskId } : holderPlaceOf(holder, taskId)),
    [onAgent, holder, taskId],
  );
  const cards = useMemo(
    () =>
      taskCards({
        agents,
        held: drawnTranscripts,
        chosen: (chosen) =>
          (chosenTab !== undefined && sameTab(chosen, chosenTab)) ||
          (shownAgent !== undefined && sameTab(chosen, { agent: shownAgent })),
        pages: pagePlace,
      }),
    [agents, drawnTranscripts, chosenTab, shownAgent, pagePlace],
  );
  const files = panel.files.filter((file) => file.browsedOn === taskId);
  const changes = panel.changes.filter((each) =>
    drawsChanges(each, { taskAgents: agents.heldIds }),
  );
  const terminalsOffered =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.TERMINALS) }).data ===
    true;
  const terminalsHere = terminalsOffered && holder !== SIDE_PANEL_HOLDER.INBOX;
  const terminals = !terminalsHere
    ? NO_TERMINALS
    : panel.terminals.filter((each) => drawsTerminal(each, { taskAgents: agents.agentIds }));
  const localsOffered =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.LOCAL_TERMINALS) })
      .data === true;
  const localsHere = localsOffered && holder !== SIDE_PANEL_HOLDER.INBOX;
  const locals = !localsHere
    ? NO_LOCALS
    : panel.locals.filter((each) => drawsLocal(each, { taskAgents: agents.agentIds }));
  const agentsOf = useAgentsElsewhere(agents, [
    ...changes.map((each) => each.changes),
    ...terminals.map((each) => each.terminal),
    ...locals.map((each) => each.local),
  ]);
  const cloudListing = holder !== SIDE_PANEL_HOLDER.INBOX;
  const cloudPlace = useMemo(() => holderPlaceOf(holder, taskId), [holder, taskId]);
  const cloudListed = useCloudBrowserTabs(cloudPlace, cloudListing);
  const cloudDraftsHeld = useCloudBrowserDrafts(cloudPlace, cloudListing);
  const cloudBrowsers = useMemo(() => {
    const ownerOf = (agentId: string): CloudBrowserOwner => {
      const subject = agentSubject(agents, agentId, drawnTranscripts, false);
      return { name: subject.name, icon: <AgentGlyph agent={subject.agent} /> };
    };
    const drawn: DrawnCloudBrowser[] = [
      ...(cloudListed ?? []).map((tab) => ({ id: tab.id, tab, owner: ownerOf(tab.agentId) })),
      ...cloudDraftsHeld.map((draft) => ({ id: draft.id, draft, owner: ownerOf(draft.agentId) })),
    ];
    return drawn.length === 0 ? NO_CLOUD_BROWSERS : drawn;
  }, [cloudListed, cloudDraftsHeld, agents, drawnTranscripts]);
  const listedBrowsers = useMemo(
    () =>
      cloudBrowsers.flatMap((drawn) =>
        "tab" in drawn
          ? [
              {
                id: drawn.id,
                title: cloudBrowserTitleOf(drawn),
                address: drawn.tab.address,
                owner: drawn.owner,
              },
            ]
          : [],
      ),
    [cloudBrowsers],
  );
  const cloudBrowserLabel = (id: string) => {
    const drawn = cloudBrowsers.find((each) => each.id === id);
    return drawn === undefined ? TAB_WORDS.BROWSER : cloudBrowserTitleOf(drawn);
  };
  const viewedAgent = shownAgent ?? (panel.tab === undefined ? undefined : agentOfTab(panel.tab));
  const cloudDrafts = {
    onOpened: (draftId: string, opened: AgentBrowserTab) => {
      discardCloudDraft(cloudPlace, draftId);
      panel.onChoose({ cloudBrowser: opened.id });
    },
    onDiscard: (draftId: string) => discardCloudDraft(cloudPlace, draftId),
  };
  const taskPages = pages ?? NO_PAGES;
  const pagesElsewhere = useMemo(
    () =>
      panel.pages.filter(
        (tab) => !pageStandsOn(tab, pagePlace) && panel.strip.some((each) => sameTab(each, tab)),
      ),
    [panel.pages, panel.strip, pagePlace],
  );
  const besidePlaces = useMemo(
    () => placesBeside(pagesElsewhere, pagePlace),
    [pagesElsewhere, pagePlace],
  );
  const besidePages = useQueries({
    queries: besidePlaces.map((place) => pagesQuery(place)),
    combine: (reads) =>
      new Map(besidePlaces.map((place, at) => [pagePlaceId(place), reads[at]?.data])),
  });
  const pageTabs = panel.pages.flatMap((tab): DrawnPage[] => {
    const place = tab.place ?? pagePlace;
    const listed = pageStandsOn(tab, pagePlace)
      ? taskPages
      : pagesElsewhere.includes(tab)
        ? besidePages.get(pagePlaceId(place))
        : undefined;
    const line = listed?.find((each) => each.id === tab.page);
    return line === undefined ? [] : [{ tab, line, place }];
  });
  const label =
    tab === undefined
      ? undefined
      : isTranscriptTab(tab)
        ? (taskAgentLabel(agents, tab.transcript) ?? TAB_WORDS.AGENT)
        : isSubagentTab(tab)
          ? subagents.find((each) => sameTab(each.tab, tab))?.label
          : isFileTab(tab)
            ? tab.file
            : isChangesTab(tab)
              ? changesLook(tab, agentsOf(tab.changes)).label
              : isPageTab(tab)
                ? pageTabs.find((each) => sameTab(each.tab, tab))?.line.title
                : isTerminalTab(tab)
                  ? TAB_WORDS.TERMINAL
                  : isLocalTab(tab)
                    ? TAB_WORDS.LOCAL
                    : isCloudBrowserTab(tab)
                      ? cloudBrowserLabel(tab.cloudBrowser)
                      : tabLook({ kind: TAB_KIND.PANEL, tab }).label;
  const ownTask = holder === SIDE_PANEL_HOLDER.AGENT || onAgent ? undefined : taskId;
  const tabTask = tab === undefined ? undefined : tabTaskOf(tab, panel.pages, files);
  const besideTask =
    tabTask === undefined || tabTask === ownTask
      ? undefined
      : taskOfTab?.tasks.find((each) => each.id === tabTask);
  const keys = shown && leaving === PANEL_LEAVING.NONE;
  const { heldIds } = agents;
  const { onCarry } = panel;
  const carryToAgent = useCallback(
    (address: Address) => {
      if (address.kind !== ADDRESS.PLACE) return;
      const { place } = address.link;
      if (place.kind !== LINK_PLACE.AGENT && place.kind !== LINK_PLACE.MESSAGE) return;
      if (heldIds === undefined || heldIds.includes(place.agentId)) return;
      onCarry();
    },
    [heldIds, onCarry],
  );
  const tabId = useId();
  const panelId = useId();
  const wiring: PanelWiring | undefined = listing ? undefined : { tab: tabId, panel: panelId };
  const openTerminal = useOpenTerminal(panel, noFocusMove);
  const openLocal = useOpenLocal(panel, noFocusMove);
  const offeredChanges = panel.changes;
  const changesPeople = useChangesPeopleOf(
    useMemo(() => offeredChanges.map((tab) => tab.changes), [offeredChanges]),
  );
  const offers = panelOffers({
    holder,
    taskId,
    panel,
    agents,
    pages: taskPages,
    onNewTerminal: terminalsHere
      ? (agentId: string) => openTerminal(agentId, TERMINAL_ASK.NEW)
      : undefined,
    onNewLocal: localsHere ? (agentId: string) => openLocal(agentId, true) : undefined,
    viewedAgent,
    listedBrowsers,
    cards: {
      agents,
      held: drawnTranscripts,
      pagePlace,
      shownAgent,
      onOpenAgent: (agent) => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent }),
      people: changesPeople,
    },
  });
  if (!panel.open) {
    return panel.toggleAsked ? (
      <ToggleOffers entries={offers} onAnswered={panel.onToggleAskedAnswered} />
    ) : null;
  }

  return (
    <PanelFrame
      panel={panel}
      leaving={leaving}
      onLeft={onLeft}
      edge={edge}
      label="Panel"
      banner={banner}
      switched={switched}
      onLeavingHere={carryToAgent}
      head={
        <>
          {switched && ownActivity !== undefined && phone !== undefined ? (
            <PanelPhoneHead
              back={phone}
              title={listing ? TABS : (label ?? PANEL_LABEL)}
              titleReplayUnmasked={listing || label === undefined}
              listing={listing}
              shown={ownShown}
              onList={() => setOwnListed(true)}
              onCloseShown={tab === undefined ? undefined : () => panel.onClose(tab)}
            />
          ) : null}
          {listing ||
          tab === undefined ||
          besideTask === undefined ||
          taskOfTab === undefined ? null : (
            <TabNotice>
              <p>
                <InlineRef
                  look={INLINE_REF_LOOK.PILL}
                  glyph={<PlanGlyph status={besideTask.status} />}
                  label={besideTask.name}
                  card={
                    <TaskChipCard
                      taskId={besideTask.id}
                      fallback={
                        <HoverCard data-task-card="">
                          <HoverCardHead
                            glyph={<PlanGlyph status={besideTask.status} />}
                            name={besideTask.name}
                          />
                        </HoverCard>
                      }
                    />
                  }
                  onPress={() => taskOfTab.onShowPanelTab(besideTask.id, tab)}
                />
              </p>
              <Button onClick={() => taskOfTab.onShowPanelTab(besideTask.id, tab)}>
                <ReplayUnmask>{BESIDE_WORDS.OPEN_TASK}</ReplayUnmask>
              </Button>
            </TabNotice>
          )}
        </>
      }
      tabs={
        <PanelTabs
          panel={panel}
          holder={holder}
          pinOn={pinOn}
          taskId={taskId}
          pagePlace={pagePlace}
          keys={keys && focused}
          unread={unread}
          agents={agents}
          agentsOf={agentsOf}
          subagents={subagents}
          files={files}
          changes={changes}
          pages={pageTabs}
          terminals={terminals}
          locals={locals}
          cloudBrowsers={cloudBrowsers}
          offers={offers}
          held={drawnTranscripts}
          wiring={wiring}
          handed={handed}
          onOpenAgent={(agent) => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent })}
          shownAgent={shownAgent}
          shown={shown}
          transcriptDoors={transcriptDoors}
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
    >
      {listing ? (
        <Fill ref={setActivitySlot} className="side-panel-content" />
      ) : tab === undefined ? (
        <Fill className="side-panel-content" />
      ) : (
        <FindScope
          className="side-panel-content"
          role="tabpanel"
          id={panelId}
          aria-label={label}
          aria-labelledby={tabId}
          active={keys && focused && !isPageTab(tab) && !isCloudBrowserTab(tab)}
          subject={{ task: taskId, tab }}
        >
          <div
            className="side-panel-keeps contents"
            onInputCapture={() => {
              if (panel.preview !== undefined && sameTab(panel.preview, tab)) panel.onKeep(tab);
            }}
          >
            <HandTabActionsContext.Provider value={(actions) => handTabActions(tab, actions)}>
              <TabContent
                tab={tab}
                taskId={taskId}
                codeFilesRead={holder === SIDE_PANEL_HOLDER.TASK || repositoryPlace !== undefined}
                repositoryPlace={repositoryPlace}
                pagePlace={pagePlace}
                repository={repository}
                files={files}
                pages={pageTabs}
                agents={agents}
                agentsOf={agentsOf}
                standings={standings}
                shown={keys}
                findActive={keys && focused}
                onOpenTarget={onOpenTarget}
                cards={cards}
                onWorkerStatus={views.onWorkerStatus}
                onWorkerHeld={views.onWorkerHeld}
                fileTree={fileTree}
                onBrowseFile={panel.onBrowseFile}
                onFileHistory={panel.onFileHistory}
                onCloseTab={panel.onClose}
                pullRequestViews={panel.pullRequestViews}
                onPullRequestView={panel.onPullRequestView}
                shellsList={shellsList}
                cloudBrowsers={cloudBrowsers}
                cloudDrafts={cloudDrafts}
                transcript={transcript}
                onTabActions={handTabActions}
              />
            </HandTabActionsContext.Provider>
          </div>
        </FindScope>
      )}
    </PanelFrame>
  );
}

function PanelTabsRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="side-panel-tabs flex min-w-0 flex-auto items-center gap-list-gap">
      {children}
    </div>
  );
}

export function SidePanelSkeleton({
  drawing,
  panel,
}: {
  drawing: Omit<SidePanelDrawing, "panel">;
  panel: SidePanelControl;
}): React.JSX.Element {
  return (
    <PanelFrame {...drawing} panel={panel} label="Panel" tabs={null}>
      {null}
    </PanelFrame>
  );
}

const TABS = "Tabs";

const PANEL_THING = "Panel";

const PANEL_LABEL = "Panel";

function PanelPhoneHead({
  back,
  title,
  titleReplayUnmasked,
  listing,
  shown,
  onList,
  onCloseShown,
}: {
  back: { readonly back: string; readonly onBack: () => void };
  title: string;
  titleReplayUnmasked: boolean;
  listing: boolean;
  shown: ShownTab | undefined;
  onList: () => void;
  onCloseShown: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <PhoneHead
      place="panel"
      start={<PhoneBack back={{ label: back.back, onPress: back.onBack }} />}
      title={title}
      titleReplayUnmasked={titleReplayUnmasked}
      end={
        <PlaceMore
          thing={PANEL_THING}
          shown
          replayUnmasked={listing || shown === undefined}
          groups={(opener) => {
            const tabActions =
              listing || shown === undefined
                ? []
                : shown
                    .groups(opener)
                    .map((group) =>
                      group.map((item) =>
                        "items" in item || "panel" in item
                          ? item
                          : { ...item, detail: item.detail ?? shown.label, replayMasked: true },
                      ),
                    );
            return [
              [
                { label: TABS, icon: <ListIcon />, checked: listing, onSelect: onList },
                ...(listing || onCloseShown === undefined
                  ? []
                  : [
                      {
                        ...commandAction(PANEL_COMMAND.CLOSE_TAB, onCloseShown, true),
                        detail: shown?.label ?? title,
                        replayMasked: true,
                      },
                    ]),
              ],
              ...phoneFindGroups(),
              ...tabActions,
            ].filter((group) => group.length > 0);
          }}
        />
      }
    />
  );
}

function PanelFrame({
  panel,
  leaving,
  onLeft,
  edge,
  label,
  tabs,
  banner,
  switched = false,
  head,
  onLeavingHere,
  children,
}: Omit<SidePanelDrawing, "panel"> & {
  panel: Pick<SidePanelControl, "width" | "fullScreen" | "fullScreenOnly" | "onToggleFullScreen">;
  label: string;
  tabs: React.ReactNode;
  banner?: React.ReactNode;
  switched?: boolean;
  head?: React.ReactNode;
  onLeavingHere?: ((address: Address) => void) | undefined;
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
      {panel.fullScreen && !panel.fullScreenOnly && leaving !== PANEL_LEAVING.CLOSE ? (
        <div
          ref={room}
          className="side-panel-room min-w-0 max-w-side-panel flex-none"
          style={{ width: panel.width }}
        />
      ) : null}
      <aside
        ref={aside}
        className="side-panel relative flex min-w-0 max-w-side-panel flex-none flex-col border-l border-border bg-well"
        aria-label={label}
        inert={leaving !== PANEL_LEAVING.NONE}
        data-full-screen={String(panel.fullScreen)}
        data-pane-switch={switched ? "" : undefined}
        data-leaving={leaving === PANEL_LEAVING.NONE ? undefined : leaving}
        data-popover-room=""
        style={panel.fullScreen ? undefined : { width: panel.width }}
      >
        <div className="side-panel-bar">
          {tabs}
          {panel.fullScreenOnly ? null : (
            <FullScreenToggle
              fullScreen={panel.fullScreen}
              leaving={leaving !== PANEL_LEAVING.NONE}
              onToggle={panel.onToggleFullScreen}
            />
          )}
        </div>
        {head}
        {panel.fullScreen ? banner : null}
        {onLeavingHere === undefined ? (
          children
        ) : (
          <OnLeavingHere leaving={onLeavingHere}>{children}</OnLeavingHere>
        )}
        {panel.fullScreen ? null : <ResizeEdge edge={edge} />}
      </aside>
    </>
  );
}
