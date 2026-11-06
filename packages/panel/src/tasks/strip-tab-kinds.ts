import { PRODUCT_SURFACE, type ProductSurface } from "@repo/features/analytics";
import { LINK_PLACE, type LinkPlace } from "@repo/features/link-grammar";
import type { PagePlace } from "@repo/features/page-wire";
import {
  type ChangesStripTab,
  type PageStripTab,
  pullRequestLabelOf,
  STRIP_TAB_KIND,
  type StripTab,
  type StripTabKind,
  type SubagentStripTab,
  stripTabKind,
  TAB_WORDS,
  tabKey,
} from "@repo/ui/tab-strip-model";
import { GLYPH_STATE } from "../state-glyph.js";
import { fileName } from "./file-ref-model.js";
import { type PlanStanding, TAB_KIND, type TabSubject } from "./tab-look.js";
import { isOverviewTab, type MainTab } from "./use-main-tabs.js";
import {
  DRAWN_KINDS,
  type DrawnTabs,
  drawsChanges,
  drawsSubagent,
  type FixedSidePanelTab,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TAB_KIND,
  SIDE_PANEL_TABS,
  type SidePanelTab,
} from "./use-side-panel.js";
import type { ShellTab } from "./use-terminal-session.js";

/**
 * strip-tab-kinds.ts -- what each kind of strip tab answers wherever the panel asks of it: what it is called, how it looks, which product surface it shows, the link that names it, and how it lives: closed, reopened, idle, pinned, kept, previewed, and found in.
 *
 * A tab of either strip is of one kind (`STRIP_TAB_KIND`), and every place
 * that asks what a tab is called, wears, shows, or links to reads that kind's
 * entry here (`STRIP_TAB_KINDS`), typed over every kind, so a kind added
 * without its answers fails to compile rather than falling to a default at
 * each place that asks. A word tab answers through its word's own tables:
 * the side panel's fixed kinds (`SIDE_PANEL_TAB_KIND`) and the column's
 * Overview (`MAIN_TAB`). Each answer takes the tab and only what the place
 * asking already holds: the names it reads (`TabNames`), what it knows of
 * the thing a tab shows (`TabKnown`), the task, or the place holding the
 * panel.
 *
 * Note that the strips' own modules read this table, as this table reads
 * their vocabulary, so nothing here reads theirs as the module loads: only
 * as an answer is asked for.
 */

/** What a strip's word tab is: the column's Overview or one of the side panel's fixed kinds. */
type WordTab = Extract<MainTab, string> | FixedSidePanelTab;

/** A tab of either strip, of one kind. */
type KindTab<K extends StripTabKind> = K extends typeof STRIP_TAB_KIND.WORD
  ? WordTab
  : Extract<SidePanelTab | MainTab, { readonly kind: K }>;

/** A tab of either strip. */
type AnyKindTab = KindTab<StripTabKind>;

/** What a Page tab is called where nothing names its page, and how a page the window does not read looks. */
const PAGE_WORDS = "Page";

/** What a subagent's tab is called where the window's history names it. */
const WORKER_WORDS = "Worker";

/** How a subagent's tab looks where nothing of it is known. */
const SUBAGENT_WORDS = "Subagent";

/** How a kind's tab is pinned: never, to the sidebar on its task, or as its agent, on the account. */
export const TAB_PIN = {
  NONE: "none",
  SIDEBAR: "sidebar",
  ACCOUNT: "account",
} as const;

export type TabPin = (typeof TAB_PIN)[keyof typeof TAB_PIN];

/**
 * The surface each word shows that names its own: the task's Inbox and its
 * comments. Note that every other word shows the task itself: the column's
 * Overview, the description of old, and a word an earlier version kept.
 */
function wordSurface(tab: WordTab): ProductSurface {
  if (tab === SIDE_PANEL_TAB.INBOX) return PRODUCT_SURFACE.INBOX;
  if (tab === SIDE_PANEL_TAB.COMMENTS) return PRODUCT_SURFACE.COMMENTS;
  return PRODUCT_SURFACE.TASK;
}

/**
 * How the place asking names what a tab shows, each by what the place
 * reads of it: an agent by its id, a worker, a file by its path, a pull
 * request, a page, and a cloud Browser tab by its id. None where the place
 * reads nothing naming it.
 */
export interface TabNames {
  readonly agent: (agentId: string) => string | undefined;
  readonly subagent: (tab: SubagentStripTab) => string | undefined;
  readonly file: (path: string) => string;
  readonly pullRequest: (tab: ChangesStripTab) => string;
  readonly page: (tab: PageStripTab) => string | undefined;
  readonly browser: (cloudBrowser: string) => string | undefined;
}

/** What a place knows of the thing a tab shows, where it knows anything: the task, the agent, its pull request. */
export interface TabKnown {
  readonly plan?: PlanStanding | undefined;
  readonly agent?: Omit<Extract<TabSubject, { kind: typeof TAB_KIND.AGENT }>, "kind"> | undefined;
  readonly pullRequest?: Extract<TabSubject, { kind: typeof TAB_KIND.CHANGES }>["pullRequest"];
}

/**
 * What the open task draws, which a tab closed on it is drawn again by: the
 * task's agents, archived ones left out, the agents whose tabs its column has
 * open, every agent of the task, an archived one among them, and its pages
 * by id, each none while unread.
 */
export interface TaskDraws {
  readonly agents: readonly string[] | undefined;
  readonly openAgents: DrawnTabs["agents"];
  readonly taskAgents: readonly string[] | undefined;
  readonly pages: readonly string[] | undefined;
}

/** Whether a kind's tab is kept across a launch in each strip that holds it. */
interface KeptIn {
  readonly column: boolean;
  readonly sidePanel: boolean;
}

/** The surface a tab shows and which one of its kind, without which strip stands it. */
interface TabSurface {
  readonly surface: ProductSurface;
  readonly of: string;
}

/**
 * What a kind declares of its tab: what it is called (`title`) by the names
 * the place reads, and what it is called where they name nothing
 * (`untitled`); how it looks by what the place knows (`look`); the product
 * surface it shows on its task (`surface`); and the link naming it on the
 * place holding the panel (`link`), none where nothing links to it.
 *
 * And how it lives: whether its closed tab is drawn again on a reopen by
 * what the task draws (`drawsAgain`); whether a close puts it on the ⇧⌘T
 * stack (`reopens`); whether its close ends the session it stands for
 * (`endsSession`); whether it closes itself once idle (`closesIdle`); how it
 * is pinned (`pin`); whether each strip keeps it across a launch (`kept`);
 * whether a link opens it as a preview (`previews`); whether the window's
 * find reaches its body (`takesFind`); and whether it never closes nor
 * moves (`stays`).
 */
interface StripTabKindDeclaration<K extends StripTabKind> {
  readonly title: (tab: KindTab<K>, names: TabNames) => string | undefined;
  readonly untitled: (tab: KindTab<K>) => string;
  readonly look: (tab: KindTab<K>, known: TabKnown) => TabSubject;
  readonly surface: (tab: KindTab<K>, taskId: string) => TabSurface;
  readonly link: (tab: KindTab<K>, holder: PagePlace) => LinkPlace | undefined;
  readonly drawsAgain: (tab: KindTab<K>, draws: TaskDraws) => boolean;
  readonly reopens: boolean;
  readonly endsSession: boolean;
  readonly closesIdle: boolean;
  readonly pin: (tab: KindTab<K>) => TabPin;
  readonly kept: KeptIn;
  readonly previews: boolean;
  readonly takesFind: boolean;
  readonly stays: (tab: KindTab<K>) => boolean;
}

/** No link, for a kind whose thing has no link of its own. */
const NO_LINK = (): undefined => undefined;

/** Yes, whatever the tab and whatever the task draws. */
const ALWAYS = (): boolean => true;

/** No, whatever the tab. */
const NEVER = (): boolean => false;

/** A kind that is never pinned. */
const UNPINNED = (): TabPin => TAB_PIN.NONE;

/** A kind pinned to the sidebar on its task. */
const PINNED_TO_SIDEBAR = (): TabPin => TAB_PIN.SIDEBAR;

/** A kind kept across a launch in no strip. */
const KEPT_NOWHERE: KeptIn = { column: false, sidePanel: false };

/** What a word tab is called: Overview, or its fixed kind's word. */
function wordTitle(tab: WordTab): string {
  return isOverviewTab(tab) ? TAB_WORDS.OVERVIEW : SIDE_PANEL_TAB_KIND[tab].label;
}

/** The surface an object tab shows, keyed by its tab. */
function surfaceOf(surface: ProductSurface) {
  return (tab: Exclude<AnyKindTab, WordTab>): TabSurface => ({ surface, of: tabKey(tab) });
}

/**
 * Each kind's answers, a missing kind failing to compile. A transcript's tab
 * looks as a draft's does and has no link, and a Local tab and a cloud
 * Browser tab have no link, as no place answered otherwise before this table.
 */
const STRIP_TAB_KINDS = {
  [STRIP_TAB_KIND.WORD]: {
    title: wordTitle,
    untitled: wordTitle,
    look: (tab, known) =>
      isOverviewTab(tab)
        ? { kind: TAB_KIND.OVERVIEW }
        : { kind: TAB_KIND.PANEL, tab, plan: known.plan },
    surface: (tab, taskId) => ({
      surface: wordSurface(tab),
      of: taskId,
    }),
    link: NO_LINK,
    // The column's Overview, and of the side panel's fixed kinds those it draws today, the retired ones never.
    drawsAgain: (tab) => isOverviewTab(tab) || DRAWN_KINDS.some((kind) => kind === tab),
    reopens: true,
    endsSession: false,
    closesIdle: false,
    pin: (tab) => (SIDE_PANEL_TABS.some((kind) => kind === tab) ? TAB_PIN.SIDEBAR : TAB_PIN.NONE),
    kept: { column: true, sidePanel: true },
    previews: false,
    takesFind: true,
    stays: isOverviewTab,
  },
  [STRIP_TAB_KIND.AGENT]: {
    title: (tab, names) => names.agent(tab.agent),
    untitled: () => TAB_WORDS.AGENT,
    look: (_tab, known) => ({
      kind: TAB_KIND.AGENT,
      name: known.agent?.name,
      agent: known.agent?.agent,
    }),
    surface: surfaceOf(PRODUCT_SURFACE.AGENT),
    link: NO_LINK,
    drawsAgain: (tab, draws) => draws.agents === undefined || draws.agents.includes(tab.agent),
    reopens: true,
    endsSession: false,
    closesIdle: true,
    pin: () => TAB_PIN.ACCOUNT,
    kept: { column: true, sidePanel: false },
    previews: true,
    takesFind: true,
    stays: NEVER,
  },
  [STRIP_TAB_KIND.TRANSCRIPT]: {
    title: (tab, names) => names.agent(tab.transcript),
    untitled: () => TAB_WORDS.AGENT,
    look: () => ({ kind: TAB_KIND.DRAFT }),
    surface: surfaceOf(PRODUCT_SURFACE.AGENT),
    link: NO_LINK,
    drawsAgain: ALWAYS,
    reopens: true,
    endsSession: false,
    closesIdle: true,
    pin: UNPINNED,
    kept: KEPT_NOWHERE,
    previews: true,
    takesFind: true,
    stays: NEVER,
  },
  [STRIP_TAB_KIND.DRAFT]: {
    title: () => TAB_WORDS.NEW_AGENT,
    untitled: () => TAB_WORDS.NEW_AGENT,
    look: () => ({ kind: TAB_KIND.DRAFT }),
    surface: surfaceOf(PRODUCT_SURFACE.AGENT),
    link: NO_LINK,
    drawsAgain: ALWAYS,
    // A draft's close lets its draft go, so nothing opens it again, nor does it close for being idle.
    reopens: false,
    endsSession: false,
    closesIdle: false,
    pin: UNPINNED,
    kept: KEPT_NOWHERE,
    previews: true,
    takesFind: true,
    stays: NEVER,
  },
  [STRIP_TAB_KIND.SUBAGENT]: {
    title: (tab, names) => names.subagent(tab),
    untitled: () => WORKER_WORDS,
    look: () => ({
      kind: TAB_KIND.SUBAGENT,
      name: SUBAGENT_WORDS,
      model: undefined,
      state: GLYPH_STATE.REST,
    }),
    surface: surfaceOf(PRODUCT_SURFACE.SUBAGENT),
    // A worker's tab is its agent's, linked by the agent alone; a worker of the app's own is drawn nowhere a link opens.
    link: (tab, holder) => {
      const agent = tab.delegation?.agent ?? ("agentId" in holder ? holder.agentId : undefined);
      return agent === undefined
        ? undefined
        : { kind: LINK_PLACE.WORKER, agentId: agent, callId: tab.subagent };
    },
    drawsAgain: (tab, draws) => drawsSubagent(tab, { agents: draws.openAgents, subagents: [] }),
    reopens: true,
    endsSession: false,
    closesIdle: true,
    pin: UNPINNED,
    kept: KEPT_NOWHERE,
    previews: true,
    takesFind: true,
    stays: NEVER,
  },
  [STRIP_TAB_KIND.FILE]: {
    title: (tab, names) => names.file(tab.file),
    untitled: (tab) => fileName(tab.file),
    look: (tab) => ({ kind: TAB_KIND.FILE, path: tab.file }),
    surface: surfaceOf(PRODUCT_SURFACE.FILES),
    link: NO_LINK,
    drawsAgain: ALWAYS,
    reopens: true,
    endsSession: false,
    closesIdle: true,
    pin: PINNED_TO_SIDEBAR,
    kept: KEPT_NOWHERE,
    previews: true,
    takesFind: true,
    stays: NEVER,
  },
  [STRIP_TAB_KIND.CHANGES]: {
    title: (tab, names) => names.pullRequest(tab),
    untitled: () => TAB_WORDS.PULL_REQUEST,
    look: (_tab, known) => ({ kind: TAB_KIND.CHANGES, pullRequest: known.pullRequest }),
    surface: surfaceOf(PRODUCT_SURFACE.PULL_REQUEST),
    // A Changes tab on another pull request of the agent's repository, by its number, is no place a link names.
    link: (tab) =>
      tab.number === undefined ? { kind: LINK_PLACE.CHANGES, agentId: tab.changes } : undefined,
    drawsAgain: (tab, draws) => drawsChanges(tab, { taskAgents: draws.taskAgents }),
    reopens: true,
    endsSession: false,
    closesIdle: true,
    pin: PINNED_TO_SIDEBAR,
    kept: { column: false, sidePanel: true },
    previews: true,
    takesFind: true,
    stays: NEVER,
  },
  [STRIP_TAB_KIND.TERMINAL]: {
    title: (tab) => tab.title,
    untitled: (tab) => tab.title,
    look: (tab) => ({ kind: TAB_KIND.TERMINAL, title: tab.title }),
    surface: surfaceOf(PRODUCT_SURFACE.TERMINAL),
    link: NO_LINK,
    drawsAgain: ALWAYS,
    // A shell ends as its tab closes, since the tab is the only place it stands, so nothing opens it again.
    reopens: false,
    endsSession: true,
    closesIdle: false,
    pin: UNPINNED,
    kept: KEPT_NOWHERE,
    previews: true,
    takesFind: true,
    stays: NEVER,
  },
  [STRIP_TAB_KIND.LOCAL]: {
    title: (tab) => tab.title,
    untitled: (tab) => tab.title,
    look: (tab) => ({ kind: TAB_KIND.LOCAL, title: tab.title }),
    surface: surfaceOf(PRODUCT_SURFACE.TERMINAL),
    link: NO_LINK,
    drawsAgain: ALWAYS,
    // A shell ends as its tab closes, since the tab is the only place it stands, so nothing opens it again.
    reopens: false,
    endsSession: true,
    closesIdle: false,
    pin: UNPINNED,
    kept: KEPT_NOWHERE,
    previews: true,
    takesFind: true,
    stays: NEVER,
  },
  [STRIP_TAB_KIND.PAGE]: {
    title: (tab, names) => names.page(tab),
    untitled: () => PAGE_WORDS,
    look: () => ({ kind: TAB_KIND.PAGE, title: PAGE_WORDS }),
    surface: surfaceOf(PRODUCT_SURFACE.PAGE),
    link: (tab, holder) =>
      "taskId" in holder
        ? { kind: LINK_PLACE.PAGE, planId: holder.taskId, pageId: tab.page }
        : { kind: LINK_PLACE.PAGE, agentId: holder.agentId, pageId: tab.page },
    // A task's pages not read yet pass over no tab, and once read, a page gone since is passed over.
    drawsAgain: (tab, draws) => draws.pages === undefined || draws.pages.includes(tab.page),
    reopens: true,
    endsSession: false,
    closesIdle: true,
    pin: UNPINNED,
    kept: KEPT_NOWHERE,
    previews: true,
    // A page draws in a frame of its own, which no find of the window reaches.
    takesFind: false,
    stays: NEVER,
  },
  [STRIP_TAB_KIND.CLOUD_BROWSER]: {
    title: (tab, names) => names.browser(tab.cloudBrowser),
    untitled: () => TAB_WORDS.BROWSER,
    look: () => ({ kind: TAB_KIND.BROWSER, title: undefined }),
    surface: surfaceOf(PRODUCT_SURFACE.BROWSER),
    link: NO_LINK,
    drawsAgain: ALWAYS,
    reopens: true,
    endsSession: false,
    // Only the "+" opens a cloud Browser tab again, so it never closes for being idle.
    closesIdle: false,
    pin: UNPINNED,
    kept: KEPT_NOWHERE,
    previews: true,
    // Its page is drawn on a canvas, which no find of the window reaches.
    takesFind: false,
    stays: NEVER,
  },
} as const satisfies { readonly [K in StripTabKind]: StripTabKindDeclaration<K> };

/** The declaration of a tab's kind, over any tab. Note that each entry is read only with a tab of its own kind, which is what makes the widening sound. */
function declarationOf(tab: StripTab): StripTabKindDeclaration<StripTabKind> {
  return STRIP_TAB_KINDS[stripTabKind(tab)] as unknown as StripTabKindDeclaration<StripTabKind>;
}

/** A tab as its kind's answers take it. Note that a word an earlier version kept reads as a word tab, which its kind's answers take as any other word. */
function asKindTab(tab: StripTab): AnyKindTab {
  return tab as AnyKindTab;
}

/**
 * The names a place that reads nothing of a tab's thing gives it: no agent,
 * worker, or page, a file by its name, a Pull request by its word and its
 * number where it names one, and a Browser tab by its word.
 */
export const UNREAD_TAB_NAMES: TabNames = {
  agent: () => undefined,
  subagent: () => undefined,
  file: fileName,
  pullRequest: (tab) =>
    tab.number === undefined
      ? TAB_WORDS.PULL_REQUEST
      : pullRequestLabelOf({ number: tab.number, title: TAB_WORDS.PULL_REQUEST }),
  page: () => undefined,
  browser: () => TAB_WORDS.BROWSER,
};

/** What a tab is called by the names the place reads; none where they name nothing. */
export function stripTabTitle(tab: AnyKindTab, names: TabNames): string | undefined {
  return declarationOf(tab).title(tab, names);
}

/** What a tab is called where the names the place reads name nothing: its kind's word. */
export function untitledStripTab(tab: AnyKindTab): string {
  return declarationOf(tab).untitled(tab);
}

/** How a tab looks, from what the place drawing it knows of what it shows. */
export function stripTabLook(tab: AnyKindTab, known: TabKnown): TabSubject {
  return declarationOf(tab).look(tab, known);
}

/** The product surface a tab of a task shows, and which one of its kind. */
export function stripTabSurface(tab: AnyKindTab, taskId: string): TabSurface {
  return declarationOf(tab).surface(tab, taskId);
}

/** The place a tab of the side panel shows, on the task or the agent's page holding the panel; none where nothing links to it. */
export function stripTabLink(tab: AnyKindTab, holder: PagePlace): LinkPlace | undefined {
  return declarationOf(tab).link(tab, holder);
}

/** Whether the open task's strips draw a tab closed on it again, by what the task draws. */
export function stripTabDrawsAgain(tab: StripTab, draws: TaskDraws): boolean {
  return declarationOf(tab).drawsAgain(asKindTab(tab), draws);
}

/** Whether a tab's close puts it on the stack of closed tabs ⇧⌘T opens again. */
export function stripTabReopens(tab: StripTab): boolean {
  return declarationOf(tab).reopens;
}

/** Whether a tab's close ends the shell session it stands for, a Terminal's or a Local tab's. */
export function stripTabEndsSession(tab: StripTab): tab is ShellTab {
  return declarationOf(tab).endsSession;
}

/** Whether a tab closes itself once idle, unless it is pinned or its agent is awake (`use-idle-tabs.ts`). */
export function stripTabClosesIdle(tab: StripTab): boolean {
  return declarationOf(tab).closesIdle;
}

/** How a tab is pinned: never, to the sidebar on its task, or as its agent on the account. */
export function stripTabPin(tab: StripTab): TabPin {
  return declarationOf(tab).pin(asKindTab(tab));
}

/** Whether each strip that holds a tab keeps it across a launch. */
export function stripTabKept(tab: StripTab): KeptIn {
  return declarationOf(tab).kept;
}

/** Whether a link opens a tab as a preview, as against the side panel's fixed kinds, which stand as the task's own and are only ever chosen. */
export function stripTabPreviews(tab: StripTab): boolean {
  return declarationOf(tab).previews;
}

/** Whether the window's find reaches a tab's body. */
export function stripTabTakesFind(tab: StripTab): boolean {
  return declarationOf(tab).takesFind;
}

/** Whether a tab never closes nor moves: the column's Overview. */
export function stripTabStays(tab: StripTab): boolean {
  return declarationOf(tab).stays(asKindTab(tab));
}
