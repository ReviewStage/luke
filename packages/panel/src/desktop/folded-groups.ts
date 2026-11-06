import { Schema, SchemaTransformation } from "effect";
import { useCallback, useState } from "react";
import {
  INBOX_SHOW,
  INBOX_WHOSE,
  type InboxShow,
  type InboxWhose,
  MINE,
} from "../tasks/inbox-model.js";
import { keptKey, useKept } from "../use-kept.js";

const STORAGE_KEY = {
  GROUPS: "app.sidebarFoldedGroups",
  PINNED: "app.sidebarPinnedFolded",
  SECTIONS: "app.sidebarFoldedSections",
  OPENED_TASKS: "app.sidebarOpenedTasks",
  INBOX_SHOW: "app.inboxShow",
  INBOX_WAITING_ONLY: "app.inboxWaitingOnly",
  INBOX_WHOSE: "app.inboxWhose",
  INBOX_LIST_WIDTH: "app.inboxListWidth",
  RUNS_PANEL: "app.automationRunsPanel",
  FILE_TREE_WIDTH: "app.fileTreeWidth",
  PAGE_COMMENTS_WIDTH: "app.pageCommentsWidth",
} as const;

export const FILE_TREE_WIDTH = {
  MIN: 220,
  MAX: 480,
  DEFAULT: 264,
} as const;

export const PAGE_COMMENTS_WIDTH = {
  MIN: 280,
  MAX: 560,
  DEFAULT: 320,
} as const;

export const RUNS_PANEL_WIDTH = {
  MIN: 280,
  MAX: 560,
  DEFAULT: 340,
} as const;

export const INBOX_LIST_WIDTH = {
  MIN: 300,
  MAX: 440,
  DEFAULT: 320,
} as const;

const storedFolds = Schema.fromJsonString(Schema.Array(Schema.NullOr(Schema.String)));

const storedFlag = Schema.fromJsonString(Schema.Boolean);

const storedTasks = Schema.fromJsonString(Schema.Array(Schema.String));

const storedWidth = Schema.fromJsonString(Schema.Finite);

const storedRunsPanel = Schema.fromJsonString(
  Schema.Struct({ width: Schema.Finite, open: Schema.Boolean }),
);

const storedWhose = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal(INBOX_WHOSE.EVERYONE) }),
    Schema.Struct({ kind: Schema.Literal(INBOX_WHOSE.MINE) }),
    Schema.Struct({
      kind: Schema.Literal(INBOX_WHOSE.PERSON),
      userId: Schema.String,
      name: Schema.String,
    }),
  ]),
);

const EARLIER_SHOW = {
  NEEDS_YOU: "needs-you",
  UNREAD: "unread",
  OPEN: "open",
  SNOOZED: "snoozed",
} as const;

const SHOW_OF_KEPT = {
  [INBOX_SHOW.NEEDS_ME]: INBOX_SHOW.NEEDS_ME,
  [INBOX_SHOW.OPEN]: INBOX_SHOW.OPEN,
  [INBOX_SHOW.ALL]: INBOX_SHOW.ALL,
  [INBOX_SHOW.REMINDERS]: INBOX_SHOW.REMINDERS,
  [EARLIER_SHOW.NEEDS_YOU]: INBOX_SHOW.OPEN,
  [EARLIER_SHOW.UNREAD]: INBOX_SHOW.OPEN,
  [EARLIER_SHOW.OPEN]: INBOX_SHOW.ALL,
  [EARLIER_SHOW.SNOOZED]: INBOX_SHOW.REMINDERS,
} as const satisfies Record<
  InboxShow | (typeof EARLIER_SHOW)[keyof typeof EARLIER_SHOW],
  InboxShow
>;

const storedShow = Schema.fromJsonString(
  Schema.Union([
    Schema.Literals([...Object.values(INBOX_SHOW), ...Object.values(EARLIER_SHOW)]),
    Schema.Boolean,
  ]).pipe(
    Schema.decodeTo(
      Schema.Literals(Object.values(INBOX_SHOW)),
      SchemaTransformation.transform({
        decode: (kept) => {
          if (typeof kept === "boolean") return kept ? INBOX_SHOW.OPEN : INBOX_SHOW.ALL;
          return SHOW_OF_KEPT[kept];
        },
        encode: (show) => show,
      }),
    ),
  ),
);

const KEPT = {
  INBOX_SHOW: keptKey<InboxShow>(
    STORAGE_KEY.INBOX_SHOW,
    storedShow,
    STORAGE_KEY.INBOX_WAITING_ONLY,
  ),
  WHOSE: keptKey<InboxWhose>(STORAGE_KEY.INBOX_WHOSE, storedWhose),
  FOLDED_GROUPS: keptKey(STORAGE_KEY.GROUPS, storedFolds),
  PINNED_FOLDED: keptKey(STORAGE_KEY.PINNED, storedFlag),
  FOLDED_SECTIONS: keptKey(STORAGE_KEY.SECTIONS, storedTasks),
  OPENED_TASKS: keptKey(STORAGE_KEY.OPENED_TASKS, storedTasks),
  INBOX_LIST_WIDTH: keptKey(STORAGE_KEY.INBOX_LIST_WIDTH, storedWidth),
  FILE_TREE_WIDTH: keptKey(STORAGE_KEY.FILE_TREE_WIDTH, storedWidth),
  PAGE_COMMENTS_WIDTH: keptKey(STORAGE_KEY.PAGE_COMMENTS_WIDTH, storedWidth),
  RUNS_PANEL: keptKey(STORAGE_KEY.RUNS_PANEL, storedRunsPanel),
} as const;

interface Folds {
  readonly groups: readonly (string | null)[];
  readonly pinned: boolean;
  readonly sections: readonly string[];
  readonly openedTasks: readonly string[];
}

const OPEN: Folds = {
  groups: [],
  pinned: false,
  sections: [],
  openedTasks: [],
};

function toggled<K extends string | null>(folded: readonly K[], held: K): K[] {
  return folded.includes(held) ? folded.filter((each) => each !== held) : [...folded, held];
}

export interface FoldedGroups {
  folded: (repository: string | null) => boolean;
  toggle: (repository: string | null) => void;
  pinnedFolded: boolean;
  togglePinned: () => void;
  sectionFolded: (sectionId: string) => boolean;
  toggleSection: (sectionId: string) => void;
  taskOpened: (taskId: string) => boolean;
  toggleTask: (taskId: string) => void;
}

export function useFoldedGroups(staged: boolean): FoldedGroups {
  const [groups, keepGroups] = useKept(KEPT.FOLDED_GROUPS, OPEN.groups);
  const [pinned, keepPinned] = useKept(KEPT.PINNED_FOLDED, OPEN.pinned);
  const [sections, keepSections] = useKept(KEPT.FOLDED_SECTIONS, OPEN.sections);
  const [openedTasks, keepOpenedTasks] = useKept(KEPT.OPENED_TASKS, OPEN.openedTasks);
  const [stagedFolds, setStagedFolds] = useState<Folds>(OPEN);
  const folds = staged ? stagedFolds : { groups, pinned, sections, openedTasks };
  const fold = (next: Partial<Folds>) => {
    if (staged) {
      setStagedFolds({ ...stagedFolds, ...next });
      return;
    }
    if (next.groups !== undefined) keepGroups(next.groups);
    if (next.pinned !== undefined) keepPinned(next.pinned);
    if (next.sections !== undefined) keepSections(next.sections);
    if (next.openedTasks !== undefined) keepOpenedTasks(next.openedTasks);
  };
  const toggle = (repository: string | null) => fold({ groups: toggled(folds.groups, repository) });
  return {
    folded: (repository) => folds.groups.includes(repository),
    toggle,
    pinnedFolded: folds.pinned,
    togglePinned: () => fold({ pinned: !folds.pinned }),
    sectionFolded: (sectionId) => folds.sections.includes(sectionId),
    toggleSection: (sectionId) => fold({ sections: toggled(folds.sections, sectionId) }),
    taskOpened: (taskId) => folds.openedTasks.includes(taskId),
    toggleTask: (taskId) => fold({ openedTasks: toggled(folds.openedTasks, taskId) }),
  };
}

interface InboxShowChoice {
  show: InboxShow;
  onShow: (show: InboxShow) => void;
}

export interface InboxViewChoices extends InboxShowChoice, InboxWhoseChoice {}

export interface InboxWhoseChoice {
  whose: InboxWhose;
  onWhose: (whose: InboxWhose) => void;
}

export function useInboxViewChoices(): InboxViewChoices {
  const [show, onShow] = useKept(KEPT.INBOX_SHOW, INBOX_SHOW.OPEN);
  const [whose, onWhose] = useKept(KEPT.WHOSE, MINE);
  return { show, onShow, whose, onWhose };
}

function clampListWidth(width: number): number {
  return Math.min(INBOX_LIST_WIDTH.MAX, Math.max(INBOX_LIST_WIDTH.MIN, Math.round(width)));
}

export interface InboxListWidth {
  width: number;
  onResize: (width: number) => void;
}

export function useInboxListWidth(): InboxListWidth {
  const [kept, keep] = useKept(KEPT.INBOX_LIST_WIDTH, INBOX_LIST_WIDTH.DEFAULT);
  return { width: clampListWidth(kept), onResize: (asked) => keep(clampListWidth(asked)) };
}

export interface FileTreeWidth {
  width: number;
  onResize: (width: number) => void;
}

function clampTreeWidth(width: number): number {
  return Math.min(FILE_TREE_WIDTH.MAX, Math.max(FILE_TREE_WIDTH.MIN, Math.round(width)));
}

export function useFileTreeWidth(): FileTreeWidth {
  const [kept, keep] = useKept(KEPT.FILE_TREE_WIDTH, FILE_TREE_WIDTH.DEFAULT);
  const onResize = useCallback((asked: number) => keep(clampTreeWidth(asked)), [keep]);
  return { width: clampTreeWidth(kept), onResize };
}

function clampPageCommentsWidth(width: number): number {
  return Math.min(PAGE_COMMENTS_WIDTH.MAX, Math.max(PAGE_COMMENTS_WIDTH.MIN, Math.round(width)));
}

export function usePageCommentsWidth(): FileTreeWidth {
  const [kept, keep] = useKept(KEPT.PAGE_COMMENTS_WIDTH, PAGE_COMMENTS_WIDTH.DEFAULT);
  const onResize = useCallback((asked: number) => keep(clampPageCommentsWidth(asked)), [keep]);
  return { width: clampPageCommentsWidth(kept), onResize };
}

function clampRunsWidth(width: number): number {
  return Math.min(RUNS_PANEL_WIDTH.MAX, Math.max(RUNS_PANEL_WIDTH.MIN, Math.round(width)));
}

export interface RunsPanel {
  width: number;
  open: boolean;
  onResize: (width: number) => void;
  onToggle: () => void;
  onShow: () => void;
}

export function useRunsPanel(): RunsPanel {
  const [stored, keep] = useKept(KEPT.RUNS_PANEL, { width: RUNS_PANEL_WIDTH.DEFAULT, open: true });
  const kept = { width: clampRunsWidth(stored.width), open: stored.open };
  return {
    ...kept,
    onResize: (asked) => keep({ ...kept, width: clampRunsWidth(asked) }),
    onToggle: () => keep({ ...kept, open: !kept.open }),
    onShow: () => {
      if (!kept.open) keep({ ...kept, open: true });
    },
  };
}
