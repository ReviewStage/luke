import type { CodeRef } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import { BoardIcon, CodeIcon, CommentsIcon, DocumentIcon } from "@luke/ui";
import {
  type AgentStripTab,
  type BrowserStripTab,
  type ChangesStripTab,
  type FileStripTab,
  inTaskOrder,
  isAgentTab,
  isBrowserTab,
  isChangesTab,
  isFileTab,
  isMacTerminalTab,
  isPageTab,
  isSubagentTab,
  isTerminalTab,
  type MacTerminalStripTab,
  movedOrder,
  openedOrder,
  type PageStripTab,
  replacementOf,
  type StripTab,
  type SubagentStripTab,
  sameTab,
  TAB_WORDS,
  type TerminalStripTab,
  viewedLast,
} from "@luke/ui/tab-strip-model";
import { fileName } from "@luke/voice/code-pane-model";
import { Option, Schema } from "effect";
import { InboxIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import {
  type ByPullRequestTab,
  ofPullRequestTab,
  withPullRequestTab,
} from "./pull-request-number.js";
import { MAIN_TAB } from "./use-main-tabs.js";

/**
 * use-side-panel.ts -- the open task's side panel: whether it is shown, which tabs it holds and which is chosen, and how wide, kept across launches.
 *
 * The task's column is the agents': its Call with Luke and its coding
 * agents (`use-main-tabs.ts`); everything else (the plan's document, the
 * task's Inbox, the whiteboard, the code Luke has on screen, and the plan's
 * comments) stands in a panel at the window's right that the developer
 * opens and closes, as every devtool window's secondary sidebar does. What
 * opens it on its own is Luke drawing on a task's board or showing its code
 * (`use-panel-arrivals.ts`), each time he does, and an Inbox item the
 * developer has not seen (`onInboxRead`); a subagent's tab opened from an
 * agent's transcript opens it too. A task just started opens with it shown
 * on the plan (`use-tasks-tab.ts`), since the plan is what Luke writes as
 * the developer talks. Not to be confused with "the panel", which in this
 * renderer is Luke's whole surface.
 *
 * A fixed tab stands in the strip only once the open task has used it: its
 * board holds something, Luke showed code on it, or a comment was left on
 * its plan. The plan's own tab is used on every task, so it stands on each
 * until closed there. The Inbox stands only once it has something to show:
 * it is closed on a task until an item the developer has not seen waits
 * there, and then opens and is chosen as an arrival is (in a narrow room it
opens without being chosen, since the panel there would stand over the
plan); an item has not
 * been seen where it did not wait at the task's last read, and a task with
 * no agent has no Inbox, since only an agent posts, unless main's read of
 * what waits across the account says an item waits on it. So a new task
 * has the plan's tab alone,
 * and what arrives on it adds its tab at the strip's end as it arrives,
 * never taking the chosen one's place. The developer's own choices lie
 * over that, per task: a tab they open from the "+" stands on that task
 * though it holds nothing, and one they close stays closed on that task however
 * much more arrives, until they or Luke's next drawing or snippet open it again. The tab chosen is the
 * window's rather than any task's, so a chosen tab the open task does not
 * have reads as the first it does.
 *
 * The three fixed kinds are a constant. A subagent's tab, opened from its
 * call in the Call tab, from the "+", or from a delegation's row in an
 * agent's tab, is held to the open task's work, or to the task's open
 * agent tabs where one of them delegated, so closing the
 * agent's tab takes its workers' with it; it closes, and it is kept
 * nowhere, so a launch opens none. An agent's Pull request tab, kept as
 * `changes` for the tab that once showed its files alone, opened from the
 * pull request's chip at its tab's foot, the "+", the
 * task's summary, or ⌘K, shows the pull request's conversation, its checks,
 * or its files (`PULL_REQUEST_VIEW`), the view each agent's tab shows held for the
 * window's life and kept nowhere, and is
 * the one kind besides the fixed three kept as they are: one per agent,
 * since each agent works in a sandbox and a pull request of its own, it is
 * opened on the task it was opened on and held to that task's agents, and
 * it is kept with the task's other choices, so it stands, and stands
 * chosen, across a launch, and pins to the sidebar. A file's tab, opened from a
 * snippet in the Code tab or from the "+", is the one kind that stands many
 * times, one per file: it is held to the files Luke showed on the open task
 * the same way, closes, and is kept nowhere. A page's tab, opened from the
 * "+", stands once per page an agent wrote for the open task, held to the
 * plan's pages and kept nowhere on the same terms. An agent's Terminal tab
 * stands once per agent, whose sandbox its shells run in, never once per
 * task: it is held to the task's agents as a Changes tab is, and kept
 * nowhere, since what it shows is a connection the next launch makes
 * afresh. A Browser tab, opened from the "+" while the Browser tab
 * experiment is on, stands many times, each on the plan it was opened on
 * and drawn on no other, and is kept nowhere, since its page is a view main
 * holds for the window's life alone (`browser-pane.tsx`). Opening a file
 * that already has a tab chooses that tab and moves its lit lines to the
 * snippet opened. A file browsed to from a File tab's tree or breadcrumbs
 * is held to the task it was browsed on instead, since any file of the
 * task's repository may be: it takes the place of the File tab it was
 * chosen from among the file tabs, as an editor's preview does, or opens a
 * tab of its own where ⌘ was held; a file that already has a tab chooses
 * that tab.
 *
 * The panel holds tabs the way an editor's pane does: the developer closes
 * the ones they do not want, and the "+" opens one again at the strip's
 * end. Every tab opened, of whatever kind and from wherever, stands there:
 * the fixed kinds keep no place of their own. Closing the chosen tab
 * chooses the one viewed before it on that task that still stands, as an editor or a browser
 * does, kept with the task's other choices so it holds across a launch;
 * only where none does, its neighbour (`replacementOf`). Closing the last
 * shuts the panel too, as an editor's secondary side bar goes once its last
 * view closes, and leaves full screen with it. Whether the panel is open is
 * the window's, but it is drawn only while the strip beside it holds a tab,
 * so a plan with none shows no panel and the next plan that holds one shows
 * it again. Shown on purpose with none, by ⌘T or the toggle, it stands
 * empty, offering the tabs closed in place, until it is hidden.
 *
 * A tab of any kind is dragged or moved from the keyboard to any place in
 * the strip, among tabs of every kind, as an editor's are. The task keeps
 * the strip's order with its other choices, written whole as a tab opens or
 * moves (`openedOrder`, `movedOrder`), so a tab opened stands after every
 * tab drawn before it, and a tab closed and opened again stands at the end
 * rather than where it stood. A tab the order holds nothing of, such as
 * one on a task no tab was opened or moved on, or one whose kind's first
 * read landed since (`firstHeld`), stands after those it holds, in its
 * kind's place (`inTaskOrder`), so a strip kept before stands as it stood.
 * A tab opened on another task, as a pin does, goes to the end of that
 * task's strip where it is sure to stand in none of it, a fixed tab closed
 * there or a file with no tab open (`withTabLastOn`), and otherwise
 * changes nothing of its order, since its strip is not drawn here to say
 * whether the tab already stands in it. The subagent and file tabs are kept nowhere, so
 * they keep their place until a launch and then drop out of the order,
 * leaving the rest as they stood.
 *
 * A fixed tab, a file's, or a Changes tab may be pinned to the sidebar, and so may a coding
 * agent's or the Inbox from the task's column, where it stands under Pinned beside the
 * pinned tasks, newest pinned first, and opens its task on that tab from
 * any task. The pins are kept here, with the rest of the window's tab
 * preferences. The strip draws a pinned tab as it draws any other: it
 * closes, moves, and is closed by Close others the same way, and closing it
 * leaves its pin, which opens it again. A subagent's tab is a moment of its
 * agent's work, kept nowhere across a launch, so it is not pinned. The pins
 * are every task's, each with the name the sidebar draws for it, since an
 * agent's is read only while its task is open; what an earlier version
 * pinned in the strip itself reads as pinned to the sidebar, older than any
 * pin since.
 *
 * These facts are this window's preference rather than anything main
 * holds, so they are kept in the renderer's own storage and read once at
 * mount, a Changes tab with the fixed ones. What an earlier version kept still reads: the fixed tabs it held
 * open, or every tab before they could close, give the order alone, so a
 * set an earlier launch held open opens no tab on a task that has not used
 * it, and a kind since retired (`RETIRED_SIDE_PANEL_TAB`) reads as never
 * kept, wherever it was. A coding agent's tab an earlier version kept here,
 * from when the agents stood in this panel, is the task's column's now,
 * which reads it from here once (`use-main-tabs.ts`); this panel lets it
 * go. A fixture run neither draws nor writes them: what it draws is staged,
 * and a capture must not depend on how the last run left the panel.
 *
 * The open panel may also fill the window's work, over the document, as
 * ChatGPT's canvas does. That is a moment's view rather than a preference,
 * so it is kept nowhere: a launch, and a panel shown again, start beside
 * the document. So is ⌘T's ask for the "+" menu, made while the panel
 * holds the window's focus, which stands until the "+" opens its menu.
 */

/** The panel's kinds of tab, the fixed five. A kind is one entry here, one row below, and one case where the panel draws it. */
export const SIDE_PANEL_TAB = {
  /** The task's plan, its document (`plan-body.tsx`). */
  PLAN: "plan",
  /** Everything the task's agents need of the developer, answered in place (`inbox-pane.tsx`). */
  INBOX: "inbox",
  BOARD: "board",
  CODE: "code",
  /** The plan's comment threads, open and resolved (`plan-comments.tsx`). */
  COMMENTS: "comments",
} as const;

/**
 * The kinds an earlier version had and this one does not, which what it kept
 * may still name: History, whose versions now take the whole window
 * (`desktop-version-history.tsx`), Transcript and Work, which the Call
 * tab drew together (`task-call.tsx`), and Call, which stands in the task's
 * column now (`use-main-tabs.ts`); a pin of it opens it there. Note that a
 * kind is retired here rather than deleted, because a kept state naming one
 * would otherwise not read at all and lose every other choice it holds.
 */
const RETIRED_SIDE_PANEL_TAB = {
  HISTORY: "history",
  TRANSCRIPT: "transcript",
  WORK: "work",
  CALL: "call",
} as const;

type RetiredSidePanelTab = (typeof RETIRED_SIDE_PANEL_TAB)[keyof typeof RETIRED_SIDE_PANEL_TAB];

const RETIRED_TABS: ReadonlySet<unknown> = new Set(Object.values(RETIRED_SIDE_PANEL_TAB));

export type FixedSidePanelTab = (typeof SIDE_PANEL_TAB)[keyof typeof SIDE_PANEL_TAB];

/** A tab of the panel: one of the fixed kinds, one subagent's, one file's, one agent's Changes or Terminal, one page's, or a Browser tab. */
export type SidePanelTab =
  | FixedSidePanelTab
  | SubagentStripTab
  | FileStripTab
  | ChangesStripTab
  | TerminalStripTab
  | PageStripTab
  | MacTerminalStripTab
  | BrowserStripTab;

/**
 * A Browser tab as the panel holds it: the tab, the plan it was opened on,
 * the one plan that draws it, and the address its page was first opened
 * at, none until one is, which a tab drawn again opens its view on.
 */
export interface OpenBrowser {
  readonly tab: BrowserStripTab;
  readonly task: string;
  readonly address: string | undefined;
}

/**
 * A file's tab as the panel holds it: the file, the lines lit in it, none
 * for a snippet of the whole file, and how many times it has been opened,
 * so opening the same snippet again brings its lines back into view.
 */
export interface OpenFile {
  readonly path: string;
  readonly range: { readonly startLine: number; readonly endLine: number } | undefined;
  readonly opened: number;
  /** The task the file was browsed to on, from a File tab's tree or breadcrumbs or an inbox item's code; none for a file opened from Luke's snippet. */
  readonly browsedOn?: string | undefined;
  /** The commit the file is read at, as an inbox item's code pins it; none reads the default branch's head. */
  readonly commit?: string | undefined;
  /** The files this tab showed before this one, the latest last, which its Back walks. */
  readonly back?: readonly FileVisit[];
  /** The files Back walked away from, the latest last, which its Forward walks again. */
  readonly forward?: readonly FileVisit[];
  /** The calls whose notes on lines this tab folded, kept while the tab stands, whatever file it walks to. */
  readonly foldedNotes?: readonly string[];
}

/** A file a File tab showed, as its history holds it to show again. */
type FileVisit = Pick<OpenFile, "path" | "range" | "browsedOn" | "commit">;

/** Which of an agent's Pull request tab's tabs it shows under its fixed header: the description and conversation, the checks, or the changed files. */
export const PULL_REQUEST_VIEW = {
  CONVERSATION: "conversation",
  CHECKS: "checks",
  FILES: "files",
} as const;

export type PullRequestView = (typeof PULL_REQUEST_VIEW)[keyof typeof PULL_REQUEST_VIEW];

/** Which way a File tab's history is walked. */
export const FILE_HISTORY_STEP = {
  BACK: "back",
  FORWARD: "forward",
} as const;

export type FileHistoryStep = (typeof FILE_HISTORY_STEP)[keyof typeof FILE_HISTORY_STEP];

/**
 * What the panel knows of a kind of tab: its name and its glyph, which its
 * tab, its pin, its "+" row, and its ⌘K row all wear (`tab-look.tsx`).
 * Note that the open tabs are kept as their kinds, so at most one tab of a
 * kind stands, and opening one already open chooses it.
 */
interface SidePanelTabKind {
  label: string;
  icon: React.ComponentType;
}

export const SIDE_PANEL_TAB_KIND = {
  [SIDE_PANEL_TAB.PLAN]: { label: "Plan", icon: DocumentIcon },
  [SIDE_PANEL_TAB.INBOX]: { label: TAB_WORDS.INBOX, icon: InboxIcon },
  [SIDE_PANEL_TAB.BOARD]: { label: "Board", icon: BoardIcon },
  [SIDE_PANEL_TAB.CODE]: { label: "Code", icon: CodeIcon },
  [SIDE_PANEL_TAB.COMMENTS]: { label: "Comments", icon: CommentsIcon },
} as const satisfies Record<FixedSidePanelTab, SidePanelTabKind>;

/** Every kind of tab, in the order the "+" offers them and a task whose order holds none of them stands them in. */
export const SIDE_PANEL_TABS: readonly FixedSidePanelTab[] = Object.values(SIDE_PANEL_TAB);

const FIXED_TABS: ReadonlySet<StripTab> = new Set(SIDE_PANEL_TABS);

/** Whether a tab is one of the fixed kinds. */
function isFixedTab(tab: SidePanelTab): tab is FixedSidePanelTab {
  return FIXED_TABS.has(tab);
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
 * How many tabs a task keeps as viewed, the latest viewed. Note that a tab
 * closed leaves the list as it closes, so the bound only lets go of tabs
 * long unviewed, which a close then passes over for its neighbour.
 */
const RECENT_KEPT = 20;

/**
 * How many tasks' own choices of tab are kept, the latest chosen. Note that
 * a task deleted leaves its entry behind, so the record is held to a bound
 * rather than growing with every task ever opened; one past it is drawn
 * from what it holds again.
 */
const TASKS_KEPT = 500;

/** A fixed kind as it is kept: one of today's, or one retired, which reads and is then let go (`settled`). An agent's, which an earlier version kept here, reads and is let go the same way. */
const sidePanelTabSchema = Schema.Literals([
  ...SIDE_PANEL_TABS,
  ...Object.values(RETIRED_SIDE_PANEL_TAB),
]);
/** An agent's Changes tab as it is kept, on the task it was opened on, with the number of the pull request it names where it names one. */
const changesTabSchema = Schema.Struct({
  changes: Schema.String,
  number: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
});
const anyTabSchema = Schema.Union([
  sidePanelTabSchema,
  Schema.Struct({ agent: Schema.String }),
  changesTabSchema,
]);

/**
 * How many tabs are kept pinned to the sidebar, the latest pinned. Note that
 * a deleted task's pins are drawn nowhere and left behind, so the record is
 * held to a bound rather than growing with every task ever pinned on.
 */
const PINS_KEPT = 100;

/**
 * The tab a pin opens: a fixed one, an agent's, the task's Call, a file's,
 * or an agent's Changes. Note that the Call's word is the retired fixed
 * kind's, so a pin of the Call made while it stood here opens it in the
 * task's column now.
 */
const pinnableTabSchema = Schema.Union([
  sidePanelTabSchema,
  Schema.Struct({ agent: Schema.String }),
  Schema.Literal(MAIN_TAB.CALL),
  Schema.Struct({ file: Schema.String }),
  changesTabSchema,
]);

/**
 * A tab pinned to the sidebar: its task, the tab, the name the sidebar draws
 * for it, when it was pinned, where it stands among the pins once it was
 * dragged (`@luke/features/pin-order`), kept on this Mac alone, and, an
 * agent's, the model it ran on then, whose harness's mark its row wears
 * while its task is not the open one.
 */
const pinnedTabSchema = Schema.Struct({
  task: Schema.String,
  tab: pinnableTabSchema,
  label: Schema.String,
  at: Schema.Number,
  position: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
});

/** A tab of a kind the sidebar holds a pin of, of today's kinds. */
export type PinnableTab =
  | Exclude<typeof pinnableTabSchema.Type, RetiredSidePanelTab>
  | typeof MAIN_TAB.CALL;

/** A tab pinned to the sidebar as the hook holds it, of today's kinds alone. */
export interface PinnedTab extends Omit<typeof pinnedTabSchema.Type, "tab"> {
  readonly tab: PinnableTab;
}

/** What the open task's pins of agents and of their Pull requests are named now, each by agent id: an agent as its tab is, and its Pull request by the pull request's number and title; and a Pull request tab naming a pull request by its number likewise, by agent and then by number. */
interface PinNames {
  readonly agents: ReadonlyMap<string, string>;
  readonly pullRequests: ReadonlyMap<string, string>;
  readonly numbered?: ByPullRequestTab<string>;
}

/** A tab an earlier version pinned in the strip itself, of any kind it then held but a draft agent's. */
const stripPinSchema = Schema.Union([
  pinnableTabSchema,
  Schema.Struct({
    subagent: Schema.String,
    delegation: Schema.optionalKey(Schema.Struct({ agent: Schema.String, task: Schema.String })),
  }),
]);

/**
 * The fixed tabs the developer opened on one task though it held nothing of
 * them, those they closed on it, in the strip's order, the tabs they
 * viewed on it, the latest last, and the strip's order since a tab first
 * opened or moved on it, and the agents' Changes tabs open on it, in the
 * order opened. A kind is in `opened` or `closed` or neither. The tabs
 * viewed and the order are kept as the chosen tab is, of fixed and Changes
 * tabs alone, since no other stands again across a launch. `inboxSeen` is the
 * items that waited in its inbox at its last read, by id. `pinned` is what an
 * earlier version pinned in the strip, read once into the sidebar's pins and
 * written no more.
 */
const taskTabsSchema = Schema.Struct({
  opened: Schema.Array(sidePanelTabSchema),
  closed: Schema.Array(sidePanelTabSchema),
  pinned: Schema.optional(Schema.Array(stripPinSchema)),
  recent: Schema.optional(Schema.Array(anyTabSchema)),
  order: Schema.optional(Schema.Array(anyTabSchema)),
  changes: Schema.optional(Schema.Array(changesTabSchema)),
  inboxSeen: Schema.optional(Schema.Array(Schema.String)),
});

/** A task's own choices as the hook holds them: today's kinds alone, its open Changes tabs, and tabs viewed and an order that may hold any tab, which the record keeps only the kept kinds of. */
interface TaskTabs {
  readonly opened: readonly FixedSidePanelTab[];
  readonly closed: readonly FixedSidePanelTab[];
  readonly recent?: readonly SidePanelTab[] | undefined;
  readonly order?: readonly SidePanelTab[] | undefined;
  /** The agents' Changes tabs open on the task, in the order opened. */
  readonly changes?: readonly ChangesStripTab[] | undefined;
  /** The items that waited in the task's inbox at its last read, by id; none before its first. */
  readonly inboxSeen?: readonly string[] | undefined;
}

/**
 * The fixed tabs in the order a task no tab was moved on draws them, which
 * an earlier version's drags set for every task, the chosen tab, each
 * task's own choices of fixed tab, by task id, and the tabs pinned to the
 * sidebar, newest pinned first. Note that `tabs`
 * once held only the open fixed tabs, so what an earlier version kept reads
 * as an order with the kinds it closed last, and that a record with no
 * `pins` is one from before them, whose strip pins are read in their place.
 */
const sidePanelStateSchema = Schema.Struct({
  open: Schema.Boolean,
  tabs: Schema.Array(sidePanelTabSchema),
  tab: Schema.optional(anyTabSchema),
  width: Schema.Number,
  tasks: Schema.optional(Schema.Record(Schema.String, taskTabsSchema)),
  pins: Schema.optional(Schema.Array(pinnedTabSchema)),
});

export type SidePanelState = typeof sidePanelStateSchema.Type;

/**
 * The state the hook holds: the kept one, every fixed kind in `tabs`, the
 * subagent tabs open, by the call that started each, in the order opened,
 * and the file tabs open, in the strip's order. Those are this view's
 * rather than the preference's, so they are kept nowhere, and a subagent's
 * or a file's tab chosen is written as no tab, which the next launch reads
 * as the first. A Changes tab is the task's own choice, kept in `plans`.
 */
interface HeldState extends Omit<SidePanelState, "tabs" | "tab" | "tasks" | "pins"> {
  readonly tabs: readonly FixedSidePanelTab[];
  readonly tab?: SidePanelTab | undefined;
  readonly subagents: readonly SubagentStripTab[];
  readonly files: readonly OpenFile[];
  /** The open page tabs, by page, in the order opened. */
  readonly pages: readonly PageStripTab[];
  /** The open Terminal tabs, by agent, in the order opened. */
  readonly terminals: readonly TerminalStripTab[];
  /** The open Browser tabs of every task, in the order opened. */
  readonly browsers: readonly OpenBrowser[];
  /** The agent whose Terminal tab was shown last on each task, by task. */
  readonly lastTerminals: Readonly<Record<string, string>>;
  /** What each Pull request tab shows, by agent and then by the number it names (`pull-request-number.ts`), of those whose view was chosen; the overview otherwise. */
  readonly pullRequestViews: ByPullRequestTab<PullRequestView>;
  /** The open tabs of this Mac's terminals, by agent, in the order opened. */
  readonly macTerminals: readonly MacTerminalStripTab[];
  readonly tasks: Readonly<Record<string, TaskTabs>>;
  readonly pins: readonly PinnedTab[];
}

/** A task the developer has chosen no fixed tab on. */
const NO_CHOICES: TaskTabs = { opened: [], closed: [] };

/** What was kept before the panel's tabs could close: every tab open, and the one chosen. */
const earlierSidePanelSchema = Schema.Struct({
  open: Schema.Boolean,
  tab: anyTabSchema,
  width: Schema.Number,
});

/** A pin as it is read: one written before tasks had their name names its task `plan`. */
const keptPinSchema = Schema.Union([
  pinnedTabSchema,
  pinnedTabSchema.mapFields(({ task: _task, ...fields }) => ({ ...fields, plan: Schema.String })),
]);

/** The kept preference as it is read: one written before tasks had their name keeps their choices under `plans`, and its pins under `plan`. */
const keptSidePanelSchema = Schema.Struct({
  ...sidePanelStateSchema.fields,
  plans: sidePanelStateSchema.fields.tasks,
  pins: Schema.optional(Schema.Array(keptPinSchema)),
});

const storedSidePanel = Schema.fromJsonString(sidePanelStateSchema);
const decodeKept = Schema.decodeUnknownOption(Schema.fromJsonString(keptSidePanelSchema));
const decodeStored = (text: string | null) =>
  Option.map(
    decodeKept(text),
    ({ plans, tasks, pins, ...rest }): SidePanelState => ({
      ...rest,
      ...(tasks === undefined && plans === undefined ? undefined : { tasks: tasks ?? plans }),
      ...(pins === undefined
        ? undefined
        : {
            pins: pins.map((pin) =>
              "plan" in pin ? (({ plan, ...held }) => ({ ...held, task: plan }))(pin) : pin,
            ),
          }),
    }),
  );
const decodeEarlier = Schema.decodeUnknownOption(Schema.fromJsonString(earlierSidePanelSchema));
const encodeStored = Schema.encodeSync(storedSidePanel);

/** A first launch: open, so the plan shows, the kinds in their own order and none chosen, at the default width. */
const FIRST_LAUNCH: SidePanelState = {
  open: true,
  tabs: SIDE_PANEL_TABS,
  width: SIDE_PANEL_WIDTH.DEFAULT,
};

/** What the panel and its toggle draw, and their presses. */
export interface SidePanelControl {
  /** Whether the panel is drawn: open, and its strip holding a tab or it asked for with none. */
  open: boolean;
  /** Whether the open panel fills the work column in the document's place: asked for, or the only way a narrow room holds it. */
  fullScreen: boolean;
  /** Whether the room holds the open panel only full screen, as a narrow one does: it has no edge to resize it and no full-screen button, and leaving full screen shuts it. */
  fullScreenOnly: boolean;
  /** Whether ⌘T asked for the "+" menu and the "+" has not yet opened it. */
  newTabAsked: boolean;
  /** The open task's fixed tabs, in the strip's order. */
  tabs: readonly FixedSidePanelTab[];
  /**
   * The open task's tabs of any kind in the order they were opened and
   * moved into, none until one first is; the strip draws them first, as
   * they stand here, and every other after them in its kind's place
   * (`inTaskOrder`).
   */
  order: readonly SidePanelTab[];
  /** The fixed tabs the developer closed on the open task, which stay closed there until one is opened again, by them or by an arrival. */
  closedTabs: readonly FixedSidePanelTab[];
  /** The fixed kinds the open task has used, in the kinds' order: each it holds something of, its tab closed or not, and each opened on it. */
  used: readonly FixedSidePanelTab[];
  /** Every task's tabs pinned to the sidebar, newest pinned first. */
  pins: readonly PinnedTab[];
  /** The open subagent tabs in the order opened; they follow the fixed tabs, and only those the open task's work or open agent tabs hold are drawn. */
  subagents: readonly SubagentStripTab[];
  /** The open file tabs, in the strip's order; they follow the subagent tabs, and only those of files shown on the open task are drawn. */
  files: readonly OpenFile[];
  /** The Changes tabs open on the open task, in the order opened, after the file tabs; only those of the task's agents are drawn. */
  changes: readonly ChangesStripTab[];
  /** The open page tabs in the order opened, after the Changes tabs; only those of the open plan's pages are drawn. */
  pages: readonly PageStripTab[];
  /** The open Terminal tabs in the order opened, after the page tabs; only those of the open task's agents are drawn. */
  terminals: readonly TerminalStripTab[];
  /** The agent whose Terminal tab was shown last on the open task, which ⌘J goes to among several. */
  lastTerminal: string | undefined;
  /** What each Pull request tab shows, by agent and then by the number it names (`pull-request-number.ts`), of those whose view was chosen; the overview otherwise. */
  pullRequestViews: ByPullRequestTab<PullRequestView>;
  /** Chooses what a Pull request tab shows, its tab open or not. */
  onPullRequestView: (tab: ChangesStripTab, view: PullRequestView) => void;
  /** The open task's Browser tabs in the order opened, after the Terminal tabs. */
  browsers: readonly OpenBrowser[];
  /** The open task's tabs of every kind as the strip draws them, in its order. */
  strip: readonly SidePanelTab[];
  /** The tab shown, which is none only while the open task has no tab open. */
  tab: SidePanelTab | undefined;
  /** The panel's width in CSS pixels, never under {@link SIDE_PANEL_WIDTH}'s least. */
  width: number;
  /** Shows or hides the panel; hiding it leaves full screen too. */
  onToggle: () => void;
  /** Shows or hides the panel as asked, as a task being started does; hiding it leaves full screen too. */
  onSetOpen: (open: boolean) => void;
  onToggleFullScreen: () => void;
  /** Shows the panel, where it was hidden, and asks its "+" to open its menu, as ⌘T does. */
  onNewTab: () => void;
  /** Says the "+" opened its menu on the ask. */
  onNewTabAnswered: () => void;
  /** Hears what a read of the task's inbox found waiting, by id, opening and choosing its Inbox, the panel shown, where an item did not wait at the last read. */
  onInboxRead: (taskId: string, waiting: readonly string[]) => void;
  /** Shows the panel on the tab, opening it at the strip's end where the strip does not draw it, and choosing it where it does; a fixed tab stays open on that task. */
  onChoose: (tab: SidePanelTab) => void;
  /** Shows the panel on the tab of the task given, as `onChoose` does on the open task: what a pin or a notification asks, the task opened beside it. */
  onShow: (taskId: string, tab: SidePanelTab) => void;
  /** Closes the tab, and only the view: a subagent goes on as it was, and a pin of the tab stands. Closing the one shown chooses the tab viewed before it on the task that still stands, else its neighbour, the one after it where there is one; closing the last the strip draws shuts the panel. */
  onClose: (tab: SidePanelTab) => void;
  /** Moves the tab to the place `to` in the strip, among tabs of every kind, leaving the chosen one chosen. */
  onMove: (tab: SidePanelTab, to: number) => void;
  /**
   * Opens a tab closed on the open task again as it stood: shown and chosen
   * at the place `at` in the strip, a file's tab with the file, the lines,
   * and the history it had (`file`).
   */
  onReopen: (tab: SidePanelTab, at: number, file: OpenFile | undefined) => void;
  /** Pins the open task's tab, of either strip, to the sidebar under the name given, newest of the pins; an agent's with the model it runs on. */
  onPin: (tab: PinnableTab, label: string, model?: string) => void;
  onUnpin: (taskId: string, tab: PinnableTab) => void;
  /** Names each agent, and each agent's Pull request, pinned on the task as its tab is named now; one named nowhere keeps the name it has. */
  onRenamePins: (taskId: string, names: PinNames) => void;
  /** Stands each pin dragged in the sidebar's Pinned section at its new place, named by the instant it was pinned, kept on this Mac; none stands it by that instant again. */
  onPlacePins: (places: ReadonlyMap<number, string | undefined>) => void;
  /**
   * Shows the panel on the file's tab, opening one at the strip's end where
   * none stands: the window's one door for a file named in place
   * (`file-ref.tsx`). A reference naming lines lights them; with `commit`,
   * as an inbox item's code or a snippet Luke read from his checkout opens
   * it, the file as it stood at that commit, drawn on the open task. One
   * naming the file alone, as ⌘K finds it, leaves a tab it has as it stands
   * and opens a new one on the whole file, drawn on the open task.
   */
  onOpenFile: (ref: CodeRef, commit?: string) => void;
  /**
   * Shows the file browsed to from the File tab of `from`: its own tab
   * where one stands, else in `from`'s tab, in its place, or in a tab of
   * its own at the strip's end where `newTab` asks.
   */
  onBrowseFile: (from: string, path: string, newTab: boolean) => void;
  /**
   * Walks the history of the File tab of `from` a step back or forward,
   * showing the file it showed there in its place; a file with a tab of its
   * own by then is chosen there instead.
   */
  onFileHistory: (from: string, step: FileHistoryStep) => void;
  /** Folds, or opens, the note of the call that showed lines of the file on the File tab of `path`, which the tab keeps while it stands. */
  onFoldNote: (path: string, callId: string, folded: boolean) => void;
  /** Asks for a width; it is held to the least width before it is kept. */
  onResize: (width: number) => void;
  /** Opens a Browser tab on the open plan, chosen at the strip's end, on the address given or on none, which its bar asks for. */
  onOpenBrowser: (address?: string) => void;
  /** Closes every Browser tab on every plan, their pages with them, as the Browser tab experiment going off does. */
  onCloseBrowsers: () => void;
  /** Says the Browser tab's page was opened at the address, which the tab opens its view on when it is drawn again; one opened already keeps its first. */
  onBrowserOpened: (browserId: string, address: string) => void;
}

function clampWidth(width: number): number {
  return Math.max(SIDE_PANEL_WIDTH.MIN, Math.round(width));
}

/**
 * Whether the open task holds something of each fixed kind: its plan
 * always, its board any element, any code Luke showed, its plan any
 * comment. Of the Inbox it says whether the task may draw one at all, an
 * agent held or an item waiting, since the Inbox stands only once opened
 * (`drawnFixed`). A kind not yet read on the task is absent, which draws no
 * tab, as nothing does.
 */
export type TaskHolds = Partial<Record<FixedSidePanelTab, boolean | undefined>>;

/** The open task as the panel draws its fixed tabs: its id, none while no task is open, and what it holds. */
export interface OpenTask {
  id: string | undefined;
  holds: TaskHolds;
  /** Whether the panel draws none of the task's fixed tabs, standing beside the window's Inbox rather than the task's page, which draws what they show. */
  bare?: true | undefined;
}

/** What the task holds for the tabs: its id and its kinds, its agents whose tabs are open, or nothing while unread, the brain's workers its work holds, by the call that started each, and the files shown on it. */
export interface DrawnTabs {
  task: OpenTask;
  agents: readonly string[] | undefined;
  subagents: readonly string[];
  /** The files shown on the task, by path, whose open tabs the strip draws. */
  files: readonly string[];
  /** The plan's pages, by id, whose open tabs the strip draws. */
  pages: readonly string[];
  /** The task's agents, by id, whose Changes tabs the strip draws, or nothing while unread. */
  taskAgents: readonly string[] | undefined;
}

/** The developer's own choices of fixed tab on the task. */
function taskTabs(held: HeldState, taskId: string | undefined): TaskTabs {
  return taskId === undefined ? NO_CHOICES : (held.tasks[taskId] ?? NO_CHOICES);
}

/** A task with no page, the same array every render. */
const NO_PAGES: readonly string[] = [];

/** A task with no Changes tab open, the same array every render. */
const NO_CHANGES: readonly ChangesStripTab[] = [];

/** A task no tab was opened or moved on. */
const NO_ORDER: readonly SidePanelTab[] = [];

/** The task's order, none until a tab is first opened or moved on it. */
function orderOn(held: HeldState, taskId: string | undefined): readonly SidePanelTab[] {
  return taskTabs(held, taskId).order ?? NO_ORDER;
}

/**
 * The task's fixed tabs in the strip's order: each it holds something of and
 * was not closed on, and each opened on it. The Inbox stands only opened, and
 * only on a task that may draw one.
 */
function drawnFixed(held: HeldState, task: OpenTask): readonly FixedSidePanelTab[] {
  if (task.bare === true) return [];
  const chosen = taskTabs(held, task.id);
  const open = held.tabs.filter((tab) =>
    tab === SIDE_PANEL_TAB.INBOX
      ? chosen.opened.includes(tab) && task.holds[tab] === true
      : chosen.opened.includes(tab) || (!chosen.closed.includes(tab) && task.holds[tab] === true),
  );
  return inTaskOrder(open, orderOn(held, task.id), (tab) => tab);
}

/**
 * The state with the task's choices changed, that task's kept latest and the
 * oldest task's let go past the bound. With no task open there is nothing to
 * keep a choice on, and a change that answers the choices it was handed
 * changes nothing.
 */
function withTaskTabs(
  held: HeldState,
  taskId: string | undefined,
  change: (was: TaskTabs) => TaskTabs,
): HeldState {
  if (taskId === undefined) return held;
  const was = taskTabs(held, taskId);
  const choice = change(was);
  if (choice === was) return held;
  const kept = Object.entries(held.tasks).filter(([task]) => task !== taskId);
  return {
    ...held,
    tasks: Object.fromEntries([...kept, [taskId, choice] as const].slice(-TASKS_KEPT)),
  };
}

/** The state with the fixed tab opened or closed on the task. */
function withChoice(
  held: HeldState,
  taskId: string | undefined,
  tab: FixedSidePanelTab,
  opened: boolean,
): HeldState {
  return withTaskTabs(held, taskId, (was) => {
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

/** Whether a tab of either strip is of a kind the sidebar holds a pin of: a fixed one, an agent's, the Call, a file's, or an agent's Changes. */
export function isPinnable(tab: StripTab): tab is PinnableTab {
  return (
    FIXED_TABS.has(tab) ||
    isAgentTab(tab) ||
    tab === MAIN_TAB.CALL ||
    isFileTab(tab) ||
    isChangesTab(tab)
  );
}

/** A pin of a tab in the task's own column rather than the side panel: an agent's, or the Call. */
export type ColumnPinnableTab = Extract<PinnableTab, AgentStripTab | typeof MAIN_TAB.CALL>;

/** Whether a pin opens in the task's own column, an agent's tab or the Call, rather than in the side panel. */
export function inColumn(tab: PinnableTab): tab is ColumnPinnableTab {
  return isAgentTab(tab) || tab === MAIN_TAB.CALL;
}

/** Whether the pin is of the plan's tab. */
function pinOf(pin: PinnedTab, taskId: string, tab: PinnableTab): boolean {
  return pin.task === taskId && sameTab(pin.tab, tab);
}

/**
 * The state with the plan's tab pinned, newest of the pins, the oldest let
 * go past the bound; a tab already pinned keeps its place. Note that its
 * stamp is `at` or just after the newest pin's, so no two pins share one,
 * and a pin's stamp tells it from every other.
 */
function withPin(held: HeldState, pin: Omit<PinnedTab, "at">, at: number): HeldState {
  if (held.pins.some((each) => pinOf(each, pin.task, pin.tab))) return held;
  const newest = held.pins[0]?.at ?? Number.NEGATIVE_INFINITY;
  const pinned = { ...pin, at: Math.max(at, newest + 1) };
  return { ...held, pins: [pinned, ...held.pins].slice(0, PINS_KEPT) };
}

/** The state with the plan's tab no longer pinned. */
function withoutPin(held: HeldState, taskId: string, tab: PinnableTab): HeldState {
  if (!held.pins.some((each) => pinOf(each, taskId, tab))) return held;
  return { ...held, pins: held.pins.filter((each) => !pinOf(each, taskId, tab)) };
}

/** The state with each pin `places` names, by the instant it was pinned, standing at the place given there, or by its instant again where none is. */
function withPinsPlaced(
  held: HeldState,
  places: ReadonlyMap<number, string | undefined>,
): HeldState {
  const pins = held.pins.map((pin) => {
    if (!places.has(pin.at)) return pin;
    const position = places.get(pin.at);
    if (position === pin.position) return pin;
    const { position: _placed, ...unplaced } = pin;
    return position === undefined ? unplaced : { ...pin, position };
  });
  return pins.every((pin, at) => pin === held.pins[at]) ? held : { ...held, pins };
}

/** The name a pin of an agent's tab or its Changes tab wears as `names` names it, by agent id; none for any other pin, or one named nowhere. */
function agentPinLabel(tab: PinnableTab, names: PinNames): string | undefined {
  if (isAgentTab(tab)) return names.agents.get(tab.agent);
  if (!isChangesTab(tab)) return undefined;
  return tab.number === undefined
    ? names.pullRequests.get(tab.changes)
    : ofPullRequestTab(names.numbered ?? new Map(), tab);
}

/** The state with each agent, and each agent's Changes, pinned on the task named as `names` names it, and the state as it is where every one already was. */
function withPinsRenamed(held: HeldState, taskId: string, names: PinNames): HeldState {
  const renamed = (pin: PinnedTab) => {
    const label = pin.task === taskId ? agentPinLabel(pin.tab, names) : undefined;
    return label === undefined || label === pin.label ? pin : { ...pin, label };
  };
  const pins = held.pins.map(renamed);
  return pins.every((pin, at) => pin === held.pins[at]) ? held : { ...held, pins };
}

/**
 * The state with the tabs viewed on the task, in the order given, as its
 * latest, each taken from where it stood before, and the oldest let go past
 * the bound. Tabs viewed as they already were change nothing.
 */
function withViewed(
  held: HeldState,
  taskId: string | undefined,
  viewed: readonly SidePanelTab[],
): HeldState {
  return withTaskTabs(held, taskId, (was) => {
    const recent = viewedLast(was.recent ?? [], viewed, RECENT_KEPT);
    return recent === undefined ? was : { ...was, recent };
  });
}

/** The state with the tab gone from those viewed on the task. */
function withoutViewed(held: HeldState, taskId: string | undefined, tab: SidePanelTab): HeldState {
  const recent = taskTabs(held, taskId).recent ?? [];
  if (!recent.some((each) => sameTab(each, tab))) return held;
  return withTaskTabs(held, taskId, (was) => ({
    ...was,
    recent: recent.filter((each) => !sameTab(each, tab)),
  }));
}

/** The state with the agent's Changes tab open on the task, after those open there; as it was where it already is. */
function withChangesOpened(
  held: HeldState,
  taskId: string | undefined,
  tab: ChangesStripTab,
): HeldState {
  return withTaskTabs(held, taskId, (was) => {
    const open = was.changes ?? NO_CHANGES;
    return open.some((each) => sameTab(each, tab)) ? was : { ...was, changes: [...open, tab] };
  });
}

/**
 * The state with the tab open and chosen. A fixed tab opens on the open
 * task, where it stands though the task holds nothing of it, and so does a
 * Changes tab; a subagent's opens at the end of its own run, and one
 * already open is chosen as it stands, whichever path named its call.
 */
function withTab(held: HeldState, tab: SidePanelTab, taskId: string | undefined): HeldState {
  const opened = isFixedTab(tab)
    ? withChoice(held, taskId, tab, true)
    : isChangesTab(tab)
      ? withChangesOpened(held, taskId, tab)
      : held;
  const open = isSubagentTab(tab) ? held.subagents.find((each) => sameTab(each, tab)) : undefined;
  const subagents =
    isSubagentTab(tab) && open === undefined ? [...held.subagents, tab] : held.subagents;
  const files =
    isFileTab(tab) && !held.files.some((each) => each.path === tab.file)
      ? [...held.files, { path: tab.file, range: undefined, opened: 0 }]
      : held.files;
  const pages =
    isPageTab(tab) && !held.pages.some((each) => sameTab(each, tab))
      ? [...held.pages, tab]
      : held.pages;
  const terminals =
    isTerminalTab(tab) && !held.terminals.some((each) => sameTab(each, tab))
      ? [...held.terminals, tab]
      : held.terminals;
  const lastTerminals =
    isTerminalTab(tab) && taskId !== undefined && held.lastTerminals[taskId] !== tab.terminal
      ? { ...held.lastTerminals, [taskId]: tab.terminal }
      : held.lastTerminals;
  const macTerminals = isMacTerminalTab(tab)
    ? [...held.macTerminals.filter((each) => !sameTab(each, tab)), tab]
    : held.macTerminals;
  const chosen = isMacTerminalTab(tab) ? tab : (open ?? tab);
  return opened === held &&
    macTerminals === held.macTerminals &&
    subagents === held.subagents &&
    files === held.files &&
    pages === held.pages &&
    terminals === held.terminals &&
    lastTerminals === held.lastTerminals &&
    chosen === held.tab
    ? held
    : { ...opened, subagents, files, pages, terminals, lastTerminals, macTerminals, tab: chosen };
}

/** An inbox read with nothing waiting, or never read. */
const NO_ITEMS: readonly string[] = [];

/**
 * The state with `waiting`, the items waiting in the inbox of the task `on`
 * by id, seen, and its Inbox opened and chosen, the panel shown, where one
 * did not wait at its last read; an Inbox already open only sees them. Note
 * that an item answered leaves what is kept as it settles, so posted again
 * it is new, and that a task that has read nothing has seen no item, so its
 * first opens its Inbox. Where `shows` is false, as in a narrow room, whose
 * panel would stand full screen over the plan, the Inbox's tab opens at the
 * strip's end without being chosen, and the panel stays as it stood.
 */
function withInboxRead(
  held: HeldState,
  on: string,
  waiting: readonly string[],
  drawn: DrawnTabs,
  shows: boolean,
): HeldState {
  const was = taskTabs(held, on);
  const seen = was.inboxSeen ?? NO_ITEMS;
  const fresh = waiting.some((item) => !seen.includes(item));
  if (!fresh && waiting.length === seen.length) return held;
  const read = withTaskTabs(held, on, (choices) => ({ ...choices, inboxSeen: waiting }));
  const tab = SIDE_PANEL_TAB.INBOX;
  if (!fresh || was.opened.includes(tab)) return read;
  if (!shows) {
    const placed =
      on === drawn.task.id ? withTabLast(read, tab, drawn) : withTabLastOn(read, on, tab);
    return withChoice(placed, on, tab, true);
  }
  const here =
    on === drawn.task.id
      ? withTabLast(withChosenViewed(read, tab, drawn), tab, drawn)
      : withTabLastOn(read, on, tab);
  return { ...withTab(here, tab, on), open: true };
}

/** The range a reference lights, none for a whole file. */
function rangeOf(ref: CodeRef): OpenFile["range"] {
  return ref.startLine === undefined || ref.endLine === undefined
    ? undefined
    : { startLine: ref.startLine, endLine: ref.endLine };
}

/**
 * The state with the file's tab open and chosen, its lit lines the
 * reference's, opened once more, its history kept; at the commit named,
 * and drawn on the task named, where a commit pins it.
 */
function withFileOpened(
  held: HeldState,
  ref: CodeRef,
  pin: { readonly commit: string; readonly taskId: string | undefined } | undefined,
): HeldState {
  const standing = held.files.find((each) => each.path === ref.path);
  // Note that the tab keeps the way it came, since it shows the same file.
  const opened: OpenFile = {
    path: ref.path,
    range: rangeOf(ref),
    opened: (standing?.opened ?? 0) + 1,
    ...(pin === undefined ? undefined : { commit: pin.commit, browsedOn: pin.taskId }),
    ...(standing?.back === undefined ? undefined : { back: standing.back }),
    ...(standing?.forward === undefined ? undefined : { forward: standing.forward }),
    ...(standing?.foldedNotes === undefined ? undefined : { foldedNotes: standing.foldedNotes }),
  };
  const files =
    standing === undefined
      ? [...held.files, opened]
      : held.files.map((each) => (each === standing ? opened : each));
  return { ...held, files, tab: { file: ref.path }, open: true };
}

/**
 * The state with the tab a file already has chosen and the panel shown, as
 * browsing or a step of a tab's history to that file asks: a tab another
 * task browsed to moves to this one, since this task does not draw it.
 */
function withOpenFileChosen(
  held: HeldState,
  open: OpenFile,
  drawn: DrawnTabs,
  taskId: string | undefined,
): HeldState {
  const tab: SidePanelTab = { file: open.path };
  const drawnHere = drawn.files.includes(open.path)
    ? held
    : {
        ...held,
        files: held.files.map((each) => (each === open ? { ...each, browsedOn: taskId } : each)),
      };
  const chosen = withTabLast(withChosenViewed(drawnHere, tab, drawn), tab, drawn);
  return { ...withTab(chosen, tab, taskId), open: true };
}

/**
 * The state with a file shown whole, as a press naming the file and no lines
 * asks, ⌘K's or a File tab's tree's with ⌘ held: the tab it has, chosen as
 * it stands, or a new one at the strip's end, viewed after the tab it was
 * chosen from, and browsed to on the task named, so the task draws it
 * though Luke never showed it.
 */
function withFileShown(
  held: HeldState,
  path: string,
  drawn: DrawnTabs,
  taskId: string | undefined,
): HeldState {
  const open = held.files.find((each) => each.path === path);
  if (open !== undefined) return withOpenFileChosen(held, open, drawn, taskId);
  const tab: SidePanelTab = { file: path };
  const placed = withTabLast(withChosenViewed(held, tab, drawn), tab, drawn);
  return withFileBrowsed(placed, taskId, undefined, path);
}

/** What a File tab's history holds of the file it shows. */
function visitOf(file: OpenFile): FileVisit {
  return { path: file.path, range: file.range, browsedOn: file.browsedOn, commit: file.commit };
}

/**
 * The state with the File tab `from` showing the file a step back or
 * forward along its history, in its place in the strip too, the one it
 * showed moved to the other way's end; the tab as it stood where that way
 * holds nothing.
 */
function withFileStepped(
  held: HeldState,
  taskId: string | undefined,
  from: OpenFile,
  step: FileHistoryStep,
): HeldState {
  const back = from.back ?? [];
  const forward = from.forward ?? [];
  const to = step === FILE_HISTORY_STEP.BACK ? back.at(-1) : forward.at(-1);
  if (to === undefined) return held;
  const stepped: OpenFile = {
    ...to,
    opened: 1,
    back: step === FILE_HISTORY_STEP.BACK ? back.slice(0, -1) : [...back, visitOf(from)],
    forward: step === FILE_HISTORY_STEP.BACK ? [...forward, visitOf(from)] : forward.slice(0, -1),
    ...(from.foldedNotes === undefined ? undefined : { foldedNotes: from.foldedNotes }),
  };
  const files = held.files.map((each) => (each === from ? stepped : each));
  const placed = withFileInPlace(held, taskId, from.path, to.path);
  return { ...placed, files, tab: { file: to.path }, open: true };
}

/**
 * The state with the file browsed to shown in the File tab `from` stands
 * in, in that tab's place in the strip, or in a tab of its own at the
 * strip's end where `from` is none (`withTabLast`), its lines lit nowhere.
 */
function withFileBrowsed(
  held: HeldState,
  taskId: string | undefined,
  from: OpenFile | undefined,
  to: string,
): HeldState {
  const browsed: OpenFile = {
    path: to,
    range: undefined,
    opened: 1,
    browsedOn: taskId,
    ...(from === undefined ? undefined : { back: [...(from.back ?? []), visitOf(from)] }),
    ...(from?.foldedNotes === undefined ? undefined : { foldedNotes: from.foldedNotes }),
  };
  const files =
    from === undefined
      ? [...held.files, browsed]
      : held.files.map((each) => (each === from ? browsed : each));
  const placed = from === undefined ? held : withFileInPlace(held, taskId, from.path, to);
  return { ...placed, files, tab: { file: to }, open: true };
}

/**
 * Whether the task draws the subagent's tab: the brain's worker's while
 * the task's work holds its call, and a delegated worker's while the
 * agent that delegated has its tab open, or until the agents are read, as
 * an agent's own tab stands. `agents` are the open agent tabs.
 */
export function drawsSubagent(
  tab: SubagentStripTab,
  drawn: Pick<DrawnTabs, "agents" | "subagents">,
): boolean {
  if (tab.delegation === undefined) return drawn.subagents.includes(tab.subagent);
  return drawn.agents === undefined || drawn.agents.includes(tab.delegation.agent);
}

/**
 * Whether the task draws the agent's Changes tab: while the agent is the
 * task's, its own tab open in the task's column or not, since the "+"
 * opens it either way, or until the agents are read, as a delegated
 * worker's tab stands.
 */
export function drawsChanges(tab: ChangesStripTab, drawn: Pick<DrawnTabs, "taskAgents">): boolean {
  return drawn.taskAgents === undefined || drawn.taskAgents.includes(tab.changes);
}

/**
 * Whether the task draws the agent's Terminal tab: once its agents are read
 * and the agent is among them. Note that it waits for the read, unlike a
 * Changes tab, because a Terminal tab is kept across no launch, so nothing
 * stands in for it meanwhile, and the tabs are held across the tasks.
 */
export function drawsTerminal(
  tab: TerminalStripTab,
  drawn: Pick<DrawnTabs, "taskAgents">,
): boolean {
  return drawn.taskAgents?.includes(tab.terminal) === true;
}

/** Whether the plan draws the agent's tab of a terminal of this Mac: once its agents are read and the agent is among them, as a Terminal tab (`drawsTerminal`). */
export function drawsMacTerminal(
  tab: MacTerminalStripTab,
  drawn: Pick<DrawnTabs, "taskAgents">,
): boolean {
  return drawn.taskAgents?.includes(tab.macTerminal) === true;
}

/** The open file tabs of files shown on the task, by path, in the strip's order. */
function drawnFiles(held: HeldState, drawn: DrawnTabs): readonly string[] {
  return held.files.flatMap((each) => (drawn.files.includes(each.path) ? [each.path] : []));
}

/** The Changes tabs open on the task that it draws (`drawsChanges`), in the order opened. */
function drawnChanges(held: HeldState, drawn: DrawnTabs): readonly ChangesStripTab[] {
  return (taskTabs(held, drawn.task.id).changes ?? NO_CHANGES).filter((each) =>
    drawsChanges(each, drawn),
  );
}

/** The Browser tabs opened on the task, which it alone draws, in the order opened. */
function drawnBrowsers(held: HeldState, taskId: string | undefined): readonly OpenBrowser[] {
  return held.browsers.filter((each) => each.task === taskId);
}

/** The open subagent tabs the task draws, in the order opened. */
function drawnSubagents(held: HeldState, drawn: DrawnTabs): readonly SubagentStripTab[] {
  return held.subagents.filter((each) => drawsSubagent(each, drawn));
}

/**
 * The strip's tabs in its order: the task's fixed tabs, the subagent tabs,
 * and the file tabs the task draws, in the task's order (`inTaskOrder`). A
 * tab another task's work holds is not in it.
 */
function stripOf(held: HeldState, drawn: DrawnTabs): readonly SidePanelTab[] {
  const kinds = [
    ...drawnFixed(held, drawn.task),
    ...drawnSubagents(held, drawn),
    ...drawnFiles(held, drawn).map((file) => ({ file })),
    ...drawnChanges(held, drawn),
    ...held.pages.filter((each) => drawn.pages.includes(each.page)),
    ...held.terminals.filter((each) => drawsTerminal(each, drawn)),
    ...held.macTerminals.filter((each) => drawsMacTerminal(each, drawn)),
    ...drawnBrowsers(held, drawn.task.id).map((each) => each.tab),
  ];
  return inTaskOrder(kinds, orderOn(held, drawn.task.id), (tab) => tab);
}

/**
 * The tabs a chosen tab the task does not have reads as the first of
 * (`shownTab`): the task's fixed tabs in the strip's order, after the tab of
 * another kind moved ahead of them where one stands first in the strip. Note
 * that the tab ahead is the task's order's own, so it is the same object from
 * one render to the next, as the tab shown must be.
 */
function fallbackTabs(held: HeldState, drawn: DrawnTabs): readonly SidePanelTab[] {
  const fixed = drawnFixed(held, drawn.task);
  const head = stripOf(held, drawn)[0];
  const ahead =
    head === undefined || isFixedTab(head)
      ? undefined
      : orderOn(held, drawn.task.id).find((tab) => sameTab(tab, head));
  return ahead === undefined ? fixed : [ahead, ...fixed];
}

/** The tab the panel shows on the task: the chosen one as `shownTab` holds it to the task. */
function shownIn(held: HeldState, drawn: DrawnTabs): SidePanelTab | undefined {
  const browsers = drawnBrowsers(held, drawn.task.id);
  return shownTab(held.tab, fallbackTabs(held, drawn), drawn, drawnChanges(held, drawn), browsers);
}

/**
 * The state with the tab about to be chosen viewed on the task, after the
 * one shown until then. Note that the one shown is viewed too, because the
 * tab a close returns to is the one last looked at, which need never have
 * been chosen: the first a launch or a task shows, or one standing in.
 */
function withChosenViewed(held: HeldState, tab: SidePanelTab, drawn: DrawnTabs): HeldState {
  const shown = shownIn(held, drawn);
  const viewed = shown === undefined || sameTab(shown, tab) ? [tab] : [shown, tab];
  return withViewed(held, drawn.task.id, viewed);
}

/**
 * The state with the tab closed, gone from those viewed on the task, and
 * another chosen in its place if it was the one shown (`replacementOf`). A
 * fixed tab closes on the open task alone; closing a pinned tab leaves its
 * pin. Closing the last tab the plan's strip draws shuts the panel.
 */
function withoutTab(held: HeldState, tab: SidePanelTab, drawn: DrawnTabs): HeldState {
  const closed: HeldState | undefined = isFixedTab(tab)
    ? drawnFixed(held, drawn.task).includes(tab)
      ? withChoice(held, drawn.task.id, tab, false)
      : undefined
    : isSubagentTab(tab)
      ? held.subagents.some((each) => sameTab(each, tab))
        ? { ...held, subagents: held.subagents.filter((each) => !sameTab(each, tab)) }
        : undefined
      : isChangesTab(tab)
        ? withTaskTabs(held, drawn.task.id, (was) => ({
            ...was,
            changes: (was.changes ?? NO_CHANGES).filter((each) => !sameTab(each, tab)),
          }))
        : isPageTab(tab)
          ? { ...held, pages: held.pages.filter((each) => !sameTab(each, tab)) }
          : isTerminalTab(tab)
            ? { ...held, terminals: held.terminals.filter((each) => !sameTab(each, tab)) }
            : isMacTerminalTab(tab)
              ? { ...held, macTerminals: held.macTerminals.filter((each) => !sameTab(each, tab)) }
              : isBrowserTab(tab)
                ? { ...held, browsers: held.browsers.filter((each) => !sameTab(each.tab, tab)) }
                : { ...held, files: held.files.filter((each) => each.path !== tab.file) };
  if (closed === undefined) return held;
  const forgotten = withoutViewed(closed, drawn.task.id, tab);
  const left = stripOf(forgotten, drawn);
  // Note that only a close that empties the strip shuts the panel, because a
  // tab the strip never drew may close without the developer seeing it go.
  const shut = left.length === 0 && stripOf(held, drawn).length > 0;
  const kept = shut ? { ...forgotten, open: false } : forgotten;
  const shown = shownIn(held, drawn);
  if (shown === undefined || !sameTab(shown, tab)) return kept;
  const recent = taskTabs(kept, drawn.task.id).recent ?? [];
  const replacement = replacementOf(left, recent, stripOf(held, drawn), tab);
  return { ...kept, tab: replacement };
}

/**
 * The state with the tab moved to `to` in the task's strip, among tabs of
 * every kind, kept as the task's order (`movedOrder`).
 */
function withTabAt(held: HeldState, tab: SidePanelTab, to: number, drawn: DrawnTabs): HeldState {
  const taskId = drawn.task.id;
  const order = movedOrder(orderOn(held, taskId), stripOf(held, drawn), tab, to);
  return order === undefined
    ? held
    : withTaskTabs(held, taskId, (choices) => ({ ...choices, order }));
}

/**
 * The state with the tab, which the task's strip does not draw yet, written
 * at the end of the task's order (`openedOrder`), so the open about to
 * stand it in the strip stands it last. A tab the strip draws already
 * changes nothing, since opening it only chooses it.
 */
function withTabLast(held: HeldState, tab: SidePanelTab, drawn: DrawnTabs): HeldState {
  const taskId = drawn.task.id;
  const order = openedOrder(orderOn(held, taskId), stripOf(held, drawn), tab);
  return order === undefined
    ? held
    : withTaskTabs(held, taskId, (choices) => ({ ...choices, order }));
}

/**
 * The state with the tab written at the end of the order of `planId`, a
 * task whose strip is not drawn here, where that strip is sure not to draw
 * it: a fixed tab closed there, a Changes tab not open there, or a file with
 * no tab open. Every other
 * fixed kind is written before it, in the order a task whose order holds
 * none of them draws them, so it stands after whichever the task draws.
 * Any other tab changes nothing, since it may stand there already.
 */
function withTabLastOn(held: HeldState, taskId: string, tab: SidePanelTab): HeldState {
  const choices = taskTabs(held, taskId);
  const absent = isFixedTab(tab)
    ? choices.closed.includes(tab)
    : isChangesTab(tab)
      ? !(choices.changes ?? NO_CHANGES).some((each) => sameTab(each, tab))
      : isFileTab(tab) && !held.files.some((each) => each.path === tab.file);
  if (!absent) return held;
  const others = held.tabs.filter((each) => !sameTab(each, tab));
  const order = openedOrder(orderOn(held, taskId), others, tab);
  return order === undefined
    ? held
    : withTaskTabs(held, taskId, (choices) => ({ ...choices, order }));
}

/**
 * The state with each kind that arrived on the task, its tab not closed
 * there, standing at the strip's end in the kinds' order, as `withTabLast`
 * stands a tab opened. `drawn` is the task as it was before they arrived.
 */
function withArrived(
  held: HeldState,
  arrivals: readonly FixedSidePanelTab[],
  drawn: DrawnTabs,
): HeldState {
  const { closed } = taskTabs(held, drawn.task.id);
  return arrivals.reduce(
    (was, tab) => (closed.includes(tab) ? was : withTabLast(was, tab, drawn)),
    held,
  );
}

/**
 * The state with the file `to` standing in the task's order where the file
 * `from` stood, as a File tab showing another file in its place does, and
 * nowhere else: a `to` the order held from a tab closed earlier is taken
 * from where it stood. The state as it is where the order holds neither.
 */
function withFileInPlace(
  held: HeldState,
  taskId: string | undefined,
  from: string,
  to: string,
): HeldState {
  const order = orderOn(held, taskId);
  if (!order.some((tab) => isFileTab(tab) && (tab.file === from || tab.file === to))) return held;
  const others = order.filter((tab) => !isFileTab(tab) || tab.file !== to);
  return withTaskTabs(held, taskId, (choices) => ({
    ...choices,
    order: others.map((tab) => (isFileTab(tab) && tab.file === from ? { file: to } : tab)),
  }));
}

/** Whether a kept tab is of a kind this version still has: any but a retired fixed kind. */
function current<T>(tab: T): tab is Exclude<T, RetiredSidePanelTab> {
  return !RETIRED_TABS.has(tab);
}

/** Whether a kept choice of tab is one of this panel's today: a fixed kind not retired, or an agent's Changes, never an agent's own, which the task's column holds now. */
function panelChoice(tab: typeof anyTabSchema.Type): tab is FixedSidePanelTab | ChangesStripTab {
  return !isAgentTab(tab) && current(tab);
}

/** Each task's kept choices without the kinds retired since they were kept, nor an agent's, nor the strip pins `stripPins` reads. */
function currentTasks(tasks: SidePanelState["tasks"]): HeldState["tasks"] {
  return Object.fromEntries(
    Object.entries(tasks ?? {}).map(
      ([task, { opened, closed, recent, order, changes, inboxSeen }]) => [
        task,
        {
          opened: opened.filter(current),
          closed: closed.filter(current),
          ...(recent === undefined ? undefined : { recent: recent.filter(panelChoice) }),
          ...(order === undefined ? undefined : { order: order.filter(panelChoice) }),
          ...(changes === undefined ? undefined : { changes }),
          ...(inboxSeen === undefined ? undefined : { inboxSeen }),
        },
      ],
    ),
  );
}

/** The name a pin read from the strip's own carries until its task is next open: a fixed tab's kind, a file's name, the Call's, any Changes tab's, or any agent's. */
function stripPinLabel(tab: PinnableTab): string {
  if (isFileTab(tab)) return fileName(tab.file);
  if (isChangesTab(tab)) return TAB_WORDS.PULL_REQUEST;
  if (tab === MAIN_TAB.CALL) return TAB_WORDS.CALL;
  return isAgentTab(tab) ? TAB_WORDS.CODING_AGENT : SIDE_PANEL_TAB_KIND[tab].label;
}

/** Whether a kept pin opens a tab this version has: any but a retired fixed kind's, the Call's among them, which opens in the task's column now. */
function currentPin<T>(
  tab: T,
): tab is Exclude<T, RetiredSidePanelTab> | Extract<T, typeof MAIN_TAB.CALL> {
  return tab === MAIN_TAB.CALL || current(tab);
}

/** The state with the note of `callId` folded, or opened, on the File tab of `path`; as it was where no such tab stands. */
function withNoteFolded(held: HeldState, path: string, callId: string, folded: boolean): HeldState {
  const files = held.files.map((each) => {
    if (each.path !== path) return each;
    const others = (each.foldedNotes ?? []).filter((call) => call !== callId);
    return { ...each, foldedNotes: folded ? [...others, callId] : others };
  });
  return { ...held, files };
}

/**
 * The tabs an earlier version pinned in each task's strip, as the sidebar's
 * pins, in the order they stood and older than any pinned since, each
 * stamped before the one ahead of it. A subagent's, and a kind retired
 * since, is let go, since the sidebar holds no pin of one.
 */
function stripPins(tasks: NonNullable<SidePanelState["tasks"]>): readonly PinnedTab[] {
  const pinned = Object.entries(tasks).flatMap(([task, { pinned = [] }]) =>
    pinned.flatMap((tab) =>
      isPinnable(tab) && currentPin(tab) ? [{ task, tab, label: stripPinLabel(tab) }] : [],
    ),
  );
  return pinned.map((pin, place) => ({ ...pin, at: -place }));
}

/**
 * A kept or staged state made whole: every kind in the order once, those it
 * did not hold last, the width no narrower than its least, no subagent or
 * file tab open, nothing of a kind retired since it was kept nor an
 * agent's, and its pins, or where it is from before them, its strip's.
 */
function settled(state: SidePanelState): HeldState {
  const { tab, pins } = state;
  return {
    ...state,
    // The plan's tab leads, since a kept order from before it stood here holds it nowhere.
    tabs: [...new Set([SIDE_PANEL_TAB.PLAN, ...state.tabs.filter(current), ...SIDE_PANEL_TABS])],
    tab: tab === undefined || !panelChoice(tab) ? undefined : tab,
    width: clampWidth(state.width),
    subagents: [],
    files: [],
    pages: [],
    terminals: [],
    browsers: [],
    lastTerminals: {},
    pullRequestViews: new Map(),
    macTerminals: [],
    tasks: currentTasks(state.tasks),
    pins:
      pins === undefined
        ? stripPins(state.tasks ?? {})
        : pins.flatMap((pin) => {
            const { tab: pinned } = pin;
            return currentPin(pinned) ? [{ ...pin, tab: pinned }] : [];
          }),
  };
}

/** Whether a chosen or viewed tab is kept across a launch: a fixed tab or a Changes tab, the kinds that stand again after it. */
function keptChoice(tab: SidePanelTab): tab is FixedSidePanelTab | ChangesStripTab {
  return isFixedTab(tab) || isChangesTab(tab);
}

/** Each task's choices as they are kept: its tabs viewed and its order as `keptChoice` keeps them, its open Changes tabs, and none of them where it has none. */
function storedTasks(tasks: HeldState["tasks"]): NonNullable<SidePanelState["tasks"]> {
  const kept = (tabs: readonly SidePanelTab[]) => {
    const each = tabs.filter(keptChoice);
    return each.length === 0 ? undefined : each;
  };
  return Object.fromEntries(
    Object.entries(tasks).map(
      ([task, { opened, closed, recent = [], order = [], changes, inboxSeen }]) => [
        task,
        {
          opened,
          closed,
          recent: kept(recent),
          order: kept(order),
          changes: changes === undefined || changes.length === 0 ? undefined : changes,
          inboxSeen,
        },
      ],
    ),
  );
}

/** What is kept of the state: the preference without the subagent, file, page, Terminal, and Browser tabs, and without one of theirs chosen. */
function stored(state: HeldState): SidePanelState {
  const kept = {
    open: state.open,
    tabs: state.tabs,
    width: state.width,
    tasks: storedTasks(state.tasks),
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
 * The tab the panel shows for the one kept: a fixed tab the open task does
 * not draw, a subagent tab the task does not draw (`drawsSubagent`), a
 * Changes tab not among `changes`, those the task draws (`drawnChanges`), a
 * Browser tab not among `browsers`, those opened on the task, or a
 * file tab of a file not shown on the open task, reads as the first of
 * `tabs` (`fallbackTabs`), or as none where the task draws none. With the
 * task's agents not yet read, a delegated worker's tab stands, so a tab is
 * not swapped for another and back while the list is on its way; a
 * brain's worker's or a file's tab is kept across no launch, and a task
 * whose work is unread or has no turn holds no subagent, so nothing is
 * waited for on its account.
 */
function shownTab(
  kept: SidePanelTab | undefined,
  tabs: readonly SidePanelTab[],
  drawn: Omit<DrawnTabs, "plan">,
  changes: readonly ChangesStripTab[],
  browsers: readonly OpenBrowser[],
): SidePanelTab | undefined {
  if (kept === undefined) return tabs[0];
  if (isFixedTab(kept)) return tabs.includes(kept) ? kept : tabs[0];
  if (isFileTab(kept)) return drawn.files.includes(kept.file) ? kept : tabs[0];
  if (isChangesTab(kept)) return changes.some((each) => sameTab(each, kept)) ? kept : tabs[0];
  if (isPageTab(kept)) return drawn.pages.includes(kept.page) ? kept : tabs[0];
  if (isTerminalTab(kept)) return drawsTerminal(kept, drawn) ? kept : tabs[0];
  if (isMacTerminalTab(kept)) return drawsMacTerminal(kept, drawn) ? kept : tabs[0];
  if (isBrowserTab(kept)) return browsers.some((each) => sameTab(each.tab, kept)) ? kept : tabs[0];
  return drawsSubagent(kept, drawn) ? kept : tabs[0];
}

/** The kinds that stand once something of theirs is held, which every kind but the Inbox does: the Inbox stands only once opened (`drawnFixed`). */
const HELD_KINDS = SIDE_PANEL_TABS.filter((tab) => tab !== SIDE_PANEL_TAB.INBOX);

/** Whether two reads of what a task holds say the same of every kind. */
function sameHolds(a: TaskHolds, b: TaskHolds): boolean {
  return SIDE_PANEL_TABS.every((tab) => a[tab] === b[tab]);
}

/**
 * Whether a kind the task did not hold holds something now. Note that a
 * kind not yet read counts as one held nothing, because the host leaves the
 * task's work absent both before its read and when it found none, so a
 * first turn arrives from nothing known; a read
 * landing after another tab shows is held to the same rule, and the tab
 * shown stands rather than flickering to the one that landed.
 */
function arrived(was: TaskHolds, now: TaskHolds): boolean {
  return HELD_KINDS.some((tab) => was[tab] !== true && now[tab] === true);
}

/**
 * The kinds read as holding nothing that hold something now, in the kinds'
 * order. Note that a kind not yet read is left out, unlike in `arrived`,
 * because its read landing may be the task opening, whose strip stands as
 * it stood rather than in the order its reads happened to land.
 */
function firstHeld(was: TaskHolds, now: TaskHolds): readonly FixedSidePanelTab[] {
  return HELD_KINDS.filter((tab) => was[tab] === false && now[tab] === true);
}

/**
 * The side panel's state: the kept preference, kept again on every change,
 * or where a fixture run stages one, that staged state and the presses on
 * it, which are kept nowhere. `task` is the open task and what it holds of
 * each fixed kind, `agents` its agents whose tabs stand open in the task's
 * column, by agent id, or nothing while they have not been read,
 * `subagents` the brain's workers its work holds, by the call that started
 * each, none where the work has none or is unread, and `files` the files
 * Luke showed on it, by path, and `pages` the pages agents wrote for it, by
 * id; the tabs drawn and the tab shown are held to them, a delegated
 * worker's to the open agent tabs. In a narrow `room` the panel stands only
 * full screen, so leaving full screen there shuts it, and a room widened
 * again hands back the panel beside the document, or full screen where it
 * was asked for.
 */
export function useSidePanel(
  staged: SidePanelState | undefined,
  task: OpenTask,
  agents?: readonly string[] | undefined,
  subagents: readonly string[] = [],
  files: readonly string[] = [],
  pages: readonly string[] = NO_PAGES,
  taskAgents?: readonly string[] | undefined,
  room: ShellRoom = SHELL_ROOM.WIDE,
): SidePanelControl {
  // Note that the fixture run's panel is a state of its own rather than the
  // kept one reset, because the run is only known once the first state
  // arrives, a render after the kept preference was read.
  const [kept, setKept] = useState<HeldState>(readStored);
  const [moved, setMoved] = useState<HeldState | undefined>(undefined);
  const [fullScreen, setFullScreen] = useState(false);
  const [newTabAsked, setNewTabAsked] = useState(false);
  // The plan, or the agent's page, the panel was shown on with no tab, by ⌘T or the toggle.
  const [emptyShownOn, setEmptyShownOn] = useState<string | undefined>(undefined);
  const [seen, setSeen] = useState<OpenTask>(task);
  // The tab a pin or a notification asked for, while it is still the one chosen.
  const [asked, setAsked] = useState<{ task: string; tab: SidePanelTab } | undefined>(undefined);
  const stage = useMemo(() => (staged === undefined ? undefined : settled(staged)), [staged]);
  const taskId = task.id;
  const state = stage === undefined ? kept : (moved ?? stage);
  // A terminal of this Mac whose tab closes, whichever way it closes, is closed with it (`mac-terminal-acts.ts`).
  const { tell } = useAct();
  const heldMacTerminals = useRef(kept.macTerminals);
  useEffect(() => {
    for (const tab of heldMacTerminals.current) {
      if (!kept.macTerminals.some((each) => sameTab(each, tab))) {
        tell(ACT_KIND.MAC_TERMINAL_CLOSE, { agentId: tab.macTerminal });
      }
    }
    heldMacTerminals.current = kept.macTerminals;
  }, [kept.macTerminals, tell]);
  // The files the task draws tabs of: those Luke showed on it, and those browsed to on it.
  const taskFiles = useMemo(() => {
    const browsed = state.files.flatMap((each) =>
      each.browsedOn === taskId && !files.includes(each.path) ? [each.path] : [],
    );
    return browsed.length === 0 ? files : [...files, ...browsed];
  }, [files, state.files, taskId]);
  const update = useCallback(
    (change: (held: HeldState) => HeldState) => {
      if (stage === undefined) setKept(change);
      else setMoved((was) => change(was ?? stage));
    },
    [stage],
  );
  const shownFor = (holds: TaskHolds) =>
    shownIn(state, {
      task: { id: taskId, holds },
      agents,
      subagents,
      files: taskFiles,
      pages,
      taskAgents,
    });

  // Note that something arriving on the task adds its tab without taking
  // the shown one's place, because a tab ahead of it in the strip would
  // otherwise become the first, and a chosen tab the task lacked would come
  // back over the one standing in for it: the tab shown is kept as chosen.
  // A tab a pin or a notification asked for is the exception, since it was
  // chosen on this very task and stands in for nothing: a file's waits for
  // the task's code to be read, however much arrives before it. A kind that
  // arrived stands at the strip's end, as a tab opened does (`firstHeld`).
  if (seen.id !== taskId || seen.bare !== task.bare || !sameHolds(seen.holds, task.holds)) {
    setSeen(task);
    const before =
      seen.id === taskId && arrived(seen.holds, task.holds) ? shownFor(seen.holds) : undefined;
    const after = shownFor(task.holds);
    const awaited =
      asked !== undefined &&
      asked.task === taskId &&
      state.tab !== undefined &&
      sameTab(asked.tab, state.tab);
    if (!awaited && before !== undefined && (after === undefined || !sameTab(before, after))) {
      update((held) => ({ ...held, tab: before }));
    }
    const arrivals = seen.id === taskId ? firstHeld(seen.holds, task.holds) : [];
    if (arrivals.length > 0) {
      const was = { task: seen, agents, subagents, files: taskFiles, pages, taskAgents };
      update((held) => withArrived(held, arrivals, was));
    }
  }
  // Past the check above, `seen` is the task as it is, and a new object
  // only where the task or what it holds changed, so the strip drawn from
  // it is the same array until something it is drawn from changes.
  const tabs = useMemo(() => drawnFixed(state, seen), [state, seen]);
  const used = useMemo(
    () => SIDE_PANEL_TABS.filter((kind) => tabs.includes(kind) || seen.holds[kind] === true),
    [tabs, seen],
  );
  const drawn = useMemo(
    () => ({ task: seen, agents, subagents, files: taskFiles, pages, taskAgents }),
    [seen, agents, subagents, taskFiles, pages, taskAgents],
  );
  // A Browser tab closed, on whatever plan and however, takes its page with
  // it, since main holds a page for the window's life otherwise.
  const browserIds = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const standing = new Set(state.browsers.map((each) => each.tab.browser));
    for (const browserId of browserIds.current) {
      if (!standing.has(browserId)) tell(ACT_KIND.BROWSER_CLOSE, { browserId });
    }
    browserIds.current = standing;
  }, [state.browsers, tell]);
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

  const strip = useMemo(() => stripOf(state, drawn), [state, drawn]);
  // Open is the window's, so a plan whose strip is empty hides the panel
  // without forgetting it was open, and the next plan with a tab shows it.
  // The Inbox with nothing chosen has no task, so it is never shown empty there.
  const shown =
    state.open && (strip.length > 0 || (taskId !== undefined && emptyShownOn === taskId));
  // A panel shut, by its toggle or by its last tab closing, or hidden by a
  // plan with no tab, shows again beside the document and with no ask of
  // its "+" standing; one shut, or whose plan was left, is shown empty only
  // when asked again.
  if (!shown && (fullScreen || newTabAsked)) {
    setFullScreen(false);
    setNewTabAsked(false);
  }
  if (emptyShownOn !== undefined && (!state.open || emptyShownOn !== taskId)) {
    setEmptyShownOn(undefined);
  }

  // Note that showing a strip with no tab shows the panel empty, offering
  // in place what its "+" does, since there is nothing of the plan's to
  // show: the plan's page chooses a tab first (`useTasksTab`).
  const onToggle = useCallback(() => {
    setFullScreen(false);
    setNewTabAsked(false);
    if (shown) {
      update((held) => ({ ...held, open: false }));
      setEmptyShownOn(undefined);
      return;
    }
    update((held) => (held.open ? held : { ...held, open: true }));
    if (strip.length === 0) setEmptyShownOn(taskId);
  }, [update, shown, strip.length, taskId]);
  const onSetOpen = useCallback(
    (open: boolean) => {
      update((held) => (held.open === open ? held : { ...held, open }));
      if (open) return;
      setFullScreen(false);
      setNewTabAsked(false);
      setEmptyShownOn(undefined);
    },
    [update],
  );
  // Note that a narrow room holds the panel full screen alone, so leaving full screen there shuts it.
  const narrow = room === SHELL_ROOM.NARROW;
  const onToggleFullScreen = useCallback(() => {
    if (narrow) onSetOpen(false);
    else setFullScreen((was) => !was);
  }, [narrow, onSetOpen]);
  const onNewTab = useCallback(() => {
    update((held) => (held.open ? held : { ...held, open: true }));
    setEmptyShownOn(taskId);
    setNewTabAsked(true);
  }, [update, taskId]);
  const onNewTabAnswered = useCallback(() => setNewTabAsked(false), []);
  // Note that a narrow room holds the panel only full screen, so an item arriving there adds its tab without taking the plan's place.
  const onInboxRead = useCallback(
    (on: string, waiting: readonly string[]) =>
      update((held) => withInboxRead(held, on, waiting, drawn, !narrow)),
    [update, drawn, narrow],
  );
  const onChoose = useCallback(
    (tab: SidePanelTab) => {
      setAsked(undefined);
      update((held) => ({
        ...withTab(withTabLast(withChosenViewed(held, tab, drawn), tab, drawn), tab, taskId),
        open: true,
      }));
    },
    [update, drawn, taskId],
  );
  // Note that a tab shown on another task is not counted viewed on the open
  // one, because the task it is viewed on is the one about to open, whose
  // strip is not drawn yet; it goes to that strip's end only where it is
  // sure to stand in none of it (`withTabLastOn`).
  const onShow = useCallback(
    (on: string, tab: SidePanelTab) => {
      setAsked({ task: on, tab });
      update((held) => {
        const here =
          on === taskId
            ? withTabLast(withChosenViewed(held, tab, drawn), tab, drawn)
            : withTabLastOn(held, on, tab);
        return { ...withTab(here, tab, on), open: true };
      });
    },
    [update, drawn, taskId],
  );
  const onClose = useCallback(
    (tab: SidePanelTab) => update((held) => withoutTab(held, tab, drawn)),
    [update, drawn],
  );
  const onOpenFile = useCallback(
    (ref: CodeRef, commit?: string) =>
      update((held) => {
        if (ref.startLine === undefined && commit === undefined) {
          return withFileShown(held, ref.path, drawn, taskId);
        }
        const tab: SidePanelTab = { file: ref.path };
        return withFileOpened(
          withTabLast(withChosenViewed(held, tab, drawn), tab, drawn),
          ref,
          commit === undefined ? undefined : { commit, taskId },
        );
      }),
    [update, drawn, taskId],
  );
  // Note that a file with a tab of its own is chosen there, because a file
  // stands in one tab at most (`withFileShown`).
  const onBrowseFile = useCallback(
    (from: string, path: string, newTab: boolean) =>
      update((held) => {
        const standing = newTab ? undefined : held.files.find((each) => each.path === from);
        if (standing === undefined || held.files.some((each) => each.path === path)) {
          return withFileShown(held, path, drawn, taskId);
        }
        const viewed = withChosenViewed(held, { file: path }, drawn);
        return withFileBrowsed(viewed, taskId, standing, path);
      }),
    [update, drawn, taskId],
  );
  // Note that a step to a file with a tab of its own by then chooses that
  // tab and leaves this one as it stands, because a file stands in one tab
  // at most.
  const onFileHistory = useCallback(
    (from: string, step: FileHistoryStep) =>
      update((held) => {
        const standing = held.files.find((each) => each.path === from);
        if (standing === undefined) return held;
        const ways = step === FILE_HISTORY_STEP.BACK ? standing.back : standing.forward;
        const to = ways?.at(-1)?.path;
        if (to === undefined) return held;
        const open = held.files.find((each) => each.path === to);
        if (open !== undefined) return withOpenFileChosen(held, open, drawn, taskId);
        return withFileStepped(withChosenViewed(held, { file: to }, drawn), taskId, standing, step);
      }),
    [update, drawn, taskId],
  );
  const onFoldNote = useCallback(
    (path: string, callId: string, folded: boolean) =>
      update((held) => withNoteFolded(held, path, callId, folded)),
    [update],
  );
  const onPullRequestView = useCallback(
    (tab: ChangesStripTab, view: PullRequestView) =>
      update((held) =>
        ofPullRequestTab(held.pullRequestViews, tab) === view
          ? held
          : { ...held, pullRequestViews: withPullRequestTab(held.pullRequestViews, tab, view) },
      ),
    [update],
  );
  const onMove = useCallback(
    (tab: SidePanelTab, to: number) => update((held) => withTabAt(held, tab, to, drawn)),
    [update, drawn],
  );
  // Note that a file browsed to is drawn on the task it was browsed on, so
  // the strip the tab is placed in draws it from the moment it stands again.
  const onReopen = useCallback(
    (tab: SidePanelTab, at: number, file: OpenFile | undefined) => {
      setAsked(undefined);
      update((held) => {
        // A file stands in one tab at most, so the record kept with the tab
        // takes the place of one another task opened on the path since.
        const others = held.files.filter((each) => each.path !== file?.path);
        const restored = file === undefined ? held : { ...held, files: [...others, file] };
        const browsed =
          file !== undefined && file.browsedOn === taskId && !drawn.files.includes(file.path);
        const here = browsed ? { ...drawn, files: [...drawn.files, file.path] } : drawn;
        const opened = withTab(withChosenViewed(restored, tab, here), tab, taskId);
        return { ...withTabAt(opened, tab, at, here), open: true };
      });
    },
    [update, drawn, taskId],
  );
  const onPin = useCallback(
    (tab: PinnableTab, label: string, model?: string) => {
      if (taskId === undefined) return;
      const at = Date.now();
      const pin =
        model === undefined ? { task: taskId, tab, label } : { task: taskId, tab, label, model };
      update((held) => withPin(held, pin, at));
    },
    [update, taskId],
  );
  const onUnpin = useCallback(
    (on: string, tab: PinnableTab) => update((held) => withoutPin(held, on, tab)),
    [update],
  );
  const onRenamePins = useCallback(
    (on: string, names: PinNames) => update((held) => withPinsRenamed(held, on, names)),
    [update],
  );
  const onPlacePins = useCallback(
    (places: ReadonlyMap<number, string | undefined>) =>
      update((held) => withPinsPlaced(held, places)),
    [update],
  );
  const onResize = useCallback(
    (width: number) => update((held) => ({ ...held, width: clampWidth(width) })),
    [update],
  );
  // Note that the tab is placed at the strip's end before it is held,
  // because a tab the strip already draws is only chosen where it stands.
  const onOpenBrowser = useCallback(
    (address?: string) => {
      if (taskId === undefined) return;
      const tab: BrowserStripTab = { browser: crypto.randomUUID() };
      setAsked(undefined);
      update((held) => {
        const placed = withTabLast(withChosenViewed(held, tab, drawn), tab, drawn);
        const browsers = [...placed.browsers, { tab, task: taskId, address }];
        return { ...withTab({ ...placed, browsers }, tab, taskId), open: true };
      });
    },
    [update, drawn, taskId],
  );
  // Note that a Browser tab chosen goes too, and the plan shows its first tab in its place.
  const onCloseBrowsers = useCallback(
    () =>
      update((held) =>
        held.browsers.length === 0
          ? held
          : {
              ...held,
              browsers: [],
              tab: held.tab !== undefined && isBrowserTab(held.tab) ? undefined : held.tab,
            },
      ),
    [update],
  );
  const onBrowserOpened = useCallback(
    (browserId: string, address: string) =>
      update((held) => {
        const standing = held.browsers.find((each) => each.tab.browser === browserId);
        if (standing === undefined || standing.address !== undefined) return held;
        const opened = { ...standing, address };
        return {
          ...held,
          browsers: held.browsers.map((each) => (each === standing ? opened : each)),
        };
      }),
    [update],
  );
  const browsers = useMemo(() => drawnBrowsers(state, taskId), [state, taskId]);
  return {
    open: shown,
    tabs,
    strip,
    order: orderOn(state, taskId),
    closedTabs: taskTabs(state, taskId).closed,
    used,
    pins: state.pins,
    subagents: state.subagents,
    changes: taskTabs(state, taskId).changes ?? NO_CHANGES,
    pages: state.pages,
    terminals: state.terminals,
    lastTerminal: taskId === undefined ? undefined : state.lastTerminals[taskId],
    pullRequestViews: state.pullRequestViews,
    onPullRequestView,
    browsers,
    files: state.files,
    tab: shownIn(state, drawn),
    width: state.width,
    fullScreen: shown && (fullScreen || narrow),
    fullScreenOnly: shown && narrow,
    newTabAsked: shown && newTabAsked,
    onToggle,
    onSetOpen,
    onToggleFullScreen,
    onNewTab,
    onNewTabAnswered,
    onInboxRead,
    onChoose,
    onShow,
    onClose,
    onMove,
    onReopen,
    onPin,
    onUnpin,
    onRenamePins,
    onPlacePins,
    onOpenFile,
    onBrowseFile,
    onFileHistory,
    onFoldNote,
    onResize,
    onOpenBrowser,
    onCloseBrowsers,
    onBrowserOpened,
  };
}
