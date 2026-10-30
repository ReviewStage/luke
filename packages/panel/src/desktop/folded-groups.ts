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

/**
 * folded-groups.ts -- which of the sidebar's groups the developer folded, Pinned and the repositories', kept across launches, and what the Inbox lists and how wide its list stands kept the same way.
 *
 * A fold is this window's alone, as the sidebar's width is, so it is kept in
 * the renderer's own storage rather than on the account: a group folded on
 * one Mac stays open on another. A group is kept by its repository's full
 * name, and the tasks with no repository by null. A repository whose last
 * task goes leaves its entry behind: it is a few bytes, and a task on it
 * later comes back folded as it was left. Pinned is kept under a key of
 * its own, since it is no repository, and so are the account's own
 * sections, each by its id. A task's child tasks nested under
 * its row stand folded until it is opened, so the tasks opened are kept,
 * each by its id, under a key of their own. A fixture run starts with every group open
 * and keeps nothing, so its frames never wear a developer's folds. The
 * Inbox's view choices are kept on the same terms, the scope it shows and
 * whom the items it lists are addressed to, a teammate by their account's
 * id, and so is its list's width; a task's own Inbox and a channel list
 * every item they hold, and keep no choice. A choice kept before its scope was is read
 * as the scope that now lists what it listed: a tab kept before the scopes, Needs you or
 * Unread, as Open, and All open or Everything as All; and the Needs you
 * button's press, kept before the tabs, as Open where it was pressed and
 * All where it was not. Open is kept under the value To do was, so a
 * scope kept as To do reads as Open. A grouping or a sort kept before the
 * list was always one run, the latest first, is left where it was and
 * read by nothing, and so is the scope a task's own Inbox and the channels
 * kept before they listed everything. A fixture run draws no inbox, so it has nothing staged to keep apart. An automation's Runs panel keeps its width and whether it
 * stands on the same terms, one for every automation, as the side panel
 * keeps one for every plan, and so does the tree beside every File and
 * Changes tab, one width for them all.
 */

/** Where the folds are kept in the renderer's storage. */
const STORAGE_KEY = {
  GROUPS: "luke.sidebarFoldedGroups",
  PINNED: "luke.sidebarPinnedFolded",
  SECTIONS: "luke.sidebarFoldedSections",
  OPENED_TASKS: "luke.sidebarOpenedTasks",
  INBOX_SHOW: "luke.inboxShow",
  /** Where the Inbox's Needs you button kept its press, before its tabs, which stood before its scopes. */
  INBOX_WAITING_ONLY: "luke.inboxWaitingOnly",
  INBOX_WHOSE: "luke.inboxWhose",
  INBOX_LIST_WIDTH: "luke.inboxListWidth",
  RUNS_PANEL: "luke.automationRunsPanel",
  FILE_TREE_WIDTH: "luke.fileTreeWidth",
} as const;

/** How wide an automation's Runs panel may stand, as the side panel is bounded. */
/**
 * How wide the tree beside a File or Changes tab may be dragged, in CSS
 * pixels, and where it starts, as stage-cli's file picker is: wide enough
 * for a nested name, never so wide that it takes the diff's room.
 */
export const FILE_TREE_WIDTH = {
  MIN: 220,
  MAX: 480,
  DEFAULT: 264,
} as const;

export const RUNS_PANEL_WIDTH = {
  MIN: 280,
  MAX: 560,
  DEFAULT: 340,
} as const;

/**
 * How wide the Inbox's list may be dragged, in CSS pixels, and where it
 * starts: a mail app's message list, as narrow as Linear's Inbox list may
 * be, never so narrow that its head, with the folded sidebar's buttons
 * standing over its start, cannot name the Inbox beside its own buttons,
 * and never so wide that it takes the room the item it reads needs.
 */
export const INBOX_LIST_WIDTH = {
  MIN: 300,
  MAX: 440,
  DEFAULT: 320,
} as const;

/** The folded groups, each by its repository, its creator, or its assignee, null for the plans with none. */
const storedFolds = Schema.fromJsonString(Schema.Array(Schema.NullOr(Schema.String)));

/** Whether Pinned is folded, or whether the Inbox shows a second line. */
const storedFlag = Schema.fromJsonString(Schema.Boolean);

/** The account's sections folded, or the tasks opened, by id. */
const storedTasks = Schema.fromJsonString(Schema.Array(Schema.String));

/** How wide the Inbox's list stands. */
const storedWidth = Schema.fromJsonString(Schema.Finite);

/** How wide the Runs panel stands, and whether it stands at all. */
const storedRunsPanel = Schema.fromJsonString(
  Schema.Struct({ width: Schema.Finite, open: Schema.Boolean }),
);

/** Whom the items the Inbox lists are addressed to. */
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

/** The tabs an earlier version kept, before the scopes: Needs you, Unread, and All open; Everything was kept as All is. */
const EARLIER_SHOW = { NEEDS_YOU: "needs-you", UNREAD: "unread", OPEN: "open" } as const;

/** The scope each kept value now stands for: a tab before the scopes as the scope listing what it did. */
const SHOW_OF_KEPT = {
  [INBOX_SHOW.OPEN]: INBOX_SHOW.OPEN,
  [INBOX_SHOW.ALL]: INBOX_SHOW.ALL,
  [EARLIER_SHOW.NEEDS_YOU]: INBOX_SHOW.OPEN,
  [EARLIER_SHOW.UNREAD]: INBOX_SHOW.OPEN,
  [EARLIER_SHOW.OPEN]: INBOX_SHOW.ALL,
} as const satisfies Record<
  InboxShow | (typeof EARLIER_SHOW)[keyof typeof EARLIER_SHOW],
  InboxShow
>;

/**
 * Which scope the Inbox shows, as any version kept it: a scope; a tab
 * before the scopes, read as the scope that lists what it did
 * (`SHOW_OF_KEPT`); or, as the key the Needs you button kept its press
 * under is read, whether it was pressed, Open where it was and All, all it
 * then listed, where it was not. Note that a `null`, which an earlier build
 * kept where nothing was chosen, reads as none, so the key beside it is read.
 */
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

/** The Inbox's view choices, each kept on this Mac under its own key. */
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
  RUNS_PANEL: keptKey(STORAGE_KEY.RUNS_PANEL, storedRunsPanel),
} as const;

/** Every fold the sidebar keeps. */
interface Folds {
  readonly groups: readonly (string | null)[];
  readonly pinned: boolean;
  /** The account's own sections folded, by id. */
  readonly sections: readonly string[];
  /** The tasks whose child tasks stand open under them, by id. */
  readonly openedTasks: readonly string[];
}

const OPEN: Folds = {
  groups: [],
  pinned: false,
  sections: [],
  openedTasks: [],
};

/** The folds with `held` folded where it was open, and open where it was folded. */
function toggled<K extends string | null>(folded: readonly K[], held: K): K[] {
  return folded.includes(held) ? folded.filter((each) => each !== held) : [...folded, held];
}

/** Whether each group is folded, and the presses that fold or unfold one. */
export interface FoldedGroups {
  folded: (repository: string | null) => boolean;
  toggle: (repository: string | null) => void;
  pinnedFolded: boolean;
  togglePinned: () => void;
  /** Whether one of the account's sections is folded, by its id. */
  sectionFolded: (sectionId: string) => boolean;
  toggleSection: (sectionId: string) => void;
  /** Whether a task's child tasks stand open under its row, by its id; folded until first opened. */
  taskOpened: (taskId: string) => boolean;
  toggleTask: (taskId: string) => void;
}

/** The sidebar's folds, each kept as it is pressed, unless the run is `staged`. */
export function useFoldedGroups(staged: boolean): FoldedGroups {
  // Note that the fixture run's folds are a state of their own rather than
  // the kept ones reset, because the run is only known a render after the
  // kept folds were read, as `sidebar-collapse.ts` says of its own.
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

/** Which scope the window's Inbox shows, and the press that shows another. */
interface InboxShowChoice {
  show: InboxShow;
  onShow: (show: InboxShow) => void;
}

/** What the window's Inbox lists, and the presses that change it. */
export interface InboxViewChoices extends InboxShowChoice, InboxWhoseChoice {}

/** Whom the items the window's Inbox lists are addressed to, and the press that lists another's. */
export interface InboxWhoseChoice {
  whose: InboxWhose;
  onWhose: (whose: InboxWhose) => void;
}

/** The Inbox's view choices, Open addressed to the reader, which is Needs you, until first changed, and kept as each is pressed. */
export function useInboxViewChoices(): InboxViewChoices {
  const [show, onShow] = useKept(KEPT.INBOX_SHOW, INBOX_SHOW.OPEN);
  const [whose, onWhose] = useKept(KEPT.WHOSE, MINE);
  return { show, onShow, whose, onWhose };
}

/** A width held within the list's bounds, in whole pixels. */
function clampListWidth(width: number): number {
  return Math.min(INBOX_LIST_WIDTH.MAX, Math.max(INBOX_LIST_WIDTH.MIN, Math.round(width)));
}

/** How wide the Inbox's list stands, and the drag that asks for another width. */
export interface InboxListWidth {
  /** Always within {@link INBOX_LIST_WIDTH}. */
  width: number;
  /** Asks for a width; it is clamped to the bounds before it is kept. */
  onResize: (width: number) => void;
}

/** The Inbox list's width, the default until first dragged, and kept as it is. */
export function useInboxListWidth(): InboxListWidth {
  const [kept, keep] = useKept(KEPT.INBOX_LIST_WIDTH, INBOX_LIST_WIDTH.DEFAULT);
  return { width: clampListWidth(kept), onResize: (asked) => keep(clampListWidth(asked)) };
}

/** How wide the tree beside File and Changes tabs stands, and the drag that asks for another width. */
export interface FileTreeWidth {
  /** Always within {@link FILE_TREE_WIDTH}. */
  width: number;
  /** Asks for a width; it is clamped to the bounds before it is kept. */
  onResize: (width: number) => void;
}

/** A tree width held within its bounds, in whole pixels. */
function clampTreeWidth(width: number): number {
  return Math.min(FILE_TREE_WIDTH.MAX, Math.max(FILE_TREE_WIDTH.MIN, Math.round(width)));
}

/** The tree's width, the default until first dragged, and kept as it is. */
export function useFileTreeWidth(): FileTreeWidth {
  const [kept, keep] = useKept(KEPT.FILE_TREE_WIDTH, FILE_TREE_WIDTH.DEFAULT);
  // Note that the drag's door is the same door across draws, so the tree the panel hands every tab is the same tree while nothing changed.
  const onResize = useCallback((asked: number) => keep(clampTreeWidth(asked)), [keep]);
  return { width: clampTreeWidth(kept), onResize };
}

/** A Runs panel width held within its bounds, in whole pixels. */
function clampRunsWidth(width: number): number {
  return Math.min(RUNS_PANEL_WIDTH.MAX, Math.max(RUNS_PANEL_WIDTH.MIN, Math.round(width)));
}

/** An automation's Runs panel: how wide it stands, whether it stands, and the presses that change them. */
export interface RunsPanel {
  /** Always within {@link RUNS_PANEL_WIDTH}. */
  width: number;
  open: boolean;
  /** Asks for a width; it is clamped to the bounds before it is kept. */
  onResize: (width: number) => void;
  onToggle: () => void;
  /** Shows the panel where it is folded, and is kept so, as a press of its toggle would be. */
  onShow: () => void;
}

/** The Runs panel's width and fold, open at the default width until changed, and kept as they are. */
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
