import { Schema, SchemaTransformation } from "effect";
import { useCallback, useState } from "react";
import {
  EVERYONES,
  INBOX_GROUPING,
  INBOX_SHOW,
  INBOX_SORT,
  INBOX_WHOSE,
  type InboxGrouping,
  type InboxShow,
  type InboxSort,
  type InboxWhose,
} from "../tasks/inbox-model.js";
import { keptKey, useKept } from "../use-kept.js";

/**
 * folded-groups.ts -- which of the sidebar's groups the developer folded, Pinned, the repositories', the creators', and the assignees', kept across launches, and the Inbox's plan groups, how it lists its items, and how wide its list stands kept the same way.
 *
 * A fold is this window's alone, as the sidebar's width is, so it is kept in
 * the renderer's own storage rather than on the account: a group folded on
 * one Mac stays open on another. A group is kept by its repository's full
 * name, and the tasks with no repository by null. A repository whose last
 * task goes leaves its entry behind: it is a few bytes, and a task on it
 * later comes back folded as it was left. Pinned is kept under a key of
 * its own, since it is no repository, and so are the creators' groups, each
 * by its creator's account id and the tasks nobody is named for by null,
 * and the assignees' groups on the same terms, the tasks no one is assigned
 * to by null, so a repository's fold stands through a while grouped by
 * creator or assignee, and the
 * account's own sections, each by its id. A fixture run starts with every group open
 * and keeps nothing, so its frames never wear a developer's folds. The
 * Inbox's task groups are kept on the same terms, each by its task's id,
 * and so are its view choices, the scope it shows, how it groups and sorts,
 * whose items it lists, a teammate by their account's id, and whether its
 * rows show their media, and its list's width; a task's own Inbox keeps a
 * scope of its own, one for every task, apart from the window's, and shows
 * no media. A choice kept before its scope was is read as the scope that
 * now lists what it listed: a tab kept before the scopes, Needs you or
 * Unread, as To do, and All open or Everything as All; the Needs you
 * button's press, kept before the tabs, as To do where it was pressed and
 * All where it was not; and the sort Waiting longest as Oldest first. A
 * fixture run draws no inbox, so it has nothing staged to keep apart. An automation's Runs panel keeps its width and whether it
 * stands on the same terms, one for every automation, as the side panel
 * keeps one for every plan, and so does the tree beside every File and
 * Changes tab, one width for them all.
 */

/** Where the folds are kept in the renderer's storage. */
const STORAGE_KEY = {
  GROUPS: "luke.sidebarFoldedGroups",
  CREATORS: "luke.sidebarFoldedCreators",
  ASSIGNEES: "luke.sidebarFoldedAssignees",
  PINNED: "luke.sidebarPinnedFolded",
  SECTIONS: "luke.sidebarFoldedSections",
  INBOX_TASKS: "luke.inboxFoldedTasks",
  /** Where the Inbox's task groups were kept before tasks had their name. */
  INBOX_TASKS_EARLIER: "luke.inboxFoldedPlans",
  INBOX_SHOW: "luke.inboxShow",
  TASK_INBOX_SHOW: "luke.taskInboxShow",
  /** Where the Inbox's Needs you button kept its press, before its tabs, which stood before its scopes. */
  INBOX_WAITING_ONLY: "luke.inboxWaitingOnly",
  TASK_INBOX_WAITING_ONLY: "luke.taskInboxWaitingOnly",
  INBOX_GROUPING: "luke.inboxGrouping",
  INBOX_SORT: "luke.inboxSort",
  INBOX_WHOSE: "luke.inboxWhose",
  INBOX_MEDIA_PREVIEWS: "luke.inboxMediaPreviews",
  INBOX_SECOND_LINE: "luke.inboxSecondLine",
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

/** Whether Pinned is folded, or the Inbox's rows show their media. */
const storedFlag = Schema.fromJsonString(Schema.Boolean);

/** The Inbox's folded tasks, by id. */
const storedTasks = Schema.fromJsonString(Schema.Array(Schema.String));

/** How wide the Inbox's list stands. */
const storedWidth = Schema.fromJsonString(Schema.Finite);

/** How wide the Runs panel stands, and whether it stands at all. */
const storedRunsPanel = Schema.fromJsonString(
  Schema.Struct({ width: Schema.Finite, open: Schema.Boolean }),
);

/** How the Inbox groups its items. */
const storedGrouping = Schema.fromJsonString(Schema.Literals(Object.values(INBOX_GROUPING)));

/** The sort an earlier version kept that the sorts no longer name: the open items first, the one waiting longest first. */
const EARLIER_SORT = { WAITING: "waiting" } as const;

/** How the Inbox sorts its items, Waiting longest, which the sorts no longer name, read as Oldest first. */
const storedSort = Schema.fromJsonString(
  Schema.Literals([...Object.values(INBOX_SORT), ...Object.values(EARLIER_SORT)]).pipe(
    Schema.decodeTo(
      Schema.Literals(Object.values(INBOX_SORT)),
      SchemaTransformation.transform({
        decode: (kept) => (kept === EARLIER_SORT.WAITING ? INBOX_SORT.OLDEST : kept),
        encode: (sort) => sort,
      }),
    ),
  ),
);

/** Whose items the Inbox lists. */
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
  [INBOX_SHOW.TO_DO]: INBOX_SHOW.TO_DO,
  [INBOX_SHOW.ALL]: INBOX_SHOW.ALL,
  [EARLIER_SHOW.NEEDS_YOU]: INBOX_SHOW.TO_DO,
  [EARLIER_SHOW.UNREAD]: INBOX_SHOW.TO_DO,
  [EARLIER_SHOW.OPEN]: INBOX_SHOW.ALL,
} as const satisfies Record<
  InboxShow | (typeof EARLIER_SHOW)[keyof typeof EARLIER_SHOW],
  InboxShow
>;

/**
 * Which scope the Inbox shows, as any version kept it: a scope; a tab
 * before the scopes, read as the scope that lists what it did
 * (`SHOW_OF_KEPT`); or, as the key the Needs you button kept its press
 * under is read, whether it was pressed, To do where it was and All, all it
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
          if (typeof kept === "boolean") return kept ? INBOX_SHOW.TO_DO : INBOX_SHOW.ALL;
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
  TASK_INBOX_SHOW: keptKey<InboxShow>(
    STORAGE_KEY.TASK_INBOX_SHOW,
    storedShow,
    STORAGE_KEY.TASK_INBOX_WAITING_ONLY,
  ),
  GROUPING: keptKey<InboxGrouping>(STORAGE_KEY.INBOX_GROUPING, storedGrouping),
  SORT: keptKey<InboxSort>(STORAGE_KEY.INBOX_SORT, storedSort),
  WHOSE: keptKey<InboxWhose>(STORAGE_KEY.INBOX_WHOSE, storedWhose),
  MEDIA_PREVIEWS: keptKey(STORAGE_KEY.INBOX_MEDIA_PREVIEWS, storedFlag),
  SECOND_LINE: keptKey(STORAGE_KEY.INBOX_SECOND_LINE, storedFlag),
  FOLDED_GROUPS: keptKey(STORAGE_KEY.GROUPS, storedFolds),
  FOLDED_CREATORS: keptKey(STORAGE_KEY.CREATORS, storedFolds),
  FOLDED_ASSIGNEES: keptKey(STORAGE_KEY.ASSIGNEES, storedFolds),
  PINNED_FOLDED: keptKey(STORAGE_KEY.PINNED, storedFlag),
  FOLDED_SECTIONS: keptKey(STORAGE_KEY.SECTIONS, storedTasks),
  INBOX_TASKS: keptKey(STORAGE_KEY.INBOX_TASKS, storedTasks, STORAGE_KEY.INBOX_TASKS_EARLIER),
  INBOX_LIST_WIDTH: keptKey(STORAGE_KEY.INBOX_LIST_WIDTH, storedWidth),
  FILE_TREE_WIDTH: keptKey(STORAGE_KEY.FILE_TREE_WIDTH, storedWidth),
  RUNS_PANEL: keptKey(STORAGE_KEY.RUNS_PANEL, storedRunsPanel),
} as const;

/** Every fold the sidebar keeps. */
interface Folds {
  readonly groups: readonly (string | null)[];
  readonly creators: readonly (string | null)[];
  readonly assignees: readonly (string | null)[];
  readonly pinned: boolean;
  /** The account's own sections folded, by id. */
  readonly sections: readonly string[];
}

/** No Inbox task group folded. */
const NO_FOLDED_TASKS: readonly string[] = [];

const OPEN: Folds = { groups: [], creators: [], assignees: [], pinned: false, sections: [] };

/** The folds with `held` folded where it was open, and open where it was folded. */
function toggled(folded: readonly (string | null)[], held: string | null): (string | null)[] {
  return folded.includes(held) ? folded.filter((each) => each !== held) : [...folded, held];
}

/** Whether each group is folded, and the presses that fold or unfold one. */
export interface FoldedGroups {
  folded: (repository: string | null) => boolean;
  toggle: (repository: string | null) => void;
  /** Whether a creator's group is folded, by their account id; undefined is the tasks nobody is named for. */
  creatorFolded: (creatorId: string | undefined) => boolean;
  toggleCreator: (creatorId: string | undefined) => void;
  /** Whether an assignee's group is folded, by their account id; undefined is the tasks no one is assigned to. */
  assigneeFolded: (assigneeId: string | undefined) => boolean;
  toggleAssignee: (assigneeId: string | undefined) => void;
  pinnedFolded: boolean;
  togglePinned: () => void;
  /** Whether one of the account's sections is folded, by its id. */
  sectionFolded: (sectionId: string) => boolean;
  toggleSection: (sectionId: string) => void;
}

/** The sidebar's folds, each kept as it is pressed, unless the run is `staged`. */
export function useFoldedGroups(staged: boolean): FoldedGroups {
  // Note that the fixture run's folds are a state of their own rather than
  // the kept ones reset, because the run is only known a render after the
  // kept folds were read, as `sidebar-collapse.ts` says of its own.
  const [groups, keepGroups] = useKept(KEPT.FOLDED_GROUPS, OPEN.groups);
  const [creators, keepCreators] = useKept(KEPT.FOLDED_CREATORS, OPEN.creators);
  const [assignees, keepAssignees] = useKept(KEPT.FOLDED_ASSIGNEES, OPEN.assignees);
  const [pinned, keepPinned] = useKept(KEPT.PINNED_FOLDED, OPEN.pinned);
  const [sections, keepSections] = useKept(KEPT.FOLDED_SECTIONS, OPEN.sections);
  const [stagedFolds, setStagedFolds] = useState<Folds>(OPEN);
  const folds = staged ? stagedFolds : { groups, creators, assignees, pinned, sections };
  const fold = (next: Partial<Folds>) => {
    if (staged) {
      setStagedFolds({ ...stagedFolds, ...next });
      return;
    }
    if (next.groups !== undefined) keepGroups(next.groups);
    if (next.creators !== undefined) keepCreators(next.creators);
    if (next.assignees !== undefined) keepAssignees(next.assignees);
    if (next.pinned !== undefined) keepPinned(next.pinned);
    if (next.sections !== undefined) keepSections(next.sections);
  };
  const toggle = (repository: string | null) => fold({ groups: toggled(folds.groups, repository) });
  const toggleCreator = (creatorId: string | undefined) =>
    fold({ creators: toggled(folds.creators, creatorId ?? null) });
  const toggleAssignee = (assigneeId: string | undefined) =>
    fold({ assignees: toggled(folds.assignees, assigneeId ?? null) });
  return {
    folded: (repository) => folds.groups.includes(repository),
    toggle,
    creatorFolded: (creatorId) => folds.creators.includes(creatorId ?? null),
    toggleCreator,
    assigneeFolded: (assigneeId) => folds.assignees.includes(assigneeId ?? null),
    toggleAssignee,
    pinnedFolded: folds.pinned,
    togglePinned: () => fold({ pinned: !folds.pinned }),
    sectionFolded: (sectionId) => folds.sections.includes(sectionId),
    toggleSection: (sectionId) =>
      fold({
        sections: folds.sections.includes(sectionId)
          ? folds.sections.filter((held) => held !== sectionId)
          : [...folds.sections, sectionId],
      }),
  };
}

/** Which of the Inbox's task groups are folded, and the press that folds or unfolds one. */
export interface InboxTaskFolds {
  folded: (taskId: string) => boolean;
  toggle: (taskId: string) => void;
}

/** The Inbox's task groups, each open until it is first folded, and kept as it is pressed. */
export function useInboxTaskFolds(): InboxTaskFolds {
  const [folded, keep] = useKept(KEPT.INBOX_TASKS, NO_FOLDED_TASKS);
  return {
    folded: (taskId) => folded.includes(taskId),
    toggle: (taskId) =>
      keep(
        folded.includes(taskId) ? folded.filter((held) => held !== taskId) : [...folded, taskId],
      ),
  };
}

/** Which scope an Inbox shows, and the press that shows another. */
export interface InboxShowChoice {
  show: InboxShow;
  onShow: (show: InboxShow) => void;
}

/** How the window's Inbox lists its items, and the presses that change it. */
export interface InboxViewChoices extends InboxShowChoice, InboxWhoseChoice {
  grouping: InboxGrouping;
  onGrouping: (grouping: InboxGrouping) => void;
  sort: InboxSort;
  onSort: (sort: InboxSort) => void;
  /** Whether each row shows the pictures and pages its item carries, drawn small under its preview. */
  mediaPreviews: boolean;
  onMediaPreviews: (mediaPreviews: boolean) => void;
  /** Whether each row shows its second line, what its item asks or how it ended, under its title; off, every row is one line. */
  secondLine: boolean;
  onSecondLine: (secondLine: boolean) => void;
}

/** Whose items the window's Inbox lists, and the press that lists another's. */
export interface InboxWhoseChoice {
  whose: InboxWhose;
  onWhose: (whose: InboxWhose) => void;
}

/** An Inbox's scope, To do until first chosen, and kept under `key` as it is chosen. */
function useKeptShow(key: typeof KEPT.INBOX_SHOW | typeof KEPT.TASK_INBOX_SHOW): InboxShowChoice {
  const [show, onShow] = useKept(key, INBOX_SHOW.TO_DO);
  return { show, onShow };
}

/** A task's own Inbox's scope, To do until first chosen, kept apart from the window's and shared by every task. */
export function useTaskInboxShow(): InboxShowChoice {
  return useKeptShow(KEPT.TASK_INBOX_SHOW);
}

/** The Inbox's view choices, To do of everyone's, grouped by nothing, the latest first, with no media shown, until first changed, and kept as each is pressed. */
export function useInboxViewChoices(): InboxViewChoices {
  const shown = useKeptShow(KEPT.INBOX_SHOW);
  const [grouping, onGrouping] = useKept(KEPT.GROUPING, INBOX_GROUPING.NONE);
  const [sort, onSort] = useKept(KEPT.SORT, INBOX_SORT.LATEST);
  const [whose, onWhose] = useKept(KEPT.WHOSE, EVERYONES);
  const [mediaPreviews, onMediaPreviews] = useKept(KEPT.MEDIA_PREVIEWS, false);
  const [secondLine, onSecondLine] = useKept(KEPT.SECOND_LINE, true);
  return {
    ...shown,
    grouping,
    onGrouping,
    sort,
    onSort,
    whose,
    onWhose,
    mediaPreviews,
    onMediaPreviews,
    secondLine,
    onSecondLine,
  };
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
