import { type PagePlace, pagePlaceId } from "@repo/features/page-wire";
import type { CodeRef } from "@repo/features/task-wire";
import { CommentsIcon, DocumentIcon } from "@repo/ui";
import {
  type AgentStripTab,
  type ChangesStripTab,
  type CloudBrowserStripTab,
  type FileStripTab,
  inTaskOrder,
  isAgentTab,
  isChangesTab,
  isCloudBrowserTab,
  isFileTab,
  isLocalTab,
  isPageTab,
  isSubagentTab,
  isTerminalTab,
  isTranscriptTab,
  type LocalStripTab,
  movedOrder,
  openedOrder,
  type PageStripTab,
  replacementOf,
  type StripTab,
  type SubagentStripTab,
  sameTab,
  stampedViewed,
  TAB_WORDS,
  type TerminalStripTab,
  type TranscriptStripTab,
  type ViewedAt,
  viewedLast,
  withoutViewedAt,
} from "@repo/ui/tab-strip-model";
import { Option, Schema } from "effect";
import { InboxIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { fileName } from "./file-ref-model.js";
import {
  type ByPullRequestTab,
  ofPullRequestTab,
  withPullRequestTab,
} from "./pull-request-number.js";

export const SIDE_PANEL_TAB = {
  DESCRIPTION: "plan",
  INBOX: "inbox",
  COMMENTS: "comments",
} as const;

const RETIRED_SIDE_PANEL_TAB = {
  HISTORY: "history",
  TRANSCRIPT: "transcript",
  WORK: "work",
  CALL: "call",
  CHAT: "chat",
  CODE: "code",
  BOARD: "board",
} as const;

type RetiredSidePanelTab = (typeof RETIRED_SIDE_PANEL_TAB)[keyof typeof RETIRED_SIDE_PANEL_TAB];

const RETIRED_TABS: ReadonlySet<unknown> = new Set(Object.values(RETIRED_SIDE_PANEL_TAB));

export type FixedSidePanelTab = (typeof SIDE_PANEL_TAB)[keyof typeof SIDE_PANEL_TAB];

export type SidePanelTab =
  | FixedSidePanelTab
  | TranscriptStripTab
  | SubagentStripTab
  | FileStripTab
  | ChangesStripTab
  | TerminalStripTab
  | LocalStripTab
  | PageStripTab
  | CloudBrowserStripTab;

export type FileReadPlace =
  | { readonly taskId: string }
  | { readonly workspaceId: string; readonly repository: string };

export interface FileReads {
  readonly place: FileReadPlace;
  readonly repository: string | null;
}

export interface OpenFile {
  readonly path: string;
  readonly range: { readonly startLine: number; readonly endLine: number } | undefined;
  readonly opened: number;
  readonly browsedOn?: string | undefined;
  readonly reads?: FileReads | undefined;
  readonly commit?: string | undefined;
  readonly back?: readonly FileVisit[];
  readonly forward?: readonly FileVisit[];
}

type FileVisit = Pick<OpenFile, "path" | "range" | "browsedOn" | "reads" | "commit">;

export const PULL_REQUEST_VIEW = {
  CONVERSATION: "conversation",
  CHECKS: "checks",
  CHAPTERS: "chapters",
  FILES: "files",
} as const;

export type PullRequestView = (typeof PULL_REQUEST_VIEW)[keyof typeof PULL_REQUEST_VIEW];

export const FILE_HISTORY_STEP = {
  BACK: "back",
  FORWARD: "forward",
} as const;

export type FileHistoryStep = (typeof FILE_HISTORY_STEP)[keyof typeof FILE_HISTORY_STEP];

interface SidePanelTabKind {
  label: string;
  icon: React.ComponentType;
}

export const SIDE_PANEL_TAB_KIND = {
  [SIDE_PANEL_TAB.DESCRIPTION]: { label: "Description", icon: DocumentIcon },
  [SIDE_PANEL_TAB.INBOX]: { label: TAB_WORDS.INBOX, icon: InboxIcon },
  [SIDE_PANEL_TAB.COMMENTS]: { label: "Comments", icon: CommentsIcon },
} as const satisfies Record<FixedSidePanelTab, SidePanelTabKind>;

export const SIDE_PANEL_TABS: readonly FixedSidePanelTab[] = Object.values(SIDE_PANEL_TAB);

const FIXED_TABS: ReadonlySet<StripTab> = new Set(SIDE_PANEL_TABS);

const RETIRED_KINDS: readonly FixedSidePanelTab[] = [SIDE_PANEL_TAB.INBOX, SIDE_PANEL_TAB.COMMENTS];

export const DRAWN_KINDS: readonly FixedSidePanelTab[] = SIDE_PANEL_TABS.filter(
  (kind) => kind !== SIDE_PANEL_TAB.DESCRIPTION && !RETIRED_KINDS.includes(kind),
);

function retiredKind(tab: SidePanelTab): boolean {
  return RETIRED_KINDS.some((kind) => kind === tab);
}

function isFixedTab(tab: SidePanelTab): tab is FixedSidePanelTab {
  return FIXED_TABS.has(tab);
}

export const SIDE_PANEL_WIDTH = {
  MIN: 280,
  DEFAULT: 400,
} as const;

const STORAGE_KEY = "app.sidePanel";

const RECENT_KEPT = 20;

const TASKS_KEPT = 500;

const VIEWED_KEPT = 50;

const sidePanelTabSchema = Schema.Literals([
  ...SIDE_PANEL_TABS,
  ...Object.values(RETIRED_SIDE_PANEL_TAB),
]);
const changesTabSchema = Schema.Struct({
  changes: Schema.String,
  number: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
});
const anyTabSchema = Schema.Union([
  sidePanelTabSchema,
  Schema.Struct({ agent: Schema.String }),
  changesTabSchema,
]);

const PINS_KEPT = 100;

const pinnableTabSchema = Schema.Union([
  sidePanelTabSchema,
  Schema.Struct({ file: Schema.String }),
  changesTabSchema,
]);

const keptTaskPinTabSchema = Schema.Union([
  pinnableTabSchema,
  Schema.Struct({ agent: Schema.String }),
]);

const taskPinSchema = Schema.Struct({
  task: Schema.String,
  tab: keptTaskPinTabSchema,
  label: Schema.String,
  at: Schema.Number,
  position: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
});

const agentHolderPinSchema = Schema.Struct({
  agent: Schema.String,
  tab: pinnableTabSchema,
  label: Schema.String,
  at: Schema.Number,
  position: Schema.optionalKey(Schema.String),
});

type KeptPin = typeof taskPinSchema.Type | typeof agentHolderPinSchema.Type;

export type PinnableTab = Exclude<typeof pinnableTabSchema.Type, RetiredSidePanelTab>;

export type PinHolder = { readonly task: string } | { readonly agent: string };

export function sameHolder(a: PinHolder, b: PinHolder): boolean {
  return "task" in a ? "task" in b && a.task === b.task : "agent" in b && a.agent === b.agent;
}

interface PinFields {
  readonly tab: PinnableTab;
  readonly label: string;
  readonly at: number;
  readonly position?: string;
}

export type PinnedTab = PinFields & PinHolder;

export interface AgentPin {
  readonly task: string;
  readonly tab: AgentStripTab;
  readonly label: string;
  readonly at: number;
  readonly position?: string;
  readonly model: string;
}

export type SidebarPin = PinnedTab | AgentPin;

export function isAgentPin(pin: SidebarPin): pin is AgentPin {
  return isAgentTab(pin.tab);
}

export function samePin(a: SidebarPin, b: SidebarPin): boolean {
  if (isAgentPin(a) || isAgentPin(b)) {
    return isAgentPin(a) && isAgentPin(b) && a.tab.agent === b.tab.agent;
  }
  return sameHolder(a, b) && a.at === b.at;
}

type CarriedPin = typeof taskPinSchema.Type & { readonly tab: AgentStripTab };

export interface CarriedAgentPin {
  readonly agent: string;
  readonly task: string;
  readonly position?: string;
}

interface PinNames {
  readonly pullRequests: ReadonlyMap<string, string>;
  readonly numbered?: ByPullRequestTab<string>;
}

const stripPinSchema = Schema.Union([
  keptTaskPinTabSchema,
  Schema.Struct({
    subagent: Schema.String,
    delegation: Schema.optionalKey(Schema.Struct({ agent: Schema.String, task: Schema.String })),
  }),
]);

const taskTabsSchema = Schema.Struct({
  opened: Schema.Array(sidePanelTabSchema),
  closed: Schema.Array(sidePanelTabSchema),
  pinned: Schema.optional(Schema.Array(stripPinSchema)),
  recent: Schema.optional(Schema.Array(anyTabSchema)),
  order: Schema.optional(Schema.Array(anyTabSchema)),
  changes: Schema.optional(Schema.Array(changesTabSchema)),
  viewedAt: Schema.optional(Schema.Array(Schema.Struct({ tab: anyTabSchema, at: Schema.Number }))),
});

interface TaskTabs {
  readonly opened: readonly FixedSidePanelTab[];
  readonly closed: readonly FixedSidePanelTab[];
  readonly recent?: readonly SidePanelTab[] | undefined;
  readonly order?: readonly SidePanelTab[] | undefined;
  readonly changes?: readonly ChangesStripTab[] | undefined;
  readonly viewedAt?: readonly ViewedAt<SidePanelTab>[] | undefined;
}

const sidePanelStateSchema = Schema.Struct({
  open: Schema.Boolean,
  tabs: Schema.Array(sidePanelTabSchema),
  tab: Schema.optional(anyTabSchema),
  width: Schema.Number,
  tasks: Schema.optional(Schema.Record(Schema.String, taskTabsSchema)),
  pins: Schema.optional(Schema.Array(taskPinSchema)),
  agentPins: Schema.optional(Schema.Array(agentHolderPinSchema)),
});

export type SidePanelState = typeof sidePanelStateSchema.Type;

export interface StagedSidePanel extends Omit<SidePanelState, "tab"> {
  readonly tab?: SidePanelState["tab"] | FileStripTab | PageStripTab | TerminalStripTab;
  readonly files?: readonly OpenFile[];
  readonly pages?: readonly OpenPage[];
  readonly terminals?: readonly TerminalStripTab[];
  readonly pullRequestViews?: ByPullRequestTab<PullRequestView>;
}

interface HeldState extends Omit<SidePanelState, "tabs" | "tab" | "tasks" | "pins"> {
  readonly tabs: readonly FixedSidePanelTab[];
  readonly tab?: SidePanelTab | undefined;
  readonly subagents: readonly SubagentStripTab[];
  readonly transcripts: readonly TranscriptStripTab[];
  readonly files: readonly OpenFile[];
  readonly pages: readonly OpenPage[];
  readonly terminals: readonly TerminalStripTab[];
  readonly locals: readonly LocalStripTab[];
  readonly openedCloudBrowsers: readonly string[];
  readonly lastTerminals: Readonly<Record<string, string>>;
  readonly pullRequestViews: ByPullRequestTab<PullRequestView>;
  readonly previews: Readonly<Record<string, SidePanelTab>>;
  readonly tasks: Readonly<Record<string, TaskTabs>>;
  readonly pins: readonly PinnedTab[];
  readonly carried: readonly CarriedPin[];
}

const NO_CHOICES: TaskTabs = { opened: [], closed: [] };

const earlierSidePanelSchema = Schema.Struct({
  open: Schema.Boolean,
  tab: anyTabSchema,
  width: Schema.Number,
});

const keptPinSchema = Schema.Union([
  taskPinSchema,
  taskPinSchema.mapFields(({ task: _task, ...fields }) => ({ ...fields, plan: Schema.String })),
]);

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

const FIRST_LAUNCH: SidePanelState = {
  open: false,
  tabs: SIDE_PANEL_TABS,
  width: SIDE_PANEL_WIDTH.DEFAULT,
};

export interface SidePanelControl {
  open: boolean;
  toggleAsked: boolean;
  fullScreen: boolean;
  fullScreenOnly: boolean;
  newTabAsked: boolean;
  tabs: readonly FixedSidePanelTab[];
  preview: SidePanelTab | undefined;
  order: readonly SidePanelTab[];
  closedTabs: readonly FixedSidePanelTab[];
  used: readonly FixedSidePanelTab[];
  pins: readonly PinnedTab[];
  subagents: readonly SubagentStripTab[];
  files: readonly OpenFile[];
  changes: readonly ChangesStripTab[];
  pages: readonly OpenPage[];
  terminals: readonly TerminalStripTab[];
  locals: readonly LocalStripTab[];
  lastTerminal: string | undefined;
  pullRequestViews: ByPullRequestTab<PullRequestView>;
  onPullRequestView: (tab: ChangesStripTab, view: PullRequestView) => void;
  strip: readonly SidePanelTab[];
  tab: SidePanelTab | undefined;
  width: number;
  opened: number;
  onToggle: () => void;
  onSetOpen: (open: boolean) => void;
  onToggleFullScreen: () => void;
  onNewTab: () => void;
  onToggleAskedAnswered: () => void;
  onNewTabAnswered: () => void;
  onChoose: (tab: SidePanelTab) => void;
  onPreview: (tab: SidePanelTab, place?: PagePlace) => void;
  onPreviewFile: (ref: CodeRef, commit?: string, reads?: FileReads) => void;
  onKeep: (tab: SidePanelTab) => void;
  onShow: (taskId: string, tab: SidePanelTab) => void;
  onCarry: () => void;
  onClose: (tab: SidePanelTab) => void;
  onCloseOn: (taskId: string, tab: FixedSidePanelTab) => void;
  onMove: (tab: SidePanelTab, to: number) => void;
  onReopen: (tab: SidePanelTab, at: number, file: OpenFile | undefined) => void;
  onPin: (holder: PinHolder, tab: PinnableTab, label: string) => void;
  onUnpin: (holder: PinHolder, tab: PinnableTab) => void;
  carried: readonly CarriedAgentPin[];
  onCarried: (agentId: string) => void;
  onRenamePins: (taskId: string, names: PinNames) => void;
  onPlacePins: (places: ReadonlyMap<number, string | undefined>) => void;
  onOpenFile: (ref: CodeRef, commit?: string, reads?: FileReads) => void;
  onBrowseFile: (from: string | undefined, path: string, newTab: boolean) => void;
  onFileHistory: (from: string, step: FileHistoryStep) => void;
  onResize: (width: number) => void;
  viewedAt: readonly ViewedAt<SidePanelTab>[];
  onViewedAt: (
    taskId: string,
    viewed: readonly SidePanelTab[],
    standing: readonly SidePanelTab[],
    at: number,
  ) => void;
}

function clampWidth(width: number): number {
  return Math.max(SIDE_PANEL_WIDTH.MIN, Math.round(width));
}

export type TaskHolds = Partial<Record<FixedSidePanelTab, boolean | undefined>>;

export interface OpenTask {
  id: string | undefined;
  holds: TaskHolds;
  bare?: true | undefined;
  files?: FileReads | undefined;
  pages?: PagePlace | undefined;
  stop?: string | undefined;
}

export interface DrawnTabs {
  task: OpenTask;
  agents: readonly string[] | undefined;
  subagents: readonly string[];
  files: readonly string[];
  pages: readonly string[];
  taskAgents: readonly string[] | undefined;
  heldAgents?: readonly string[] | undefined;
  cloudBrowsers?: readonly string[] | undefined;
}

function taskTabs(held: HeldState, taskId: string | undefined): TaskTabs {
  return taskId === undefined ? NO_CHOICES : (held.tasks[taskId] ?? NO_CHOICES);
}

export interface OpenPage extends PageStripTab {
  readonly place?: PagePlace | undefined;
  readonly shownOn?: string | undefined;
}

const NO_PAGES: readonly string[] = [];

const NO_CHANGES: readonly ChangesStripTab[] = [];

const NO_FIXED: readonly FixedSidePanelTab[] = [];

const NO_ORDER: readonly SidePanelTab[] = [];

const NO_STAMPS: readonly ViewedAt<SidePanelTab>[] = [];

function orderOn(held: HeldState, taskId: string | undefined): readonly SidePanelTab[] {
  return taskTabs(held, taskId).order ?? NO_ORDER;
}

function drawnFixed(held: HeldState, task: OpenTask): readonly FixedSidePanelTab[] {
  if (task.bare === true) return NO_FIXED;
  const chosen = taskTabs(held, task.id);
  const open = held.tabs.filter(
    (tab) =>
      DRAWN_KINDS.includes(tab) &&
      (chosen.opened.includes(tab) || (!chosen.closed.includes(tab) && task.holds[tab] === true)),
  );
  return inTaskOrder(open, orderOn(held, task.id), (tab) => tab);
}

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

export function isPinnable(tab: StripTab): tab is PinnableTab {
  return FIXED_TABS.has(tab) || isFileTab(tab) || isChangesTab(tab);
}

function pinOf(pin: PinnedTab, holder: PinHolder, tab: PinnableTab): boolean {
  return sameHolder(pin, holder) && sameTab(pin.tab, tab);
}

function withPin(
  held: HeldState,
  holder: PinHolder,
  tab: PinnableTab,
  label: string,
  at: number,
): HeldState {
  if (held.pins.some((each) => pinOf(each, holder, tab))) return held;
  const newest = held.pins[0]?.at ?? Number.NEGATIVE_INFINITY;
  const pinned: PinnedTab = { ...holder, tab, label, at: Math.max(at, newest + 1) };
  return { ...held, pins: [pinned, ...held.pins].slice(0, PINS_KEPT) };
}

function withoutPin(held: HeldState, holder: PinHolder, tab: PinnableTab): HeldState {
  if (!held.pins.some((each) => pinOf(each, holder, tab))) return held;
  return { ...held, pins: held.pins.filter((each) => !pinOf(each, holder, tab)) };
}

function withoutCarried(held: HeldState, agentId: string): HeldState {
  if (!held.carried.some((pin) => pin.tab.agent === agentId)) return held;
  return { ...held, carried: held.carried.filter((pin) => pin.tab.agent !== agentId) };
}

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

function agentPinLabel(tab: PinnableTab, names: PinNames): string | undefined {
  if (!isChangesTab(tab)) return undefined;
  return tab.number === undefined
    ? names.pullRequests.get(tab.changes)
    : ofPullRequestTab(names.numbered ?? new Map(), tab);
}

function withPinsRenamed(held: HeldState, taskId: string, names: PinNames): HeldState {
  const renamed = (pin: PinnedTab) => {
    const label = "task" in pin && pin.task === taskId ? agentPinLabel(pin.tab, names) : undefined;
    return label === undefined || label === pin.label ? pin : { ...pin, label };
  };
  const pins = held.pins.map(renamed);
  return pins.every((pin, at) => pin === held.pins[at]) ? held : { ...held, pins };
}

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

function withoutViewed(held: HeldState, taskId: string | undefined, tab: SidePanelTab): HeldState {
  const { recent = [], viewedAt = NO_STAMPS } = taskTabs(held, taskId);
  const stamps = withoutViewedAt(viewedAt, tab);
  if (!recent.some((each) => sameTab(each, tab)) && stamps === viewedAt) return held;
  return withTaskTabs(held, taskId, (was) => ({
    ...was,
    recent: recent.filter((each) => !sameTab(each, tab)),
    ...(stamps === viewedAt ? undefined : { viewedAt: stamps }),
  }));
}

function withViewedAt(
  held: HeldState,
  taskId: string | undefined,
  viewed: readonly SidePanelTab[],
  standing: readonly SidePanelTab[],
  at: number,
): HeldState {
  return withTaskTabs(held, taskId, (was) => {
    const viewedAt = stampedViewed(was.viewedAt ?? NO_STAMPS, viewed, standing, at, VIEWED_KEPT);
    return viewedAt === undefined ? was : { ...was, viewedAt };
  });
}

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

function withTab(
  held: HeldState,
  tab: SidePanelTab,
  taskId: string | undefined,
  bare = false,
): HeldState {
  const opened = isFixedTab(tab)
    ? bare
      ? held
      : withChoice(held, taskId, tab, true)
    : isChangesTab(tab)
      ? withChangesOpened(held, taskId, tab)
      : held;
  const open = isSubagentTab(tab) ? held.subagents.find((each) => sameTab(each, tab)) : undefined;
  const subagents =
    isSubagentTab(tab) && open === undefined ? [...held.subagents, tab] : held.subagents;
  const files =
    isFileTab(tab) && !held.files.some((each) => each.path === tab.file)
      ? [...held.files, { path: tab.file, range: undefined, opened: 0, browsedOn: taskId }]
      : held.files;
  const pages =
    isPageTab(tab) && !held.pages.some((each) => sameTab(each, tab))
      ? [...held.pages, tab]
      : held.pages;
  const transcripts =
    isTranscriptTab(tab) && !held.transcripts.some((each) => sameTab(each, tab))
      ? [...held.transcripts, tab]
      : held.transcripts;
  const terminals =
    isTerminalTab(tab) && !held.terminals.some((each) => sameTab(each, tab))
      ? [...held.terminals, tab]
      : held.terminals;
  const locals =
    isLocalTab(tab) && !held.locals.some((each) => sameTab(each, tab))
      ? [...held.locals, tab]
      : held.locals;
  const lastTerminals =
    isTerminalTab(tab) && taskId !== undefined && held.lastTerminals[taskId] !== tab.terminal
      ? { ...held.lastTerminals, [taskId]: tab.terminal }
      : held.lastTerminals;
  const openedCloudBrowsers =
    isCloudBrowserTab(tab) && !held.openedCloudBrowsers.includes(tab.cloudBrowser)
      ? [...held.openedCloudBrowsers, tab.cloudBrowser]
      : held.openedCloudBrowsers;
  const chosen = open ?? tab;
  return opened === held &&
    openedCloudBrowsers === held.openedCloudBrowsers &&
    subagents === held.subagents &&
    files === held.files &&
    pages === held.pages &&
    transcripts === held.transcripts &&
    terminals === held.terminals &&
    locals === held.locals &&
    lastTerminals === held.lastTerminals &&
    chosen === held.tab
    ? held
    : {
        ...opened,
        subagents,
        transcripts,
        files,
        pages,
        terminals,
        locals,
        lastTerminals,
        openedCloudBrowsers,
        tab: chosen,
      };
}

function withPagePlaced(
  held: HeldState,
  tab: SidePanelTab,
  place: PagePlace | undefined,
  beside?: { readonly place: PagePlace; readonly on: string },
): HeldState {
  if (!isPageTab(tab) || (place === undefined && beside === undefined)) return held;
  const standing = held.pages.find((each) => sameTab(each, tab));
  if (standing === undefined) return held;
  if (beside !== undefined) {
    const placed = { ...standing, place: beside.place, shownOn: beside.on };
    return { ...held, pages: held.pages.map((each) => (each === standing ? placed : each)) };
  }
  if (standing.place !== undefined) return held;
  const pages = held.pages.map((each) => (each === standing ? { ...each, place } : each));
  return { ...held, pages };
}

function withShownPlaced(
  held: HeldState,
  pagePlace: PagePlace | undefined,
  reads: FileReads | undefined,
): HeldState {
  const { tab } = held;
  if (tab === undefined) return held;
  if (isPageTab(tab)) return withPagePlaced(held, tab, pagePlace);
  if (!isFileTab(tab) || reads === undefined) return held;
  const files = held.files.map((each) =>
    each.path === tab.file && each.reads === undefined ? { ...each, reads } : each,
  );
  return { ...held, files };
}

function withShownCarried(held: HeldState, on: string): HeldState {
  const { tab } = held;
  if (tab === undefined) return held;
  if (isPageTab(tab)) {
    const pages = held.pages.map((each) => (sameTab(each, tab) ? { ...each, shownOn: on } : each));
    return { ...held, pages };
  }
  if (!isFileTab(tab)) return held;
  const files = held.files.map((each) =>
    each.path === tab.file ? { ...each, browsedOn: on } : each,
  );
  return { ...held, files };
}

function rangeOf(ref: CodeRef): OpenFile["range"] {
  return ref.startLine === undefined || ref.endLine === undefined
    ? undefined
    : { startLine: ref.startLine, endLine: ref.endLine };
}

function withFileOpened(
  held: HeldState,
  ref: CodeRef,
  commit: string | undefined,
  taskId: string | undefined,
  reads: FileReads | undefined,
): HeldState {
  const standing = held.files.find((each) => each.path === ref.path);
  const opened: OpenFile = {
    path: ref.path,
    range: rangeOf(ref),
    opened: (standing?.opened ?? 0) + 1,
    browsedOn: taskId,
    reads,
    ...(commit === undefined ? undefined : { commit }),
    ...(standing?.back === undefined ? undefined : { back: standing.back }),
    ...(standing?.forward === undefined ? undefined : { forward: standing.forward }),
  };
  const files =
    standing === undefined
      ? [...held.files, opened]
      : held.files.map((each) => (each === standing ? opened : each));
  return { ...held, files, tab: { file: ref.path }, open: true };
}

function withOpenFileChosen(
  held: HeldState,
  open: OpenFile,
  drawn: DrawnTabs,
  taskId: string | undefined,
  reads: FileReads | undefined,
): HeldState {
  const tab: SidePanelTab = { file: open.path };
  const drawnHere = drawn.files.includes(open.path)
    ? held
    : {
        ...held,
        files: held.files.map((each) =>
          each === open ? { ...each, browsedOn: taskId, reads } : each,
        ),
      };
  const chosen = withTabLast(withChosenViewed(drawnHere, tab, drawn), tab, drawn);
  return { ...withTab(chosen, tab, taskId), open: true };
}

function withFileShown(
  held: HeldState,
  path: string,
  drawn: DrawnTabs,
  taskId: string | undefined,
  reads: FileReads | undefined,
): HeldState {
  const open = held.files.find((each) => each.path === path);
  if (open !== undefined) return withOpenFileChosen(held, open, drawn, taskId, reads);
  const tab: SidePanelTab = { file: path };
  const placed = withTabLast(withChosenViewed(held, tab, drawn), tab, drawn);
  return withFileBrowsed(placed, taskId, undefined, path, reads);
}

function visitOf(file: OpenFile): FileVisit {
  const { path, range, browsedOn, reads, commit } = file;
  return { path, range, browsedOn, reads, commit };
}

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
  };
  const files = held.files.map((each) => (each === from ? stepped : each));
  const placed = withFileInPlace(held, taskId, from.path, to.path);
  return { ...placed, files, tab: { file: to.path }, open: true };
}

function withFileBrowsed(
  held: HeldState,
  taskId: string | undefined,
  from: OpenFile | undefined,
  to: string,
  reads: FileReads | undefined,
): HeldState {
  const browsed: OpenFile = {
    path: to,
    range: undefined,
    opened: 1,
    browsedOn: taskId,
    reads,
    ...(from === undefined ? undefined : { back: [...(from.back ?? []), visitOf(from)] }),
  };
  const files =
    from === undefined
      ? [...held.files, browsed]
      : held.files.map((each) => (each === from ? browsed : each));
  const placed = from === undefined ? held : withFileInPlace(held, taskId, from.path, to);
  return { ...placed, files, tab: { file: to }, open: true };
}

export function drawsSubagent(
  tab: SubagentStripTab,
  drawn: Pick<DrawnTabs, "agents" | "subagents">,
): boolean {
  if (tab.delegation === undefined) return drawn.subagents.includes(tab.subagent);
  return drawn.agents === undefined || drawn.agents.includes(tab.delegation.agent);
}

export function drawsChanges(
  tab: ChangesStripTab,
  drawn: Pick<DrawnTabs, "taskAgents" | "heldAgents">,
): boolean {
  const held = drawn.heldAgents ?? drawn.taskAgents;
  return held === undefined || held.includes(tab.changes);
}

function drawsTranscript(
  tab: TranscriptStripTab,
  drawn: Pick<DrawnTabs, "taskAgents" | "task">,
): boolean {
  return drawn.task.bare === true && drawn.taskAgents?.includes(tab.transcript) === true;
}

export function drawsTerminal(
  tab: TerminalStripTab,
  drawn: Pick<DrawnTabs, "taskAgents">,
): boolean {
  return drawn.taskAgents?.includes(tab.terminal) === true;
}

export function drawsLocal(tab: LocalStripTab, drawn: Pick<DrawnTabs, "taskAgents">): boolean {
  return drawn.taskAgents?.includes(tab.local) === true;
}

function drawnFiles(held: HeldState, drawn: DrawnTabs): readonly string[] {
  return held.files.flatMap((each) => (drawn.files.includes(each.path) ? [each.path] : []));
}

function drawnChanges(held: HeldState, drawn: DrawnTabs): readonly ChangesStripTab[] {
  return (taskTabs(held, drawn.task.id).changes ?? NO_CHANGES).filter((each) =>
    drawsChanges(each, drawn),
  );
}

const cloudBrowserTabs = new Map<string, CloudBrowserStripTab>();

function cloudBrowserTabOf(id: string): CloudBrowserStripTab {
  const held = cloudBrowserTabs.get(id);
  if (held !== undefined) return held;
  const made = { cloudBrowser: id };
  cloudBrowserTabs.set(id, made);
  return made;
}

function drawnCloudBrowsers(held: HeldState, drawn: DrawnTabs): readonly CloudBrowserStripTab[] {
  return (drawn.cloudBrowsers ?? [])
    .filter((id) => held.openedCloudBrowsers.includes(id))
    .map(cloudBrowserTabOf);
}

function drawnSubagents(held: HeldState, drawn: DrawnTabs): readonly SubagentStripTab[] {
  return held.subagents.filter((each) => drawsSubagent(each, drawn));
}

function stripOf(held: HeldState, drawn: DrawnTabs): readonly SidePanelTab[] {
  const kinds = [
    ...drawnFixed(held, drawn.task),
    ...held.transcripts.filter((each) => drawsTranscript(each, drawn)),
    ...drawnSubagents(held, drawn),
    ...drawnFiles(held, drawn).map((file) => ({ file })),
    ...drawnChanges(held, drawn),
    ...held.pages.filter((each) => drawn.pages.includes(each.page)),
    ...held.terminals.filter((each) => drawsTerminal(each, drawn)),
    ...held.locals.filter((each) => drawsLocal(each, drawn)),
    ...drawnCloudBrowsers(held, drawn),
  ];
  return inTaskOrder(kinds, orderOn(held, drawn.task.id), (tab) => tab);
}

function fallbackTabs(held: HeldState, drawn: DrawnTabs): readonly SidePanelTab[] {
  const fixed = drawnFixed(held, drawn.task);
  const head = stripOf(held, drawn)[0];
  const ahead =
    head === undefined || isFixedTab(head)
      ? undefined
      : orderOn(held, drawn.task.id).find((tab) => sameTab(tab, head));
  return ahead === undefined ? fixed : [ahead, ...fixed];
}

function shownIn(held: HeldState, drawn: DrawnTabs): SidePanelTab | undefined {
  return shownTab(held.tab, fallbackTabs(held, drawn), drawn, drawnChanges(held, drawn));
}

function withChosenViewed(held: HeldState, tab: SidePanelTab, drawn: DrawnTabs): HeldState {
  const shown = shownIn(held, drawn);
  const viewed = shown === undefined || sameTab(shown, tab) ? [tab] : [shown, tab];
  return withViewed(held, drawn.task.id, viewed);
}

function withoutTab(held: HeldState, tab: SidePanelTab, drawn: DrawnTabs): HeldState {
  const closed: HeldState | undefined = isFixedTab(tab)
    ? drawnFixed(held, drawn.task).includes(tab)
      ? drawn.task.bare === true
        ? held
        : withChoice(held, drawn.task.id, tab, false)
      : undefined
    : isTranscriptTab(tab)
      ? { ...held, transcripts: held.transcripts.filter((each) => !sameTab(each, tab)) }
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
              : isLocalTab(tab)
                ? { ...held, locals: held.locals.filter((each) => !sameTab(each, tab)) }
                : isCloudBrowserTab(tab)
                  ? {
                      ...held,
                      openedCloudBrowsers: held.openedCloudBrowsers.filter(
                        (each) => each !== tab.cloudBrowser,
                      ),
                    }
                  : { ...held, files: held.files.filter((each) => each.path !== tab.file) };
  if (closed === undefined) return held;
  const forgotten = withoutViewed(closed, drawn.task.id, tab);
  const left = stripOf(forgotten, drawn);
  const shut = left.length === 0 && stripOf(held, drawn).length > 0;
  const kept = shut ? { ...forgotten, open: false } : forgotten;
  const shown = shownIn(held, drawn);
  if (shown === undefined || !sameTab(shown, tab)) return kept;
  const recent = taskTabs(kept, drawn.task.id).recent ?? [];
  const replacement = replacementOf(left, recent, stripOf(held, drawn), tab);
  return { ...kept, tab: replacement };
}

function previewable(tab: SidePanelTab): boolean {
  return !isFixedTab(tab);
}

function previewOf(held: HeldState, drawn: DrawnTabs): SidePanelTab | undefined {
  const taskId = drawn.task.id;
  const preview = taskId === undefined ? undefined : held.previews[taskId];
  if (preview === undefined) return undefined;
  return stripOf(held, drawn).some((each) => sameTab(each, preview)) ? preview : undefined;
}

function withPreviewKept(held: HeldState, taskId: string, tab?: SidePanelTab): HeldState {
  const preview = held.previews[taskId];
  if (preview === undefined || (tab !== undefined && !sameTab(preview, tab))) return held;
  const { [taskId]: _kept, ...others } = held.previews;
  return { ...held, previews: others };
}

function withPreviewMoved(
  held: HeldState,
  taskId: string | undefined,
  from: string,
  to: string,
): HeldState {
  const preview = taskId === undefined ? undefined : held.previews[taskId];
  if (taskId === undefined || preview === undefined || !sameTab(preview, { file: from }))
    return held;
  return { ...held, previews: { ...held.previews, [taskId]: { file: to } } };
}

function withPreview(
  held: HeldState,
  tab: SidePanelTab,
  drawn: DrawnTabs,
  open: (held: HeldState) => HeldState,
): HeldState {
  const taskId = drawn.task.id;
  const preview = previewOf(held, drawn);
  const standing = stripOf(held, drawn).some((each) => sameTab(each, tab));
  const isPreview = preview !== undefined && sameTab(preview, tab);
  if (taskId === undefined || !previewable(tab) || (standing && !isPreview)) return open(held);
  const cleared = preview === undefined || isPreview ? held : withoutTab(held, preview, drawn);
  const opened = open(cleared);
  return { ...opened, previews: { ...opened.previews, [taskId]: tab } };
}

function withFileAsked(
  held: HeldState,
  ref: CodeRef,
  commit: string | undefined,
  drawn: DrawnTabs,
  taskId: string | undefined,
  reads: FileReads | undefined,
): HeldState {
  if (ref.startLine === undefined && commit === undefined) {
    return withFileShown(held, ref.path, drawn, taskId, reads);
  }
  const tab: SidePanelTab = { file: ref.path };
  return withFileOpened(
    withTabLast(withChosenViewed(held, tab, drawn), tab, drawn),
    ref,
    commit,
    taskId,
    reads,
  );
}

function withTabAt(held: HeldState, tab: SidePanelTab, to: number, drawn: DrawnTabs): HeldState {
  const taskId = drawn.task.id;
  const order = movedOrder(orderOn(held, taskId), stripOf(held, drawn), tab, to);
  return order === undefined
    ? held
    : withTaskTabs(held, taskId, (choices) => ({ ...choices, order }));
}

function withTabLast(held: HeldState, tab: SidePanelTab, drawn: DrawnTabs): HeldState {
  const taskId = drawn.task.id;
  const order = openedOrder(orderOn(held, taskId), stripOf(held, drawn), tab);
  return order === undefined
    ? held
    : withTaskTabs(held, taskId, (choices) => ({ ...choices, order }));
}

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

function current<T>(tab: T): tab is Exclude<T, RetiredSidePanelTab> {
  return !RETIRED_TABS.has(tab);
}

function panelChoice(tab: typeof anyTabSchema.Type): tab is FixedSidePanelTab | ChangesStripTab {
  return !isAgentTab(tab) && current(tab);
}

function currentTasks(tasks: SidePanelState["tasks"]): HeldState["tasks"] {
  return Object.fromEntries(
    Object.entries(tasks ?? {}).map(
      ([task, { opened, closed, recent, order, changes, viewedAt }]) => [
        task,
        {
          opened: opened.filter(current),
          closed: closed.filter(current),
          ...(recent === undefined ? undefined : { recent: recent.filter(panelChoice) }),
          ...(order === undefined ? undefined : { order: order.filter(panelChoice) }),
          ...(changes === undefined ? undefined : { changes }),
          ...(viewedAt === undefined
            ? undefined
            : {
                viewedAt: viewedAt.flatMap(({ tab, at }) =>
                  panelChoice(tab) ? [{ tab, at }] : [],
                ),
              }),
        },
      ],
    ),
  );
}

function stripPinLabel(tab: PinnableTab | AgentStripTab): string {
  if (isFileTab(tab)) return fileName(tab.file);
  if (isChangesTab(tab)) return TAB_WORDS.PULL_REQUEST;
  return isAgentTab(tab) ? TAB_WORDS.AGENT : SIDE_PANEL_TAB_KIND[tab].label;
}

function currentPin<T>(tab: T): tab is Exclude<T, RetiredSidePanelTab> {
  return current(tab);
}

function stripPins(
  tasks: NonNullable<SidePanelState["tasks"]>,
): readonly (typeof taskPinSchema.Type)[] {
  const pinned = Object.entries(tasks).flatMap(([task, { pinned = [] }]) =>
    pinned.flatMap((tab) =>
      (isPinnable(tab) || isAgentTab(tab)) && currentPin(tab)
        ? [{ task, tab, label: stripPinLabel(tab) }]
        : [],
    ),
  );
  return pinned.map((pin, place) => ({ ...pin, at: -place }));
}

function carriedPin(pin: KeptPin): pin is CarriedPin {
  return "task" in pin && isAgentTab(pin.tab);
}

function heldPin(pin: KeptPin): PinnedTab[] {
  const { tab } = pin;
  if (isAgentTab(tab) || !currentPin(tab) || retiredKind(tab)) return [];
  const { label, at, position } = pin;
  const fields = position === undefined ? { tab, label, at } : { tab, label, at, position };
  return ["task" in pin ? { ...fields, task: pin.task } : { ...fields, agent: pin.agent }];
}

function settled(state: SidePanelState): HeldState {
  const { tab } = state;
  const pins: readonly KeptPin[] = [
    ...(state.pins ?? stripPins(state.tasks ?? {})),
    ...(state.agentPins ?? []),
  ];
  return {
    ...state,
    tabs: [
      ...new Set([SIDE_PANEL_TAB.DESCRIPTION, ...state.tabs.filter(current), ...SIDE_PANEL_TABS]),
    ],
    tab: tab === undefined || !panelChoice(tab) ? undefined : tab,
    width: clampWidth(state.width),
    subagents: [],
    transcripts: [],
    files: [],
    pages: [],
    terminals: [],
    locals: [],
    openedCloudBrowsers: [],
    lastTerminals: {},
    pullRequestViews: new Map(),
    previews: {},
    tasks: currentTasks(state.tasks),
    pins: pins.flatMap(heldPin).toSorted((a, b) => b.at - a.at),
    carried: pins.filter(carriedPin),
  };
}

function stagedHeld(staged: StagedSidePanel): HeldState {
  const {
    tab,
    files = [],
    pages = [],
    terminals = [],
    pullRequestViews = new Map(),
    ...kept
  } = staged;
  const opened = tab !== undefined && (isFileTab(tab) || isPageTab(tab) || isTerminalTab(tab));
  const held = settled(opened ? kept : { ...kept, tab });
  return { ...held, ...(opened ? { tab } : undefined), files, pages, terminals, pullRequestViews };
}

function keptChoice(tab: SidePanelTab): tab is FixedSidePanelTab | ChangesStripTab {
  return isFixedTab(tab) || isChangesTab(tab);
}

function storedTasks(tasks: HeldState["tasks"]): NonNullable<SidePanelState["tasks"]> {
  const kept = (tabs: readonly SidePanelTab[]) => {
    const each = tabs.filter(keptChoice);
    return each.length === 0 ? undefined : each;
  };
  return Object.fromEntries(
    Object.entries(tasks).map(
      ([task, { opened, closed, recent = [], order = [], changes, viewedAt = [] }]) => {
        const stamps = viewedAt.flatMap(({ tab, at }) => (keptChoice(tab) ? [{ tab, at }] : []));
        return [
          task,
          {
            opened,
            closed,
            recent: kept(recent),
            order: kept(order),
            changes: changes === undefined || changes.length === 0 ? undefined : changes,
            viewedAt: stamps.length === 0 ? undefined : stamps,
          },
        ] as const;
      },
    ),
  );
}

function stored(state: HeldState): SidePanelState {
  const kept = {
    open: state.open,
    tabs: state.tabs,
    width: state.width,
    tasks: storedTasks(state.tasks),
    pins: [
      ...state.pins.flatMap((pin): (typeof taskPinSchema.Type)[] => ("task" in pin ? [pin] : [])),
      ...state.carried,
    ],
  };
  const agentPins = state.pins.flatMap((pin): (typeof agentHolderPinSchema.Type)[] =>
    "agent" in pin ? [pin] : [],
  );
  const withAgents = agentPins.length === 0 ? kept : { ...kept, agentPins };
  const tab = state.tab;
  return tab !== undefined && keptChoice(tab) ? { ...withAgents, tab } : withAgents;
}

function storedText(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

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

function shownTab(
  kept: SidePanelTab | undefined,
  tabs: readonly SidePanelTab[],
  drawn: Omit<DrawnTabs, "plan">,
  changes: readonly ChangesStripTab[],
): SidePanelTab | undefined {
  if (kept === undefined) return tabs[0];
  if (isFixedTab(kept)) return tabs.includes(kept) ? kept : tabs[0];
  if (isFileTab(kept)) return drawn.files.includes(kept.file) ? kept : tabs[0];
  if (isTranscriptTab(kept)) return drawsTranscript(kept, drawn) ? kept : tabs[0];
  if (isChangesTab(kept)) return changes.some((each) => sameTab(each, kept)) ? kept : tabs[0];
  if (isPageTab(kept)) return drawn.pages.includes(kept.page) ? kept : tabs[0];
  if (isTerminalTab(kept)) return drawsTerminal(kept, drawn) ? kept : tabs[0];
  if (isLocalTab(kept)) return drawsLocal(kept, drawn) ? kept : tabs[0];
  if (isCloudBrowserTab(kept)) {
    return drawn.cloudBrowsers === undefined || drawn.cloudBrowsers.includes(kept.cloudBrowser)
      ? kept
      : tabs[0];
  }
  return drawsSubagent(kept, drawn) ? kept : tabs[0];
}

const HELD_KINDS = SIDE_PANEL_TABS.filter((tab) => !retiredKind(tab));

function sameHolds(a: TaskHolds, b: TaskHolds): boolean {
  return SIDE_PANEL_TABS.every((tab) => a[tab] === b[tab]);
}

function arrived(was: TaskHolds, now: TaskHolds): boolean {
  return HELD_KINDS.some((tab) => was[tab] !== true && now[tab] === true);
}

export function useSidePanel(
  staged: StagedSidePanel | undefined,
  task: OpenTask,
  agents?: readonly string[] | undefined,
  subagents: readonly string[] = [],
  pages: readonly string[] = NO_PAGES,
  taskAgents?: readonly string[] | undefined,
  room: ShellRoom = SHELL_ROOM.WIDE,
  cloudBrowsers?: readonly string[] | undefined,
  heldAgents?: readonly string[] | undefined,
): SidePanelControl {
  const [kept, setKept] = useState<HeldState>(readStored);
  const [moved, setMoved] = useState<HeldState | undefined>(undefined);
  const [fullScreen, setFullScreen] = useState(false);
  const [newTabAsked, setNewTabAsked] = useState(false);
  const [toggleAskedOn, setToggleAskedOn] = useState<string | undefined>(undefined);
  const [seen, setSeen] = useState<OpenTask>(task);
  const [asked, setAsked] = useState<
    { task: string; tab: SidePanelTab; carry: boolean } | undefined
  >(undefined);
  const [carrying, setCarrying] = useState(false);
  const [opened, setOpened] = useState(0);
  const stage = useMemo(() => (staged === undefined ? undefined : stagedHeld(staged)), [staged]);
  const taskId = task.id;
  const { files: fileReads, pages: pagePlace } = task;
  const state = stage === undefined ? kept : (moved ?? stage);
  const taskFiles = useMemo(
    () => state.files.flatMap((each) => (each.browsedOn === taskId ? [each.path] : [])),
    [state.files, taskId],
  );
  const pagesHere = useMemo(() => {
    const beside = state.pages.flatMap((each) =>
      each.shownOn === taskId && !pages.includes(each.page) ? [each.page] : [],
    );
    return beside.length === 0 ? pages : [...pages, ...beside];
  }, [state.pages, pages, taskId]);
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
      pages: pagesHere,
      taskAgents,
      heldAgents,
      cloudBrowsers,
    });

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
  }
  const tabs = useMemo(() => drawnFixed(state, seen), [state, seen]);
  const used = useMemo(
    () => DRAWN_KINDS.filter((kind) => tabs.includes(kind) || seen.holds[kind] === true),
    [tabs, seen],
  );
  const drawn = useMemo(
    () => ({
      task: seen,
      agents,
      subagents,
      files: taskFiles,
      pages: pagesHere,
      taskAgents,
      heldAgents,
      cloudBrowsers,
    }),
    [seen, agents, subagents, taskFiles, pagesHere, taskAgents, heldAgents, cloudBrowsers],
  );
  useEffect(() => {
    if (staged !== undefined) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, encodeStored(stored(kept)));
    } catch {}
  }, [staged, kept]);

  const strip = useMemo(() => stripOf(state, drawn), [state, drawn]);
  const narrow = room === SHELL_ROOM.NARROW;
  const shown = state.open && strip.length > 0;
  const stop = task.stop ?? taskId;
  const [standing, setStanding] = useState(stop);
  if (standing !== stop) {
    if (carrying) {
      setCarrying(false);
      if (taskId !== undefined) update((held) => withShownCarried(held, taskId));
    } else if (asked?.carry === true && asked.task === taskId) setAsked({ ...asked, carry: false });
    else if (state.open) update((held) => (held.open ? { ...held, open: false } : held));
    setStanding(stop);
  }
  if (!shown && (fullScreen || newTabAsked)) {
    setFullScreen(false);
    setNewTabAsked(false);
  }
  if (toggleAskedOn !== undefined && (shown || toggleAskedOn !== taskId)) {
    setToggleAskedOn(undefined);
  }

  const onToggle = useCallback(() => {
    setFullScreen(false);
    setNewTabAsked(false);
    if (shown) {
      update((held) => ({ ...held, open: false }));
      return;
    }
    if (strip.length === 0) {
      setToggleAskedOn((was) => (was === taskId ? undefined : taskId));
      return;
    }
    update((held) => (held.open ? held : { ...held, open: true }));
  }, [update, shown, strip.length, taskId]);
  const onSetOpen = useCallback(
    (open: boolean) => {
      update((held) => (held.open === open ? held : { ...held, open }));
      if (open) return;
      setFullScreen(false);
      setNewTabAsked(false);
      setToggleAskedOn(undefined);
    },
    [update],
  );
  const onToggleFullScreen = useCallback(() => {
    if (narrow) onSetOpen(false);
    else setFullScreen((was) => !was);
  }, [narrow, onSetOpen]);
  const onNewTab = useCallback(() => {
    if (strip.length === 0) {
      setToggleAskedOn(taskId);
      return;
    }
    update((held) => (held.open ? held : { ...held, open: true }));
    setNewTabAsked(true);
  }, [update, strip.length, taskId]);
  const onNewTabAnswered = useCallback(() => setNewTabAsked(false), []);
  const onToggleAskedAnswered = useCallback(() => setToggleAskedOn(undefined), []);
  const onChoose = useCallback(
    (tab: SidePanelTab) => {
      if (retiredKind(tab)) return;
      setAsked(undefined);
      update((held) => ({
        ...withPagePlaced(
          withTab(
            withTabLast(withChosenViewed(held, tab, drawn), tab, drawn),
            tab,
            taskId,
            drawn.task.bare === true,
          ),
          tab,
          pagePlace,
        ),
        open: true,
      }));
    },
    [update, drawn, taskId, pagePlace],
  );
  const onShow = useCallback(
    (on: string, tab: SidePanelTab) => {
      if (retiredKind(tab)) return;
      setAsked({ task: on, tab, carry: on !== taskId || stop !== taskId });
      setOpened((was) => was + 1);
      update((held) => {
        const here =
          on === taskId
            ? withTabLast(withChosenViewed(held, tab, drawn), tab, drawn)
            : withTabLastOn(held, on, tab);
        return { ...withTab(here, tab, on), open: true };
      });
    },
    [update, drawn, taskId, stop],
  );
  const onCarry = useCallback(() => {
    setCarrying(true);
    update((held) => withShownPlaced(held, pagePlace, fileReads));
  }, [update, pagePlace, fileReads]);
  const onClose = useCallback(
    (tab: SidePanelTab) =>
      update((held) => {
        const closed = withoutTab(held, tab, drawn);
        return drawn.task.id === undefined ? closed : withPreviewKept(closed, drawn.task.id, tab);
      }),
    [update, drawn],
  );
  const onCloseOn = useCallback(
    (on: string, tab: FixedSidePanelTab) => update((held) => withChoice(held, on, tab, false)),
    [update],
  );
  const onOpenFile = useCallback(
    (ref: CodeRef, commit?: string, reads?: FileReads) => {
      setOpened((was) => was + 1);
      update((held) => withFileAsked(held, ref, commit, drawn, taskId, reads ?? fileReads));
    },
    [update, drawn, taskId, fileReads],
  );
  const onPreview = useCallback(
    (tab: SidePanelTab, place?: PagePlace) => {
      setAsked(undefined);
      setOpened((was) => was + 1);
      const beside =
        place === undefined ||
        taskId === undefined ||
        (pagePlace !== undefined && pagePlaceId(place) === pagePlaceId(pagePlace))
          ? undefined
          : { place, on: taskId };
      const here =
        beside === undefined || !isPageTab(tab) || drawn.pages.includes(tab.page)
          ? drawn
          : { ...drawn, pages: [...drawn.pages, tab.page] };
      update((held) => ({
        ...withPreview(held, tab, here, (from) =>
          withPagePlaced(
            withTab(withTabLast(withChosenViewed(from, tab, here), tab, here), tab, taskId),
            tab,
            pagePlace,
            beside,
          ),
        ),
        open: true,
      }));
    },
    [update, drawn, taskId, pagePlace],
  );
  const onPreviewFile = useCallback(
    (ref: CodeRef, commit?: string, reads?: FileReads) => {
      setOpened((was) => was + 1);
      update((held) => ({
        ...withPreview(held, { file: ref.path }, drawn, (from) =>
          withFileAsked(from, ref, commit, drawn, taskId, reads ?? fileReads),
        ),
        open: true,
      }));
    },
    [update, drawn, taskId, fileReads],
  );
  const onKeep = useCallback(
    (tab: SidePanelTab) => {
      if (taskId !== undefined) update((held) => withPreviewKept(held, taskId, tab));
    },
    [update, taskId],
  );
  const onBrowseFile = useCallback(
    (from: string | undefined, path: string, newTab: boolean) =>
      update((held) => {
        const tree = held.files.find((each) => each.path === from);
        const standing = newTab ? undefined : tree;
        if (standing === undefined || held.files.some((each) => each.path === path)) {
          return withFileShown(held, path, drawn, taskId, tree?.reads ?? fileReads);
        }
        const viewed = withChosenViewed(held, { file: path }, drawn);
        return withPreviewMoved(
          withFileBrowsed(viewed, taskId, standing, path, standing.reads),
          taskId,
          standing.path,
          path,
        );
      }),
    [update, drawn, taskId, fileReads],
  );
  const onFileHistory = useCallback(
    (from: string, step: FileHistoryStep) =>
      update((held) => {
        const standing = held.files.find((each) => each.path === from);
        if (standing === undefined) return held;
        const ways = step === FILE_HISTORY_STEP.BACK ? standing.back : standing.forward;
        const to = ways?.at(-1)?.path;
        if (to === undefined) return held;
        const open = held.files.find((each) => each.path === to);
        if (open !== undefined)
          return withOpenFileChosen(held, open, drawn, taskId, standing.reads);
        const stepped = withFileStepped(
          withChosenViewed(held, { file: to }, drawn),
          taskId,
          standing,
          step,
        );
        return withPreviewMoved(stepped, taskId, from, to);
      }),
    [update, drawn, taskId],
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
  const onReopen = useCallback(
    (tab: SidePanelTab, at: number, file: OpenFile | undefined) => {
      if (retiredKind(tab)) return;
      setAsked(undefined);
      update((held) => {
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
    (holder: PinHolder, tab: PinnableTab, label: string) => {
      const at = Date.now();
      update((held) => withPin(held, holder, tab, label, at));
    },
    [update],
  );
  const onUnpin = useCallback(
    (holder: PinHolder, tab: PinnableTab) => update((held) => withoutPin(held, holder, tab)),
    [update],
  );
  const onCarried = useCallback(
    (agentId: string) => update((held) => withoutCarried(held, agentId)),
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
  const onViewedAt = useCallback(
    (on: string, viewed: readonly SidePanelTab[], standing: readonly SidePanelTab[], at: number) =>
      update((held) => withViewedAt(held, on, viewed, standing, at)),
    [update],
  );
  const carried = useMemo(
    () =>
      state.carried.map(({ task, tab, position }): CarriedAgentPin => {
        const pin = { agent: tab.agent, task };
        return position === undefined ? pin : { ...pin, position };
      }),
    [state.carried],
  );
  return {
    open: shown,
    tabs,
    strip,
    order: orderOn(state, taskId),
    closedTabs: taskTabs(state, taskId).closed,
    used,
    pins: state.pins,
    carried,
    subagents: state.subagents,
    changes: taskTabs(state, taskId).changes ?? NO_CHANGES,
    pages: state.pages,
    terminals: state.terminals,
    locals: state.locals,
    lastTerminal: taskId === undefined ? undefined : state.lastTerminals[taskId],
    pullRequestViews: state.pullRequestViews,
    onPullRequestView,
    files: state.files,
    tab: shownIn(state, drawn),
    preview: previewOf(state, drawn),
    width: state.width,
    opened,
    fullScreen: shown && (fullScreen || narrow),
    fullScreenOnly: shown && narrow,
    newTabAsked: shown && newTabAsked,
    onToggle,
    toggleAsked: toggleAskedOn !== undefined && toggleAskedOn === taskId && !shown,
    onToggleAskedAnswered,
    onSetOpen,
    onToggleFullScreen,
    onNewTab,
    onNewTabAnswered,
    onChoose,
    onShow,
    onCarry,
    onClose,
    onCloseOn,
    onMove,
    onReopen,
    onPin,
    onUnpin,
    onCarried,
    onRenamePins,
    onPlacePins,
    onOpenFile,
    onPreview,
    onPreviewFile,
    onKeep,
    onBrowseFile,
    onFileHistory,
    onResize,
    viewedAt: taskTabs(state, taskId).viewedAt ?? NO_STAMPS,
    onViewedAt,
  };
}
