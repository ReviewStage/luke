import { PRODUCT_SURFACE, type ProductSurface } from "@repo/features/analytics";
import { LINK_PLACE, type LinkPlace } from "@repo/features/link-grammar";
import type { PagePlace } from "@repo/features/page-wire";
import {
  type ChangesStripTab,
  type PageStripTab,
  pullRequestLabelOf,
  STRIP_TAB_KIND,
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
  type FixedSidePanelTab,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TAB_KIND,
  type SidePanelTab,
} from "./use-side-panel.js";

/**
 * strip-tab-kinds.ts -- what each kind of strip tab answers wherever the panel asks of it: what it is called, how it looks, which product surface it shows, and the link that names it.
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

/**
 * The surface each word shows that names its own: the task's Inbox and its
 * comments. Note that every other word shows the task itself: the column's
 * Overview, the description of old, and a word an earlier version kept.
 */
const WORD_SURFACE: ReadonlyMap<string, ProductSurface> = new Map([
  [SIDE_PANEL_TAB.INBOX, PRODUCT_SURFACE.INBOX],
  [SIDE_PANEL_TAB.COMMENTS, PRODUCT_SURFACE.COMMENTS],
]);

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
 */
interface StripTabKindDeclaration<K extends StripTabKind> {
  readonly title: (tab: KindTab<K>, names: TabNames) => string | undefined;
  readonly untitled: (tab: KindTab<K>) => string;
  readonly look: (tab: KindTab<K>, known: TabKnown) => TabSubject;
  readonly surface: (tab: KindTab<K>, taskId: string) => TabSurface;
  readonly link: (tab: KindTab<K>, holder: PagePlace) => LinkPlace | undefined;
}

/** No link, for a kind whose thing has no link of its own. */
const NO_LINK = (): undefined => undefined;

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
      surface: WORD_SURFACE.get(tab) ?? PRODUCT_SURFACE.TASK,
      of: taskId,
    }),
    link: NO_LINK,
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
  },
  [STRIP_TAB_KIND.TRANSCRIPT]: {
    title: (tab, names) => names.agent(tab.transcript),
    untitled: () => TAB_WORDS.AGENT,
    look: () => ({ kind: TAB_KIND.DRAFT }),
    surface: surfaceOf(PRODUCT_SURFACE.AGENT),
    link: NO_LINK,
  },
  [STRIP_TAB_KIND.DRAFT]: {
    title: () => TAB_WORDS.NEW_AGENT,
    untitled: () => TAB_WORDS.NEW_AGENT,
    look: () => ({ kind: TAB_KIND.DRAFT }),
    surface: surfaceOf(PRODUCT_SURFACE.AGENT),
    link: NO_LINK,
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
  },
  [STRIP_TAB_KIND.FILE]: {
    title: (tab, names) => names.file(tab.file),
    untitled: (tab) => fileName(tab.file),
    look: (tab) => ({ kind: TAB_KIND.FILE, path: tab.file }),
    surface: surfaceOf(PRODUCT_SURFACE.FILES),
    link: NO_LINK,
  },
  [STRIP_TAB_KIND.CHANGES]: {
    title: (tab, names) => names.pullRequest(tab),
    untitled: () => TAB_WORDS.PULL_REQUEST,
    look: (_tab, known) => ({ kind: TAB_KIND.CHANGES, pullRequest: known.pullRequest }),
    surface: surfaceOf(PRODUCT_SURFACE.PULL_REQUEST),
    // A Changes tab on another pull request of the agent's repository, by its number, is no place a link names.
    link: (tab) =>
      tab.number === undefined ? { kind: LINK_PLACE.CHANGES, agentId: tab.changes } : undefined,
  },
  [STRIP_TAB_KIND.TERMINAL]: {
    title: (tab) => tab.title,
    untitled: (tab) => tab.title,
    look: (tab) => ({ kind: TAB_KIND.TERMINAL, title: tab.title }),
    surface: surfaceOf(PRODUCT_SURFACE.TERMINAL),
    link: NO_LINK,
  },
  [STRIP_TAB_KIND.LOCAL]: {
    title: (tab) => tab.title,
    untitled: (tab) => tab.title,
    look: (tab) => ({ kind: TAB_KIND.LOCAL, title: tab.title }),
    surface: surfaceOf(PRODUCT_SURFACE.TERMINAL),
    link: NO_LINK,
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
  },
  [STRIP_TAB_KIND.CLOUD_BROWSER]: {
    title: (tab, names) => names.browser(tab.cloudBrowser),
    untitled: () => TAB_WORDS.BROWSER,
    look: () => ({ kind: TAB_KIND.BROWSER, title: undefined }),
    surface: surfaceOf(PRODUCT_SURFACE.BROWSER),
    link: NO_LINK,
  },
} as const satisfies { readonly [K in StripTabKind]: StripTabKindDeclaration<K> };

/** The declaration of a tab's kind, over any tab. Note that each entry is read only with a tab of its own kind, which is what makes the widening sound. */
function declarationOf(tab: AnyKindTab): StripTabKindDeclaration<StripTabKind> {
  return STRIP_TAB_KINDS[stripTabKind(tab)] as unknown as StripTabKindDeclaration<StripTabKind>;
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
