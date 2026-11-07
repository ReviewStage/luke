/**
 * command-palette.tsx -- ⌘K: the tasks, the open task's agents and files, the Inbox's items, the workspace's automations, every command the window can run now, and the Settings pages and settings, found by typing, in a dialog over the window.
 *
 * The palette is `@repo/ui`'s command dialog (`@repo/ui/command`), its
 * rows the window's menu rows, under a row of filters as Cursor's palette has them: All, then
 * one kind each. All lists each kind's best few rows under its heading, and
 * a filter that kind's alone, as many as are worth reading. ← and → step
 * through the filters while the search field is empty, and ⌘[ and ⌘] at
 * any time, where they mean Back and Forward elsewhere; once anything is
 * typed, ← and → move the caret, as in any text field. A press on a filter
 * chooses it. The palette ranks the rows itself with the one tiered scorer
 * (`@repo/ui/search-score`), so each kind keeps its own best few however
 * many rows the others hold, and marks in each row what found it. Letters
 * typed in order find only a file and a command, whose words are typed by
 * their first letters, so "thm" finds no Theme setting.
 *
 * It decides nothing about a command: it lists the commands whose control is
 * on screen and able right now (`app-commands.ts`), so a row runs exactly
 * what its shortcut would, Delete task's question included, and it opens a
 * task through the same select the sidebar does, which takes its ask back
 * when the host does not open the task. A command is worded, marked, and
 * keyed as the menus that offer it are, from the window's one list
 * (`command-items.tsx`), and one whose only key is Esc, the window's step
 * back, is no row at all. Each task names its repository
 * beside it, so two tasks of one name can be told apart, and hangs the
 * task's card beside its row, as its sidebar row does. An agent opens its tab as the column's "+" would, hanging
 * its tab's card beside its row while the pointer rests on it, as every
 * place naming an agent does (`agent-ref.tsx`), and an archived agent, which
 * says so, its own page, a subagent
 * its tab as the side panel's "+" would, a file in a tab of its own as one
 * chosen in a File tab's tree would, a Settings page opens as the Settings
 * sidebar's row for it does, and a setting lands on its row as the settings
 * search does. The pages are the sidebar's own list, and a page found ranks
 * above every setting found, so "appearance" offers the page before its rows. The
 * files are the open task's repository read whole in the one listing the File
 * tab's search reads, the first time a file is searched, and fuzzy-matched on
 * their paths.
 *
 * The Inbox's items are the listed workspace's, as the window's Inbox lists
 * them, followed the first time the Inbox is searched (`use-inbox-search.ts`):
 * each found by its title and its task's or automation's name, and else by
 * anything its thread says, the words that found it then said beside its
 * task's name. One chosen opens in the Inbox, as its row there would.
 *
 * The automations are the listed workspace's, followed the first time they
 * are searched, as the Inbox's items are: each found by its name, what fires
 * it, and its task's name, hanging its card beside its row, as every place
 * naming one does. One chosen opens its page, as its row on the Automations
 * page would.
 *
 * It is the nearest layer while it stands: no key pressed in it goes on to
 * the window, so Escape closes the palette and nothing else, and no chord
 * changes what stands behind it. Closing hands focus
 * back to whatever had it, and only then runs what was chosen, so a command
 * acts from where the developer was, as its shortcut would have. It then
 * fades out as the dialog does.
 *
 * Every row's id is its place in the list, never words: the dialog writes it
 * into an attribute, which the session recording does not mask
 * (`session-replay.ts`), and two tasks may share a name. The search reads
 * each row's words instead.
 */

import type { TasklessAgent } from "@repo/features/agent-wire";
import { automationTriggerText } from "@repo/features/automation-list-model";
import type { AutomationSummary } from "@repo/features/automation-wire";
import { formatCount } from "@repo/features/number-format";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  TASK_CREATE_RELATION_KIND,
  TASK_RELATION_KIND,
  TASK_TREE_BOUNDS,
  TASK_TREE_ENTRY,
  type TaskSummary,
} from "@repo/features/task-wire";
import type { TasksTreeAnswer } from "@repo/features/tasks-view";
import { TERMINAL_ASK } from "@repo/features/terminal-entry";
import { noMatchWords, readFailedWords, readingWords, TERM, VERB } from "@repo/features/words";
import { taskKey } from "@repo/features/workspace-key";
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceMembersAnswer,
} from "@repo/features/workspace-wire";
import {
  EXPERIMENT,
  type ExperimentChoices,
  HOST_CAPABILITY,
  type HostCapability,
} from "@repo/settings";
import { SETTINGS_PAGE_LIST, type SettingsView } from "@repo/settings/settings-views";
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
  shortcutLabel,
} from "@repo/settings/shortcuts";
import {
  CHOICE_BAR_FOCUS,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  ErrorState,
  GearIcon,
  NOTE_LINE_LOOK,
  NoteLine,
  Shortcut,
  useMinute,
} from "@repo/ui";
import { ACTOR_KIND, type Actor, actorName, assigneeFace } from "@repo/ui/actor-model";
import {
  COMMAND_FILTER,
  CommandDialog,
  type CommandDialogProps,
  type CommandGroup,
  type CommandItem,
} from "@repo/ui/command";
import { GLYPH } from "@repo/ui/icons";
import {
  hitRangesIn,
  SEARCH_TIER,
  type SearchHit,
  type SearchSubject,
  searchHit,
} from "@repo/ui/search-score";
import { type MatchRange, matchesTokens, matchRanges, searchTokens } from "@repo/ui/search-tokens";
import { ReplayMask, ReplayUnmask, ReplayWords } from "@repo/ui/session-replay-marks";
import { fileTab, inTaskOrder } from "@repo/ui/tab-strip-model";
import {
  agentRow,
  orderTaskRows,
  repositoryLabel,
  TASK_ROW,
  type TaskRow,
  taskRow,
} from "@repo/ui/task-list-model";
import { DOCUMENT_REGION, SETTLED_STATUS, settleOffered, TASK_MARK } from "@repo/ui/tasks-model";
import { type UseQueryResult, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Fragment,
  isValidElement,
  memo,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AssigneeFaceMark, AutomationCard } from "../actor-ref.js";
import {
  appCommandOffered,
  runAppCommand,
  useAppCommand,
  useOverlayHold,
} from "../app-commands.js";
import {
  COMMAND_PLACE,
  commandWords,
  PANEL_COMMAND,
  type PanelCommand,
  panelCommandOf,
} from "../command-items.js";
import { unreadShown } from "../failure-report.js";
import { type CopyLink, inSidePanel, type LinkAtHand } from "../links-at-hand.js";
import { workspaceMembersQuery, workspaceMembersRetryMutation } from "../live-reads.js";
import { memberRows } from "../member-rows.js";
import { PANEL_SPAN, useKeystrokeSpans } from "../panel-spans.js";
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
import { agentName } from "../tasks/agent-model.js";
import { AgentCard, agentSubject, NOTHING_HELD, tasklessRowSubject } from "../tasks/agent-ref.js";
import { useChangesPeopleOf } from "../tasks/changes-people.js";
import { FileCard, fileLook } from "../tasks/file-ref.js";
import { fileName } from "../tasks/file-ref-model.js";
import { refusalLine } from "../tasks/file-tab-model.js";
import { InboxItemCard, InboxItemEnd, ItemMark } from "../tasks/inbox-item-parts.js";
import { holderName, type InboxListed, inboxItemWords } from "../tasks/inbox-model.js";
import { refusedAnswer, taskTreeQueryOptions } from "../tasks/repository-reads.js";
import { agentEndMark, openPlanStanding, TAB_KIND, tabLook } from "../tasks/tab-look.js";
import { markReadItem, type OpenTaskRename, useTaskRenameOffer } from "../tasks/task-menu-items.js";
import { TaskKey } from "../tasks/task-standing.js";
import { useOpenTerminal } from "../tasks/terminal-commands.js";
import { TERMINAL_KIND } from "../tasks/terminal-session.js";
import { cardTitle } from "../tasks/tool-call-model.js";
import { type AgentsControl, type HeldPeople, readAgentById } from "../tasks/use-agents.js";
import { choiceOf } from "../tasks/use-inbox-listing.js";
import { type InboxSearch, useInboxSearch } from "../tasks/use-inbox-search.js";
import { SIDE_PANEL_TAB_KIND, type SidePanelControl } from "../tasks/use-side-panel.js";
import { type ReadMarks, useReadMarks } from "../tasks/use-task-looks.js";
import { useTaskOrigin } from "../tasks/use-task-origin.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useOpenTerminalTab } from "../tasks/use-terminal-session.js";
import { useWindowAccount } from "../tasks/window-account.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";
import { useExperimentsIn, useWorkspaceExperiment } from "../workspace-experiments.js";
import { useAgentArchive, useAgentUnarchive } from "./agent-archive.js";
import { type AgentReadMarks, useAgentReadMarks } from "./agent-read-marks.js";
import { READING_AUTOMATIONS } from "./automation-words.js";
import { agentEntries, inboxEntries } from "./main-tabs.js";
import { ADD_SECTION, offeredPanelKinds, panelOffers, SIDE_PANEL_HOLDER } from "./side-panel.js";
import type { AddEntry } from "./strip-tabs.js";
import { taskOf } from "./task-actions.js";
import { homeTaskCardOf, TaskRowStatus } from "./task-card.js";
import { useAutomations } from "./use-automations.js";
import { WorkspaceRef } from "./workspace-ref.js";

/** The kinds of row the palette lists, each a filter of its own after All, in the order the filters stand. */
const PALETTE_FILTER = {
  ALL: "all",
  TASKS: "plans",
  THIS_TASK: "this-task",
  INBOX: "inbox",
  PEOPLE: "people",
  AUTOMATIONS: "automations",
  FILES: "files",
  COMMANDS: "commands",
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
  [PALETTE_FILTER.THIS_TASK]: "This task",
  [PALETTE_FILTER.INBOX]: "Inbox",
  [PALETTE_FILTER.PEOPLE]: "People",
  [PALETTE_FILTER.AUTOMATIONS]: "Automations",
  [PALETTE_FILTER.FILES]: "Files",
  [PALETTE_FILTER.COMMANDS]: "Commands",
  [PALETTE_FILTER.SETTINGS]: "Settings",
} as const satisfies Record<PaletteFilter, string>;

/** What the search field asks for: the product's name under All, and the kind, as it stands mid-sentence, under its filter. */
function filterPlaceholder(filter: PaletteFilter): string {
  return filter === PALETTE_FILTER.ALL
    ? `Search ${PRODUCT_NAME}`
    : `Search ${FILTER_LABEL[filter].toLowerCase()}`;
}

/** How many rows a kind lists: its best few under All, and as many as are worth reading under its own filter. */
const KIND_ROWS = {
  ALL: 5,
  FILTERED: 50,
} as const;

/** The first row's id: rows are known by their place in the list, from one. */
const FIRST_ROW = "1";

/** No Archive asked of ⌘K yet, of any agent. */
const NO_ARCHIVE_ASKS = { agentId: "", asked: 0 };

/** Nothing to move: a terminal opened from ⌘K stands in the side panel, as one opened from the panel's "+" does. */
const noFocusMove = (): void => undefined;

/** What the list says where no row stands and no source is still to answer, as every menu says it. */
const NOTHING_MATCHES = noMatchWords(TERM.RESULT);

/** How far the read of the open task's files has come: asked, listed, or not listed and why. */
const FILES_READ = {
  READING: "reading",
  LISTED: "listed",
  MISSED: "missed",
  FAILED: "failed",
} as const;

/** The open task's repository as the palette read it, whole, in one listing: its files by path, or why they were not listed. */
type FilesRead =
  | { read: typeof FILES_READ.READING }
  | { read: typeof FILES_READ.LISTED; paths: readonly string[]; truncated: boolean }
  | { read: typeof FILES_READ.MISSED; notice: string }
  | { read: typeof FILES_READ.FAILED };

/** What the Files filter says while no plan with a repository stands open, as under an agent's page. */
const NO_REPOSITORY_LINE = "Open a task with a repository to search its files.";

/** What the Files filter says where the read did not land, beside its Retry. */
const FILES_MISSED_LINE = "The files could not be read.";

/** What the Files filter says while the repository is read. */
const READING_LINE = readingWords(`the repository's ${TERM.FILE.many}`);

/** What the Tasks filter says while the account's tasks are first read, and where that read did not land. */
const TASKS_READING_LINE = readingWords(`your ${TERM.TASK.many}`);
const TASKS_FAILED_LINE = readFailedWords(`your ${TERM.TASK.many}`);

/** What the Inbox filter says while its items are first read, and where a read did not land. */
const INBOX_READING_LINE = readingWords("your inbox");
const INBOX_FAILED_LINE = "Your inbox could not be read.";

/** How many characters of an item's words a row says on either side of the word that found it. */
const SNIPPET_REACH = 40;

/** What the People filter says while the listed workspace's members are read, and where that read did not land. */
const PEOPLE_READING_LINE = readingWords(`the workspace's ${TERM.MEMBER.many}`);
const PEOPLE_FAILED_LINE = "The workspace's members could not be read.";

/** What the Automations filter says where the listed workspace's automations could not be read. */
const AUTOMATIONS_FAILED_LINE = "Your automations could not be read.";

/** What the list says in place of "No results match": a line of its own, a source still reading, or one refused. */
const PALETTE_NOTICE = {
  SAID: "said",
  READING: "reading",
  FAILED: "failed",
} as const;

/** A notice and its words, a refusal with the Retry that reads its source again. */
type PaletteNotice =
  | {
      readonly kind: typeof PALETTE_NOTICE.SAID | typeof PALETTE_NOTICE.READING;
      readonly line: ReactNode;
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

/** What Return does to the row chosen, as the footer says it: a command runs, and a thing opens. */
const RETURN_WORD = {
  RUN: "Run",
  OPEN: VERB.OPEN,
} as const;

/**
 * The footer's hints for the list's own keys, which are bare: ↑ and ↓, and
 * Return, worded for the row chosen. Escape is not among them, because
 * every dialog closes on it and saying so is noise.
 */
function listHints(returnWord: (typeof RETURN_WORD)[keyof typeof RETURN_WORD]): FooterHint[] {
  return [
    {
      chords: [
        { key: SHORTCUT_KEY.UP, bare: true },
        { key: SHORTCUT_KEY.DOWN, bare: true },
      ],
      label: "Select",
    },
    { chords: [{ key: SHORTCUT_KEY.ENTER, bare: true }], label: returnWord },
  ];
}

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

/**
 * Whether a command's only key is Esc: the window's step back out of what
 * stands, Exit settings and Back to inbox list among them, which the
 * Keyboard shortcuts page names but which is a key to press rather than a
 * command to find, so the palette lists none of them.
 */
function escapeOnly(command: KeyedCommand): boolean {
  return APP_SHORTCUTS[command].chord.key === SHORTCUT_KEY.ESCAPE;
}

/**
 * The one-step keys the palette lists none of: a step to the next or the
 * previous thing, or a move of the row or tab that has the keyboard, each of
 * which acts on where the keyboard stood, which opening the palette took it
 * from, so a row chosen there would step once from somewhere else. Their
 * chords and the Keyboard shortcuts page still name them.
 */
const ONE_STEP: ReadonlySet<AppCommand> = new Set([
  APP_COMMAND.FIND_NEXT,
  APP_COMMAND.FIND_PREVIOUS,
  APP_COMMAND.PREVIOUS_INBOX_ITEM,
  APP_COMMAND.NEXT_INBOX_ITEM,
  APP_COMMAND.MOVE_TAB_LEFT,
  APP_COMMAND.MOVE_TAB_RIGHT,
  APP_COMMAND.MOVE_ROW_UP,
  APP_COMMAND.MOVE_ROW_DOWN,
  APP_COMMAND.NEXT_RECENT_TAB,
  APP_COMMAND.PREVIOUS_RECENT_TAB,
  APP_COMMAND.PREVIOUS_TASK,
  APP_COMMAND.NEXT_TASK,
]);

/** The commands the palette lists: the Keyboard shortcuts page's but the Esc-only and the one-step, then the menu bar's own chordless commands, then its own, the sidebar's view of its tasks. */
const LISTED_COMMANDS: readonly AppCommand[] = [
  ...APP_SHORTCUT_GROUPS.flatMap((group) => group.commands).filter(
    (command) => !escapeOnly(command) && !ONE_STEP.has(command),
  ),
  APP_COMMAND.NEW_TERMINAL,
  APP_COMMAND.MARK_TASK_DONE,
  APP_COMMAND.SEND_FEEDBACK,
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
  /** Whether its detail is the app's own words, a setting's page, shown in a screen recording; every other row's detail names a person's thing, a repository, a task, or a link's subject, and stays masked. */
  detailShown?: boolean | undefined;
  /** The workspace a task is in where that is not the one listed, named by its tile and name before the detail. */
  workspace?: Workspace | undefined;
  /** The mark at the row's end: a failed agent's, or a task's face of who is on it (`assigneeFace`) and its row's mark (`TaskRowStatus`). */
  endMark?: React.JSX.Element | undefined;
  /** A task's assignee's and creator's names, the one the query found it by said after the detail. */
  people?: readonly string[] | undefined;
  /** The card the row hangs beside it while the pointer rests on it: a task's, an agent's tab's, or a file's. */
  card?: React.ReactNode;
  /** The chord an action's row draws as keys. */
  command?: KeyedCommand | undefined;
  /** The short words the search scores, the name first. */
  terms: readonly string[];
  /** A task's key, as `ACME-42`, which leads its row as it leads the Tasks list's, and which typed whole finds the task first. */
  taskKey?: { readonly workspaceName: string; readonly number: number } | undefined;
  /** Longer words the row is found by as the settings search finds it, every word of the query somewhere in them. */
  keywords?: readonly string[] | undefined;
  /** Whether letters typed in order find the row, as a file's path or a command's name. */
  loose?: boolean | undefined;
  onChoose: () => void;
  /** Whether its words name a person's thing, a task, an agent, a member, an automation, an Inbox item, or a file, kept masked in a screen recording where the palette shows its own. */
  replayMasked?: boolean | undefined;
}

/** What a row's search reads: its name, its short words, its task's key, its keywords, and whether its letters in order find it. */
type RowWords = Pick<PaletteRow, "label" | "terms" | "taskKey" | "keywords" | "loose">;

/**
 * A row ranked before it is drawn: what its search reads, and the row, drawn
 * only once the filter lists it. Note that the tasks and the Inbox's items
 * rank this way, as the files do, because a source may hold thousands, a row's
 * marks and card are most of its cost, and a filter lists fifty at most.
 */
interface UndrawnRow {
  readonly subject: SearchSubject;
  readonly draw: () => PaletteRow;
}

/** One kind's rows, ranked and cut to what the filter lists, and its source's notice where it stands. */
interface PaletteSection {
  kind: PaletteKind;
  rows: readonly PaletteRow[];
  notice: PaletteNotice | undefined;
}

/**
 * What a row is searched by: its name, its other short words, its task's
 * key, its keywords, and, for a file or a command, its letters in order.
 */
function rowSubject(row: RowWords): SearchSubject {
  return {
    label: row.label,
    lines: row.terms.filter((term) => term !== row.label),
    key:
      row.taskKey === undefined
        ? undefined
        : taskKey(row.taskKey.workspaceName, row.taskKey.number),
    keywords: row.keywords,
    loose: row.loose,
  };
}

/** How well what a row is searched by answers the query, by the tier it meets; 0 where it meets none. */
function subjectScore(subject: SearchSubject, query: string): number {
  return searchHit(subject, query)?.score ?? 0;
}

/** How well a row answers the query, by the tier it meets; 0 where it meets none. */
function rowScore(row: PaletteRow, query: string): number {
  return subjectScore(rowSubject(row), query);
}

/** A row ranked by its `words` and drawn with the rest of it, by `draw`, only once it is listed. */
function undrawnRow(words: RowWords, draw: () => Omit<PaletteRow, keyof RowWords>): UndrawnRow {
  return { subject: rowSubject(words), draw: () => ({ ...draw(), ...words }) };
}

/**
 * How well a path answers the query, as its row would: asked only of a path
 * holding every letter typed, since the repository may hold tens of
 * thousands and most hold none of a query's rarer letters.
 */
function pathScore(path: string, query: string): number {
  const lowered = path.toLowerCase();
  for (const letter of query.toLowerCase()) {
    if (letter.trim() !== "" && !lowered.includes(letter)) return 0;
  }
  return searchHit({ label: fileName(path), lines: [path], loose: true }, query)?.score ?? 0;
}

/**
 * The items that match the query, best first, as many as `limit`, ties
 * left in the order given. A blank query matches every item in that order.
 */
function ranked<Item>(
  items: readonly Item[],
  query: string,
  limit: number,
  score: (item: Item) => number,
): readonly Item[] {
  if (searchTokens(query).length === 0) return items.slice(0, limit);
  return items
    .map((item) => ({ item, score: score(item) }))
    .filter((each) => each.score > 0)
    .sort((first, second) => second.score - first.score)
    .slice(0, limit)
    .map((each) => each.item);
}

/**
 * The open task's files at hand, each once: its file tabs the strip draws,
 * in the strip's order, a tab moved among them included (`inTaskOrder`).
 */
function filesAtHand(
  panel: Pick<SidePanelControl, "files" | "order">,
  taskId: string | undefined,
): readonly string[] {
  const drawn = panel.files.filter((file) => file.browsedOn === taskId);
  const placed = inTaskOrder(drawn, panel.order, (file) => fileTab(file.path));
  return [...new Set(placed.map((file) => file.path))];
}

/**
 * The paths Files lists with nothing typed, as many as `limit`: those of
 * `leading` the listing holds first, in their order, then the rest in the
 * listing's. Note that the rest is walked only as far as the limit, since
 * it is asked on every render.
 */
function leadingPaths(
  paths: readonly string[],
  listed: ReadonlySet<string>,
  leading: readonly string[],
  limit: number,
): readonly string[] {
  const lead = leading.filter((path) => listed.has(path)).slice(0, limit);
  const led = new Set(lead);
  const rest: string[] = [];
  for (const path of paths) {
    if (lead.length + rest.length >= limit) break;
    if (!led.has(path)) rest.push(path);
  }
  return [...lead, ...rest];
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
  if ("failure" in answer) return { read: FILES_READ.FAILED };
  return { read: FILES_READ.MISSED, notice: refusalLine(answer.refusal, answer.branch) };
}

/** The whole of the open task's repository, listed in one read, which the Files rows are. */
function paletteFilesQueryOptions(taskId: string | undefined) {
  return taskTreeQueryOptions(taskId === undefined ? undefined : { taskId }, "", true);
}

/** The files as the palette holds them: none before they are asked for, and reading while a read is out, a Retry's among them. */
function filesHeld(files: UseQueryResult<TasksTreeAnswer>): FilesRead | undefined {
  if (files.isFetching) return { read: FILES_READ.READING };
  if (files.isError) return filesOf(refusedAnswer(files.error));
  return files.data === undefined ? undefined : filesOf(files.data);
}

/** What the Files filter says in place of rows: why there are none to search yet, a failed read with its Retry, or nothing. */
function filesNotice(
  repositoryOpen: boolean,
  held: FilesRead | undefined,
  onRetry: () => void,
): PaletteNotice | undefined {
  if (!repositoryOpen) return { kind: PALETTE_NOTICE.SAID, line: NO_REPOSITORY_LINE };
  if (held === undefined || held.read === FILES_READ.READING) {
    return { kind: PALETTE_NOTICE.READING, line: READING_LINE };
  }
  if (held.read === FILES_READ.FAILED) {
    return { kind: PALETTE_NOTICE.FAILED, line: FILES_MISSED_LINE, onRetry };
  }
  return held.read === FILES_READ.MISSED
    ? { kind: PALETTE_NOTICE.SAID, line: <ReplayMask>{held.notice}</ReplayMask> }
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
  read: UseQueryResult<WorkspaceMembersAnswer>,
  retry: () => void,
): PaletteNotice | undefined {
  if (tasks.workspace === undefined) {
    const coming = tasks.signedIn && tasks.workspaces.length === 0 && !tasks.listFailed;
    return coming ? { kind: PALETTE_NOTICE.READING, line: PEOPLE_READING_LINE } : undefined;
  }
  if (read.data !== undefined) return undefined;
  return read.isError
    ? { kind: PALETTE_NOTICE.FAILED, line: PEOPLE_FAILED_LINE, onRetry: retry }
    : { kind: PALETTE_NOTICE.READING, line: PEOPLE_READING_LINE };
}

/** What the Inbox filter says while its items have not been pushed, or a push did not land; nothing once every one is. */
function inboxNotice(search: InboxSearch): PaletteNotice | undefined {
  if (search.reading) return { kind: PALETTE_NOTICE.READING, line: INBOX_READING_LINE };
  return search.failed
    ? { kind: PALETTE_NOTICE.FAILED, line: INBOX_FAILED_LINE, onRetry: search.onRetry }
    : undefined;
}

/** What the Automations filter says while the listed workspace, or its automations, have not been read, or their read did not land; nothing once they are, as People says of its members. */
function automationsNotice(
  tasks: Pick<TasksControl, "signedIn" | "workspace" | "workspaces" | "listFailed">,
  automations: Pick<ReturnType<typeof useAutomations>, "read" | "reload">,
): PaletteNotice | undefined {
  const { read, reload: onRetry } = automations;
  if (tasks.workspace === undefined) {
    const coming = tasks.signedIn && tasks.workspaces.length === 0 && !tasks.listFailed;
    return coming ? { kind: PALETTE_NOTICE.READING, line: READING_AUTOMATIONS } : undefined;
  }
  if (read === undefined) return { kind: PALETTE_NOTICE.READING, line: READING_AUTOMATIONS };
  return "failure" in read
    ? { kind: PALETTE_NOTICE.FAILED, line: AUTOMATIONS_FAILED_LINE, onRetry }
    : undefined;
}

/** A kind's notice after its rows: a refusal with Retry, a reading line a reader hears, or a line of its own, inset as the group's note is. */
function NoticeLine({ notice }: { notice: PaletteNotice }): React.JSX.Element {
  if (notice.kind === PALETTE_NOTICE.FAILED) {
    return (
      <ErrorState failure={unreadShown(FAILURE_SURFACE.PALETTE_READ)} onRetry={notice.onRetry}>
        {notice.line}
      </ErrorState>
    );
  }
  return (
    <NoteLine look={NOTE_LINE_LOOK.INSET} status={notice.kind === PALETTE_NOTICE.READING}>
      {notice.line}
    </NoteLine>
  );
}

/** A file's row, as every place names a file (`file-ref.tsx`): its type's icon, its name, and its folder after it, hanging the file's card. */
function fileRow(path: string, open: (path: string) => void): PaletteRow {
  return {
    ...fileLook(path),
    replayMasked: true,
    loose: true,
    card: <FileCard path={path} />,
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

/** The filter `step` places from the one given among those standing, wrapping at either end. */
function steppedFilter(
  filters: readonly PaletteFilter[],
  filter: PaletteFilter,
  step: number,
): PaletteFilter {
  const at = filters.indexOf(filter);
  const count = filters.length;
  return filters[(at + step + count) % count] ?? PALETTE_FILTER.ALL;
}

/** The word a task the app or an agent made is also found by, beside its maker's name. */
const MADE_BY_WORDS: Partial<Record<Actor["kind"], string>> = {
  [ACTOR_KIND.APP]: "app",
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

/**
 * A task's muted words: its repository, by its name alone as the Tasks
 * list's row says it, unless another listed repository shares the name
 * (`repositoryLabel`).
 */
function taskDetail(
  task: TaskSummary,
  repositories: readonly { readonly repository: string | null }[],
): string | undefined {
  return task.repository === null ? undefined : repositoryLabel(task.repository, repositories);
}

/**
 * Every plan and every agent with no task, as the sidebar lists them among
 * each other (`task-list-model.ts`'s rows): the pinned first, then the rest
 * by their last activity (`taskRowTime`), then the archived agents, each in
 * its tab's look, an archived one saying so in its detail. Within each, the
 * listed workspace's come first and every other workspace's tasks after
 * them, naming its workspace and found by its name, since opening one
 * switches the window to it. A task wears at its end who is on it and its
 * row's mark, as its sidebar row does (`assigneeFace`, `TaskRowStatus`),
 * leads with its key and says its repository by its name, as the Tasks
 * list's row does, and is found by its key, its assignee's name, and its
 * creator's, a key typed whole listing its task first. An agent opens on its own page, as its
 * sidebar row does. An agent's line on a task's card opens the task on its
 * tab through `showAgent`, which leaves the palette as a row does.
 */
function taskRows(
  tasks: TasksControl,
  members: readonly WorkspaceMember[] | undefined,
  open: (taskId: string) => void,
  openAgent: (agentId: string) => void,
  showAgent: TasksControl["onShowAgent"],
  originOf: (task: TaskSummary) => Actor | undefined,
): readonly UndrawnRow[] {
  const listedId = tasks.workspace?.id;
  const carded = { ...tasks, onShowAgent: showAgent };
  // Note that a repository's name is weighed against each repository listed once, not against each task, since many tasks share one.
  const repositories = [
    ...new Set([
      ...tasks.tasks.map((task) => task.repository),
      ...tasks.listedAgents.standing.map((agent) => agent.repository),
      ...tasks.listedAgents.archived.map((agent) => agent.repository),
    ]),
  ].map((repository) => ({ repository }));
  // Note that only the listed workspace's members are read, so another workspace's assignee stands by the wire's name, never as having left.
  const listedMembers = (task: TaskSummary) =>
    task.workspaceId === listedId ? members : undefined;
  const readerOf = (task: TaskSummary) => ({
    members: listedMembers(task),
    readerId: tasks.me,
    memberCount: tasks.workspaces.find((each) => each.id === task.workspaceId)?.memberCount,
  });
  const elsewhereOf = (task: TaskSummary): Workspace | undefined =>
    listedId === undefined || task.workspaceId === listedId
      ? undefined
      : tasks.workspaces.find((each) => each.id === task.workspaceId);
  // Note that a task is found by its key, as its card and the Tasks list say it, read under its own workspace's name.
  const keyOf = (task: TaskSummary): PaletteRow["taskKey"] => {
    const home = tasks.workspaces.find((each) => each.id === task.workspaceId);
    return home === undefined || task.number === undefined
      ? undefined
      : { workspaceName: home.name, number: task.number };
  };
  const taskOf = (task: TaskSummary): UndrawnRow => {
    const elsewhere = elsewhereOf(task);
    const numbered = keyOf(task);
    const key =
      numbered === undefined ? undefined : taskKey(numbered.workspaceName, numbered.number);
    const createdBy = task.createdBy?.name ?? null;
    const assignedTo = task.assignee?.name ?? null;
    // Note that a task the app or an agent made says them in its detail, so it is found by them.
    const origin = originOf(task);
    const madeBy = origin === undefined ? null : actorName(origin);
    const words: RowWords = {
      label: task.name,
      terms: [
        task.name,
        key,
        task.repository,
        elsewhere?.name ?? null,
        assignedTo,
        createdBy,
        madeBy,
        origin === undefined ? null : MADE_BY_WORDS[origin.kind],
      ].filter((term) => term !== null && term !== undefined),
      taskKey: numbered,
    };
    return undrawnRow(words, () => {
      const worn = assigneeFace(task, readerOf(task));
      const detail = taskDetail(task, repositories);
      return {
        replayMasked: true,
        icon: tabLook({ kind: TAB_KIND.PLAN, name: task.name, status: task.status }).icon,
        detail:
          madeBy === null
            ? detail
            : [detail, `by ${madeBy}`].filter((each) => each !== undefined).join(" · "),
        workspace: elsewhere,
        card: <PaletteTaskCard tasks={carded} task={task} />,
        endMark: (
          <>
            {worn === undefined ? null : <AssigneeFaceMark face={worn} />}
            <TaskRowStatus task={task} />
          </>
        ),
        people: [...new Set([assignedTo, createdBy])].filter((name) => name !== null),
        onChoose: () => open(task.id),
      };
    });
  };
  const agentOf = (agent: TasklessAgent, archived: boolean): UndrawnRow => {
    const name = agentName(agent, tasks.agents.models);
    const words: RowWords = {
      label: name,
      terms: [name, agent.repository, agent.automationName ?? null].filter((term) => term !== null),
    };
    return undrawnRow(words, () => {
      // Note that an agent's repository is named as a task's row names its own, by its name alone unless another listed shares it.
      const repository =
        agent.repository === null ? null : repositoryLabel(agent.repository, repositories);
      const said = [repository, archived ? ARCHIVED_WORD : null].filter((word) => word !== null);
      return {
        replayMasked: true,
        icon: tabLook({ kind: TAB_KIND.AGENT, name, agent }).icon,
        detail: said.length === 0 ? undefined : said.join(" · "),
        endMark: agentEndMark(agent, archived),
        card: (
          <AgentCard
            subject={tasklessRowSubject(agent, tasks.agents)}
            models={tasks.agents.models}
          />
        ),
        onChoose: () => openAgent(agent.id),
      };
    });
  };
  const rowOf = (row: TaskRow, archived: boolean): UndrawnRow =>
    row.kind === TASK_ROW.TASK ? taskOf(row.task) : agentOf(row.agent, archived);
  const listed = (task: TaskSummary) => listedId === undefined || task.workspaceId === listedId;
  // The pinned stand first, as the sidebar's; the rest by their last
  // activity, as the sidebar, Home's Recent, and the row's time read it.
  const pinnedFirst = (rows: readonly TaskRow[]) => [
    ...rows.filter((row) => taskRowPinnedAt(row) !== undefined),
    ...orderTaskRows(rows.filter((row) => taskRowPinnedAt(row) === undefined)),
  ];
  const { standing: agents, archived: archivedAgents } = tasks.listedAgents;
  const here = [...tasks.tasks.filter(listed).map(taskRow), ...agents.map(agentRow)];
  const elsewhere = tasks.tasks.filter((task) => !listed(task)).map(taskRow);
  // The listed workspace's archived agents, by their last activity.
  const archived = orderTaskRows(archivedAgents.map(agentRow));
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

/** What the "+" rules read that only a hook can: the door a new shell is asked through where the platform runs terminals. */
interface PanelOfferDoors {
  /** The account signed in, whose cloud Browser draft a row starts. */
  readonly account: string | undefined;
  readonly onNewTerminal: ((agentId: string) => void) | undefined;
  readonly onNewLocal: ((agentId: string) => void) | undefined;
}

/**
 * An offer as ⌘K lists it: as it stands, or, for the "+"'s new Browser tab
 * on a task with several agents, whose submenu ⌘K cannot open, one row for
 * each agent's browser, named by the agent as the submenu's choice is.
 */
function paletteEntries(entry: AddEntry): readonly AddEntry[] {
  const { submenu, ...row } = entry.row;
  if (submenu === undefined) return [entry];
  return submenu.rows.map((choice) => ({
    row: { ...row, detail: choice.label, terms: [row.label, choice.label] },
    endMark: isValidElement(choice.end) ? choice.end : undefined,
    card: choice.card,
    onPick: () => submenu.onPick(choice.id),
  }));
}

/**
 * The open task's Inbox and coding agents, as the column's "+" lists them,
 * then what the side panel's "+" offers past its kinds, by its own rules
 * (`panelOffers`): the agents' Pull request tabs, the
 * plan's pages, a terminal for each agent, and a new Browser tab in each
 * agent's browser; then its archived agents (`archivedAgentRows`), each in
 * its row's look and words, found by its row's words, and beside the task's
 * name; none while no task is open. The "+"'s kinds stand under Commands as
 * Show comments and the rest (`panelTabRows`). An agent opens on its task's
 * tab, or its own page where it has no task, the Inbox the same way, and the panel's
 * places as the "+" opens them, the version history giving way to each, so
 * none opens behind what covers it.
 */
function agentRows(
  tasks: TasksControl,
  doors: PanelOfferDoors,
  show: (pick: () => void) => void,
  people: ReadonlyMap<string, HeldPeople>,
): readonly PaletteRow[] {
  const taskId = tasks.activeTaskId;
  if (taskId === undefined) return [];
  const taskName = tasks.tasks.find((task) => task.id === taskId)?.name;
  // Note that an item main says waits on the task holds its Inbox with no agent read yet.
  const waiting = tasks.inbox.find((each) => each.taskId === taskId)?.items.length ?? 0;
  const inbox = inboxEntries(tasks.agents, waiting, () => tasks.onShowInbox({ taskId }));
  const agents = agentEntries(tasks.mainTabs, tasks.agents).map((entry) => ({
    ...entry,
    onPick: () => tasks.onShowAgent(taskId, entry.row.id),
  }));
  // Note that the plan's places open in its own panel, and in the Inbox's
  // beside an item of the plan, whose panel is the Inbox's.
  const holder = holdsTaskPanel(tasks) ? SIDE_PANEL_HOLDER.TASK : SIDE_PANEL_HOLDER.INBOX;
  // Note that the Inbox's panel reads the chosen item's pages on its own (`desktop-inbox.tsx`).
  const inboxHeld = holder === SIDE_PANEL_HOLDER.INBOX;
  const pages = (inboxHeld ? tasks.inboxView.pages : tasks.pages) ?? [];
  const places = opensTaskItems(tasks)
    ? panelOffers({
        holder,
        taskId,
        panel: tasks.sidePanel,
        agents: tasks.agents,
        pages,
        account: doors.account,
        onNewTerminal: doors.onNewTerminal,
        onNewLocal: doors.onNewLocal,
        viewedAgent: undefined,
        plan: openPlanStanding(tasks),
        cards: {
          agents: tasks.agents,
          held: NOTHING_HELD,
          pagePlace: { taskId },
          shownAgent: undefined,
          onOpenAgent: (agentId) => show(() => tasks.onShowAgent(taskId, agentId)),
          people,
        },
      })
        .filter((entry) => entry.row.section !== undefined)
        .flatMap(paletteEntries)
        .map((entry) => ({ ...entry, onPick: () => shownOverHistory(tasks, entry.onPick) }))
    : [];
  const entries: readonly AddEntry[] = [...inbox, ...agents, ...places];
  const standing = entries.map(({ row, endMark, card, onPick, agent }) => {
    // Note that a terminal's row is named by its agent, as under the "+"'s Cloud and Local headings, which ⌘K draws none of, so the row says it.
    const heading =
      row.section === ADD_SECTION.CLOUD || row.section === ADD_SECTION.LOCAL
        ? row.section
        : undefined;
    const detail = typeof row.detail === "string" ? row.detail : undefined;
    const named = [heading, taskName].filter((word) => word !== undefined);
    return {
      replayMasked: true,
      icon: row.icon,
      label: row.label,
      detail:
        [heading, detail, taskName].filter((word) => word !== undefined).join(" · ") || undefined,
      endMark,
      card:
        card ??
        (agent === undefined ? undefined : (
          <AgentCard
            subject={agentSubject(tasks.agents, agent.id, NOTHING_HELD, false)}
            models={tasks.agents.models}
          />
        )),
      terms: [...(row.terms ?? [row.label]), ...named],
      onChoose: () => show(onPick),
    };
  });
  return [...standing, ...archivedAgentRows(tasks, taskName, show)];
}

/**
 * The open plan's archived agents, in the order started, each in its tab's
 * look and found by its name as a standing one is, its detail saying it is
 * archived before the plan's name, and hanging its card. One opens its tab
 * in the plan's column, as a standing one does, where it is read and
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
      name: agentName(agent, agents.models),
      agent,
    });
    return {
      ...look,
      replayMasked: true,
      detail: [ARCHIVED_WORD, taskName].filter((word) => word !== undefined).join(" · "),
      endMark: agentEndMark(agent, true),
      card: (
        <AgentCard
          subject={agentSubject(agents, agent.id, NOTHING_HELD, false)}
          models={agents.models}
        />
      ),
      terms: [look.label, ...(taskName === undefined ? [] : [taskName])],
      onChoose: () =>
        show(() =>
          agent.planId === null
            ? tasks.agentView.onOpen(agent.id)
            : tasks.onShowAgent(agent.planId, agent.id),
        ),
    };
  });
}

/**
 * The listed workspace's members as every people menu lists them, the
 * reader first (`memberRows`), each hanging their card, a choice opening
 * their page; none until the members are read.
 */
function peopleRows(
  members: readonly WorkspaceMember[] | undefined,
  readerId: string | undefined,
  open: (userId: string) => void,
): readonly PaletteRow[] {
  return memberRows(members, readerId).map((row) => ({
    replayMasked: true,
    icon: row.icon,
    label: row.label,
    detail: row.detail,
    terms: row.terms,
    card: row.card,
    onChoose: () => open(row.member.userId),
  }));
}

/** The listed workspace's automations, each by its name and what fires it, as the Automations page lists it, then its task's name, hanging its card as every place naming one does, which choosing opens on its page; its task's name finds it too. */
function automationRows(
  automations: readonly AutomationSummary[],
  workspaceName: string | undefined,
  open: (automationId: string) => void,
): readonly PaletteRow[] {
  return automations.map((automation) => {
    const trigger = automationTriggerText(automation.trigger, automation.repositories ?? []);
    return {
      replayMasked: true,
      icon: <GLYPH.AUTOMATION />,
      label: automation.name,
      // Note that its task's name, which finds it too, is said after what fires it, so a row it found says why.
      detail: automation.planName === null ? trigger : `${trigger} · ${automation.planName}`,
      card: <AutomationCard automation={automation} workspaceName={workspaceName} />,
      terms: [automation.name, trigger, automation.planName].filter((term) => term !== null),
      onChoose: () => open(automation.id),
    };
  });
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

/** What an Inbox item's search reads: its title and its holder's name, and else everything it says (`inboxItemWords`). */
function inboxWords({ holder, item }: InboxListed): RowWords {
  const title = cardTitle(item.title);
  return { label: title, terms: [title, holderName(holder)], keywords: inboxItemWords(item) };
}

/**
 * An Inbox item's row, by its agent's tile and title, beside its task's or
 * automation's name and, where its thread rather than those found it, the
 * words that did, the marks its Inbox row wears at its end and its card hung
 * beside it (`inbox-item-parts.tsx`), drawn only once the filter lists it.
 */
function inboxRow(
  listed: InboxListed,
  words: RowWords,
  seams: {
    readonly readerId: string | undefined;
    readonly models: AgentsControl["models"];
    readonly tokens: readonly string[];
    readonly now: number;
    readonly open: (listed: InboxListed) => void;
  },
): UndrawnRow {
  const { holder, item } = listed;
  return undrawnRow(words, () => {
    const name = holderName(holder);
    const snippet = snippetOf(words.keywords ?? [], [item.title, words.label, name], seams.tokens);
    return {
      replayMasked: true,
      icon: (
        <ItemMark
          holder={holder}
          agentId={item.agentId}
          models={seams.models}
          readerId={seams.readerId}
          plain
        />
      ),
      detail: snippet === undefined ? name : `${name} · ${snippet}`,
      endMark: <InboxItemEnd listed={listed} now={seams.now} readerId={seams.readerId} />,
      card: (
        <InboxItemCard
          listed={listed}
          now={seams.now}
          models={seams.models}
          readerId={seams.readerId}
        />
      ),
      onChoose: () => seams.open(listed),
    };
  });
}

/**
 * The commands that open a place of the window rather than act, which ⌘K
 * says as "Go to" and the place, as it stands mid-sentence, so a place is
 * never read as a verb among the verbs; the menus and the Keyboard
 * shortcuts page go on naming the place alone.
 */
const PLACE_COMMANDS: ReadonlySet<AppCommand> = new Set([
  APP_COMMAND.HOME,
  APP_COMMAND.TASKS,
  APP_COMMAND.INBOX,
  APP_COMMAND.AUTOMATIONS,
  APP_COMMAND.SETTINGS,
  APP_COMMAND.KEYBOARD_SHORTCUTS,
  APP_COMMAND.ADMIN,
]);

/**
 * The commands a chord reaches that act on the open thing, its plan, its
 * selection, or its Inbox item, in the order ⌘K lists them after its Copy
 * link and ahead of the open thing's menu rows; each is offered only while
 * something open takes it.
 */
const OPEN_THING_COMMANDS: readonly AppCommand[] = [
  APP_COMMAND.COPY_CONTENT,
  APP_COMMAND.COPY_FULL_TRANSCRIPT,
  APP_COMMAND.COMMENT_ON_SELECTION,
  APP_COMMAND.REPLY_TO_SELECTION,
  APP_COMMAND.MENTION_LINES,
  APP_COMMAND.INSERT_PICTURE,
  APP_COMMAND.TOGGLE_READ,
  APP_COMMAND.OPEN_IN_TASK,
  APP_COMMAND.MARK_TASK_DONE,
  APP_COMMAND.OPEN_ON_GITHUB,
];

/**
 * The commands a row of the open thing's own offers with its chord
 * (`readMarkRows`, `taskPinRows`, `taskCommandRows`), so no run of commands
 * lists them again: U, but the Inbox's, which only the run lists, P, and
 * Version history.
 */
const OWN_ROW_COMMANDS: ReadonlySet<AppCommand> = new Set([
  APP_COMMAND.PIN,
  APP_COMMAND.VERSION_HISTORY,
]);

/** The open thing's commands as its run lists them: U only while the Inbox stands, whose chosen item no row of its own marks. */
function openThingCommands(tasks: TasksControl): readonly AppCommand[] {
  return OPEN_THING_COMMANDS.filter(
    (command) => command !== APP_COMMAND.TOGGLE_READ || tasks.inboxView.open,
  );
}

/** The open thing's Show terminal, listed beside its other Show rows. */
const OPEN_THING_SHOW_COMMANDS: readonly AppCommand[] = [APP_COMMAND.SHOW_TERMINAL];

/** The open thing's command that cannot be undone, which ends its commands as it ends the task's ⋯ menu. */
const OPEN_THING_LAST_COMMANDS: readonly AppCommand[] = [APP_COMMAND.DELETE];

/** Every command the open thing's runs name, which the window's run leaves out. */
const OPEN_THING_ALL: ReadonlySet<AppCommand> = new Set([
  ...OPEN_THING_COMMANDS,
  ...OPEN_THING_SHOW_COMMANDS,
  ...OPEN_THING_LAST_COMMANDS,
  ...OWN_ROW_COMMANDS,
]);

/** The places ⌘K goes to, in the Keyboard shortcuts page's order, which it lists after the open thing's commands. */
const GO_TO_COMMANDS = LISTED_COMMANDS.filter((command) => PLACE_COMMANDS.has(command));

/** The window's own commands, every listed one neither the open thing's nor a place, in the Keyboard shortcuts page's order, which ⌘K lists last. */
const WINDOW_COMMANDS = LISTED_COMMANDS.filter(
  (command) => !PLACE_COMMANDS.has(command) && !OPEN_THING_ALL.has(command),
);

/** What a command is called for the account's experiments, as the menu bar and the Keyboard shortcuts page call it (`shortcutLabel`). */
function commandLabel(command: AppCommand, experiments: ExperimentChoices): string {
  return isKeyedCommand(command) ? shortcutLabel(command, experiments) : appCommandLabel(command);
}

/**
 * What a command's row says: a place as "Go to" it, and else the words its
 * shortcut says for the account's experiments, which its menu item says too
 * (`panelCommandOf`) but where an experiment renames it, as Copy description or
 * transcript is Copy transcript while Descriptions is off.
 */
function actionLabel(command: AppCommand, experiments: ExperimentChoices): string {
  const label = commandLabel(command, experiments);
  return PLACE_COMMANDS.has(command) ? `Go to ${label.toLowerCase()}` : label;
}

/**
 * The commands of `commands` the palette lists and the window offers now,
 * in that order, the palette's own left out, each with its chord, and the
 * glyph its menu item wears where a menu offers it too (`command-items.tsx`).
 * Note that one no menu offers keeps its glyph's room empty, so every name
 * in the group starts at one edge.
 */
function actionRows(
  commands: readonly AppCommand[],
  run: (command: AppCommand) => void,
  experiments: ExperimentChoices,
): readonly PaletteRow[] {
  return commands
    .filter(
      (command) =>
        LISTED_COMMANDS.includes(command) &&
        command !== APP_COMMAND.COMMAND_PALETTE &&
        command !== APP_COMMAND.COPY_LINK &&
        appCommandOffered(command),
    )
    .map((command) => {
      const label = actionLabel(command, experiments);
      return {
        icon: panelCommandOf(command)?.icon ?? null,
        label,
        command: isKeyedCommand(command) ? command : undefined,
        terms: [label],
        onChoose: () => run(command),
      };
    });
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
 * window holds it, its name; the first wears ⇧⌘C, which copies it.
 */
function copyLinkRows(
  links: readonly LinkAtHand[],
  copy: (held: LinkAtHand) => void,
): readonly PaletteRow[] {
  const item = PANEL_COMMAND.COPY_LINK;
  return links.map((held, index) => {
    const label = `${commandWords(item, COMMAND_PLACE.PALETTE)} to ${held.thing}`;
    return {
      icon: item.icon,
      label,
      detail: held.name,
      command: index === 0 ? item.command : undefined,
      terms: [label, ...COPY_LINK_TERMS],
      onChoose: () => copy(held),
    };
  });
}

/**
 * The side panel's kinds, listed with the commands as Show comments and the
 * rest, a command's verb before the name its tab wears, each wearing its
 * kind's glyph as its tab does (`tab-look.tsx`) and showing the panel on
 * its tab as the panel's "+" does, over the version history, and only the
 * kinds the "+" offers (`offeredPanelKinds`), so none opens blank; none while
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
  const kinds = offeredPanelKinds(SIDE_PANEL_HOLDER.TASK);
  return kinds.map((tab) => {
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
 * the mark back before it is ever seen. It wears U, which marks the plan
 * open while no sidebar row has the keyboard, as ⌘K's own field has it.
 */
function readMarkRows(
  tasks: TasksControl,
  reads: ReadMarks,
  choose: (run: () => void) => void,
): readonly PaletteRow[] {
  if (tasks.region.kind !== DOCUMENT_REGION.READY) return [];
  const { task } = tasks.region;
  if (task.id !== reads.watched) return [];
  const item = markReadItem(
    { unread: reads.markedUnread(task.id), onMark: (unread) => reads.mark(task, unread) },
    true,
  );
  return [
    {
      icon: item.icon,
      label: item.label,
      command: item.command,
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
  const item = markReadItem(
    { unread: reads.markedUnread(agent.id), onMark: (unread) => reads.mark(agent, unread) },
    true,
  );
  return [
    {
      icon: item.icon,
      label: item.label,
      command: item.command,
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
  const item = pinned ? PANEL_COMMAND.UNPIN_TASK : PANEL_COMMAND.PIN_TASK;
  const label = commandWords(item, COMMAND_PLACE.PALETTE);
  const mark = pinned ? TASK_MARK.UNPIN : TASK_MARK.PIN;
  return [
    {
      icon: item.icon,
      label,
      command: item.command,
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
  const item = pinned ? PANEL_COMMAND.UNPIN_AGENT : PANEL_COMMAND.PIN_AGENT;
  const label = commandWords(item, COMMAND_PLACE.PALETTE);
  return [
    {
      icon: item.icon,
      label,
      command: item.command,
      terms: [label],
      onChoose: () => choose(() => tasks.onPinAgent(agent.id, !pinned)),
    },
  ];
}

/**
 * The plan on screen's own commands, as its ⋯ menu offers them
 * (`task-actions.tsx`'s `taskActionGroups`): Rename where its page offers
 * the door its ⋯ asks, Version history while Descriptions is on, New sub-task, Add task relation, which
 * opens the head's add menu as S opens the status menu, Remove parent on a
 * task with a parent, Cancel task on a task not already canceled, and
 * Change repository; each runs what its menu item runs, Version history
 * wearing its chord. None while no plan is looked at. Note
 * that Copy link, Mark as read, Pin, Mark done, and Permanently delete are
 * rows of their own.
 */
function taskCommandRows(
  tasks: TasksControl,
  reads: ReadMarks,
  rename: OpenTaskRename | undefined,
  choose: (run: () => void) => void,
  historyOffered: boolean,
): readonly PaletteRow[] {
  const task = reads.watched === undefined ? undefined : taskOf(tasks, reads.watched);
  if (task === undefined) return [];
  const renamed = rename?.taskId === task.id ? rename.begin : undefined;
  const commands: readonly { item: PanelCommand; run: () => void }[] = [
    ...(renamed === undefined ? [] : [{ item: PANEL_COMMAND.RENAME_TASK, run: renamed }]),
    ...(historyOffered
      ? [{ item: PANEL_COMMAND.VERSION_HISTORY, run: () => tasks.history.onOpen(task.id) }]
      : []),
    {
      item: PANEL_COMMAND.NEW_CHILD_TASK,
      run: () => tasks.onNewRelatedTask(task.id, TASK_CREATE_RELATION_KIND.SUB_TASK_OF),
    },
    // Add task relation opens the head's add menu on its first kind, whose pinned Relation row switches it.
    {
      item: PANEL_COMMAND.ADD_RELATION,
      run: () => tasks.onAddRelation(task.id, TASK_RELATION_KIND.SUB_TASK),
    },
    ...(task.parentTaskId === undefined
      ? []
      : [{ item: PANEL_COMMAND.REMOVE_PARENT, run: () => tasks.onRemoveTaskParent(task.id) }]),
    ...(settleOffered(task, SETTLED_STATUS.CANCELED)
      ? [
          {
            item: PANEL_COMMAND.CANCEL_TASK,
            run: () => tasks.onSettleTasks([task.id], SETTLED_STATUS.CANCELED),
          },
        ]
      : []),
    { item: PANEL_COMMAND.CHANGE_REPOSITORY, run: () => tasks.onChangeRepository(task.id) },
  ];
  return commands.map(({ item, run }) => {
    const label = commandWords(item, COMMAND_PLACE.PALETTE);
    return {
      icon: item.icon,
      label,
      command: item.command,
      terms: [label],
      onChoose: () => choose(run),
    };
  });
}

/**
 * U and P on what is open, while no sidebar row has the keyboard, whose
 * own answer over these (`useFocusedRowKeys`): the plan on screen, marked
 * read or unread and pinned as its menus do, or the agent whose page
 * stands, the pin only while it is not archived. Note that the Inbox's U
 * is its chosen item's (`use-inbox-read-marks.ts`), so nothing here stands
 * while the Inbox does.
 */
function useOpenThingKeys(tasks: TasksControl, reads: ReadMarks, agentReads: AgentReadMarks): void {
  const inbox = tasks.inboxView.open;
  const task = inbox || reads.watched === undefined ? undefined : taskOf(tasks, reads.watched);
  const agent = inbox ? undefined : openAgentOf(tasks);
  const standing =
    agent === undefined
      ? undefined
      : tasks.listedAgents.standing.find((each) => each.id === agent.id);
  const toggleRead =
    task !== undefined
      ? () => reads.mark(task, !reads.markedUnread(task.id))
      : agent !== undefined
        ? () => agentReads.mark(agent, !agentReads.markedUnread(agent.id))
        : undefined;
  const togglePin =
    task !== undefined
      ? () =>
          tasks.onMarkTask(task.id, task.pinnedAt === undefined ? TASK_MARK.PIN : TASK_MARK.UNPIN)
      : standing !== undefined
        ? () => tasks.onPinAgent(standing.id, standing.pinnedAt === undefined)
        : undefined;
  useAppCommand(APP_COMMAND.TOGGLE_READ, toggleRead);
  useAppCommand(APP_COMMAND.PIN, togglePin);
}

/** The agent on no task whose page stands, archived or not; none while no agent's page stands. */
function openAgentOf(tasks: TasksControl): TasklessAgent | undefined {
  const { agentId } = tasks.agentView;
  const { standing, archived } = tasks.listedAgents;
  return [...standing, ...archived].find((each) => each.id === agentId);
}

/**
 * Archive agent for the agent whose page stands, or Unarchive agent once it
 * is archived, as its ⋯ offers them; none while no agent's page stands. A
 * choice asks `OpenAgentArchive`, which runs the menu's own item.
 */
function agentArchiveRows(
  agent: TasklessAgent | undefined,
  ask: (agentId: string) => void,
  choose: (run: () => void) => void,
): readonly PaletteRow[] {
  if (agent === undefined) return [];
  const item =
    agent.archivedAt === undefined ? PANEL_COMMAND.ARCHIVE_AGENT : PANEL_COMMAND.UNARCHIVE_AGENT;
  const label = commandWords(item, COMMAND_PLACE.PALETTE);
  return [{ icon: item.icon, label, terms: [label], onChoose: () => choose(() => ask(agent.id)) }];
}

/**
 * The open agent's Archive or Unarchive, run as its ⋯ runs them
 * (`agent-archive.tsx`) each time ⌘K asks, and the question Archive asks
 * through while a teammate's agent works, drawn while the window stands.
 * Note that it is keyed by the agent, so an ask for one is never run on
 * another.
 */
function OpenAgentArchive({
  agent,
  agents,
  shown,
  asked,
}: {
  agent: TasklessAgent;
  agents: AgentsControl;
  shown: boolean;
  /** How many times ⌘K asked for this agent, each new one run once. */
  asked: number;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  // Note that the agent is read again by its own id before a teammate's is archived, as its sidebar row reads it.
  const control = {
    ...agents,
    readAgent: (agentId: string) => readAgentById(queryClient, agentId),
  };
  const archive = useAgentArchive(agent, control, shown);
  const unarchive = useAgentUnarchive(agent.id, control);
  const action = agent.archivedAt === undefined ? archive.action : unarchive;
  const answered = useRef(asked);
  useEffect(() => {
    if (asked === answered.current) return;
    answered.current = asked;
    action.onSelect();
  });
  return archive.dialog;
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
    detailShown: true,
    terms: [entry.label],
    keywords: entry.haystack,
    onChoose: () => land(entry.page, entry.id),
  }));
}

/**
 * The person whose name explains why the query found a row, its assignee
 * before its creator: the one whose name holds the most words of the query;
 * none where no name holds one, since the row's own words explain it then.
 */
function personFound(row: PaletteRow, tokens: readonly string[]): string | undefined {
  const people = row.people ?? [];
  if (people.length === 0 || tokens.length === 0) return undefined;
  // The name holding the most of the query's words, so a first name two people share never hides the one the whole query names.
  const held = (name: string) =>
    tokens.filter((token) => matchRanges(name, [token]).length > 0).length;
  const named = people.reduce((best, name) => (held(name) > held(best) ? name : best));
  return held(named) > 0 ? named : undefined;
}

/**
 * Where a drawn line other than the row's name is marked: a loose hit's
 * letters where they fell in it, and else wherever the words typed stand
 * in it, since a word tier found each of them whole.
 */
function markedIn(
  text: string,
  subject: SearchSubject,
  hit: SearchHit | undefined,
  tokens: readonly string[],
): readonly MatchRange[] {
  if (hit === undefined) return [];
  return hit.tier === SEARCH_TIER.LOOSE
    ? hitRangesIn(text, subject, hit)
    : matchRanges(text, tokens);
}

/** A row as the dialog draws it, known by its place in the list, its words lit where the query found them. */
function paletteItem(
  row: PaletteRow,
  id: string,
  query: string,
  tokens: readonly string[],
): CommandItem {
  const subject = rowSubject(row);
  const hit = searchHit(subject, query);
  // A task found by its assignee's or its creator's name says the name after its detail, so the match is in sight.
  const found = personFound(row, tokens);
  const detail =
    found === undefined
      ? row.detail
      : [row.detail, found].filter((words) => words !== undefined).join(" · ");
  const words =
    detail === undefined && row.workspace === undefined ? undefined : (
      <ReplayWords masked={row.detailShown !== true}>
        {row.workspace === undefined ? null : (
          <WorkspaceRef
            workspace={row.workspace}
            name={
              <Highlighted
                text={row.workspace.name}
                ranges={markedIn(row.workspace.name, subject, hit, tokens)}
              />
            }
          />
        )}
        {row.workspace === undefined || detail === undefined ? null : " · "}
        {detail === undefined ? null : (
          <Highlighted text={detail} ranges={markedIn(detail, subject, hit, tokens)} />
        )}
      </ReplayWords>
    );
  // Note that a task's key stands first at the row's end, as the Tasks list's row sets it, and never leads: a lead on the keyed rows alone pushes their glyph and name right of every row without one.
  // Spoken, since a palette row is an option, which carries no
  // `aria-keyshortcuts` to say the chord for it.
  const end =
    row.command === undefined &&
    row.endMark === undefined &&
    row.taskKey === undefined ? undefined : (
      <>
        {row.taskKey === undefined ? null : (
          <TaskKey
            workspaceName={row.taskKey.workspaceName}
            number={row.taskKey.number}
            tokens={tokens}
          />
        )}
        {row.command === undefined ? null : (
          <Shortcut chord={APP_SHORTCUTS[row.command].chord} spoken />
        )}
        {row.endMark}
      </>
    );
  return {
    id,
    label: <Highlighted text={row.label} ranges={hit?.label ?? []} />,
    // Note that a person's face draws their initial as words, so a masked row's glyph is masked with it.
    icon: row.replayMasked === true ? <ReplayMask>{row.icon}</ReplayMask> : row.icon,
    detail: words,
    hint: end,
    card: row.card,
    replayMasked: row.replayMasked,
    // Note that the palette ranks its own rows, so these words only name the row's card.
    words: row.label,
    onSelect: row.onChoose,
  };
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
    <div ref={band}>
      <ReplayUnmask>
        <ChoiceBar
          label="Filter"
          items={PALETTE_FILTERS.map((each) => ({ value: each, label: FILTER_LABEL[each] }))}
          value={filter}
          onChange={onFilter}
          look={CHOICE_BAR_LOOK.FILL}
          size={CHOICE_BAR_SIZE.COMPACT}
          focus={CHOICE_BAR_FOCUS.NONE}
        />
      </ReplayUnmask>
    </div>
  );
}

/** The keys' hints along the foot, each its chords and then its word, which a reader is not read: Return runs a command chosen, and opens anything else. */
function PaletteFooter({ typed, runs }: { typed: boolean; runs: boolean }): React.JSX.Element {
  const hints: FooterHint[] = [
    ...listHints(runs ? RETURN_WORD.RUN : RETURN_WORD.OPEN),
    typed ? FILTER_HINT.TYPED : FILTER_HINT.EMPTY,
  ];
  return (
    <>
      {hints.map((hint) => (
        <span key={hint.label} aria-hidden="true">
          <ReplayUnmask>
            {hint.chords.map((chord, index) => (
              <Fragment key={chord.key.accelerator}>
                {/* Note that bare keys read as one glyph pair, ←→, while chords with a modifier, ⌘[ / ⌘] or Ctrl [ / Ctrl ], need a slash between them, or they run into each other. */}
                {index > 0 && chord.bare !== true ? " / " : null}
                <Shortcut chord={chord} />
              </Fragment>
            ))}{" "}
            {hint.label}
          </ReplayUnmask>
        </span>
      ))}
    </>
  );
}

/**
 * ⌘K's dialog over the rows ranked, holding the row chosen, by its place in
 * the list: the first each time ⌘K opens the palette and as a filter is
 * chosen, then wherever the arrows or the pointer move it. Note that the row
 * chosen is held here rather than by the palette, so moving it draws the
 * dialog again and never ranks a row, which the palette does over every
 * task, Inbox item, and setting it lists. Note too that it draws again only
 * for props that changed, which the palette holds still while it is shut,
 * so the window drawing again leaves the hidden dialog alone.
 */
const PaletteDialog = memo(function PaletteDialog({
  opening,
  filter,
  groups,
  query,
  ...dialog
}: {
  /** How many times ⌘K has opened the palette, each time choosing the first row again. */
  opening: number;
  filter: PaletteFilter;
  groups: readonly CommandGroup[];
  query: string;
} & Pick<
  CommandDialogProps,
  | "open"
  | "onOpenChange"
  | "placeholder"
  | "onQueryChange"
  | "empty"
  | "band"
  | "onKeyDown"
  | "inputRef"
>): React.JSX.Element {
  const [selected, setSelected] = useState(FIRST_ROW);
  // Note that a palette closing keeps its row chosen, since it fades out as it stood.
  const [chosenUnder, setChosenUnder] = useState({ opening, filter });
  if (chosenUnder.opening !== opening || chosenUnder.filter !== filter) {
    setChosenUnder({ opening, filter });
    setSelected(FIRST_ROW);
  }
  // Whether the row chosen is a command's, which Return runs rather than opens.
  const runs = groups.some(
    (group) =>
      group.id === PALETTE_FILTER.COMMANDS && group.items.some((item) => item.id === selected),
  );
  return (
    <CommandDialog
      {...dialog}
      label="Command palette"
      replayUnmasked
      // Note that the palette stays drawn, hidden, while shut, so ⌘K only shows it, since its props stand still until it opens.
      keepMounted
      groups={groups}
      filter={COMMAND_FILTER.NONE}
      query={query}
      selected={selected}
      onSelectedChange={setSelected}
      foot={<PaletteFooter typed={query !== ""} runs={runs} />}
    />
  );
});

/**
 * The palette, offering ⌘K while `available`: past the sign-in, where there
 * is something to run. A palette standing when that ends is taken down in
 * the render that finds it gone. It opens on All with nothing typed.
 */
export function CommandPalette({
  available,
  tab,
  onTabChange,
  tasks,
  links,
  settings,
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
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // The experiments on in the workspace the window lists, the account's own beside them.
  const experiments = useExperimentsIn(tasks.workspace?.id);
  if (open && !available) setOpen(false);
  const [filter, setFilter] = useState<PaletteFilter>(PALETTE_FILTER.ALL);
  // How many times ⌘K has opened the palette, each of which chooses its first row.
  const [openings, setOpenings] = useState(0);
  const [query, setQuery] = useState("");
  // Each key pressed in the search field is timed to the paint after it, which its ranking of every row is among.
  const keystrokes = useKeystrokeSpans(PANEL_SPAN.KEYSTROKE_COMMAND_PALETTE);
  const queryClient = useQueryClient();
  // Whether the keyboard was in the side panel when ⌘K was pressed, which puts its tab's link first, as ⌥⌘C there would.
  const [fromPanel, setFromPanel] = useState(false);
  const chosen = useRef<(() => void) | undefined>(undefined);
  const shown = useRef(false);
  // The groups as they stood when the palette last stood open, which it fades out with rather than giving way to "No results match".
  const stood = useRef<readonly CommandGroup[]>([]);
  // The menu bar's Back and Forward, a mouse's back button among them, leave the window behind the palette alone.
  useOverlayHold(open);

  useAppCommand(
    APP_COMMAND.COMMAND_PALETTE,
    available
      ? () => {
          setFromPanel(inSidePanel(document.activeElement));
          setFilter(PALETTE_FILTER.ALL);
          setOpenings((count) => count + 1);
          setQuery("");
          // The files are read afresh by the first search of each opening,
          // since the branch they are listed on moves, and a read still out
          // from the last opening is not kept.
          void queryClient.resetQueries({
            queryKey: paletteFilesQueryOptions(tasks.activeTaskId).queryKey,
            exact: true,
          });
          setOpen(true);
        }
      : undefined,
  );

  // Note that what was chosen runs once the palette is gone and focus is
  // back where it was, which the dialog hands back as it closes, because a
  // command that moves focus (Delete's question, the New task dialog's
  // field) would otherwise lose it to the palette's own going.
  useEffect(() => {
    if (open) {
      shown.current = true;
      return;
    }
    if (!shown.current) return;
    shown.current = false;
    const run = chosen.current;
    chosen.current = undefined;
    run?.();
  }, [open]);

  const choose = useCallback((run: () => void) => {
    chosen.current = run;
    setOpen(false);
  }, []);
  // A task, and an agent's tab, are always opened on the Tasks tab, as a
  // press in the sidebar is.
  const onTasks = useCallback(
    (run: () => void) =>
      choose(() => {
        // A routed place standing, Settings or Admin, is left for what was chosen.
        onTabChange(PANEL_TAB.TASKS);
        run();
      }),
    [choose, onTabChange],
  );
  // The seek for a setting's row gives itself up once another is asked
  // for or Settings is left, so it never lands on a later visit's page.
  const landing = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (tab !== PANEL_TAB.SETTINGS) landing.current?.();
  }, [tab]);
  useEffect(() => () => landing.current?.(), []);
  const land = (page: SettingsView, id: string) =>
    choose(() => {
      // Choosing a page opens Settings on it, or turns the page of Settings standing.
      settings.onViewChange(page);
      landing.current?.();
      landing.current = landOnSettingsRow(id);
    });
  const openPage = (page: SettingsView) =>
    choose(() => {
      landing.current?.();
      landing.current = undefined;
      settings.onViewChange(page);
    });

  // Note that the rows are ranked for the words a render behind the field
  // (`sought`), so a key paints in the field at once and the ranking of every
  // row follows in a render of its own, which the next key may cut short. A
  // closed palette seeks nothing, so an opening starts level with its empty field.
  const sought = useDeferredValue(open ? query : "");
  // The words a Return was pressed on before the rows were ranked for them, held until they are.
  const owedReturn = useRef<string | undefined>(undefined);
  useEffect(() => {
    const owed = owedReturn.current;
    if (!open) owedReturn.current = undefined;
    if (!open || owed === undefined || sought !== query) return;
    owedReturn.current = undefined;
    // Note that the Return chooses the row its words rank first, as a Return typed after them would,
    // whatever was highlighted before; and none where the words changed again before they were ranked.
    if (owed !== query) return;
    const items = stood.current.flatMap((group) => group.items);
    items.find((item) => item.disabled !== true)?.onSelect();
  }, [open, sought, query]);

  // Note that no key pressed in the palette goes on to the window, which the
  // dialog sees to, because the window's Escape would stop an agent mid-reply and
  // a window chord would change what stands behind the palette. Escape itself
  // is the dialog's, which closes the palette alone.
  const keyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Note that a Return the rows have not caught up with waits for them, so it never chooses a row the earlier words ranked.
      if (event.key === "Enter" && sought !== query) {
        event.preventDefault();
        owedReturn.current = query;
        return;
      }
      const step = arrowStep(event, query);
      if (step !== 0) {
        event.preventDefault();
        setFilter(steppedFilter(PALETTE_FILTERS, filter, step));
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
      else setFilter(steppedFilter(PALETTE_FILTERS, filter, pressed === APP_COMMAND.BACK ? -1 : 1));
    },
    [sought, query, filter],
  );

  const tokens = searchTokens(sought);
  // The listed workspace's members, read once for it, name a task's assignee by face.
  const membersRead = useQuery(workspaceMembersQuery(tasks.workspace?.id));
  const { mutate: retryMembers } = useMutation(workspaceMembersRetryMutation());
  const originOf = useTaskOrigin();
  const members = membersRead.data?.members;
  // Note that the tasks' rows are built once for what they say rather than on every render, and
  // only while a filter that lists them stands open, because a key, an arrow, or the pointer
  // moving ranks or lights them again but changes none of them, and an account may hold thousands.
  const tasksShown =
    open && tasks.signedIn && (filter === PALETTE_FILTER.ALL || filter === PALETTE_FILTER.TASKS);
  const taskList = useMemo(
    () =>
      tasksShown
        ? taskRows(
            tasks,
            members,
            // Note that a task jumped to goes back to work on it, as a sidebar row does (`onResume`).
            (id) => onTasks(() => tasks.onResume(id)),
            (id) => onTasks(() => tasks.agentView.onOpen(id)),
            (taskId, agentId) => onTasks(() => tasks.onShowAgent(taskId, agentId)),
            originOf,
          )
        : [],
    [tasksShown, tasks, members, onTasks, originOf],
  );
  const reads = useReadMarks();
  // The watched task's history is its description's, which stands by its own workspace's choice.
  const historyOffered = useWorkspaceExperiment(
    reads.watched === undefined ? undefined : taskOf(tasks, reads.watched)?.workspaceId,
    EXPERIMENT.DESCRIPTIONS,
  );
  const renameOffer = useTaskRenameOffer();
  const agentReads = useAgentReadMarks();
  useOpenThingKeys(tasks, reads, agentReads);
  // The open agent's Archive, asked of `OpenAgentArchive` by the agent it was chosen for.
  const openAgent = openAgentOf(tasks);
  const [archiveAsks, setArchiveAsks] = useState<{ agentId: string; asked: number }>(
    NO_ARCHIVE_ASKS,
  );
  const askArchive = (agentId: string) =>
    setArchiveAsks((was) => ({ agentId, asked: was.agentId === agentId ? was.asked + 1 : 1 }));
  const limit = filter === PALETTE_FILTER.ALL ? KIND_ROWS.ALL : KIND_ROWS.FILTERED;
  // The task's terminals and Browser tabs are offered as the panel's "+" offers them, through its own doors.
  const openTerminal = useOpenTerminal(tasks.sidePanel, noFocusMove);
  const openLocal = useOpenTerminalTab(TERMINAL_KIND.LOCAL, tasks.sidePanel, noFocusMove);
  // Note that the task's Changes rows hang their pull request's people, as their Changes tabs read them.
  const offeredChanges = tasks.sidePanel.changes;
  const changesPeople = useChangesPeopleOf(
    useMemo(() => offeredChanges.map((tab) => tab.changes), [offeredChanges]),
  );
  const offerDoors: PanelOfferDoors = {
    account: useWindowAccount(),
    onNewTerminal:
      useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.TERMINALS) }).data ===
      true
        ? (agentId) => openTerminal(agentId, TERMINAL_ASK.NEW)
        : undefined,
    onNewLocal:
      useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.LOCAL_TERMINALS) })
        .data === true
        ? (agentId) => openLocal(agentId, true)
        : undefined,
  };
  const taskId = tasks.activeTaskId;
  const repository = tasks.tasks.find((task) => task.id === taskId)?.repository ?? null;
  // Note that a task's files are searched only while its panel is the one standing, which an agent's page holds otherwise.
  const filesOpen = opensTaskItems(tasks) && taskId !== undefined && repository !== null;
  const filesAsked = open && filesOpen && (filter === PALETTE_FILTER.FILES || tokens.length > 0);
  // Note that the Inbox is read the first time it is searched, on the Files filter's terms.
  const inboxAsked =
    open && tasks.signedIn && (filter === PALETTE_FILTER.INBOX || tokens.length > 0);
  const inboxSearch = useInboxSearch(tasks, inboxAsked);
  // Note that each Inbox item's words are read once for the items pushed rather than on every key.
  const inboxList = useMemo(
    () =>
      inboxAsked ? inboxSearch.items.map((listed) => ({ listed, words: inboxWords(listed) })) : [],
    [inboxAsked, inboxSearch.items],
  );
  // Note that the automations are held the first time they are searched, on the Inbox's terms.
  const automationsAsked =
    open && tasks.signedIn && (filter === PALETTE_FILTER.AUTOMATIONS || tokens.length > 0);
  const automations = useAutomations(automationsAsked ? tasks.workspace?.id : undefined);
  const now = useMinute();

  // Note that the repository is read the first time its files are searched
  // rather than as the palette opens, because most of its uses never ask
  // for a file, and kept for the opening while the task stays the same.
  const filesQuery = useQuery({ ...paletteFilesQueryOptions(taskId), enabled: filesAsked });
  const held = filesOpen ? filesHeld(filesQuery) : undefined;
  const retryFiles = () => void filesQuery.refetch();

  const paths = held?.read === FILES_READ.LISTED ? held.paths : undefined;
  const fileQuery = filter === PALETTE_FILTER.FILES || tokens.length > 0 ? sought : undefined;
  const blankFiles = fileQuery !== undefined && searchTokens(fileQuery).length === 0;
  // Ranked once a query or the listing changes, not on every render, since
  // a repository may list tens of thousands of paths.
  const rankedPaths = useMemo(
    () =>
      paths === undefined || fileQuery === undefined
        ? []
        : ranked(paths, fileQuery, limit, (path) => pathScore(path, fileQuery)),
    [paths, fileQuery, limit],
  );
  const listedPaths = useMemo(
    () => (paths === undefined || !blankFiles ? undefined : new Set(paths)),
    [paths, blankFiles],
  );
  // Note that with nothing typed the files open in the strip lead, since they are the likeliest sought.
  const matchedPaths =
    paths === undefined || listedPaths === undefined
      ? rankedPaths
      : leadingPaths(paths, listedPaths, filesAtHand(tasks.sidePanel, taskId), limit);

  const byRow = (row: PaletteRow) => rowScore(row, sought);
  const runCommand = (command: AppCommand) => choose(() => runAppCommand(command));
  // The tasks and the Inbox's items, which may number thousands, ranked by what their search
  // reads and drawn only once listed.
  const undrawnOf = {
    [PALETTE_FILTER.TASKS]: () => taskList,
    [PALETTE_FILTER.INBOX]: () =>
      inboxList.map(({ listed, words }) =>
        inboxRow(listed, words, {
          readerId: tasks.me,
          models: tasks.agents.models,
          tokens,
          now,
          open: (chosen) =>
            onTasks(() => tasks.inboxView.onOpenItem({ ...choiceOf(chosen), opened: true })),
        }),
      ),
  } as const;
  // Every other kind's rows in tiers, built only for the filter shown and only
  // while open: every row a tier matches ranks above the next tier's.
  const tiersOf = {
    [PALETTE_FILTER.THIS_TASK]: () => [agentRows(tasks, offerDoors, onTasks, changesPeople)],
    [PALETTE_FILTER.PEOPLE]: () => [
      peopleRows(members, tasks.me, (userId) => onTasks(() => tasks.personView.onOpen(userId))),
    ],
    [PALETTE_FILTER.AUTOMATIONS]: () => [
      automationRows(
        automations.read !== undefined && "automations" in automations.read
          ? automations.read.automations
          : [],
        tasks.workspace?.name,
        (automationId) =>
          onTasks(() =>
            tasks.automationsView.onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
          ),
      ),
    ],
    // Note that a command is found by its letters in order too, as a path is, since a command's name is typed by its first letters.
    // Note that the commands are one tier, so a query ranks them all alike, and their order
    // is what an empty field lists and what breaks a tie: the open thing's, then Go to, then the window's.
    [PALETTE_FILTER.COMMANDS]: () => [
      [
        ...copyLinkRows(links.linksAt(fromPanel), (held) => choose(() => links.copy(held))),
        ...actionRows(openThingCommands(tasks), runCommand, experiments),
        ...readMarkRows(tasks, reads, choose),
        ...agentReadMarkRows(tasks, agentReads, choose),
        ...taskPinRows(tasks, reads, choose),
        ...agentPinRows(tasks, choose),
        ...taskCommandRows(tasks, reads, renameOffer, choose, historyOffered),
        ...agentArchiveRows(openAgent, askArchive, choose),
        ...panelTabRows(tasks, onTasks),
        ...actionRows(OPEN_THING_SHOW_COMMANDS, runCommand, experiments),
        ...actionRows(OPEN_THING_LAST_COMMANDS, runCommand, experiments),
        ...actionRows(GO_TO_COMMANDS, runCommand, experiments),
        ...actionRows(WINDOW_COMMANDS, runCommand, experiments),
      ].map((row) => ({ ...row, loose: true })),
    ],
    [PALETTE_FILTER.SETTINGS]: () => [
      settingsPageRows(settings.capabilities, experiments, openPage),
      settingRows(settings.rows, land),
    ],
  } as const satisfies Record<
    Exclude<PaletteKind, keyof typeof undrawnOf | typeof PALETTE_FILTER.FILES>,
    () => readonly (readonly PaletteRow[])[]
  >;
  // Note that a file found opens through the panel's one door for a file
  // named in place: the tab it has, as it stands, or a new one at the strip's end.
  const openFile = (path: string) =>
    onTasks(() => shownOverHistory(tasks, () => tasks.sidePanel.onOpenFile({ path })));
  const rowsFor = (kind: PaletteKind): readonly PaletteRow[] => {
    if (kind === PALETTE_FILTER.FILES) {
      return (filesOpen ? matchedPaths : []).map((path) => fileRow(path, openFile));
    }
    if (kind === PALETTE_FILTER.TASKS || kind === PALETTE_FILTER.INBOX) {
      return ranked(undrawnOf[kind](), sought, limit, (row) =>
        subjectScore(row.subject, sought),
      ).map((row) => row.draw());
    }
    return tiersOf[kind]()
      .flatMap((tier) => ranked(tier, sought, limit, byRow))
      .slice(0, limit);
  };
  const kinds = PALETTE_FILTERS.filter((each): each is PaletteKind =>
    filter === PALETTE_FILTER.ALL ? each !== PALETTE_FILTER.ALL : each === filter,
  );
  // Each kind's word for its rows' absence: still reading, refused, or a line of its own.
  const noticeOf = {
    [PALETTE_FILTER.TASKS]: () => tasksNotice(tasks),
    [PALETTE_FILTER.THIS_TASK]: () => undefined,
    [PALETTE_FILTER.INBOX]: () => (inboxAsked ? inboxNotice(inboxSearch) : undefined),
    [PALETTE_FILTER.PEOPLE]: () =>
      peopleNotice(tasks, membersRead, () => {
        const workspaceId = tasks.workspace?.id;
        if (workspaceId !== undefined) retryMembers({ workspaceId });
      }),
    [PALETTE_FILTER.AUTOMATIONS]: () =>
      automationsAsked ? automationsNotice(tasks, automations) : undefined,
    [PALETTE_FILTER.FILES]: () =>
      fileQuery === undefined ? undefined : filesNotice(filesOpen, held, retryFiles),
    [PALETTE_FILTER.COMMANDS]: () => undefined,
    [PALETTE_FILTER.SETTINGS]: () => undefined,
  } as const satisfies Record<PaletteKind, () => PaletteNotice | undefined>;
  // Note that each kind's notice stands in its own group, beside the rows other kinds matched,
  // so a source that failed or is still reading is never taken for no match; under All a
  // line of a kind's own (no repository open) stays out, since that kind is simply not searched.
  const noticeFor = (kind: PaletteKind): PaletteNotice | undefined => {
    const notice = noticeOf[kind]();
    return filter === PALETTE_FILTER.ALL && notice?.kind === PALETTE_NOTICE.SAID
      ? undefined
      : notice;
  };
  const cut =
    filesOpen &&
    filter === PALETTE_FILTER.FILES &&
    held?.read === FILES_READ.LISTED &&
    held.truncated;
  // A kind's notice after its rows, or, under Files, that the listing searched was cut short.
  const noteOf = (section: PaletteSection): ReactNode =>
    section.notice !== undefined ? (
      <ReplayUnmask>
        <NoticeLine notice={section.notice} />
      </ReplayUnmask>
    ) : cut && section.kind === PALETTE_FILTER.FILES ? (
      <ReplayUnmask>{TRUNCATED_LINE}</ReplayUnmask>
    ) : undefined;
  // Every kind's rows ranked for the words sought, each group's items placed after the last.
  const rank = (): readonly CommandGroup[] => {
    const sections = kinds
      .map((kind) => ({ kind, rows: rowsFor(kind), notice: noticeFor(kind) }))
      .filter((section) => section.rows.length > 0 || section.notice !== undefined);
    let place = 0;
    const items = (rows: readonly PaletteRow[]): CommandItem[] =>
      rows.map((row) => {
        place += 1;
        return paletteItem(row, String(place), sought, tokens);
      });
    return [
      ...sections.map((section) => ({
        id: section.kind,
        label: FILTER_LABEL[section.kind],
        items: items(section.rows),
        note: noteOf(section),
      })),
    ];
  };
  // The render a key paints the field in draws the ranking already standing, and only the
  // render the words sought catch up in ranks them, so no key waits on the ranking.
  if (open) stood.current = sought === query ? rank() : stood.current;
  const band = useMemo(() => <PaletteFilters filter={filter} onFilter={setFilter} />, [filter]);

  return (
    <>
      <PaletteDialog
        open={open}
        opening={openings}
        onOpenChange={setOpen}
        placeholder={filterPlaceholder(filter)}
        groups={stood.current}
        filter={filter}
        query={query}
        onQueryChange={setQuery}
        // Note that a listing cut short is said where nothing matches too, since what was sought may lie past the cut.
        empty={cut ? `${NOTHING_MATCHES}. ${TRUNCATED_LINE}` : NOTHING_MATCHES}
        band={band}
        onKeyDown={keyDown}
        inputRef={keystrokes}
      />
      {openAgent === undefined ? null : (
        <OpenAgentArchive
          key={openAgent.id}
          agent={openAgent}
          agents={tasks.agents}
          shown={tasks.shown}
          asked={archiveAsks.agentId === openAgent.id ? archiveAsks.asked : 0}
        />
      )}
    </>
  );
}
