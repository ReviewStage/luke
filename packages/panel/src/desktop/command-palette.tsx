/**
 * command-palette.tsx -- ⌘K: the tasks, the open task's agents and files, the Inbox's items, every command the window can run now, and the Settings pages and settings, found by typing, in a dialog over the window.
 *
 * The palette is cmdk's own dialog, list, and keys, drawn in the window's
 * menu rows, under a row of filters as Cursor's palette has them: All, then
 * one kind each. All lists each kind's best few rows under its heading, and
 * a filter that kind's alone, as many as are worth reading. ← and → step
 * through the filters while the search field is empty, and ⌘[ and ⌘] at
 * any time, where they mean Back and Forward elsewhere; once anything is
 * typed, ← and → move the caret, as in any text field. A press on a filter
 * chooses it. The palette ranks the rows itself with cmdk's own scoring, so
 * each kind keeps its own best few however many rows the others hold.
 *
 * It decides nothing about a command: it lists the commands whose control is
 * on screen and able right now (`app-commands.ts`), so a row runs exactly
 * what its shortcut would, Delete task's question included, and it opens a
 * task through the same select the sidebar does, which takes its ask back
 * when the host does not open the task. Each task names its repository
 * beside it, so two tasks of one name can be told apart, and hangs the
 * task's card beside its row, as its sidebar row does. An agent opens its tab as the column's "+" would, hanging
 * its tab's card beside its row while the pointer rests on it, as every
 * place naming an agent does (`agent-ref.tsx`), and an archived agent, which
 * says so, its own page, a subagent
 * its tab as the side panel's "+" would, a file in a tab of its own as one
 * chosen in a File tab's tree would, a Settings page opens as the Settings
 * sidebar's row for it does, and a setting lands on its row as the settings
 * search does. The pages are the sidebar's own list, and a page found ranks
 * above every setting found, so "voice" offers the page before its rows. The
 * files are the open task's repository read whole in the one listing the File
 * tab's search reads, the first time a file is searched, and fuzzy-matched on
 * their paths.
 *
 * The Inbox's items are the listed workspace's, as the window's Inbox lists
 * them, followed the first time the Inbox is searched (`use-inbox-search.ts`):
 * each found by its title and its task's or automation's name, and else by
 * anything its thread says, the words that found it then said beside its
 * task's name. One chosen opens in the Inbox, as a notification's would.
 *
 * It is the nearest layer while it stands: no key pressed in it goes on to
 * the window, so Escape closes the palette and nothing else, a call's reply
 * included, and no chord changes what stands behind it. Closing hands focus
 * back to whatever had it, and only then runs what was chosen, so a command
 * acts from where the developer was, as its shortcut would have. It then
 * fades out over `--luke-duration-exit`, held by Radix's dialog through the exit
 * its `data-state` plays, and inert while it does.
 *
 * Every row's value is its place in the list, never words: cmdk writes it
 * into an attribute, which the session recording does not mask
 * (`session-replay.ts`), and two tasks may share a name. The search reads
 * each row's words instead.
 */

import type { TasklessAgent } from "@luke/features/coding-agent-wire";
import { TASK_TREE_BOUNDS, TASK_TREE_ENTRY, type TaskSummary } from "@luke/features/task-wire";
import type { TaskCodeShowing, TasksTreeAnswer } from "@luke/features/tasks-view";
import { taskKey } from "@luke/features/workspace-key";
import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import type { ExperimentChoices, HostCapability } from "@luke/settings";
import { SETTINGS_PAGE_LIST, type SettingsView } from "@luke/settings/settings-views";
import {
  APP_COMMAND,
  APP_SHORTCUT_GROUPS,
  APP_SHORTCUTS,
  type AppCommand,
  appCommandLabel,
  commandForKey,
  isKeyedCommand,
  type KeyedCommand,
  PALETTE_COMMANDS,
  SHORTCUT_KEY,
  type ShortcutChord,
} from "@luke/settings/shortcuts";
import {
  CHOICE_BAR_FOCUS,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  COMBOBOX_LIST_HEIGHT,
  ComboboxListBox,
  ComboboxOptionItem,
  ErrorState,
  GearIcon,
  NoteLine,
  PinIcon,
  SearchIcon,
  Shortcut,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Tooltip,
  UnpinIcon,
  useMinute,
  VisuallyHidden,
  WingFace,
} from "@luke/ui";
import {
  ACTOR_KIND,
  type Actor,
  actorName,
  assigneeFace,
  memberActor,
  ROLE_WORDS,
} from "@luke/ui/actor-model";
import { matchesTokens, matchRanges, searchTokens } from "@luke/ui/search-tokens";
import {
  agentRow,
  orderTaskRows,
  TASK_ORDER,
  TASK_ROW,
  type TaskRow,
  taskRow,
  taskRowName,
} from "@luke/ui/task-list-model";
import { DOCUMENT_REGION, TASK_MARK } from "@luke/ui/tasks-model";
import { formatCount } from "@luke/ui/time-format";
import { Command, defaultFilter } from "cmdk";
import { LinkIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActorMark, AssigneeFaceMark } from "../actor-ref.js";
import {
  appCommandOffered,
  runAppCommand,
  useAppCommand,
  useOverlayHold,
} from "../app-commands.js";
import { AttentionMark } from "../attention-mark.js";
import { type CopyLink, inSidePanel, type LinkAtHand } from "../links-at-hand.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import { Highlighted } from "../search-field.js";
import { settingsPageOf } from "../settings/pages.js";
import { settingsPageShown } from "../settings/settings-rows.js";
import {
  landOnSettingsRow,
  resultPageWord,
  type SettingsSearchInput,
  settingsSearchEntries,
} from "../settings-search.js";
import { AgentCard, agentSubject, NOTHING_HELD } from "../tasks/agent-ref.js";
import { useChatOn } from "../tasks/chat-gate.js";
import { agentTabLabel } from "../tasks/coding-agent-model.js";
import { FileCard, fileLook, newestFileNote } from "../tasks/file-ref.js";
import { refusalLine } from "../tasks/file-tab-model.js";
import { ItemMark } from "../tasks/inbox-list.js";
import {
  holderName,
  type InboxListed,
  inboxItemWords,
  NEEDS_YOU,
  needsYou,
} from "../tasks/inbox-model.js";
import { agentEndMark, openPlanStanding, TAB_KIND, tabLook } from "../tasks/tab-look.js";
import { markReadItem } from "../tasks/task-menu-items.js";
import { cardTitle } from "../tasks/tool-call-model.js";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import { choiceOf } from "../tasks/use-inbox-listing.js";
import { type InboxSearch, useInboxSearch } from "../tasks/use-inbox-search.js";
import { SIDE_PANEL_TAB_KIND, SIDE_PANEL_TABS } from "../tasks/use-side-panel.js";
import { type ReadMarks, useReadMarks } from "../tasks/use-task-looks.js";
import { useTaskOrigin } from "../tasks/use-task-origin.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import {
  useWorkspaceMembersRead,
  type WorkspaceMembersRead,
} from "../tasks/use-workspace-members.js";
import { useExperimentChoices } from "../use-app-state.js";
import { type AgentReadMarks, useAgentReadMarks } from "./agent-read-marks.js";
import { LUKE_NAME, type LukeOperator, useLukeOperator, withoutLuke } from "./luke-operator.js";
import { agentEntries, chatEntries, inboxEntries } from "./main-tabs.js";
import { strandedHome } from "./move-task-dialog.js";
import { changesOffers, panelEntries } from "./side-panel.js";
import { taskOf } from "./task-actions.js";
import { homeTaskCardOf, TaskRowMark } from "./task-card.js";
import { WorkspaceRef } from "./workspace-ref.js";

/** The kinds of row the palette lists, each a filter of its own after All, in the order the filters stand. */
const PALETTE_FILTER = {
  ALL: "all",
  TASKS: "plans",
  AGENTS: "agents",
  INBOX: "inbox",
  PEOPLE: "people",
  FILES: "files",
  ACTIONS: "actions",
  SETTINGS: "settings",
} as const;

type PaletteFilter = (typeof PALETTE_FILTER)[keyof typeof PALETTE_FILTER];

/** A kind of row, which every filter but All is. */
type PaletteKind = Exclude<PaletteFilter, typeof PALETTE_FILTER.ALL>;

const PALETTE_FILTERS: readonly PaletteFilter[] = Object.values(PALETTE_FILTER);

/** Each filter's name, which is also each kind's heading under All. */
const FILTER_LABEL = {
  [PALETTE_FILTER.ALL]: "All",
  [PALETTE_FILTER.TASKS]: "Tasks",
  [PALETTE_FILTER.AGENTS]: "Agents",
  [PALETTE_FILTER.INBOX]: "Inbox",
  [PALETTE_FILTER.PEOPLE]: "People",
  [PALETTE_FILTER.FILES]: "Files",
  [PALETTE_FILTER.ACTIONS]: "Actions",
  [PALETTE_FILTER.SETTINGS]: "Settings",
} as const satisfies Record<PaletteFilter, string>;

/** What the search field asks for under each filter. */
const FILTER_PLACEHOLDER = {
  [PALETTE_FILTER.ALL]: "Search tasks, agents, inbox, people, files, actions, and settings…",
  [PALETTE_FILTER.TASKS]: "Search tasks…",
  [PALETTE_FILTER.AGENTS]: "Search agents…",
  [PALETTE_FILTER.INBOX]: "Search inbox…",
  [PALETTE_FILTER.PEOPLE]: "Search people…",
  [PALETTE_FILTER.FILES]: "Search files…",
  [PALETTE_FILTER.ACTIONS]: "Search actions…",
  [PALETTE_FILTER.SETTINGS]: "Search settings…",
} as const satisfies Record<PaletteFilter, string>;

/** How many rows a kind lists: its best few under All, and as many as are worth reading under its own filter. */
const KIND_ROWS = {
  ALL: 5,
  FILTERED: 50,
} as const;

/** The first row's value: rows are valued by their place in the list, from one. */
const FIRST_ROW = "1";

/** What the row that opens Luke says, as his chord's command names it. */
const ASK_LUKE_LABEL = appCommandLabel(APP_COMMAND.ASK_LUKE);

/** How far the read of the open task's files has come: asked, listed, or not listed and why. */
const FILES_READ = {
  READING: "reading",
  LISTED: "listed",
  MISSED: "missed",
} as const;

/**
 * The open task's repository as the palette read it, whole, in one listing:
 * which task and repository it is of, and its files by path, or why they
 * were not listed.
 */
type FilesHeld = { taskId: string; repository: string } & FilesRead;

type FilesRead =
  | { read: typeof FILES_READ.READING }
  | { read: typeof FILES_READ.LISTED; paths: readonly string[]; truncated: boolean }
  | { read: typeof FILES_READ.MISSED; notice: string };

/** What the Files filter says while no plan with a repository stands open, as under an agent's page. */
const NO_REPOSITORY_LINE = "Open a task with a repository to search its files.";

/** What the Files filter says where the read did not land. */
const FILES_MISSED_LINE = "The files could not be read.";

/** What the Files filter says while the repository is read. */
const READING_LINE = "Reading the repository's files…";

/** What the Tasks filter says while the account's tasks are first read, and where that read did not land. */
const TASKS_READING_LINE = "Reading your tasks…";
const TASKS_FAILED_LINE = "Your tasks could not be read.";

/** What the Inbox filter says while its items are first read, and where a read did not land. */
const INBOX_READING_LINE = "Reading your inbox…";
const INBOX_FAILED_LINE = "Your inbox could not be read.";

/** How many characters of an item's words a row says on either side of the word that found it. */
const SNIPPET_REACH = 40;

/** What the People filter says while the listed workspace's members are read, and where that read did not land. */
const PEOPLE_READING_LINE = "Reading the workspace's members…";
const PEOPLE_FAILED_LINE = "The workspace's members could not be read.";

/** What the list says in place of "Nothing matches.": a line of its own, a source still reading, or one refused. */
const PALETTE_NOTICE = {
  SAID: "said",
  READING: "reading",
  FAILED: "failed",
} as const;

/** A notice and its words, a refusal with the Retry that reads its source again. */
type PaletteNotice =
  | {
      readonly kind: typeof PALETTE_NOTICE.SAID | typeof PALETTE_NOTICE.READING;
      readonly line: string;
    }
  | {
      readonly kind: typeof PALETTE_NOTICE.FAILED;
      readonly line: string;
      readonly onRetry: () => void;
    };

/** What the Files filter says under a listing cut short at the wire's bound. */
const TRUNCATED_LINE = `Only the repository's first ${formatCount(TASK_TREE_BOUNDS.MAX_RECURSIVE_ENTRIES)} entries are searched.`;

/** A footer hint: the chords it names and what they do. */
interface FooterHint {
  chords: readonly ShortcutChord[];
  label: string;
}

/**
 * The footer's hints for the list's own keys, which are bare. Escape is not
 * among them, because every dialog closes on it and saying so is noise.
 */
const LIST_HINTS: readonly FooterHint[] = [
  {
    chords: [
      { key: SHORTCUT_KEY.UP, bare: true },
      { key: SHORTCUT_KEY.DOWN, bare: true },
    ],
    label: "Select",
  },
  { chords: [{ key: SHORTCUT_KEY.ENTER, bare: true }], label: "Open" },
];

/**
 * The Filter hint, naming the keys that step the filters now: ← and → while
 * the search field is empty, ⌘[ and ⌘] once anything is typed, when the
 * arrows are the caret's.
 */
const FILTER_HINT = {
  EMPTY: {
    chords: [
      { key: SHORTCUT_KEY.LEFT, bare: true },
      { key: SHORTCUT_KEY.RIGHT, bare: true },
    ],
    label: "Filter",
  },
  TYPED: {
    chords: [APP_SHORTCUTS[APP_COMMAND.BACK].chord, APP_SHORTCUTS[APP_COMMAND.FORWARD].chord],
    label: "Filter",
  },
} as const satisfies Record<string, FooterHint>;

/** The word a Settings page is also found by, beside its own name, so "settings" lists the pages. */
const SETTINGS_WORD = "Settings";

/** What an archived agent's detail says of it. */
const ARCHIVED_WORD = "Archived";

/** The commands the palette lists: the Keyboard shortcuts page's, then the menu bar's own dialogs, then its own, the sidebar's view of its tasks. */
const LISTED_COMMANDS: readonly AppCommand[] = [
  ...APP_SHORTCUT_GROUPS.flatMap((group) => group.commands),
  APP_COMMAND.NEW_TERMINAL,
  APP_COMMAND.SEND_FEEDBACK,
  APP_COMMAND.SUGGEST_FEATURE,
  ...PALETTE_COMMANDS,
];

/** One row as the palette draws it, the words its search reads, and what choosing it does. */
/** Words a Copy link row is found by beside its name. */
const COPY_LINK_TERMS = ["link", "share", "url"] as const;

interface PaletteRow {
  icon?: React.ReactNode;
  label: string;
  /** Muted words after the name: a task's repository, an agent's task, a setting's page. */
  detail?: string | undefined;
  /** The workspace a task is in where that is not the one listed, named by its tile and name before the detail. */
  workspace?: Workspace | undefined;
  /** The mark at the row's end: a failed agent's, or a task's face of who is on it (`assigneeFace`) and its row's mark (`TaskRowMark`). */
  endMark?: React.JSX.Element | undefined;
  /** A task's assignee's and creator's names, the one the query found it by said after the detail. */
  people?: readonly string[] | undefined;
  /** The card the row hangs beside it while the pointer rests on it: a task's, an agent's tab's, or a file's. */
  card?: React.ReactNode;
  /** The chord an action's row draws as keys. */
  command?: KeyedCommand | undefined;
  /** The short words the search scores, the name first. */
  terms: readonly string[];
  /** Longer words the row is found by as the settings search finds it, every word of the query somewhere in them. */
  keywords?: readonly string[] | undefined;
  onChoose: () => void;
}

/** One kind's rows, ranked and cut to what the filter lists. */
interface PaletteSection {
  kind: PaletteKind;
  rows: readonly PaletteRow[];
}

/** The score a row found only by its keywords takes: after every row its own words matched. */
const KEYWORD_SCORE = Number.MIN_VALUE;

/**
 * How well a row answers the query: cmdk's own score over its short words,
 * else the least score where every word of the query is in its keywords.
 * Note that the keywords are not scored by cmdk, because its scoring is
 * fuzzy and a setting's description is long enough to hold almost any
 * letters in order.
 */
function rowScore(row: PaletteRow, query: string, tokens: readonly string[]): number {
  const score = defaultFilter(row.terms.join(" "), query);
  if (score > 0 || row.keywords === undefined) return score;
  return matchesTokens(row.keywords, tokens) ? KEYWORD_SCORE : 0;
}

/**
 * How well a path answers the query: cmdk's own score, asked only of a path
 * holding every letter typed, since the repository may hold tens of
 * thousands and most hold none of a query's rarer letters.
 */
function pathScore(path: string, query: string): number {
  const lowered = path.toLowerCase();
  for (const letter of query.toLowerCase()) {
    if (letter.trim() !== "" && !lowered.includes(letter)) return 0;
  }
  return defaultFilter(path, query);
}

/**
 * The items that match the query, best first, as many as `limit`, ties
 * left in the order given. A blank query matches every item in that order.
 */
function ranked<Item>(
  items: readonly Item[],
  query: string,
  limit: number,
  score: (item: Item, tokens: readonly string[]) => number,
): readonly Item[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return items.slice(0, limit);
  return items
    .map((item) => ({ item, score: score(item, tokens) }))
    .filter((each) => each.score > 0)
    .sort((first, second) => second.score - first.score)
    .slice(0, limit)
    .map((each) => each.item);
}

/** The repository's listing as the palette holds it: its files alone, by path, or why not. */
function filesOf(answer: TasksTreeAnswer): FilesRead {
  if ("folder" in answer) {
    return {
      read: FILES_READ.LISTED,
      paths: answer.folder.entries
        .filter((entry) => entry.kind === TASK_TREE_ENTRY.FILE)
        .map((entry) => entry.name),
      truncated: answer.folder.truncated,
    };
  }
  if ("failure" in answer) return { read: FILES_READ.MISSED, notice: FILES_MISSED_LINE };
  return { read: FILES_READ.MISSED, notice: refusalLine(answer.refusal, answer.branch) };
}

/** What the Files filter says in place of rows: why there are none to search yet, or nothing. */
function filesNotice(
  repositoryOpen: boolean,
  held: FilesHeld | undefined,
): PaletteNotice | undefined {
  if (!repositoryOpen) return { kind: PALETTE_NOTICE.SAID, line: NO_REPOSITORY_LINE };
  if (held === undefined || held.read === FILES_READ.READING) {
    return { kind: PALETTE_NOTICE.READING, line: READING_LINE };
  }
  return held.read === FILES_READ.MISSED
    ? { kind: PALETTE_NOTICE.SAID, line: held.notice }
    : undefined;
}

/** What the Tasks filter says while the account's tasks have not been read, or their read did not land; nothing once they are read. */
function tasksNotice(
  tasks: Pick<TasksControl, "signedIn" | "listRead" | "listFailed" | "onRetryList">,
): PaletteNotice | undefined {
  if (!tasks.signedIn || tasks.listRead) return undefined;
  return tasks.listFailed
    ? { kind: PALETTE_NOTICE.FAILED, line: TASKS_FAILED_LINE, onRetry: tasks.onRetryList }
    : { kind: PALETTE_NOTICE.READING, line: TASKS_READING_LINE };
}

/**
 * What the People filter says while the listed workspace's members have not
 * been read, the workspaces themselves among that, or their read was
 * refused; nothing once they are read, or where no workspace is to come.
 */
function peopleNotice(
  tasks: Pick<TasksControl, "signedIn" | "workspace" | "workspaces" | "listFailed">,
  read: WorkspaceMembersRead,
): PaletteNotice | undefined {
  if (tasks.workspace === undefined) {
    const coming = tasks.signedIn && tasks.workspaces.length === 0 && !tasks.listFailed;
    return coming ? { kind: PALETTE_NOTICE.READING, line: PEOPLE_READING_LINE } : undefined;
  }
  if (read.members !== undefined) return undefined;
  return read.refused
    ? { kind: PALETTE_NOTICE.FAILED, line: PEOPLE_FAILED_LINE, onRetry: read.retry }
    : { kind: PALETTE_NOTICE.READING, line: PEOPLE_READING_LINE };
}

/** What the Inbox filter says while its items have not been pushed, or a push did not land; nothing once every one is. */
function inboxNotice(search: InboxSearch): PaletteNotice | undefined {
  if (search.reading) return { kind: PALETTE_NOTICE.READING, line: INBOX_READING_LINE };
  return search.failed
    ? { kind: PALETTE_NOTICE.FAILED, line: INBOX_FAILED_LINE, onRetry: search.onRetry }
    : undefined;
}

/**
 * What an empty list says for the filter shown: its kind's own notice, or,
 * under All, the first kind still reading, else the first refused, since
 * either could still have matched; nothing where "Nothing matches." is true.
 */
function emptyNotice(
  filter: PaletteFilter,
  notices: readonly (PaletteNotice | undefined)[],
): PaletteNotice | undefined {
  if (filter !== PALETTE_FILTER.ALL) return notices[0];
  return (
    notices.find((notice) => notice?.kind === PALETTE_NOTICE.READING) ??
    notices.find((notice) => notice?.kind === PALETTE_NOTICE.FAILED)
  );
}

/** The list's notice where its rows would stand: a refusal with Retry, a reading line a reader hears, or a line of its own. */
function NoticeLine({ notice }: { notice: PaletteNotice }): React.JSX.Element {
  if (notice.kind === PALETTE_NOTICE.FAILED) {
    return (
      <div className="command-palette-notice-slot">
        <ErrorState onRetry={notice.onRetry}>{notice.line}</ErrorState>
      </div>
    );
  }
  return <NoteLine status={notice.kind === PALETTE_NOTICE.READING}>{notice.line}</NoteLine>;
}

/** A file's row, as every place names a file (`file-ref.tsx`): its type's icon, its name, and its folder after it, hanging the file's card with Luke's note on its newest lines where he showed it. */
function fileRow(
  path: string,
  read: { readonly shown: readonly TaskCodeShowing[]; readonly repository: string | null },
  open: (path: string) => void,
): PaletteRow {
  const note = newestFileNote(read.shown, path, { repository: read.repository, commit: undefined });
  return {
    ...fileLook(path),
    card: <FileCard path={path} note={note} />,
    onChoose: () => open(path),
  };
}

/**
 * How many filters an arrow steps, or none: ← or → alone while the search
 * field is empty, where there is no caret to move. Once anything is typed the
 * arrows move the caret, and ⌘[ and ⌘] are what step the filters.
 */
function arrowStep(event: React.KeyboardEvent, query: string): number {
  if (query !== "" || event.nativeEvent.isComposing) return 0;
  if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return 0;
  if (event.key === SHORTCUT_KEY.LEFT.key) return -1;
  if (event.key === SHORTCUT_KEY.RIGHT.key) return 1;
  return 0;
}

/** The filter `step` places from the one given, wrapping at either end. */
function steppedFilter(filter: PaletteFilter, step: number): PaletteFilter {
  const at = PALETTE_FILTERS.indexOf(filter);
  const count = PALETTE_FILTERS.length;
  return PALETTE_FILTERS[(at + step + count) % count] ?? PALETTE_FILTER.ALL;
}

/** The word a task Luke or an agent made is also found by, beside its maker's name. */
const MADE_BY_WORDS: Partial<Record<Actor["kind"], string>> = {
  [ACTOR_KIND.LUKE]: "luke",
  [ACTOR_KIND.AGENT]: "agent",
  [ACTOR_KIND.AUTOMATION]: "automation",
};

/** A task's row's card, as its sidebar row hangs it, its times counted back from the minute it is hung. */
function PaletteTaskCard({
  tasks,
  task,
}: {
  tasks: TasksControl;
  task: TaskSummary;
}): React.JSX.Element {
  return homeTaskCardOf(tasks, task, useMinute());
}

/** A task's muted words: its repository. */
function taskDetail(task: TaskSummary): string | undefined {
  return task.repository ?? undefined;
}

/**
 * Every plan and every agent with no task, as the sidebar lists them among
 * each other (`task-list-model.ts`'s rows): the pinned first, then the rest
 * by their last activity (`taskRowTime`), then the archived agents, each in
 * its tab's look, an archived one saying so in its detail. Within each, the
 * listed workspace's come first and every other workspace's tasks after
 * them, naming its workspace and found by its name, since opening one
 * switches the window to it. A task wears at its end who is on it and its
 * row's mark, as its sidebar row does (`assigneeFace`, `TaskRowMark`), and
 * is found by its key, its assignee's name, and its creator's. An agent
 * opens on its own page, as its sidebar row does. An agent's line on a
 * task's card opens the task on its tab through `showAgent`, which leaves
 * the palette as a row does.
 */
function taskRows(
  tasks: TasksControl,
  members: readonly WorkspaceMember[] | undefined,
  open: (taskId: string) => void,
  openAgent: (agentId: string) => void,
  showAgent: TasksControl["onShowAgent"],
  originOf: (task: TaskSummary) => Actor | undefined,
): readonly PaletteRow[] {
  const listedId = tasks.workspace?.id;
  const carded = { ...tasks, onShowAgent: showAgent };
  // Note that only the listed workspace's members are read, so another workspace's assignee stands by the wire's name, never as having left.
  const listedMembers = (task: TaskSummary) =>
    task.workspaceId === listedId ? members : undefined;
  const readerOf = (task: TaskSummary) => ({ members: listedMembers(task), readerId: tasks.me });
  const elsewhereOf = (task: TaskSummary): Workspace | undefined =>
    listedId === undefined || task.workspaceId === listedId
      ? undefined
      : tasks.workspaces.find((each) => each.id === task.workspaceId);
  // Note that a task is found by its key, as its card and the Tasks list say it, read under its own workspace's name.
  const keyOf = (task: TaskSummary): string | null => {
    const home = tasks.workspaces.find((each) => each.id === task.workspaceId);
    return home === undefined || task.number === undefined ? null : taskKey(home.name, task.number);
  };
  const taskOf = (task: TaskSummary): PaletteRow => {
    const elsewhere = elsewhereOf(task);
    const worn = assigneeFace(task, readerOf(task));
    const createdBy = task.createdBy?.name ?? null;
    const assignedTo = task.assignee?.name ?? null;
    // Note that a task Luke or an agent made says them in its detail, so it is found by them.
    const origin = originOf(task);
    const madeBy = origin === undefined ? null : actorName(origin);
    const detail = taskDetail(task);
    return {
      ...tabLook({ kind: TAB_KIND.PLAN, name: task.name, status: task.status }),
      detail:
        madeBy === null
          ? detail
          : [detail, `by ${madeBy}`].filter((words) => words !== undefined).join(" · "),
      workspace: elsewhere,
      card: <PaletteTaskCard tasks={carded} task={task} />,
      endMark: (
        <>
          {worn === undefined ? null : <AssigneeFaceMark face={worn} />}
          <TaskRowMark task={task} stranded={strandedHome(tasks, task)} />
        </>
      ),
      people: [...new Set([assignedTo, createdBy])].filter((name) => name !== null),
      terms: [
        task.name,
        keyOf(task),
        task.repository,
        elsewhere?.name ?? null,
        assignedTo,
        createdBy,
        madeBy,
        origin === undefined ? null : MADE_BY_WORDS[origin.kind],
      ].filter((term) => term !== null && term !== undefined),
      onChoose: () => open(task.id),
    };
  };
  const agentOf = (agent: TasklessAgent, archived: boolean): PaletteRow => {
    const name = taskRowName(agentRow(agent));
    const words = [agent.repository, archived ? ARCHIVED_WORD : null].filter(
      (word) => word !== null,
    );
    return {
      ...tabLook({ kind: TAB_KIND.AGENT, name, agent }),
      detail: words.length === 0 ? undefined : words.join(" · "),
      endMark: agentEndMark(agent, archived),
      terms: [name, agent.repository, agent.automationName ?? null].filter((term) => term !== null),
      onChoose: () => openAgent(agent.id),
    };
  };
  const rowOf = (row: TaskRow, archived: boolean): PaletteRow =>
    row.kind === TASK_ROW.TASK ? taskOf(row.task) : agentOf(row.agent, archived);
  const listed = (task: TaskSummary) => listedId === undefined || task.workspaceId === listedId;
  // The pinned stand first, as the sidebar's; the rest by their last
  // activity, as the sidebar, Home's Recent, and the row's time read it.
  const pinnedFirst = (rows: readonly TaskRow[]) => [
    ...rows.filter((row) => taskRowPinnedAt(row) !== undefined),
    ...orderTaskRows(
      rows.filter((row) => taskRowPinnedAt(row) === undefined),
      TASK_ORDER.UPDATED,
    ),
  ];
  const { standing: agents, archived: archivedAgents } = tasks.listedAgents;
  const here = [...tasks.tasks.filter(listed).map(taskRow), ...agents.map(agentRow)];
  const elsewhere = tasks.tasks.filter((task) => !listed(task)).map(taskRow);
  // The listed workspace's archived agents, by their last activity.
  const archived = orderTaskRows(archivedAgents.map(agentRow), TASK_ORDER.UPDATED);
  return [
    ...pinnedFirst(here).map((row) => rowOf(row, false)),
    ...pinnedFirst(elsewhere).map((row) => rowOf(row, false)),
    ...archived.map((row) => rowOf(row, true)),
  ];
}

/** When the reader pinned a row's task or agent; undefined while they have not. */
function taskRowPinnedAt(row: TaskRow): number | undefined {
  return row.kind === TASK_ROW.TASK ? row.task.pinnedAt : row.agent.pinnedAt;
}

/** Shows one of the side panel's tabs, the version history put away first so the tab is not shown behind it. */
function shownOverHistory(tasks: TasksControl, show: () => void): void {
  if (tasks.history.open) tasks.history.onClose();
  show();
}

/**
 * The open task's Inbox, Chat, and coding agents, as the column's "+" lists them,
 * then its agents' Changes tabs, as the side panel's "+" lists them, then
 * its archived agents (`archivedAgentRows`), each in its row's look and
 * words, found by its row's words, and beside the task's name; none while
 * no task is open. An agent opens as its notification's click opens it, the
 * Inbox the same way, and a Changes tab as the "+" opens it, the version history
 * giving way to each, so none opens behind what covers it.
 */
function agentRows(
  tasks: TasksControl,
  chatOn: boolean,
  show: (pick: () => void) => void,
): readonly PaletteRow[] {
  const taskId = tasks.activeTaskId;
  if (taskId === undefined) return [];
  const taskName = tasks.tasks.find((task) => task.id === taskId)?.name;
  const inbox = inboxEntries(tasks.agents, () => tasks.onShowInbox(taskId));
  const chat = chatEntries(chatOn && tasks.chatView.available, () => tasks.onShowChat(taskId));
  const agents = agentEntries(tasks.mainTabs, tasks.agents).map((entry) => ({
    ...entry,
    onPick: () => tasks.onShowAgent(taskId, entry.row.id),
  }));
  // Note that the plan's Changes open in its own panel, and in the Inbox's
  // beside an item of the plan, which draws its pull requests.
  const subagents = opensTaskItems(tasks)
    ? panelEntries({
        panel: tasks.sidePanel,
        kinds: [],
        files: [],
        changes: changesOffers(tasks.agents, tasks.sidePanel.changes),
      }).map((entry) => ({ ...entry, onPick: () => shownOverHistory(tasks, entry.onPick) }))
    : [];
  const entries = [...inbox, ...chat, ...agents, ...subagents];
  const standing = entries.map(({ row, endMark, onPick, agent }) => ({
    icon: row.icon,
    label: row.label,
    detail: [row.detail, taskName].filter((word) => word !== undefined).join(" · ") || undefined,
    endMark,
    card:
      agent === undefined ? undefined : (
        <AgentCard
          subject={agentSubject(tasks.agents, agent.id, NOTHING_HELD, false)}
          models={tasks.agents.models}
        />
      ),
    terms: [...(row.terms ?? [row.label]), ...(taskName === undefined ? [] : [taskName])],
    onChoose: () => show(onPick),
  }));
  return [...standing, ...archivedAgentRows(tasks, taskName, show)];
}

/**
 * The open plan's archived agents, in the order started, each in its tab's
 * look and found by its name as a standing one is, its detail saying it is
 * archived before the plan's name, and hanging its card. Note that one opens
 * on its own page, as an archived agent the sidebar lists does, because its
 * tab is gone from the plan's column and its page is where it is read and
 * brought back.
 */
function archivedAgentRows(
  tasks: TasksControl,
  taskName: string | undefined,
  show: (pick: () => void) => void,
): readonly PaletteRow[] {
  const { agents } = tasks;
  return (agents.archived ?? []).map((agent) => {
    const look = tabLook({
      kind: TAB_KIND.AGENT,
      name: agentTabLabel(agent, agents.models),
      agent,
    });
    return {
      ...look,
      detail: [ARCHIVED_WORD, taskName].filter((word) => word !== undefined).join(" · "),
      endMark: agentEndMark(agent, true),
      card: (
        <AgentCard
          subject={agentSubject(agents, agent.id, NOTHING_HELD, false)}
          models={agents.models}
        />
      ),
      terms: [look.label, ...(taskName === undefined ? [] : [taskName])],
      onChoose: () => show(() => tasks.agentView.onOpen(agent.id)),
    };
  });
}

/**
 * The listed workspace's members, the reader among them, each by their
 * face, name, and role, found by their name and email, a choice opening
 * their page; none until the members are read.
 */
function peopleRows(
  members: readonly WorkspaceMember[] | undefined,
  readerId: string | undefined,
  open: (userId: string) => void,
): readonly PaletteRow[] {
  return (members ?? []).map((member) => ({
    icon: <ActorMark actor={memberActor(member, readerId)} />,
    label: member.name,
    detail:
      member.userId === readerId ? `You · ${ROLE_WORDS[member.role]}` : ROLE_WORDS[member.role],
    terms: [member.name, member.email],
    onChoose: () => open(member.userId),
  }));
}

/**
 * The words around where a query's word that the row's title and holder do
 * not hold landed in what the item says, cut on either side, for a row
 * those did not find whole; none where they did, or where nothing else it
 * says holds such a word. Note that the title is never the snippet, since
 * the row already says it.
 */
function snippetOf(
  words: readonly string[],
  seen: readonly string[],
  tokens: readonly string[],
): string | undefined {
  const missing = tokens.filter((token) => !matchesTokens(seen, [token]));
  for (const line of words) {
    if (seen.includes(line)) continue;
    const lowered = line.toLowerCase();
    const token = missing.find((each) => lowered.includes(each));
    if (token === undefined) continue;
    const at = lowered.indexOf(token);
    const from = Math.max(0, at - SNIPPET_REACH);
    const to = Math.min(line.length, at + token.length + SNIPPET_REACH);
    return `${from > 0 ? "…" : ""}${line.slice(from, to).trim()}${to < line.length ? "…" : ""}`;
  }
  return undefined;
}

/**
 * The listed workspace's Inbox items, each by its agent's tile and title,
 * beside its task's or automation's name and, where its thread rather than
 * those found it, the words that did; one that needs the reader wears the
 * mark its Inbox row wears. Each is found by its title and its holder's
 * name, and else by everything it says (`inboxItemWords`).
 */
function inboxRows(
  items: readonly InboxListed[],
  seams: {
    readonly readerId: string | undefined;
    readonly models: CodingAgentsControl["models"];
    readonly tokens: readonly string[];
    readonly open: (listed: InboxListed) => void;
  },
): readonly PaletteRow[] {
  return items.map((listed) => {
    const { holder, item } = listed;
    const title = cardTitle(item.title);
    const name = holderName(holder);
    const words = inboxItemWords(item);
    const snippet = snippetOf(words, [item.title, title, name], seams.tokens);
    return {
      icon: (
        <ItemMark
          holder={holder}
          agentId={item.agentId}
          models={seams.models}
          readerId={seams.readerId}
          plain
        />
      ),
      label: title,
      detail: snippet === undefined ? name : `${name} · ${snippet}`,
      endMark: needsYou(listed, seams.readerId) ? (
        <span className="inbox-row-attention">
          <AttentionMark />
          <VisuallyHidden>{NEEDS_YOU.LABEL}</VisuallyHidden>
        </span>
      ) : undefined,
      terms: [title, name],
      keywords: words,
      onChoose: () => seams.open(listed),
    };
  });
}

/** The commands offered now, the palette's own left out, each with its chord. */
function actionRows(run: (command: AppCommand) => void): readonly PaletteRow[] {
  return LISTED_COMMANDS.filter(
    (command) =>
      command !== APP_COMMAND.COMMAND_PALETTE &&
      command !== APP_COMMAND.COPY_LINK &&
      command !== APP_COMMAND.ASK_LUKE &&
      appCommandOffered(command),
  ).map((command) => ({
    label: appCommandLabel(command),
    command: isKeyedCommand(command) ? command : undefined,
    terms: [appCommandLabel(command)],
    onChoose: () => run(command),
  }));
}

/**
 * Whether the side panel draws the open plan's own tabs, its fixed kinds and
 * its workers: not while an agent's page holds it, nor while the Inbox does,
 * whose panel is bare and draws neither (`use-tasks-tab.ts`).
 */
function holdsTaskPanel(tasks: TasksControl): boolean {
  return tasks.agentView.agentId === undefined && !tasks.inboxView.open;
}

/**
 * Whether a file or a pull request of the open plan opens in the side panel:
 * wherever it holds the plan's tabs, and over an Inbox item of the open plan,
 * whose panel opens that task's files and draws its pull requests. Over an
 * Inbox with nothing chosen the panel has no task, so neither could be shown.
 */
function opensTaskItems(tasks: TasksControl): boolean {
  if (holdsTaskPanel(tasks)) return true;
  if (tasks.agentView.agentId !== undefined || !tasks.inboxView.open) return false;
  const { chosen } = tasks.inboxView;
  return chosen !== undefined && "taskId" in chosen && chosen.taskId === tasks.activeTaskId;
}

/**
 * Copy link to each thing the window can copy a link to now, the most
 * specific first (`links-at-hand.ts`), named by what it is and, where the
 * window holds it, its name; the first wears ⌥⌘C, which copies it.
 */
function copyLinkRows(
  links: readonly LinkAtHand[],
  copy: (held: LinkAtHand) => void,
): readonly PaletteRow[] {
  return links.map((held, index) => {
    const label = `${appCommandLabel(APP_COMMAND.COPY_LINK)} to ${held.thing}`;
    return {
      icon: <LinkIcon aria-hidden="true" />,
      label,
      detail: held.name,
      command: index === 0 ? APP_COMMAND.COPY_LINK : undefined,
      terms: [label, ...COPY_LINK_TERMS],
      onChoose: () => copy(held),
    };
  });
}

/**
 * The side panel's kinds, listed with the commands as Show board and the
 * rest, a command's verb before the name its tab wears, each wearing its
 * kind's glyph as its tab does (`tab-look.tsx`) and showing the panel on
 * its tab as the panel's "+" does, over the version history; none while
 * the plan is not drawn, since there is no panel to show, nor while an
 * agent's page holds the panel, which is that agent's. No chord reaches
 * them.
 */
function panelTabRows(
  tasks: TasksControl,
  show: (pick: () => void) => void,
): readonly PaletteRow[] {
  if (tasks.region.kind !== DOCUMENT_REGION.READY || !holdsTaskPanel(tasks)) return [];
  const plan = openPlanStanding(tasks);
  return SIDE_PANEL_TABS.map((tab) => {
    // Note that the row says the kind, Show plan, while its glyph is the Plan tab's, the task's status.
    const { icon } = tabLook({ kind: TAB_KIND.PANEL, tab, plan });
    const label = `Show ${SIDE_PANEL_TAB_KIND[tab].label.toLowerCase()}`;
    const pick = () => shownOverHistory(tasks, () => tasks.sidePanel.onChoose(tab));
    return { icon, label, terms: [label], onChoose: () => show(pick) };
  });
}

/**
 * Mark as unread for the plan on screen, or Mark as read once it is marked
 * so, as the plan's menus offer it; none while no plan is looked at. Note
 * that a plan Settings or the Inbox covers is offered nothing, because the
 * row does not name the plan, and going back to it opens it, which takes
 * the mark back before it is ever seen. No chord reaches it, since Mail's
 * ⇧⌘U is Automations' here.
 */
function readMarkRows(
  tasks: TasksControl,
  reads: ReadMarks,
  choose: (run: () => void) => void,
): readonly PaletteRow[] {
  if (tasks.region.kind !== DOCUMENT_REGION.READY) return [];
  const { task } = tasks.region;
  if (task.id !== reads.watched) return [];
  const item = markReadItem({
    unread: reads.markedUnread(task.id),
    onMark: (unread) => reads.mark(task, unread),
  });
  return [
    {
      icon: item.icon,
      label: item.label,
      terms: [item.label],
      onChoose: () => choose(item.onSelect),
    },
  ];
}

/**
 * Mark as unread for the agent whose page stands, or Mark as read once it is
 * unread, as its sidebar row's menu offers it, through the plans' marks;
 * none while no agent's page stands. Note that the open page is unread only
 * by a mark by hand, since its unseen dot goes as the page is shown.
 */
function agentReadMarkRows(
  tasks: TasksControl,
  reads: AgentReadMarks,
  choose: (run: () => void) => void,
): readonly PaletteRow[] {
  const { agentId } = tasks.agentView;
  const { standing, archived } = tasks.listedAgents;
  const agent = [...standing, ...archived].find((each) => each.id === agentId);
  if (agent === undefined) return [];
  const item = markReadItem({
    unread: reads.markedUnread(agent.id),
    onMark: (unread) => reads.mark(agent, unread),
  });
  return [
    {
      icon: item.icon,
      label: item.label,
      terms: [item.label],
      onChoose: () => choose(item.onSelect),
    },
  ];
}

/**
 * Pin task, or Unpin task once it is pinned, for the plan on screen, as its
 * sidebar row's menu offers it: the reader's own pin, through the same mark.
 * None while no plan is looked at.
 */
function taskPinRows(
  tasks: TasksControl,
  reads: ReadMarks,
  choose: (run: () => void) => void,
): readonly PaletteRow[] {
  const task = reads.watched === undefined ? undefined : taskOf(tasks, reads.watched);
  if (task === undefined) return [];
  const pinned = task.pinnedAt !== undefined;
  const label = pinned ? "Unpin task" : "Pin task";
  const mark = pinned ? TASK_MARK.UNPIN : TASK_MARK.PIN;
  return [
    {
      icon: pinned ? <UnpinIcon /> : <PinIcon />,
      label,
      terms: [label],
      onChoose: () => choose(() => tasks.onMarkTask(task.id, mark)),
    },
  ];
}

/**
 * Pin agent, or Unpin agent once it is pinned, for the agent whose page
 * stands, as its sidebar row's menu offers it: the reader's own pin. None
 * while no agent's page stands, nor for an archived agent, which offers no
 * pin.
 */
function agentPinRows(
  tasks: TasksControl,
  choose: (run: () => void) => void,
): readonly PaletteRow[] {
  const { agentId } = tasks.agentView;
  const agent = tasks.listedAgents.standing.find((each) => each.id === agentId);
  if (agent === undefined) return [];
  const pinned = agent.pinnedAt !== undefined;
  const label = pinned ? "Unpin agent" : "Pin agent";
  return [
    {
      icon: pinned ? <UnpinIcon /> : <PinIcon />,
      label,
      terms: [label],
      onChoose: () => choose(() => tasks.onPinAgent(agent.id, !pinned)),
    },
  ];
}

/** Every Settings page this platform offers, in the sidebar's order, under its own glyph and name. */
function settingsPageRows(
  capabilities: readonly HostCapability[],
  experiments: ExperimentChoices,
  open: (page: SettingsView) => void,
): readonly PaletteRow[] {
  return SETTINGS_PAGE_LIST.filter((page) =>
    settingsPageShown(page, capabilities, experiments),
  ).map((page) => {
    const { title, icon } = settingsPageOf(page);
    return {
      icon,
      label: title,
      terms: [title],
      keywords: [title, SETTINGS_WORD],
      onChoose: () => open(page),
    };
  });
}

/** Every settings row the pages draw now, as the settings search finds them, beside its page's name. */
function settingRows(
  rows: SettingsSearchInput | undefined,
  land: (page: SettingsView, id: string) => void,
): readonly PaletteRow[] {
  if (rows === undefined) return [];
  return settingsSearchEntries(rows).map((entry) => ({
    icon: <GearIcon />,
    label: entry.label,
    detail: resultPageWord(entry.page),
    terms: [entry.label],
    keywords: entry.haystack,
    onChoose: () => land(entry.page, entry.id),
  }));
}

/**
 * The person whose name explains why the query found a row, its assignee
 * before its creator: the one whose name holds the most words of the query,
 * else, where the query reaches the row only with the names among its words,
 * as a loose match on a name, or one running from the task's name into a
 * person's, does, the name it answers best; none where the row's own words
 * explain it.
 */
function personFound(
  row: PaletteRow,
  query: string,
  tokens: readonly string[],
): string | undefined {
  const people = row.people ?? [];
  if (people.length === 0 || tokens.length === 0) return undefined;
  // The name holding the most of the query's words, so a first name two people share never hides the one the whole query names.
  const held = (name: string) =>
    tokens.filter((token) => matchRanges(name, [token]).length > 0).length;
  const named = people.reduce((best, name) => (held(name) > held(best) ? name : best));
  if (held(named) > 0) return named;
  const others = row.terms.filter((term) => !people.includes(term)).join(" ");
  if (defaultFilter(others, query) !== 0) return undefined;
  return people.toSorted((a, b) => defaultFilter(b, query) - defaultFilter(a, query))[0];
}

function PaletteItem({
  row,
  value,
  query,
  tokens,
}: {
  row: PaletteRow;
  value: string;
  query: string;
  tokens: readonly string[];
}): React.JSX.Element {
  // A task found by its assignee's or its creator's name says the name after its detail, so the match is in sight.
  const found = personFound(row, query, tokens);
  const detail =
    found === undefined
      ? row.detail
      : [row.detail, found].filter((words) => words !== undefined).join(" · ");
  const words =
    detail === undefined && row.workspace === undefined ? undefined : (
      <>
        {row.workspace === undefined ? null : (
          <WorkspaceRef
            workspace={row.workspace}
            name={<Highlighted text={row.workspace.name} tokens={tokens} />}
          />
        )}
        {row.workspace === undefined || detail === undefined ? null : " · "}
        {detail === undefined ? null : <Highlighted text={detail} tokens={tokens} />}
      </>
    );
  // Spoken, since a palette row is an option, which carries no
  // `aria-keyshortcuts` to say the chord for it.
  const end =
    row.command === undefined && row.endMark === undefined ? undefined : (
      <>
        {row.command === undefined ? null : (
          <Shortcut chord={APP_SHORTCUTS[row.command].chord} spoken />
        )}
        {row.endMark}
      </>
    );
  const item = (
    <Command.Item asChild value={value} onSelect={row.onChoose}>
      <ComboboxOptionItem
        option={{
          id: value,
          label: <Highlighted text={row.label} tokens={tokens} />,
          icon: row.icon,
          detail: words,
          hint: end,
        }}
      />
    </Command.Item>
  );
  if (row.card === undefined) return item;
  return (
    <Tooltip label={row.label} card={row.card} cardBeside>
      {item}
    </Tooltip>
  );
}

/**
 * Scrolls the bar in `band` along its own row until its checked option
 * stands whole in view, and nothing else. Note that the bar's own scroller
 * is moved rather than the option scrolled into view, which would scroll
 * every box around it, the dialog's and the window's among them.
 */
function revealChecked(band: HTMLElement): void {
  const bar = band.querySelector<HTMLElement>('[role="radiogroup"]');
  const checked = bar?.querySelector<HTMLElement>('[aria-checked="true"]');
  if (bar === null || bar === undefined || checked === null || checked === undefined) return;
  const start = checked.offsetLeft;
  const end = start + checked.offsetWidth;
  if (start < bar.scrollLeft) bar.scrollLeft = start;
  else if (end > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = end - bar.clientWidth;
}

/**
 * The filters under the field, a radio group the palette drives from the
 * field. Note that it takes no focus, because the caret belongs in the field
 * and Return there opens the row chosen, not a filter; a press chooses one
 * and leaves the caret where it was. A row too wide for a narrow window
 * scrolls sideways, and keeps the filter chosen in view, since no focus
 * moving there would bring it.
 */
function PaletteFilters({
  filter,
  onFilter,
}: {
  filter: PaletteFilter;
  onFilter: (filter: PaletteFilter) => void;
}): React.JSX.Element {
  const band = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (band.current !== null) revealChecked(band.current);
  }, [filter]);
  return (
    <div ref={band} className="command-palette-filters">
      <ChoiceBar
        label="Filter"
        items={PALETTE_FILTERS.map((each) => ({ value: each, label: FILTER_LABEL[each] }))}
        value={filter}
        onChange={onFilter}
        look={CHOICE_BAR_LOOK.FILL}
        size={CHOICE_BAR_SIZE.COMPACT}
        focus={CHOICE_BAR_FOCUS.NONE}
      />
    </div>
  );
}

function PaletteFooter({ typed }: { typed: boolean }): React.JSX.Element {
  const hints = [...LIST_HINTS, typed ? FILTER_HINT.TYPED : FILTER_HINT.EMPTY];
  return (
    <div className="command-palette-footer" aria-hidden="true">
      {hints.map((hint) => (
        <span key={hint.label} className="command-palette-footer-hint">
          <span className="command-palette-footer-keys">
            {hint.chords.map((chord) => (
              <Shortcut key={chord.key.accelerator} chord={chord} />
            ))}
          </span>
          {hint.label}
        </span>
      ))}
    </div>
  );
}

/**
 * The palette, offering ⌘K while `available`: past the sign-in, where there
 * is something to run. A palette standing when that ends is taken down in
 * the render that finds it gone. It opens on All with nothing typed.
 */
/** The window's tasks with Luke left out of the agents listed, since Ask Luke stands for him. */
function withoutLukeIn(tasks: TasksControl, operator: LukeOperator | undefined): TasksControl {
  if (operator === undefined) return tasks;
  return {
    ...tasks,
    // Note that a Luke a Reset retired is left out too, since he is known by his kind and the row he stood in now opens his successor.
    listedAgents: {
      standing: withoutLuke(tasks.listedAgents.standing, operator),
      archived: withoutLuke(tasks.listedAgents.archived, operator),
    },
  };
}

/**
 * Ask Luke, the palette's first row while the account has Luke: it opens his
 * page, or asks his ensure again where it failed, with his chord at its end.
 */
function askLukeRow(
  operator: LukeOperator,
  onTasks: (run: () => void) => void,
  choose: (run: () => void) => void,
  tasks: TasksControl,
): PaletteRow {
  const { agentId } = operator;
  return {
    icon: <WingFace />,
    label: ASK_LUKE_LABEL,
    command: APP_COMMAND.ASK_LUKE,
    terms: [ASK_LUKE_LABEL, LUKE_NAME],
    onChoose: () =>
      agentId === undefined
        ? choose(operator.retry)
        : onTasks(() => tasks.agentView.onOpen(agentId)),
  };
}

export function CommandPalette({
  available,
  tab,
  onTabChange,
  tasks,
  links,
  settings,
  readFiles,
}: {
  available: boolean;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  tasks: TasksControl;
  /** The links the window can copy now, the most specific first, and their copy (`useCopyLink`). */
  links: CopyLink;
  /** What the settings pages draw now, which the Settings rows are; the page a row lands on is shown through `onViewChange`. */
  settings: {
    rows: SettingsSearchInput | undefined;
    /** What the platform offers, which decides the Settings pages listed, whether or not the rows have been read. */
    capabilities: readonly HostCapability[];
    onViewChange: (view: SettingsView) => void;
  };
  /** Lists everything in the task's repository in one read, which the Files rows are. */
  readFiles: (taskId: string) => Promise<TasksTreeAnswer>;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const chatOn = useChatOn();
  const experiments = useExperimentChoices();
  if (open && !available) setOpen(false);
  const [filter, setFilter] = useState<PaletteFilter>(PALETTE_FILTER.ALL);
  const [query, setQuery] = useState("");
  // The row chosen, by its place in the list, which a new filter puts back on the first.
  const [selected, setSelected] = useState(FIRST_ROW);
  const changeFilter = (next: PaletteFilter) => {
    setFilter(next);
    setSelected(FIRST_ROW);
  };
  const [files, setFiles] = useState<FilesHeld | undefined>(undefined);
  // The read of the files asked last, by its count: only its answer is kept.
  const filesAsk = useRef(0);
  const invoker = useRef<HTMLElement | null>(null);
  // Whether the keyboard was in the side panel when ⌘K was pressed, which puts its tab's link first, as ⌥⌘C there would.
  const [fromPanel, setFromPanel] = useState(false);
  const chosen = useRef<(() => void) | undefined>(undefined);
  const shown = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  // The menu bar's Back and Forward, a mouse's back button among them, leave the window behind the palette alone.
  useOverlayHold(open);

  useAppCommand(
    APP_COMMAND.COMMAND_PALETTE,
    available
      ? () => {
          invoker.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setFromPanel(inSidePanel(document.activeElement));
          changeFilter(PALETTE_FILTER.ALL);
          setQuery("");
          // The files are read afresh by the first search of each opening,
          // since the branch they are listed on moves, and a read still out
          // from the last opening is not kept.
          filesAsk.current += 1;
          setFiles(undefined);
          setOpen(true);
        }
      : undefined,
  );

  // Note that what was chosen runs once the palette is gone and focus is
  // back where it was, because a command that moves focus (Delete's
  // question, the New task dialog's field) would otherwise lose it to the palette's
  // own going. The field takes focus as the palette opens, as the dialog
  // gives it, and also where it opens again while it is still leaving,
  // which the dialog, never having let it go, does not give it again.
  useEffect(() => {
    if (open) {
      shown.current = true;
      field.current?.focus();
      return;
    }
    if (!shown.current) return;
    shown.current = false;
    if (invoker.current?.isConnected) invoker.current.focus({ preventScroll: true });
    const run = chosen.current;
    chosen.current = undefined;
    run?.();
  }, [open]);

  const choose = (run: () => void) => {
    chosen.current = run;
    setOpen(false);
  };
  // A task, and an agent's tab, are always opened on the Tasks tab, as a
  // press in the sidebar is.
  const onTasks = (run: () => void) =>
    choose(() => {
      if (tab !== PANEL_TAB.TASKS) onTabChange(PANEL_TAB.TASKS);
      run();
    });
  // The seek for a setting's row gives itself up once another is asked
  // for or Settings is left, so it never lands on a later visit's page.
  const landing = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (tab !== PANEL_TAB.SETTINGS) landing.current?.();
  }, [tab]);
  useEffect(() => () => landing.current?.(), []);
  const land = (page: SettingsView, id: string) =>
    choose(() => {
      onTabChange(PANEL_TAB.SETTINGS);
      settings.onViewChange(page);
      landing.current?.();
      landing.current = landOnSettingsRow(id);
    });
  const openPage = (page: SettingsView) =>
    choose(() => {
      landing.current?.();
      landing.current = undefined;
      onTabChange(PANEL_TAB.SETTINGS);
      settings.onViewChange(page);
    });

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Note that no key pressed in the palette goes on to the window, because
    // the window's Escape would stop Luke mid-reply and a window chord would
    // change what stands behind the palette. Escape itself is the dialog's,
    // which closes the palette alone.
    event.stopPropagation();
    const step = arrowStep(event, query);
    if (step !== 0) {
      event.preventDefault();
      changeFilter(steppedFilter(filter, step));
      return;
    }
    const pressed = commandForKey(
      [APP_COMMAND.COMMAND_PALETTE, APP_COMMAND.BACK, APP_COMMAND.FORWARD],
      event.nativeEvent,
    );
    if (pressed === undefined) return;
    // The menu bar's Back and Forward are held off too, since the palette
    // claims their chords for its filters while it stands.
    event.preventDefault();
    if (pressed === APP_COMMAND.COMMAND_PALETTE) setOpen(false);
    else changeFilter(steppedFilter(filter, pressed === APP_COMMAND.BACK ? -1 : 1));
  };

  const tokens = searchTokens(query);
  // Luke leads the list as Ask Luke, so the rows that list agents leave him out.
  const operator = useLukeOperator({
    accountId: tasks.me,
    workspaceId: tasks.signedIn ? tasks.workspace?.id : undefined,
  });
  const listedTasks = withoutLukeIn(tasks, operator);
  const askLuke = operator === undefined ? undefined : askLukeRow(operator, onTasks, choose, tasks);
  const askLukeShown =
    open &&
    askLuke !== undefined &&
    (filter === PALETTE_FILTER.ALL || filter === PALETTE_FILTER.AGENTS) &&
    (tokens.length === 0 || rowScore(askLuke, query, tokens) > 0);
  // The listed workspace's members, read once for it, name a task's assignee by face.
  const membersRead = useWorkspaceMembersRead(tasks.workspace);
  const originOf = useTaskOrigin();
  const { members } = membersRead;
  const reads = useReadMarks();
  const agentReads = useAgentReadMarks();
  const limit = filter === PALETTE_FILTER.ALL ? KIND_ROWS.ALL : KIND_ROWS.FILTERED;
  const taskId = tasks.activeTaskId;
  const repository = tasks.tasks.find((task) => task.id === taskId)?.repository ?? null;
  // The files held are the open task's repository's, or none of its.
  const held =
    files !== undefined && files.taskId === taskId && files.repository === repository
      ? files
      : undefined;
  // Note that a task's files are searched only while its panel is the one standing, which an agent's page holds otherwise.
  const filesOpen = opensTaskItems(tasks) && taskId !== undefined && repository !== null;
  const filesAsked = open && filesOpen && (filter === PALETTE_FILTER.FILES || tokens.length > 0);
  // Note that the Inbox is read the first time it is searched, on the Files filter's terms.
  const inboxAsked =
    open && tasks.signedIn && (filter === PALETTE_FILTER.INBOX || tokens.length > 0);
  const inboxSearch = useInboxSearch(tasks, inboxAsked);

  // Note that the repository is read the first time its files are searched
  // rather than as the palette opens, because most of its uses never ask
  // for a file, and kept for the opening while the task and its repository
  // stay the same. A read that answers after a later one was asked is not
  // kept, since it may list an older branch than the later one does.
  useEffect(() => {
    if (!filesAsked || taskId === undefined || repository === null || held !== undefined) return;
    filesAsk.current += 1;
    const ask = filesAsk.current;
    setFiles({ taskId, repository, read: FILES_READ.READING });
    const keep = (read: FilesRead) => {
      if (filesAsk.current === ask) setFiles({ taskId, repository, ...read });
    };
    readFiles(taskId).then(
      (answer) => keep(filesOf(answer)),
      () => keep({ read: FILES_READ.MISSED, notice: FILES_MISSED_LINE }),
    );
  }, [filesAsked, taskId, repository, held, readFiles]);

  const paths = held?.read === FILES_READ.LISTED ? held.paths : undefined;
  const fileQuery = filter === PALETTE_FILTER.FILES || tokens.length > 0 ? query : undefined;
  // Ranked once a query or the listing changes, not on every render, since
  // a repository may list tens of thousands of paths.
  const matchedPaths = useMemo(
    () =>
      paths === undefined || fileQuery === undefined
        ? []
        : ranked(paths, fileQuery, limit, (path) => pathScore(path, fileQuery)),
    [paths, fileQuery, limit],
  );

  // Each kind's rows in tiers, built only for the filter shown and only
  // while open: every row a tier matches ranks above the next tier's.
  const byRow = (row: PaletteRow, words: readonly string[]) => rowScore(row, query, words);
  const tiersOf = {
    [PALETTE_FILTER.TASKS]: () => [
      tasks.signedIn
        ? taskRows(
            listedTasks,
            members,
            (id) => onTasks(() => tasks.onSelect(id)),
            (id) => onTasks(() => tasks.agentView.onOpen(id)),
            (taskId, agentId) => onTasks(() => tasks.onShowAgent(taskId, agentId)),
            originOf,
          )
        : [],
    ],
    [PALETTE_FILTER.AGENTS]: () => [agentRows(tasks, chatOn, onTasks)],
    [PALETTE_FILTER.INBOX]: () => [
      inboxAsked
        ? inboxRows(inboxSearch.items, {
            readerId: tasks.me,
            models: tasks.agents.models,
            tokens,
            open: (listed) =>
              onTasks(() => tasks.inboxView.onOpenItem({ ...choiceOf(listed), opened: true })),
          })
        : [],
    ],
    [PALETTE_FILTER.PEOPLE]: () => [
      peopleRows(members, tasks.me, (userId) => onTasks(() => tasks.personView.onOpen(userId))),
    ],
    [PALETTE_FILTER.FILES]: () => [],
    [PALETTE_FILTER.ACTIONS]: () => [
      [
        ...copyLinkRows(links.linksAt(fromPanel), (held) => choose(() => links.copy(held))),
        ...actionRows((command) => choose(() => runAppCommand(command))),
        ...panelTabRows(tasks, onTasks),
        ...readMarkRows(tasks, reads, choose),
        ...agentReadMarkRows(listedTasks, agentReads, choose),
        ...taskPinRows(tasks, reads, choose),
        ...agentPinRows(listedTasks, choose),
      ],
    ],
    [PALETTE_FILTER.SETTINGS]: () => [
      settingsPageRows(settings.capabilities, experiments, openPage),
      settingRows(settings.rows, land),
    ],
  } as const satisfies Record<PaletteKind, () => readonly (readonly PaletteRow[])[]>;
  // Note that a file found opens through the panel's one door for a file
  // named in place: the tab it has, as it stands, or a new one at the strip's end.
  const openFile = (path: string) =>
    onTasks(() => shownOverHistory(tasks, () => tasks.sidePanel.onOpenFile({ path })));
  const rowsFor = (kind: PaletteKind): readonly PaletteRow[] =>
    kind === PALETTE_FILTER.FILES
      ? (filesOpen ? matchedPaths : []).map((path) =>
          fileRow(path, { shown: tasks.shownCode ?? [], repository }, openFile),
        )
      : tiersOf[kind]()
          .flatMap((tier) => ranked(tier, query, limit, byRow))
          .slice(0, limit);
  const kinds = PALETTE_FILTERS.filter((each): each is PaletteKind =>
    filter === PALETTE_FILTER.ALL ? each !== PALETTE_FILTER.ALL : each === filter,
  );
  const sections: readonly PaletteSection[] = open
    ? kinds
        .map((kind) => ({ kind, rows: rowsFor(kind) }))
        .filter((section) => section.rows.length > 0)
    : [];
  // Each kind's word for its rows' absence: still reading, refused, or a line of its own.
  const noticeOf = {
    [PALETTE_FILTER.TASKS]: () => tasksNotice(tasks),
    [PALETTE_FILTER.AGENTS]: () => undefined,
    [PALETTE_FILTER.INBOX]: () => (inboxAsked ? inboxNotice(inboxSearch) : undefined),
    [PALETTE_FILTER.PEOPLE]: () => peopleNotice(tasks, membersRead),
    [PALETTE_FILTER.FILES]: () =>
      fileQuery === undefined ? undefined : filesNotice(filesOpen, held),
    [PALETTE_FILTER.ACTIONS]: () => undefined,
    [PALETTE_FILTER.SETTINGS]: () => undefined,
  } as const satisfies Record<PaletteKind, () => PaletteNotice | undefined>;
  const notice =
    open && sections.length === 0 && !askLukeShown
      ? emptyNotice(
          filter,
          kinds.map((kind) => noticeOf[kind]()),
        )
      : undefined;
  const cut =
    filesOpen &&
    filter === PALETTE_FILTER.FILES &&
    held?.read === FILES_READ.LISTED &&
    held.truncated;
  // Note that Ask Luke, where it stands, is the first row, so the first row chosen as the palette opens is his.
  let place = askLukeShown ? 1 : 0;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      shouldFilter={false}
      value={selected}
      onValueChange={setSelected}
      loop
      overlayClassName="command-palette-backdrop"
      contentClassName="command-palette"
      inert={!open}
      onKeyDown={keyDown}
    >
      <div className="command-palette-search">
        <SearchIcon />
        <Command.Input
          ref={field}
          placeholder={FILTER_PLACEHOLDER[filter]}
          value={query}
          onValueChange={setQuery}
        />
      </div>
      <PaletteFilters filter={filter} onFilter={changeFilter} />
      <Command.List asChild label="Results">
        <ComboboxListBox height={COMBOBOX_LIST_HEIGHT.FILL}>
          {notice === undefined ? (
            <Command.Empty>
              <NoteLine>Nothing matches.</NoteLine>
            </Command.Empty>
          ) : (
            <NoticeLine notice={notice} />
          )}
          {askLukeShown && askLuke !== undefined ? (
            <Command.Group>
              <PaletteItem row={askLuke} value={FIRST_ROW} query={query} tokens={tokens} />
            </Command.Group>
          ) : null}
          {sections.map((section) => (
            <Command.Group
              key={section.kind}
              heading={
                <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
                  {FILTER_LABEL[section.kind]}
                </Text>
              }
            >
              {section.rows.map((row) => {
                place += 1;
                return (
                  <PaletteItem
                    key={place}
                    row={row}
                    value={String(place)}
                    query={query}
                    tokens={tokens}
                  />
                );
              })}
            </Command.Group>
          ))}
          {cut ? (
            <div className="command-palette-notice">
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
                {TRUNCATED_LINE}
              </Text>
            </div>
          ) : null}
        </ComboboxListBox>
      </Command.List>
      <PaletteFooter typed={query !== ""} />
    </Command.Dialog>
  );
}
