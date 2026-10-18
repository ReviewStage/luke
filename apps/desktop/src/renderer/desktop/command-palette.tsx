/**
 * command-palette.tsx -- ⌘K: the tasks, the open task's agents and files, every command the window can run now, and the Settings pages and settings, found by typing, in a dialog over the window.
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
 * beside it, so two tasks of one name can be told apart, and an archived
 * task says so. An agent opens its tab as the column's "+" would, hanging
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
 * It is the nearest layer while it stands: no key pressed in it goes on to
 * the window, so Escape closes the palette and nothing else, a call's reply
 * included, and no chord changes what stands behind it. Closing hands focus
 * back to whatever had it, and only then runs what was chosen, so a command
 * acts from where the developer was, as its shortcut would have. It then
 * fades out over `--duration-exit`, held by Radix's dialog through the exit
 * its `data-state` plays, and inert while it does.
 *
 * Every row's value is its place in the list, never words: cmdk writes it
 * into an attribute, which the session recording does not mask
 * (`session-replay.ts`), and two tasks may share a name. The search reads
 * each row's words instead.
 */

import { TASK_TREE_BOUNDS, TASK_TREE_ENTRY, type TaskSummary } from "@luke/features/task-wire";
import type { TaskCodeShowing, TasksTreeAnswer } from "@luke/features/tasks-view";
import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import type { HostCapability } from "@luke/settings";
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
  CHIP_LOOK,
  Chip,
  GearIcon,
  PinIcon,
  SearchIcon,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  UnpinIcon,
} from "@luke/ui";
import { memberActor, ROLE_WORDS, teammateCreator } from "@luke/ui/actor-model";
import { matchesTokens, matchRanges, searchTokens } from "@luke/ui/search-tokens";
import { orderTasks, TASK_ORDER } from "@luke/ui/task-list-model";
import { DOCUMENT_REGION, TASK_MARK } from "@luke/ui/tasks-model";
import { Command, defaultFilter } from "cmdk";
import { LinkIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark, CreatorHeard } from "../actor-ref";
import { appCommandOffered, runAppCommand, useAppCommand, useOverlayHold } from "../app-commands";
import { type CopyLink, inSidePanel, type LinkAtHand } from "../links-at-hand";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { Highlighted } from "../search-field";
import { settingsPageOf, settingsPageShown } from "../settings/pages";
import {
  landOnSettingsRow,
  resultPageWord,
  type SettingsSearchInput,
  settingsSearchEntries,
} from "../settings-search";
import { Shortcut } from "../shortcut";
import { AgentCard, agentSubject, NOTHING_HELD } from "../tasks/agent-ref";
import { useChatOn } from "../tasks/chat-gate";
import { agentTabLabel } from "../tasks/coding-agent-model";
import { FileCard, fileLook, newestFileNote } from "../tasks/file-ref";
import { refusalLine } from "../tasks/file-tab-model";
import { agentEndMark, TAB_KIND, tabLook } from "../tasks/tab-look";
import { markReadItem } from "../tasks/task-menu-items";
import { SIDE_PANEL_TABS } from "../tasks/use-side-panel";
import { type ReadMarks, useReadMarks } from "../tasks/use-task-looks";
import type { TasksControl } from "../tasks/use-tasks-tab";
import { useWorkspaceMembers } from "../tasks/use-workspace-members";
import { workRowsOf } from "../tasks/work-model";
import { Tooltip } from "../tooltip";
import { agentEntries, chatEntries, inboxEntries } from "./main-tabs";
import { changesOffers, panelEntries, taskWorkers } from "./side-panel";
import { taskOf } from "./task-actions";
import { WorkspaceRef } from "./workspace-ref";

/** The kinds of row the palette lists, each a filter of its own after All, in the order the chips stand. */
const PALETTE_FILTER = {
  ALL: "all",
  TASKS: "plans",
  AGENTS: "agents",
  PEOPLE: "people",
  FILES: "files",
  ACTIONS: "actions",
  SETTINGS: "settings",
} as const;

type PaletteFilter = (typeof PALETTE_FILTER)[keyof typeof PALETTE_FILTER];

/** A kind of row, which every filter but All is. */
type PaletteKind = Exclude<PaletteFilter, typeof PALETTE_FILTER.ALL>;

const PALETTE_FILTERS: readonly PaletteFilter[] = Object.values(PALETTE_FILTER);

/** Each filter's chip, which is also each kind's heading under All. */
const FILTER_LABEL = {
  [PALETTE_FILTER.ALL]: "All",
  [PALETTE_FILTER.TASKS]: "Tasks",
  [PALETTE_FILTER.AGENTS]: "Agents",
  [PALETTE_FILTER.PEOPLE]: "People",
  [PALETTE_FILTER.FILES]: "Files",
  [PALETTE_FILTER.ACTIONS]: "Actions",
  [PALETTE_FILTER.SETTINGS]: "Settings",
} as const satisfies Record<PaletteFilter, string>;

/** What the search field asks for under each filter. */
const FILTER_PLACEHOLDER = {
  [PALETTE_FILTER.ALL]: "Search tasks, agents, people, files, actions, and settings…",
  [PALETTE_FILTER.TASKS]: "Search tasks…",
  [PALETTE_FILTER.AGENTS]: "Search agents…",
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

/** What the Files filter says under a listing cut short at the wire's bound. */
const TRUNCATED_LINE = `Only the repository's first ${TASK_TREE_BOUNDS.MAX_RECURSIVE_ENTRIES.toLocaleString("en-US")} entries are searched.`;

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

/** What an archived task's or agent's detail says of it. */
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
  /** The mark at the row's end: a failed agent's, or a teammate's task's creator's face. */
  endMark?: React.JSX.Element | undefined;
  /** A task's creator's name, said after the detail where the query found it. */
  creator?: string | undefined;
  /** The card the row hangs beside it while the pointer rests on it: an agent's tab's. */
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
 * The least of cmdk's scores the palette counts as a match. An abbreviation
 * of a row's words ("tgsb" for Toggle sidebar) scores above it, and letters
 * scattered through unrelated words ("palette" in Permanently delete task)
 * a tenth of it.
 */
const LEAST_SCORE = 0.01;

/** cmdk's own score of the words for the query, nothing under the least the palette counts. */
function fuzzyScore(words: string, query: string): number {
  const score = defaultFilter(words, query);
  return score < LEAST_SCORE ? 0 : score;
}

/**
 * How well a row answers the query: cmdk's own score over its short words,
 * else the least score where every word of the query is in its keywords.
 * Note that the keywords are not scored by cmdk, because its scoring is
 * fuzzy and a setting's description is long enough to hold almost any
 * letters in order.
 */
function rowScore(row: PaletteRow, query: string, tokens: readonly string[]): number {
  const score = fuzzyScore(row.terms.join(" "), query);
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
  return fuzzyScore(path, query);
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
function filesNotice(repositoryOpen: boolean, held: FilesHeld | undefined): string | undefined {
  if (!repositoryOpen) return NO_REPOSITORY_LINE;
  if (held === undefined || held.read === FILES_READ.READING) return READING_LINE;
  return held.read === FILES_READ.MISSED ? held.notice : undefined;
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

/** A task's muted words: its repository, and whether it is archived. */
function taskDetail(task: TaskSummary, archived: boolean): string | undefined {
  const words = [task.repository, archived ? ARCHIVED_WORD : null].filter((word) => word !== null);
  return words.length === 0 ? undefined : words.join(" · ");
}

/**
 * Every plan, the pinned first, then the rest by their last activity
 * (`taskTime`), then the archived ones, each
 * in its tab's look, an archived one saying so in its detail. Within each,
 * the listed workspace's tasks come first and every other workspace's after
 * them, naming its workspace and found by its name, since opening one
 * switches the window to it.
 */
function taskRows(
  tasks: TasksControl,
  members: readonly WorkspaceMember[] | undefined,
  open: (taskId: string) => void,
): readonly PaletteRow[] {
  const listedId = tasks.workspace?.id;
  // Note that only the listed workspace's members are read, so another workspace's creator stands by the wire's name, never as having left.
  const creatorOf = (task: TaskSummary) =>
    teammateCreator(task, {
      members: task.workspaceId === listedId ? members : undefined,
      readerId: tasks.me,
    });
  const elsewhereOf = (task: TaskSummary): Workspace | undefined =>
    listedId === undefined || task.workspaceId === listedId
      ? undefined
      : tasks.workspaces.find((each) => each.id === task.workspaceId);
  const row = (task: TaskSummary, archived: boolean): PaletteRow => {
    const elsewhere = elsewhereOf(task);
    const creator = creatorOf(task);
    const createdBy = task.createdBy?.name ?? null;
    return {
      ...tabLook({ kind: TAB_KIND.PLAN, name: task.name }),
      detail: taskDetail(task, archived),
      workspace: elsewhere,
      endMark:
        creator === undefined ? undefined : (
          <>
            <ActorMark actor={creator} size={ACTOR_SIZE.MARK} />
            <CreatorHeard actor={creator} />
          </>
        ),
      creator: createdBy ?? undefined,
      terms: [task.name, task.repository, elsewhere?.name ?? null, createdBy].filter(
        (term) => term !== null,
      ),
      onChoose: () => open(task.id),
    };
  };
  const listedFirst = (list: readonly TaskSummary[]) => [
    ...list.filter((task) => listedId === undefined || task.workspaceId === listedId),
    ...list.filter((task) => listedId !== undefined && task.workspaceId !== listedId),
  ];
  // The pinned stand first, as the sidebar's; the rest by their last
  // activity, as the sidebar, Home's Recent, and the row's time read it.
  const standing = [
    ...tasks.tasks.filter((plan) => plan.pinnedAt !== undefined),
    ...orderTasks(
      tasks.tasks.filter((plan) => plan.pinnedAt === undefined),
      TASK_ORDER.UPDATED,
    ),
  ];
  return [
    ...listedFirst(standing).map((plan) => row(plan, false)),
    ...listedFirst(tasks.archived).map((plan) => row(plan, true)),
  ];
}

/** Shows one of the side panel's tabs, the version history put away first so the tab is not shown behind it. */
function shownOverHistory(tasks: TasksControl, show: () => void): void {
  if (tasks.history.open) tasks.history.onClose();
  show();
}

/**
 * The open task's Inbox, Chat, and coding agents, as the column's "+" lists them,
 * then its subagents and its agents' Changes tabs, as the side panel's "+"
 * lists them, then its archived agents (`archivedAgentRows`), each in its
 * row's look and words, found by its row's words, and beside the task's
 * name; none while no task is open. An agent opens as
 * its notification's click opens it, the Inbox the same way, and a
 * subagent's or a Changes tab as the "+" opens it, the version history
 * giving way to each, so none opens behind what covers it.
 */
function agentRows(
  tasks: TasksControl,
  chatOn: boolean,
  show: (pick: () => void) => void,
): readonly PaletteRow[] {
  const taskId = tasks.activeTaskId;
  if (taskId === undefined) return [];
  const taskName = [...tasks.tasks, ...tasks.archived].find((task) => task.id === taskId)?.name;
  const workers = taskWorkers(workRowsOf(tasks.work.conversation, tasks.work.callLive));
  const inbox = inboxEntries(tasks.agents, () => tasks.onShowInbox(taskId));
  const chat = chatEntries(chatOn && tasks.chatView.available, () => tasks.onShowChat(taskId));
  const agents = agentEntries(tasks.mainTabs, tasks.agents).map((entry) => ({
    ...entry,
    onPick: () => tasks.onShowAgent(taskId, entry.row.id),
  }));
  // Note that the plan's workers and Changes open in its panel, which an agent's page holds while it stands.
  const subagents = holdsTaskPanel(tasks)
    ? panelEntries({
        panel: tasks.sidePanel,
        kinds: [],
        workers,
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

/** The commands offered now, the palette's own left out, each with its chord. */
function actionRows(run: (command: AppCommand) => void): readonly PaletteRow[] {
  return LISTED_COMMANDS.filter(
    (command) =>
      command !== APP_COMMAND.COMMAND_PALETTE &&
      command !== APP_COMMAND.COPY_LINK &&
      appCommandOffered(command),
  ).map((command) => ({
    label: appCommandLabel(command),
    command: isKeyedCommand(command) ? command : undefined,
    terms: [appCommandLabel(command)],
    onChoose: () => run(command),
  }));
}

/** Whether the side panel is the open plan's, as it is but while an agent's page holds it (`use-plans-tab.ts`). */
function holdsTaskPanel(tasks: TasksControl): boolean {
  return tasks.agentView.agentId === undefined;
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
  return SIDE_PANEL_TABS.map((tab) => {
    const look = tabLook({ kind: TAB_KIND.PANEL, tab });
    const label = `Show ${look.label.toLowerCase()}`;
    const pick = () => shownOverHistory(tasks, () => tasks.sidePanel.onChoose(tab));
    return { icon: look.icon, label, terms: [label], onChoose: () => show(pick) };
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
  const { task: plan } = tasks.region;
  if (plan.id !== reads.watched) return [];
  const item = markReadItem({
    unread: reads.markedUnread(plan.id),
    onMark: (unread) => reads.mark(plan, unread),
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
 * None while no plan is looked at, nor for an archived plan, which offers
 * no pin.
 */
function taskPinRows(
  tasks: TasksControl,
  reads: ReadMarks,
  choose: (run: () => void) => void,
): readonly PaletteRow[] {
  const plan = reads.watched === undefined ? undefined : taskOf(tasks, reads.watched);
  if (plan === undefined || plan.archivedAt !== undefined) return [];
  const pinned = plan.pinnedAt !== undefined;
  const label = pinned ? "Unpin task" : "Pin task";
  const mark = pinned ? TASK_MARK.UNPIN : TASK_MARK.PIN;
  return [
    {
      icon: pinned ? <UnpinIcon /> : <PinIcon />,
      label,
      terms: [label],
      onChoose: () => choose(() => tasks.onMarkTask(plan.id, mark)),
    },
  ];
}

/**
 * Pin agent, or Unpin agent once it is pinned, for the agent whose page
 * stands, as its sidebar row's menu offers it: the reader's own pin. None
 * while no agent's page stands, nor for an archived agent, which offers no
 * pin, as an archived task's row offers none.
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
  open: (page: SettingsView) => void,
): readonly PaletteRow[] {
  return SETTINGS_PAGE_LIST.filter((page) => settingsPageShown(page, capabilities)).map((page) => {
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
 * Whether a row's creator explains why the query found it: their name holds a
 * word of the query, or the query reaches the row only with the name among
 * its words, as a loose match on the name, or one running from the task's
 * name into its creator's, does.
 */
function creatorExplains(row: PaletteRow, query: string, tokens: readonly string[]): boolean {
  const { creator } = row;
  if (creator === undefined || tokens.length === 0) return false;
  if (matchRanges(creator, tokens).length > 0) return true;
  const others = row.terms.filter((term) => term !== creator).join(" ");
  return fuzzyScore(others, query) === 0;
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
  // A task found by its creator's name says the name after its detail, so the match is in sight.
  const detail = creatorExplains(row, query, tokens)
    ? [row.detail, row.creator].filter((words) => words !== undefined).join(" · ")
    : row.detail;
  const item = (
    <Command.Item className="menu-item" value={value} onSelect={row.onChoose}>
      {row.icon === undefined ? null : <span className="menu-item-glyph">{row.icon}</span>}
      <span className="command-palette-name">
        <Highlighted text={row.label} tokens={tokens} />
      </span>
      {detail === undefined && row.workspace === undefined ? null : (
        <span className="command-palette-detail">
          {row.workspace === undefined ? null : (
            <WorkspaceRef
              workspace={row.workspace}
              name={<Highlighted text={row.workspace.name} tokens={tokens} />}
            />
          )}
          {row.workspace === undefined || detail === undefined ? null : " · "}
          {detail === undefined ? null : <Highlighted text={detail} tokens={tokens} />}
        </span>
      )}
      {/* Spoken, since a palette row is an option, which carries no
          `aria-keyshortcuts` to say the chord for it. */}
      {row.command === undefined ? null : (
        <Shortcut chord={APP_SHORTCUTS[row.command].chord} className="menu-item-hint" spoken />
      )}
      {row.endMark === undefined ? null : <span className="menu-item-end">{row.endMark}</span>}
    </Command.Item>
  );
  if (row.card === undefined) return item;
  return (
    <Tooltip label={row.label} card={row.card} cardBeside>
      {item}
    </Tooltip>
  );
}

/** The filters under the field; a press chooses one and leaves the caret in the field. */
function FilterChips({
  filter,
  onFilter,
}: {
  filter: PaletteFilter;
  onFilter: (filter: PaletteFilter) => void;
}): React.JSX.Element {
  return (
    <fieldset className="command-palette-filters" aria-label="Filter">
      {PALETTE_FILTERS.map((each) => (
        <Chip
          key={each}
          look={CHIP_LOOK.FILTER}
          aria-pressed={each === filter}
          // Note that a chip takes no focus, because the caret belongs in the
          // field and Return there opens the row chosen, not the chip.
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onFilter(each)}
        >
          {FILTER_LABEL[each]}
        </Chip>
      ))}
    </fieldset>
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
export function CommandPalette({
  available,
  tab,
  onTabChange,
  tasks: plans,
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
  // The listed workspace's members, read once for it, name a teammate's task's creator by face.
  const members = useWorkspaceMembers(plans.workspace);
  const reads = useReadMarks();
  const limit = filter === PALETTE_FILTER.ALL ? KIND_ROWS.ALL : KIND_ROWS.FILTERED;
  const taskId = plans.activeTaskId;
  const repository =
    [...plans.tasks, ...plans.archived].find((task) => task.id === taskId)?.repository ?? null;
  // The files held are the open task's repository's, or none of its.
  const held =
    files !== undefined && files.taskId === taskId && files.repository === repository
      ? files
      : undefined;
  // Note that a task's files are searched only while its panel is the one standing, which an agent's page holds otherwise.
  const filesOpen = holdsTaskPanel(plans) && taskId !== undefined && repository !== null;
  const filesAsked = open && filesOpen && (filter === PALETTE_FILTER.FILES || tokens.length > 0);

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
      plans.signedIn ? taskRows(plans, members, (id) => onTasks(() => plans.onSelect(id))) : [],
    ],
    [PALETTE_FILTER.AGENTS]: () => [agentRows(plans, chatOn, onTasks)],
    [PALETTE_FILTER.PEOPLE]: () => [
      peopleRows(members, plans.me, (userId) => onTasks(() => plans.personView.onOpen(userId))),
    ],
    [PALETTE_FILTER.FILES]: () => [],
    [PALETTE_FILTER.ACTIONS]: () => [
      [
        ...copyLinkRows(links.linksAt(fromPanel), (held) => choose(() => links.copy(held))),
        ...actionRows((command) => choose(() => runAppCommand(command))),
        ...panelTabRows(plans, onTasks),
        ...readMarkRows(plans, reads, choose),
        ...taskPinRows(plans, reads, choose),
        ...agentPinRows(plans, choose),
      ],
    ],
    [PALETTE_FILTER.SETTINGS]: () => [
      settingsPageRows(settings.capabilities, openPage),
      settingRows(settings.rows, land),
    ],
  } as const satisfies Record<PaletteKind, () => readonly (readonly PaletteRow[])[]>;
  // Note that a file found opens through the panel's one door for a file
  // named in place: the tab it has, as it stands, or a new one at the strip's end.
  const openFile = (path: string) =>
    onTasks(() => shownOverHistory(plans, () => plans.sidePanel.onOpenFile({ path })));
  const rowsFor = (kind: PaletteKind): readonly PaletteRow[] =>
    kind === PALETTE_FILTER.FILES
      ? (filesOpen ? matchedPaths : []).map((path) =>
          fileRow(path, { shown: plans.shownCode ?? [], repository }, openFile),
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
  const notice = filter === PALETTE_FILTER.FILES ? filesNotice(filesOpen, held) : undefined;
  const cut =
    filesOpen &&
    filter === PALETTE_FILTER.FILES &&
    held?.read === FILES_READ.LISTED &&
    held.truncated;
  let place = 0;

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
      <FilterChips filter={filter} onFilter={changeFilter} />
      <Command.List className="command-palette-list scroll-fade" label="Results">
        {notice === undefined ? (
          <Command.Empty className="command-palette-empty">
            <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
              Nothing matches.
            </Text>
          </Command.Empty>
        ) : (
          <div className="command-palette-empty">
            <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
              {notice}
            </Text>
          </div>
        )}
        {sections.map((section) => (
          <Command.Group key={section.kind} heading={FILTER_LABEL[section.kind]}>
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
      </Command.List>
      <PaletteFooter typed={query !== ""} />
    </Command.Dialog>
  );
}
