import type { CodeRef } from "@sidecar/hosted/plan-wire";
import { Option, Schema } from "effect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fileName } from "./code-pane-model";

/**
 * use-side-panel.ts -- the open plan's side panel: whether it is shown, which tabs it holds and which is chosen, and how wide, kept across launches.
 *
 * The plan's document is always the page's main content; what supports it
 * (the whiteboard, the code Luke has on screen, what was said on the plan's
 * calls, what Luke's planning model wrote and ran on them, and each coding
 * agent started on the plan) stands in a panel at the window's right that
 * the developer opens and closes, as every devtool
 * window's secondary sidebar does. The one thing that opens it on its own is
 * Luke first drawing on a plan's board or first showing its code
 * (`use-panel-arrivals.ts`), once per plan and kind, and a coding agent
 * just started, whose tab opens selected. Not to be confused with "the
 * panel", which in this renderer is Luke's whole surface.
 *
 * A fixed tab stands in the strip only once the open plan has used it: its
 * board holds something, Luke showed code on it, a call on it has a line,
 * or Luke's planning model took a turn on it. So a new plan has no tab,
 * and what arrives on it adds its tab as it arrives, never taking the
 * chosen one's place. The developer's own choices lie over that, per plan:
 * a tab they open from the "+" or its shortcut stands on that plan though
 * it holds nothing, and one they close stays closed on that plan however
 * much more arrives, until they open it again. The tab chosen is the
 * window's rather than any plan's, so a chosen tab the open plan does not
 * have reads as the first it does.
 *
 * The four fixed kinds are a constant; the agent tabs are the plan's, one
 * per agent, drawn after them, and come and go with the plan. An agent's
 * tab closes as any other does, which closes the view and leaves the agent
 * running, and the "+" opens it again; the agents whose tabs were closed
 * are kept, so a closed tab stays closed across a launch, and an agent
 * started since opens its tab. A kept tab naming an agent the open plan
 * has none of reads as the first open fixed tab, so leaving a plan or
 * opening another never shows a tab with nothing behind it, while the kept
 * value stands until the next choice: the plan whose agent it names shows
 * it again. A subagent's tab, opened from its call in the Work tab, from
 * the "+", or from a delegation's row in an agent's tab, follows the
 * agents: it is held to the open plan's work, or to the plan's open agent
 * tabs where one of them delegated, the same way, it closes, and it is
 * kept nowhere, so a launch opens none. A draft
 * agent's tab, opened from the "+", stands after the agents while the open
 * plan holds the draft, and is kept nowhere either; closing it lets the
 * draft go, which is its owner's to do. A file's tab, opened from a snippet
 * in the Code tab or from the "+", is the first kind that stands many
 * times, one per file: it follows the subagents, is held to the files Luke
 * showed on the open plan the same way, closes, and is kept nowhere.
 * Opening a file that already has a tab chooses that tab and moves its lit
 * lines to the snippet opened.
 *
 * The panel holds tabs the way an editor's pane does: the developer closes
 * the ones they do not want, and the "+" or a tab's shortcut opens one again
 * in its place in the order. Closing the chosen tab chooses the one viewed
 * before it on that plan that still stands, as an editor or a browser
 * does, kept with the plan's other choices so it holds across a launch;
 * only where none does, its neighbour. Closing the last leaves the panel
 * open and empty rather than shutting it.
 *
 * A tab of any kind is dragged or moved from the keyboard to any place in
 * the strip, among tabs of every kind, as an editor's are, and the plan
 * keeps the strip's order from then on with its other choices: a tab closed
 * and opened again stands where it stood, and one never moved, such as one
 * just opened, stands after those that were, in its kind's place. The
 * subagent, draft, and file tabs are kept nowhere, so they keep their place
 * until a launch and then drop out of the order, leaving the rest as they
 * stood.
 *
 * A fixed tab, an agent's, or a file's may be pinned to the sidebar, where
 * it stands under Pinned beside the pinned plans, newest pinned first, and
 * opens its plan on that tab from any plan. The strip draws a pinned tab as
 * it draws any other: it closes, moves, and is closed by Close others the
 * same way, and closing it leaves its pin, which opens it again. A subagent's
 * and a draft's tab is a moment of its agent's or its plan's work, kept
 * nowhere across a launch, so neither is pinned. The pins are every plan's,
 * each with the name the sidebar draws for it, since an agent's is read only
 * while its plan is open; what an earlier version pinned in the strip itself
 * reads as pinned to the sidebar, older than any pin since.
 *
 * These facts are this window's preference rather than anything main
 * holds, so they are kept in the renderer's own storage and read once at
 * mount. What an earlier version kept still reads: the fixed tabs it held
 * open, or every tab before they could close, give the order alone, so a
 * set an earlier launch held open opens no tab on a plan that has not used
 * it, and a kind since retired (`RETIRED_SIDE_PANEL_TAB`) reads as never
 * kept, wherever it was. A fixture run neither draws nor writes them: what it draws is staged,
 * and a capture must not depend on how the last run left the panel.
 *
 * The open panel may also fill the window's work, over the document, as
 * ChatGPT's canvas does. That is a moment's view rather than a preference,
 * so it is kept nowhere: a launch, and a panel shown again, start beside
 * the document. So is ⌘T's ask for the "+" menu, which shows the panel
 * where it was hidden and stands until the "+" opens its menu.
 */

/** The panel's kinds of tab, the fixed four. A kind is one entry here, one row below, and one case where the panel draws it. */
export const SIDE_PANEL_TAB = {
  BOARD: "board",
  CODE: "code",
  TRANSCRIPT: "transcript",
  WORK: "work",
} as const;

/**
 * The kinds an earlier version had and this one does not, which what it kept
 * may still name: History, whose versions now take the whole window
 * (`desktop-version-history.tsx`). Note that a kind is retired here rather
 * than deleted, because a kept state naming one would otherwise not read at
 * all and lose every other choice it holds.
 */
const RETIRED_SIDE_PANEL_TAB = {
  HISTORY: "history",
} as const;

type RetiredSidePanelTab = (typeof RETIRED_SIDE_PANEL_TAB)[keyof typeof RETIRED_SIDE_PANEL_TAB];

const RETIRED_TABS: ReadonlySet<unknown> = new Set(Object.values(RETIRED_SIDE_PANEL_TAB));

export type FixedSidePanelTab = (typeof SIDE_PANEL_TAB)[keyof typeof SIDE_PANEL_TAB];

/** One coding agent's tab, named by the agent it shows. */
export interface AgentSidePanelTab {
  readonly agent: string;
}

/** A worker one of the plan's agents delegated to, as its tab carries it: the agent, and the task it handed over, which the tab names itself by. */
interface SubagentDelegation {
  readonly agent: string;
  readonly task: string;
}

/** One subagent's tab, named by the call that started it: on the open plan's work, or, with the delegation, on one of its agents' turns. */
export interface SubagentSidePanelTab {
  readonly subagent: string;
  /** Absent for the planning worker, whose session the plan's work holds. */
  readonly delegation?: SubagentDelegation;
}

/** The tab of an agent not yet started, named by the key its first message will start it under. */
export interface DraftSidePanelTab {
  readonly draft: string;
}

/** One file's tab, named by the file's path in the open plan's repository. */
export interface FileSidePanelTab {
  readonly file: string;
}

/** A tab of the panel: one of the fixed kinds, one agent's, one subagent's, a draft agent's, or one file's. */
export type SidePanelTab =
  | FixedSidePanelTab
  | AgentSidePanelTab
  | SubagentSidePanelTab
  | DraftSidePanelTab
  | FileSidePanelTab;

/**
 * A file's tab as the panel holds it: the file, the lines lit in it, none
 * for a snippet of the whole file, and how many times it has been opened,
 * so opening the same snippet again brings its lines back into view.
 */
export interface OpenFile {
  readonly path: string;
  readonly range: { readonly startLine: number; readonly endLine: number } | undefined;
  readonly opened: number;
}

/**
 * What the panel knows of a kind of tab. Note that the open tabs are kept
 * as their kinds, so at most one tab of a kind stands, and opening one
 * already open chooses it.
 */
export interface SidePanelTabKind {
  label: string;
}

export const SIDE_PANEL_TAB_KIND = {
  [SIDE_PANEL_TAB.BOARD]: { label: "Board" },
  [SIDE_PANEL_TAB.CODE]: { label: "Code" },
  [SIDE_PANEL_TAB.TRANSCRIPT]: { label: "Transcript" },
  [SIDE_PANEL_TAB.WORK]: { label: "Work" },
} as const satisfies Record<FixedSidePanelTab, SidePanelTabKind>;

/** Every kind of tab, in the order a first launch stands them in and the "+" offers them; the agent tabs follow them. */
export const SIDE_PANEL_TABS: readonly FixedSidePanelTab[] = Object.values(SIDE_PANEL_TAB);

const FIXED_TABS: ReadonlySet<SidePanelTab> = new Set(SIDE_PANEL_TABS);

/** Whether a tab is one of the fixed kinds. */
function isFixedTab(tab: SidePanelTab): tab is FixedSidePanelTab {
  return FIXED_TABS.has(tab);
}

/** Whether a tab is one agent's. */
export function isAgentTab(tab: SidePanelTab): tab is AgentSidePanelTab {
  return !isFixedTab(tab) && "agent" in tab;
}

/** Whether a tab is one subagent's. */
export function isSubagentTab(tab: SidePanelTab): tab is SubagentSidePanelTab {
  return !isFixedTab(tab) && "subagent" in tab;
}

/** Whether a tab is a draft agent's. */
export function isDraftTab(tab: SidePanelTab): tab is DraftSidePanelTab {
  return !isFixedTab(tab) && "draft" in tab;
}

/** Whether a tab is one file's. */
export function isFileTab(tab: SidePanelTab): tab is FileSidePanelTab {
  return !isFixedTab(tab) && "file" in tab;
}

/** Whether two tabs are the same tab. A delegated worker's call names it within its agent, as the service names its conversation, so its tab is the pair. */
export function sameTab(a: SidePanelTab, b: SidePanelTab): boolean {
  if (isAgentTab(a)) return isAgentTab(b) && a.agent === b.agent;
  if (isSubagentTab(a)) {
    return (
      isSubagentTab(b) && a.subagent === b.subagent && a.delegation?.agent === b.delegation?.agent
    );
  }
  if (isDraftTab(a)) return isDraftTab(b) && a.draft === b.draft;
  if (isFileTab(a)) return isFileTab(b) && a.file === b.file;
  return a === b;
}

/** A tab's key for a list that draws one element per tab: a fixed tab's word, the agent's, call's, or draft's own id, which no fixed word spells, or the file's path. */
export function tabKey(tab: SidePanelTab): string {
  if (isAgentTab(tab)) return tab.agent;
  if (isDraftTab(tab)) return tab.draft;
  if (isFileTab(tab)) return tab.file;
  return isSubagentTab(tab) ? tab.subagent : tab;
}

/**
 * How narrow the panel may be dragged, in CSS pixels, and where it starts. It
 * has no greatest width of its own: it is dragged as wide as the document
 * beside it leaves room for (side-panel.tsx), as an editor's secondary side
 * bar is.
 */
export const SIDE_PANEL_WIDTH = {
  MIN: 280,
  DEFAULT: 400,
} as const;

/** Where the preference is kept in the renderer's storage. */
const STORAGE_KEY = "luke.sidePanel";

/**
 * How many agents whose tabs were closed are kept, the latest closed. Note
 * that the agents are every plan's, so the list is held to a bound rather
 * than growing with every agent ever closed; one past it opens again.
 */
const CLOSED_AGENTS_KEPT = 500;

/**
 * How many tabs a plan keeps as viewed, the latest viewed. Note that a tab
 * closed leaves the list as it closes, so the bound only lets go of tabs
 * long unviewed, which a close then passes over for its neighbour.
 */
const RECENT_KEPT = 20;

/**
 * How many plans' own choices of tab are kept, the latest chosen. Note that
 * a plan deleted leaves its entry behind, so the record is held to a bound
 * rather than growing with every plan ever opened; one past it is drawn
 * from what it holds again.
 */
const PLANS_KEPT = 500;

/** A fixed kind as it is kept: one of today's, or one retired, which reads and is then let go (`settled`). */
const sidePanelTabSchema = Schema.Literals([
  ...SIDE_PANEL_TABS,
  ...Object.values(RETIRED_SIDE_PANEL_TAB),
]);
const anyTabSchema = Schema.Union([sidePanelTabSchema, Schema.Struct({ agent: Schema.String })]);

/**
 * How many tabs are kept pinned to the sidebar, the latest pinned. Note that
 * a deleted plan's pins are drawn nowhere and left behind, so the record is
 * held to a bound rather than growing with every plan ever pinned on.
 */
const PINS_KEPT = 100;

/** The tab a pin opens: a fixed one, an agent's, or a file's. */
const pinnableTabSchema = Schema.Union([
  sidePanelTabSchema,
  Schema.Struct({ agent: Schema.String }),
  Schema.Struct({ file: Schema.String }),
]);

/** A tab pinned to the sidebar: its plan, the tab, the name the sidebar draws for it, and when it was pinned. */
const pinnedTabSchema = Schema.Struct({
  plan: Schema.String,
  tab: pinnableTabSchema,
  label: Schema.String,
  at: Schema.Number,
});

/** A tab of a kind the sidebar holds a pin of, of today's kinds. */
export type PinnableTab = Exclude<typeof pinnableTabSchema.Type, RetiredSidePanelTab>;

/** A tab pinned to the sidebar as the hook holds it, of today's kinds alone. */
export interface PinnedTab extends Omit<typeof pinnedTabSchema.Type, "tab"> {
  readonly tab: PinnableTab;
}

/** A tab an earlier version pinned in the strip itself, of any kind but a draft's. */
const stripPinSchema = Schema.Union([
  pinnableTabSchema,
  Schema.Struct({
    subagent: Schema.String,
    delegation: Schema.optionalKey(Schema.Struct({ agent: Schema.String, task: Schema.String })),
  }),
]);

/**
 * The fixed tabs the developer opened on one plan though it held nothing of
 * them, those they closed on it, in the strip's order, the tabs they
 * viewed on it, the latest last, and the strip's order since they first
 * moved a tab on it. A kind is in `opened` or `closed` or neither. The tabs
 * viewed and the order are kept as the chosen tab is, of fixed tabs and
 * agents' alone, since no other stands again across a launch. `pinned` is what an
 * earlier version pinned in the strip, read once into the sidebar's pins and
 * written no more.
 */
const planTabsSchema = Schema.Struct({
  opened: Schema.Array(sidePanelTabSchema),
  closed: Schema.Array(sidePanelTabSchema),
  pinned: Schema.optional(Schema.Array(stripPinSchema)),
  recent: Schema.optional(Schema.Array(anyTabSchema)),
  order: Schema.optional(Schema.Array(anyTabSchema)),
});

/** A plan's own choices as the hook holds them: today's kinds alone, and tabs viewed and an order that may hold any tab, which the record keeps none of. */
interface PlanTabs {
  readonly opened: readonly FixedSidePanelTab[];
  readonly closed: readonly FixedSidePanelTab[];
  readonly recent?: readonly SidePanelTab[] | undefined;
  readonly order?: readonly SidePanelTab[] | undefined;
}

/**
 * The fixed tabs in the order a plan no tab was moved on draws them, which
 * an earlier version's drags set for every plan, the chosen tab, the agents whose
 * tabs were closed, each plan's own choices of fixed tab, by plan id, and
 * the tabs pinned to the sidebar, newest pinned first. The agent tabs are
 * the plan's rather than the panel's to keep, so only the chosen one may
 * name an agent, and the agents kept are those not drawn. Note that `tabs`
 * once held only the open fixed tabs, so what an earlier version kept reads
 * as an order with the kinds it closed last, and that a record with no
 * `pins` is one from before them, whose strip pins are read in their place.
 */
const sidePanelStateSchema = Schema.Struct({
  open: Schema.Boolean,
  tabs: Schema.Array(sidePanelTabSchema),
  tab: Schema.optional(anyTabSchema),
  width: Schema.Number,
  closedAgents: Schema.optional(Schema.Array(Schema.String)),
  plans: Schema.optional(Schema.Record(Schema.String, planTabsSchema)),
  pins: Schema.optional(Schema.Array(pinnedTabSchema)),
});

export type SidePanelState = typeof sidePanelStateSchema.Type;

/**
 * The state the hook holds: the kept one, every fixed kind in `tabs`, the
 * subagent tabs open, by the call that started each, in the order opened,
 * and the file tabs open, in the strip's order. Those are this view's
 * rather than the preference's, so they are kept nowhere, and a subagent's
 * or a file's tab chosen is written as no tab, which the next launch reads
 * as the first.
 */
interface HeldState
  extends Omit<SidePanelState, "tabs" | "tab" | "closedAgents" | "plans" | "pins"> {
  readonly tabs: readonly FixedSidePanelTab[];
  readonly tab?: SidePanelTab | undefined;
  readonly subagents: readonly SubagentSidePanelTab[];
  readonly files: readonly OpenFile[];
  readonly closedAgents: readonly string[];
  readonly plans: Readonly<Record<string, PlanTabs>>;
  readonly pins: readonly PinnedTab[];
}

/** A plan the developer has chosen no fixed tab on. */
const NO_CHOICES: PlanTabs = { opened: [], closed: [] };

/** What was kept before the panel's tabs could close: every tab open, and the one chosen. */
const earlierSidePanelSchema = Schema.Struct({
  open: Schema.Boolean,
  tab: anyTabSchema,
  width: Schema.Number,
});

const storedSidePanel = Schema.fromJsonString(sidePanelStateSchema);
const decodeStored = Schema.decodeUnknownOption(storedSidePanel);
const decodeEarlier = Schema.decodeUnknownOption(Schema.fromJsonString(earlierSidePanelSchema));
const encodeStored = Schema.encodeSync(storedSidePanel);

/** A first launch: closed, the kinds in their own order and none chosen, at the default width. */
const FIRST_LAUNCH: SidePanelState = {
  open: false,
  tabs: SIDE_PANEL_TABS,
  width: SIDE_PANEL_WIDTH.DEFAULT,
};

/** What the panel and its toggle draw, and their presses. */
export interface SidePanelControl {
  open: boolean;
  /** Whether the open panel fills the work column in the document's place. */
  fullScreen: boolean;
  /** Whether ⌘T asked for the "+" menu and the "+" has not yet opened it. */
  newTabAsked: boolean;
  /** The open plan's fixed tabs, in the strip's order. */
  tabs: readonly FixedSidePanelTab[];
  /**
   * The open plan's tabs of any kind in the order the developer moved them
   * into, none until they first move one; the strip draws them first, as
   * they stand here, and every other after them in its kind's place
   * (`inPlanOrder`).
   */
  order: readonly SidePanelTab[];
  /** The fixed tabs the developer closed on the open plan, which stay closed there however much arrives until one is opened again. */
  closedTabs: readonly FixedSidePanelTab[];
  /** Every plan's tabs pinned to the sidebar, newest pinned first. */
  pins: readonly PinnedTab[];
  /** The open subagent tabs in the order opened; they follow the agent tabs, and only those the open plan's work or open agent tabs hold are drawn. */
  subagents: readonly SubagentSidePanelTab[];
  /** The agents whose tabs were closed, which the strip draws none for until one is opened again. */
  closedAgents: readonly string[];
  /** The open file tabs, in the strip's order; they follow the subagent tabs, and only those of files shown on the open plan are drawn. */
  files: readonly OpenFile[];
  /** The tab shown, which is none only while the open plan has no tab open. */
  tab: SidePanelTab | undefined;
  /** The panel's width in CSS pixels, never under {@link SIDE_PANEL_WIDTH}'s least. */
  width: number;
  /** Shows or hides the panel; hiding it leaves full screen too. */
  onToggle: () => void;
  onToggleFullScreen: () => void;
  /** Shows the panel, where it was hidden, and asks its "+" to open its menu, as ⌘T does. */
  onNewTab: () => void;
  /** Says the "+" opened its menu on the ask. */
  onNewTabAnswered: () => void;
  /** Shows the panel on the tab, opening it where it was closed or the open plan has not used it; a fixed tab stays open on that plan. */
  onChoose: (tab: SidePanelTab) => void;
  /** Shows the panel on the tab of the plan given, as `onChoose` does on the open plan: what a pin or a notification asks, the plan opened beside it. */
  onShow: (planId: string, tab: SidePanelTab) => void;
  /** Closes the tab, and only the view: an agent's goes on as it was, and a pin of it stands. Closing the one shown chooses the tab viewed before it on the plan that still stands, else its neighbour, the one after it where there is one. */
  onClose: (tab: SidePanelTab) => void;
  /** Moves the tab to the place `to` in the strip, among tabs of every kind, leaving the chosen one chosen. */
  onMove: (tab: SidePanelTab, to: number) => void;
  /** Pins the open plan's tab to the sidebar under the name given, newest of the pins. */
  onPin: (tab: PinnableTab, label: string) => void;
  onUnpin: (planId: string, tab: PinnableTab) => void;
  /** Names each agent pinned on the plan as its tab is named now, by agent id; an agent named nowhere keeps the name it has. */
  onRenamePins: (planId: string, labels: ReadonlyMap<string, string>) => void;
  /** Shows the panel on the file's tab, opening one at the strip's end where none stands, its lit lines the reference's. */
  onOpenFile: (ref: CodeRef) => void;
  /** Asks for a width; it is held to the least width before it is kept. */
  onResize: (width: number) => void;
}

function clampWidth(width: number): number {
  return Math.max(SIDE_PANEL_WIDTH.MIN, Math.round(width));
}

/**
 * Whether the open plan holds something of each fixed kind: its board any
 * element, any code Luke showed, any call a line, its work any turn, its
 * history any revision. A kind
 * not yet read on the plan is absent, which draws no tab, as nothing does.
 */
export type PlanHolds = Partial<Record<FixedSidePanelTab, boolean | undefined>>;

/** The open plan as the panel draws its fixed tabs: its id, none while no plan is open, and what it holds. */
export interface OpenPlan {
  id: string | undefined;
  holds: PlanHolds;
}

/** What the plan holds for the tabs: its id and its kinds, its agents, or nothing while unread, the planning workers its work holds, by the call that started each, its draft, and the files shown on it. */
export interface DrawnTabs {
  plan: OpenPlan;
  agents: readonly string[] | undefined;
  subagents: readonly string[];
  draft: string | undefined;
  /** The files shown on the plan, by path, whose open tabs the strip draws. */
  files: readonly string[];
}

/** The developer's own choices of fixed tab on the plan. */
function planTabs(held: HeldState, planId: string | undefined): PlanTabs {
  return planId === undefined ? NO_CHOICES : (held.plans[planId] ?? NO_CHOICES);
}

/**
 * `drawn` in the plan's order: each tab `order` holds first, as it stands
 * there, then the rest as they stood. Note that a tab never moved, such as
 * one just opened, so stands after every tab that was.
 */
export function inPlanOrder<T>(
  drawn: readonly T[],
  order: readonly SidePanelTab[],
  tabOf: (each: T) => SidePanelTab,
): T[] {
  const placed = order.flatMap((tab) => drawn.filter((each) => sameTab(tabOf(each), tab)));
  return [...placed, ...drawn.filter((each) => !placed.includes(each))];
}

/** A plan no tab was moved on. */
const NO_ORDER: readonly SidePanelTab[] = [];

/** The plan's order, none until a tab is first moved on it. */
function orderOn(held: HeldState, planId: string | undefined): readonly SidePanelTab[] {
  return planTabs(held, planId).order ?? NO_ORDER;
}

/** The plan's fixed tabs in the strip's order: each it holds something of and was not closed on, and each opened on it. */
function drawnFixed(held: HeldState, plan: OpenPlan): readonly FixedSidePanelTab[] {
  const chosen = planTabs(held, plan.id);
  const open = held.tabs.filter(
    (tab) =>
      chosen.opened.includes(tab) || (!chosen.closed.includes(tab) && plan.holds[tab] === true),
  );
  return inPlanOrder(open, orderOn(held, plan.id), (tab) => tab);
}

/**
 * The state with the plan's choices changed, that plan's kept latest and the
 * oldest plan's let go past the bound. With no plan open there is nothing to
 * keep a choice on, and a change that answers the choices it was handed
 * changes nothing.
 */
function withPlanTabs(
  held: HeldState,
  planId: string | undefined,
  change: (was: PlanTabs) => PlanTabs,
): HeldState {
  if (planId === undefined) return held;
  const was = planTabs(held, planId);
  const choice = change(was);
  if (choice === was) return held;
  const kept = Object.entries(held.plans).filter(([plan]) => plan !== planId);
  return {
    ...held,
    plans: Object.fromEntries([...kept, [planId, choice] as const].slice(-PLANS_KEPT)),
  };
}

/** The state with the fixed tab opened or closed on the plan. */
function withChoice(
  held: HeldState,
  planId: string | undefined,
  tab: FixedSidePanelTab,
  opened: boolean,
): HeldState {
  return withPlanTabs(held, planId, (was) => {
    if ((opened ? was.opened : was.closed).includes(tab)) return was;
    const others = {
      ...was,
      opened: was.opened.filter((each) => each !== tab),
      closed: was.closed.filter((each) => each !== tab),
    };
    return opened
      ? { ...others, opened: [...others.opened, tab] }
      : { ...others, closed: [...others.closed, tab] };
  });
}

/** Whether a tab is of a kind the sidebar holds a pin of: a fixed one, an agent's, or a file's. */
export function isPinnable(tab: SidePanelTab): tab is PinnableTab {
  return isFixedTab(tab) || isAgentTab(tab) || isFileTab(tab);
}

/** Whether the pin is of the plan's tab. */
function pinOf(pin: PinnedTab, planId: string, tab: SidePanelTab): boolean {
  return pin.plan === planId && sameTab(pin.tab, tab);
}

/**
 * The state with the plan's tab pinned, newest of the pins, the oldest let
 * go past the bound; a tab already pinned keeps its place. Note that its
 * stamp is `at` or just after the newest pin's, so no two pins share one,
 * and a pin's stamp tells it from every other.
 */
function withPin(held: HeldState, pin: Omit<PinnedTab, "at">, at: number): HeldState {
  if (held.pins.some((each) => pinOf(each, pin.plan, pin.tab))) return held;
  const newest = held.pins[0]?.at ?? Number.NEGATIVE_INFINITY;
  const pinned = { ...pin, at: Math.max(at, newest + 1) };
  return { ...held, pins: [pinned, ...held.pins].slice(0, PINS_KEPT) };
}

/** The state with the plan's tab no longer pinned. */
function withoutPin(held: HeldState, planId: string, tab: SidePanelTab): HeldState {
  if (!held.pins.some((each) => pinOf(each, planId, tab))) return held;
  return { ...held, pins: held.pins.filter((each) => !pinOf(each, planId, tab)) };
}

/** The state with each agent pinned on the plan named as `labels` names it, and the state as it is where every one already was. */
function withPinsRenamed(
  held: HeldState,
  planId: string,
  labels: ReadonlyMap<string, string>,
): HeldState {
  const renamed = (pin: PinnedTab) => {
    const label =
      pin.plan === planId && isAgentTab(pin.tab) ? labels.get(pin.tab.agent) : undefined;
    return label === undefined || label === pin.label ? pin : { ...pin, label };
  };
  const pins = held.pins.map(renamed);
  return pins.every((pin, at) => pin === held.pins[at]) ? held : { ...held, pins };
}

/**
 * The state with the tabs viewed on the plan, in the order given, as its
 * latest, each taken from where it stood before, and the oldest let go past
 * the bound. Tabs viewed as they already were change nothing.
 */
function withViewed(
  held: HeldState,
  planId: string | undefined,
  viewed: readonly SidePanelTab[],
): HeldState {
  return withPlanTabs(held, planId, (was) => {
    const before = was.recent ?? [];
    const others = before.filter((each) => !viewed.some((tab) => sameTab(tab, each)));
    const recent = [...others, ...viewed].slice(-RECENT_KEPT);
    const same =
      recent.length === before.length &&
      recent.every((tab, at) => before[at] !== undefined && sameTab(tab, before[at]));
    return same ? was : { ...was, recent };
  });
}

/** The state with the tab gone from those viewed on the plan. */
function withoutViewed(held: HeldState, planId: string | undefined, tab: SidePanelTab): HeldState {
  const recent = planTabs(held, planId).recent ?? [];
  if (!recent.some((each) => sameTab(each, tab))) return held;
  return withPlanTabs(held, planId, (was) => ({
    ...was,
    recent: recent.filter((each) => !sameTab(each, tab)),
  }));
}

/**
 * The state with the tab open and chosen. A fixed tab opens on the open
 * plan, where it stands though the plan holds nothing of it; an agent's
 * opens again in its place among the agents, which stand in the order
 * started; a subagent's opens at the end of its own run, and one already
 * open is chosen as it stands, whichever path named its call.
 */
function withTab(held: HeldState, tab: SidePanelTab, planId: string | undefined): HeldState {
  const opened = isFixedTab(tab) ? withChoice(held, planId, tab, true) : held;
  const open = isSubagentTab(tab) ? held.subagents.find((each) => sameTab(each, tab)) : undefined;
  const subagents =
    isSubagentTab(tab) && open === undefined ? [...held.subagents, tab] : held.subagents;
  const files =
    isFileTab(tab) && !held.files.some((each) => each.path === tab.file)
      ? [...held.files, { path: tab.file, range: undefined, opened: 0 }]
      : held.files;
  const closedAgents =
    isAgentTab(tab) && held.closedAgents.includes(tab.agent)
      ? held.closedAgents.filter((each) => each !== tab.agent)
      : held.closedAgents;
  const chosen = open ?? tab;
  return opened === held &&
    subagents === held.subagents &&
    files === held.files &&
    closedAgents === held.closedAgents &&
    chosen === held.tab
    ? held
    : { ...opened, subagents, files, closedAgents, tab: chosen };
}

/** The range a reference lights, none for a whole file. */
function rangeOf(ref: CodeRef): OpenFile["range"] {
  return ref.startLine === undefined || ref.endLine === undefined
    ? undefined
    : { startLine: ref.startLine, endLine: ref.endLine };
}

/** The state with the file's tab open and chosen, its lit lines the reference's, opened once more. */
function withFileOpened(held: HeldState, ref: CodeRef): HeldState {
  const standing = held.files.find((each) => each.path === ref.path);
  const opened: OpenFile = {
    path: ref.path,
    range: rangeOf(ref),
    opened: (standing?.opened ?? 0) + 1,
  };
  const files =
    standing === undefined
      ? [...held.files, opened]
      : held.files.map((each) => (each === standing ? opened : each));
  return { ...held, files, tab: { file: ref.path }, open: true };
}

/**
 * Whether the plan draws the subagent's tab: the planning worker's while
 * the plan's work holds its call, and a delegated worker's while the
 * agent that delegated has its tab open, or until the agents are read, as
 * an agent's own tab stands. `agents` are the open agent tabs.
 */
export function drawsSubagent(
  tab: SubagentSidePanelTab,
  drawn: Pick<DrawnTabs, "agents" | "subagents">,
): boolean {
  if (tab.delegation === undefined) return drawn.subagents.includes(tab.subagent);
  return drawn.agents === undefined || drawn.agents.includes(tab.delegation.agent);
}

/** The open file tabs of files shown on the plan, by path, in the strip's order. */
function drawnFiles(held: HeldState, drawn: DrawnTabs): readonly string[] {
  return held.files.flatMap((each) => (drawn.files.includes(each.path) ? [each.path] : []));
}

/** The plan's agents whose tabs are open, in the order started; nothing while the agents are unread. */
function drawnAgents(
  agents: readonly string[] | undefined,
  closedAgents: readonly string[],
): readonly string[] | undefined {
  return agents?.filter((each) => !closedAgents.includes(each));
}

/** The open subagent tabs the plan draws, in the order opened. */
function drawnSubagents(held: HeldState, drawn: DrawnTabs): readonly SubagentSidePanelTab[] {
  const agents = drawnAgents(drawn.agents, held.closedAgents);
  return held.subagents.filter((each) =>
    drawsSubagent(each, { agents, subagents: drawn.subagents }),
  );
}

/**
 * The strip's tabs in its order: the plan's fixed tabs, the open agents,
 * the draft, the subagent tabs, and the file tabs the plan draws, in the
 * plan's order (`inPlanOrder`). A tab another plan's work holds is not in it.
 */
function stripOf(held: HeldState, drawn: DrawnTabs): readonly SidePanelTab[] {
  const agents = drawnAgents(drawn.agents, held.closedAgents) ?? [];
  const kinds = [
    ...drawnFixed(held, drawn.plan),
    ...agents.map((agent) => ({ agent })),
    ...(drawn.draft === undefined ? [] : [{ draft: drawn.draft }]),
    ...drawnSubagents(held, drawn),
    ...drawnFiles(held, drawn).map((file) => ({ file })),
  ];
  return inPlanOrder(kinds, orderOn(held, drawn.plan.id), (tab) => tab);
}

/**
 * The tab the panel shows on the plan: the chosen one as `shownTab` holds it
 * to the plan, else the plan's first open agent's.
 */
function shownIn(held: HeldState, drawn: DrawnTabs): SidePanelTab | undefined {
  const agents = drawnAgents(drawn.agents, held.closedAgents);
  const first = agents?.[0];
  return (
    shownTab(
      held.tab,
      drawnFixed(held, drawn.plan),
      agents,
      drawn.subagents,
      drawn.draft,
      drawn.files,
    ) ?? (first === undefined ? undefined : { agent: first })
  );
}

/**
 * The state with the tab about to be chosen viewed on the plan, after the
 * one shown until then. Note that the one shown is viewed too, because the
 * tab a close returns to is the one last looked at, which need never have
 * been chosen: the first a launch or a plan shows, or one standing in.
 */
function withChosenViewed(held: HeldState, tab: SidePanelTab, drawn: DrawnTabs): HeldState {
  const shown = shownIn(held, drawn);
  const viewed = shown === undefined || sameTab(shown, tab) ? [tab] : [shown, tab];
  return withViewed(held, drawn.plan.id, viewed);
}

/**
 * The tab chosen in place of the closed one, from `closed`, the state it
 * has left: the latest viewed on the plan that still stands in the strip,
 * or where none does, the tab after it in the strip as it stood, or the one
 * before.
 */
function replacementOf(
  held: HeldState,
  closed: HeldState,
  tab: SidePanelTab,
  drawn: DrawnTabs,
): SidePanelTab | undefined {
  const standing = stripOf(closed, drawn);
  const recent = planTabs(closed, drawn.plan.id).recent ?? [];
  const viewed = recent.findLast((each) => standing.some((other) => sameTab(other, each)));
  if (viewed !== undefined) return viewed;
  const strip = stripOf(held, drawn);
  const place = strip.findIndex((other) => sameTab(other, tab));
  return strip[place + 1] ?? strip[place - 1];
}

/**
 * The state with the tab closed, gone from those viewed on the plan, and
 * another chosen in its place if it was the one shown (`replacementOf`). A
 * fixed tab closes on the open plan alone. Closing an agent's tab closes
 * nothing of the agent's own, and closing a draft's leaves the draft its
 * owner's to let go; closing a pinned tab leaves its pin.
 */
function withoutTab(held: HeldState, tab: SidePanelTab, drawn: DrawnTabs): HeldState {
  const closed: HeldState | undefined = isFixedTab(tab)
    ? drawnFixed(held, drawn.plan).includes(tab)
      ? withChoice(held, drawn.plan.id, tab, false)
      : undefined
    : isAgentTab(tab)
      ? held.closedAgents.includes(tab.agent)
        ? undefined
        : { ...held, closedAgents: [...held.closedAgents, tab.agent].slice(-CLOSED_AGENTS_KEPT) }
      : isSubagentTab(tab)
        ? held.subagents.some((each) => sameTab(each, tab))
          ? { ...held, subagents: held.subagents.filter((each) => !sameTab(each, tab)) }
          : undefined
        : isFileTab(tab)
          ? { ...held, files: held.files.filter((each) => each.path !== tab.file) }
          : held;
  if (closed === undefined) return held;
  const forgotten = withoutViewed(closed, drawn.plan.id, tab);
  const shown = shownIn(held, drawn);
  return shown !== undefined && sameTab(shown, tab)
    ? { ...forgotten, tab: replacementOf(held, forgotten, tab, drawn) }
    : forgotten;
}

/**
 * `all` with the tab taken out and put back at `to` in `run`, the part of
 * it the strip draws: before the tab that stands there now, or after every
 * one of `all` where none does. Nothing where the tab does not move.
 */
function movedIn<T extends SidePanelTab>(
  all: readonly T[],
  run: readonly SidePanelTab[],
  tab: SidePanelTab,
  to: number,
): readonly T[] | undefined {
  const at = run.findIndex((other) => sameTab(other, tab));
  const own = all.find((other) => sameTab(other, tab));
  if (at < 0 || to === at || own === undefined) return undefined;
  const before = run.filter((other) => !sameTab(other, tab))[Math.max(0, to)];
  const rest = all.filter((other) => !sameTab(other, tab));
  const place = before === undefined ? -1 : rest.findIndex((other) => sameTab(other, before));
  return place < 0 ? [...rest, own] : [...rest.slice(0, place), own, ...rest.slice(place)];
}

/**
 * The state with the tab moved to `to` in the plan's strip, among tabs of
 * every kind, kept as the plan's order: the tabs it already held, those the
 * strip does not draw now among them, such as one closed, then the rest of
 * the strip as it stands, the tab taken out and put back at its new place.
 */
function withTabAt(held: HeldState, tab: SidePanelTab, to: number, drawn: DrawnTabs): HeldState {
  const planId = drawn.plan.id;
  const strip = stripOf(held, drawn);
  const was = orderOn(held, planId);
  const all = [...was, ...strip.filter((each) => !was.some((other) => sameTab(other, each)))];
  const order = movedIn(all, strip, tab, to);
  return order === undefined
    ? held
    : withPlanTabs(held, planId, (choices) => ({ ...choices, order }));
}

/** Whether a kept tab is of a kind this version still has: any but a retired fixed kind. */
function current<T>(tab: T): tab is Exclude<T, RetiredSidePanelTab> {
  return !RETIRED_TABS.has(tab);
}

/** Each plan's kept choices without the kinds retired since they were kept, nor the strip pins `stripPins` reads. */
function currentPlans(plans: SidePanelState["plans"]): HeldState["plans"] {
  return Object.fromEntries(
    Object.entries(plans ?? {}).map(([plan, { opened, closed, recent, order }]) => [
      plan,
      {
        opened: opened.filter(current),
        closed: closed.filter(current),
        ...(recent === undefined ? undefined : { recent: recent.filter(current) }),
        ...(order === undefined ? undefined : { order: order.filter(current) }),
      },
    ]),
  );
}

/** The name a pin read from the strip's own carries until its plan is next open: a fixed tab's kind, a file's name, or any agent's. */
function stripPinLabel(tab: PinnableTab): string {
  if (isFileTab(tab)) return fileName(tab.file);
  return isAgentTab(tab) ? "Coding agent" : SIDE_PANEL_TAB_KIND[tab].label;
}

/**
 * The tabs an earlier version pinned in each plan's strip, as the sidebar's
 * pins, in the order they stood and older than any pinned since, each
 * stamped before the one ahead of it. A subagent's, and a kind retired
 * since, is let go, since the sidebar holds no pin of one.
 */
function stripPins(plans: NonNullable<SidePanelState["plans"]>): readonly PinnedTab[] {
  const pinned = Object.entries(plans).flatMap(([plan, { pinned = [] }]) =>
    pinned.flatMap((tab) =>
      current(tab) && isPinnable(tab) ? [{ plan, tab, label: stripPinLabel(tab) }] : [],
    ),
  );
  return pinned.map((pin, place) => ({ ...pin, at: -place }));
}

/**
 * A kept or staged state made whole: every kind in the order once, those it
 * did not hold last, the width no narrower than its least, no subagent or
 * file tab open, nothing of a kind retired since it was kept, and its pins,
 * or where it is from before them, its strip's.
 */
function settled(state: SidePanelState): HeldState {
  const { tab, pins } = state;
  return {
    ...state,
    tabs: [...new Set([...state.tabs.filter(current), ...SIDE_PANEL_TABS])],
    tab: tab === undefined || !current(tab) ? undefined : tab,
    width: clampWidth(state.width),
    subagents: [],
    files: [],
    closedAgents: state.closedAgents ?? [],
    plans: currentPlans(state.plans),
    pins:
      pins === undefined
        ? stripPins(state.plans ?? {})
        : pins.flatMap((pin) => {
            const { tab: pinned } = pin;
            return current(pinned) ? [{ ...pin, tab: pinned }] : [];
          }),
  };
}

/** Whether a chosen or viewed tab is kept across a launch: a fixed tab or an agent's, the kinds that stand again after it. */
function keptChoice(tab: SidePanelTab): tab is FixedSidePanelTab | AgentSidePanelTab {
  return isFixedTab(tab) || isAgentTab(tab);
}

/** Each plan's choices as they are kept: its tabs viewed and its order as `keptChoice` keeps them, and neither where it has none. */
function storedPlans(plans: HeldState["plans"]): NonNullable<SidePanelState["plans"]> {
  const kept = (tabs: readonly SidePanelTab[]) => {
    const each = tabs.filter(keptChoice);
    return each.length === 0 ? undefined : each;
  };
  return Object.fromEntries(
    Object.entries(plans).map(([plan, { opened, closed, recent = [], order = [] }]) => [
      plan,
      { opened, closed, recent: kept(recent), order: kept(order) },
    ]),
  );
}

/** What is kept of the state: the preference without the subagent and file tabs, and without a subagent's, a draft's, or a file's tab chosen. */
function stored(state: HeldState): SidePanelState {
  const kept = {
    open: state.open,
    tabs: state.tabs,
    width: state.width,
    closedAgents: state.closedAgents,
    plans: storedPlans(state.plans),
    pins: state.pins,
  };
  const tab = state.tab;
  return tab !== undefined && keptChoice(tab) ? { ...kept, tab } : kept;
}

/** What storage holds under the key, or nothing where it refuses the read. */
function storedText(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The kept preference, an earlier version's in the kinds' own order, or the
 * first launch's where none was kept or it no longer reads.
 */
function readStored(): HeldState {
  const text = storedText();
  const stored = Option.getOrElse(decodeStored(text), () =>
    Option.match(decodeEarlier(text), {
      onNone: () => FIRST_LAUNCH,
      onSome: (earlier): SidePanelState => ({ ...earlier, tabs: SIDE_PANEL_TABS }),
    }),
  );
  return settled(stored);
}

/**
 * The tab the panel shows for the one kept: a fixed tab the open plan does
 * not draw, an agent tab whose agent the open plan has none of, a subagent
 * tab the plan does not draw (`drawsSubagent`), or a file tab of a file not
 * shown on the open plan, reads as the first of the plan's fixed tabs, or
 * as none where it draws none. With the plan's agents not yet read, the
 * kept agent tab stands, and a delegated worker's with it, so a tab kept
 * across a launch is not swapped for another and back while the list is on
 * its way; a planning worker's or a file's tab is kept across no launch,
 * and a plan whose work is unread or has no turn holds no subagent, so
 * nothing is waited for on its account. A draft's tab shows while the open
 * plan holds that draft.
 */
export function shownTab(
  kept: SidePanelTab | undefined,
  tabs: readonly FixedSidePanelTab[],
  agents: readonly string[] | undefined,
  subagents: readonly string[] = [],
  draft: string | undefined = undefined,
  files: readonly string[] = [],
): SidePanelTab | undefined {
  if (kept === undefined) return tabs[0];
  if (isFixedTab(kept)) return tabs.includes(kept) ? kept : tabs[0];
  if (isAgentTab(kept)) {
    return agents === undefined || agents.includes(kept.agent) ? kept : tabs[0];
  }
  if (isDraftTab(kept)) return kept.draft === draft ? kept : tabs[0];
  if (isFileTab(kept)) return files.includes(kept.file) ? kept : tabs[0];
  return drawsSubagent(kept, { agents, subagents }) ? kept : tabs[0];
}

/** Whether two reads of what a plan holds say the same of every kind. */
function sameHolds(a: PlanHolds, b: PlanHolds): boolean {
  return SIDE_PANEL_TABS.every((tab) => a[tab] === b[tab]);
}

/**
 * Whether a kind the plan did not hold holds something now. Note that a
 * kind not yet read counts as one held nothing, because the host leaves the
 * plan's work and code absent both before their read and when it found
 * none, so a first snippet or turn arrives from nothing known; a read
 * landing after another tab shows is held to the same rule, and the tab
 * shown stands rather than flickering to the one that landed.
 */
function arrived(was: PlanHolds, now: PlanHolds): boolean {
  return SIDE_PANEL_TABS.some((tab) => was[tab] !== true && now[tab] === true);
}

/**
 * The side panel's state: the kept preference, kept again on every change,
 * or where a fixture run stages one, that staged state and the presses on
 * it, which are kept nowhere. `plan` is the open plan and what it holds of
 * each fixed kind, `agents` its agent tabs, by agent id, or nothing while
 * they have not been read, `subagents` the planning workers its work
 * holds, by the call that started each, none where the work has none or is
 * unread, `draft` its draft agent's key, if it holds one, and `files` the
 * files Luke showed on it, by path; the tabs drawn and the tab shown are
 * held to them, a delegated worker's to the open agent tabs. A plan with no
 * fixed tab shows its first open agent's.
 */
export function useSidePanel(
  staged: SidePanelState | undefined,
  plan: OpenPlan,
  agents?: readonly string[] | undefined,
  subagents: readonly string[] = [],
  draft: string | undefined = undefined,
  files: readonly string[] = [],
): SidePanelControl {
  // Note that the fixture run's panel is a state of its own rather than the
  // kept one reset, because the run is only known once the first state
  // arrives, a render after the kept preference was read.
  const [kept, setKept] = useState<HeldState>(readStored);
  const [moved, setMoved] = useState<HeldState | undefined>(undefined);
  const [fullScreen, setFullScreen] = useState(false);
  const [newTabAsked, setNewTabAsked] = useState(false);
  const [seen, setSeen] = useState<OpenPlan>(plan);
  // The tab a pin or a notification asked for, while it is still the one chosen.
  const [asked, setAsked] = useState<{ plan: string; tab: SidePanelTab } | undefined>(undefined);
  const stage = useMemo(() => (staged === undefined ? undefined : settled(staged)), [staged]);
  const planId = plan.id;
  const state = stage === undefined ? kept : (moved ?? stage);
  const update = useCallback(
    (change: (held: HeldState) => HeldState) => {
      if (stage === undefined) setKept(change);
      else setMoved((was) => change(was ?? stage));
    },
    [stage],
  );
  const openAgents = drawnAgents(agents, state.closedAgents);
  // Note that the first open agent's tab is made once per agent, because the
  // window redraws on a change of the tab shown, and a new one each render
  // would never be the same.
  const firstAgent = openAgents?.[0];
  const agentTab = useMemo(
    () => (firstAgent === undefined ? undefined : { agent: firstAgent }),
    [firstAgent],
  );
  const shownFor = (holds: PlanHolds) =>
    shownTab(
      state.tab,
      drawnFixed(state, { id: planId, holds }),
      openAgents,
      subagents,
      draft,
      files,
    ) ?? agentTab;

  // Note that something arriving on the plan adds its tab without taking
  // the shown one's place, because a tab ahead of it in the strip would
  // otherwise become the first, and a chosen tab the plan lacked would come
  // back over the one standing in for it: the tab shown is kept as chosen.
  // A tab a pin or a notification asked for is the exception, since it was
  // chosen on this very plan and stands in for nothing: a file's waits for
  // the plan's code to be read, however much arrives before it.
  if (seen.id !== planId || !sameHolds(seen.holds, plan.holds)) {
    setSeen(plan);
    const before =
      seen.id === planId && arrived(seen.holds, plan.holds) ? shownFor(seen.holds) : undefined;
    const after = shownFor(plan.holds);
    const awaited =
      asked !== undefined &&
      asked.plan === planId &&
      state.tab !== undefined &&
      sameTab(asked.tab, state.tab);
    if (!awaited && before !== undefined && (after === undefined || !sameTab(before, after))) {
      update((held) => ({ ...held, tab: before }));
    }
  }
  // Past the check above, `seen` is the plan as it is, and a new object
  // only where the plan or what it holds changed, so the strip drawn from
  // it is the same array until something it is drawn from changes.
  const tabs = useMemo(() => drawnFixed(state, seen), [state, seen]);
  const drawn = useMemo(
    () => ({ plan: seen, agents, subagents, draft, files }),
    [seen, agents, subagents, draft, files],
  );
  // Note that a write that fails (storage full, or refused) costs only the
  // preference, so it is not worth a word on screen.
  useEffect(() => {
    if (staged !== undefined) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, encodeStored(stored(kept)));
    } catch {
      // The panel keeps working on the state it holds.
    }
  }, [staged, kept]);

  const onToggle = useCallback(() => {
    update((held) => ({ ...held, open: !held.open }));
    setFullScreen(false);
    setNewTabAsked(false);
  }, [update]);
  const onToggleFullScreen = useCallback(() => setFullScreen((was) => !was), []);
  const onNewTab = useCallback(() => {
    update((held) => (held.open ? held : { ...held, open: true }));
    setNewTabAsked(true);
  }, [update]);
  const onNewTabAnswered = useCallback(() => setNewTabAsked(false), []);
  const onChoose = useCallback(
    (tab: SidePanelTab) => {
      setAsked(undefined);
      update((held) => ({
        ...withTab(withChosenViewed(held, tab, drawn), tab, planId),
        open: true,
      }));
    },
    [update, drawn, planId],
  );
  // Note that a tab shown on another plan is not counted viewed on the open
  // one, because the plan it is viewed on is the one about to open.
  const onShow = useCallback(
    (on: string, tab: SidePanelTab) => {
      setAsked({ plan: on, tab });
      update((held) => ({
        ...withTab(on === planId ? withChosenViewed(held, tab, drawn) : held, tab, on),
        open: true,
      }));
    },
    [update, drawn, planId],
  );
  const onClose = useCallback(
    (tab: SidePanelTab) => update((held) => withoutTab(held, tab, drawn)),
    [update, drawn],
  );
  const onOpenFile = useCallback(
    (ref: CodeRef) =>
      update((held) => withFileOpened(withChosenViewed(held, { file: ref.path }, drawn), ref)),
    [update, drawn],
  );
  const onMove = useCallback(
    (tab: SidePanelTab, to: number) => update((held) => withTabAt(held, tab, to, drawn)),
    [update, drawn],
  );
  const onPin = useCallback(
    (tab: PinnableTab, label: string) => {
      if (planId === undefined) return;
      const at = Date.now();
      update((held) => withPin(held, { plan: planId, tab, label }, at));
    },
    [update, planId],
  );
  const onUnpin = useCallback(
    (on: string, tab: PinnableTab) => update((held) => withoutPin(held, on, tab)),
    [update],
  );
  const onRenamePins = useCallback(
    (on: string, labels: ReadonlyMap<string, string>) =>
      update((held) => withPinsRenamed(held, on, labels)),
    [update],
  );
  const onResize = useCallback(
    (width: number) => update((held) => ({ ...held, width: clampWidth(width) })),
    [update],
  );
  return {
    open: state.open,
    tabs,
    order: orderOn(state, planId),
    closedTabs: planTabs(state, planId).closed,
    pins: state.pins,
    subagents: state.subagents,
    closedAgents: state.closedAgents,
    files: state.files,
    tab: shownTab(state.tab, tabs, openAgents, subagents, draft, files) ?? agentTab,
    width: state.width,
    fullScreen: state.open && fullScreen,
    newTabAsked: state.open && newTabAsked,
    onToggle,
    onToggleFullScreen,
    onNewTab,
    onNewTabAnswered,
    onChoose,
    onShow,
    onClose,
    onMove,
    onPin,
    onUnpin,
    onRenamePins,
    onOpenFile,
    onResize,
  };
}
