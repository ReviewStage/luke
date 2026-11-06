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
  experimentOn,
  HOST_CAPABILITY,
  type HostCapability,
  NO_EXPERIMENTS,
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
import { inTaskOrder } from "@repo/ui/tab-strip-model";
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
import { cardTitle } from "../tasks/tool-call-model.js";
import { type AgentsControl, type HeldPeople, readAgentById } from "../tasks/use-agents.js";
import { choiceOf } from "../tasks/use-inbox-listing.js";
import { type InboxSearch, useInboxSearch } from "../tasks/use-inbox-search.js";
import { useOpenLocal } from "../tasks/use-local-session.js";
import { SIDE_PANEL_TAB_KIND, type SidePanelControl } from "../tasks/use-side-panel.js";
import { type ReadMarks, useReadMarks } from "../tasks/use-task-looks.js";
import { useTaskOrigin } from "../tasks/use-task-origin.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { appStateQuery, selectCapability, selectExperimentChoices } from "../use-app-state.js";
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

type PaletteKind = Exclude<PaletteFilter, typeof PALETTE_FILTER.ALL>;

const PALETTE_FILTERS: readonly PaletteFilter[] = Object.values(PALETTE_FILTER);

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

function filterPlaceholder(filter: PaletteFilter): string {
  return filter === PALETTE_FILTER.ALL
    ? `Search ${PRODUCT_NAME}`
    : `Search ${FILTER_LABEL[filter].toLowerCase()}`;
}

const KIND_ROWS = {
  ALL: 5,
  FILTERED: 50,
} as const;

const FIRST_ROW = "1";

const NO_ARCHIVE_ASKS = { agentId: "", asked: 0 };

const noFocusMove = (): void => undefined;

const NOTHING_MATCHES = noMatchWords(TERM.RESULT);

const FILES_READ = {
  READING: "reading",
  LISTED: "listed",
  MISSED: "missed",
  FAILED: "failed",
} as const;

type FilesRead =
  | { read: typeof FILES_READ.READING }
  | { read: typeof FILES_READ.LISTED; paths: readonly string[]; truncated: boolean }
  | { read: typeof FILES_READ.MISSED; notice: string }
  | { read: typeof FILES_READ.FAILED };

const NO_REPOSITORY_LINE = "Open a task with a repository to search its files.";

const FILES_MISSED_LINE = "The files could not be read.";

const READING_LINE = readingWords(`the repository's ${TERM.FILE.many}`);

const TASKS_READING_LINE = readingWords(`your ${TERM.TASK.many}`);
const TASKS_FAILED_LINE = readFailedWords(`your ${TERM.TASK.many}`);

const INBOX_READING_LINE = readingWords("your inbox");
const INBOX_FAILED_LINE = "Your inbox could not be read.";

const SNIPPET_REACH = 40;

const PEOPLE_READING_LINE = readingWords(`the workspace's ${TERM.MEMBER.many}`);
const PEOPLE_FAILED_LINE = "The workspace's members could not be read.";

const AUTOMATIONS_FAILED_LINE = "Your automations could not be read.";

const PALETTE_NOTICE = {
  SAID: "said",
  READING: "reading",
  FAILED: "failed",
} as const;

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

const TRUNCATED_LINE = `Only the repository's first ${formatCount(TASK_TREE_BOUNDS.MAX_RECURSIVE_ENTRIES)} entries are searched.`;

interface FooterHint {
  chords: readonly ShortcutChord[];
  label: string;
}

const RETURN_WORD = {
  RUN: "Run",
  OPEN: VERB.OPEN,
} as const;

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

const SETTINGS_WORD = "Settings";

const ARCHIVED_WORD = "Archived";

function escapeOnly(command: KeyedCommand): boolean {
  return APP_SHORTCUTS[command].chord.key === SHORTCUT_KEY.ESCAPE;
}

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

const LISTED_COMMANDS: readonly AppCommand[] = [
  ...APP_SHORTCUT_GROUPS.flatMap((group) => group.commands).filter(
    (command) => !escapeOnly(command) && !ONE_STEP.has(command),
  ),
  APP_COMMAND.NEW_TERMINAL,
  APP_COMMAND.MARK_TASK_DONE,
  APP_COMMAND.SEND_FEEDBACK,
  ...PALETTE_COMMANDS,
];

const COPY_LINK_TERMS = ["link", "share", "url"] as const;

interface PaletteRow {
  icon?: React.ReactNode;
  label: string;
  detail?: string | undefined;
  detailShown?: boolean | undefined;
  workspace?: Workspace | undefined;
  endMark?: React.JSX.Element | undefined;
  people?: readonly string[] | undefined;
  card?: React.ReactNode;
  command?: KeyedCommand | undefined;
  terms: readonly string[];
  taskKey?: { readonly workspaceName: string; readonly number: number } | undefined;
  keywords?: readonly string[] | undefined;
  loose?: boolean | undefined;
  onChoose: () => void;
  replayMasked?: boolean | undefined;
}

type RowWords = Pick<PaletteRow, "label" | "terms" | "taskKey" | "keywords" | "loose">;

interface UndrawnRow {
  readonly subject: SearchSubject;
  readonly draw: () => PaletteRow;
}

interface PaletteSection {
  kind: PaletteKind;
  rows: readonly PaletteRow[];
  notice: PaletteNotice | undefined;
}

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

function subjectScore(subject: SearchSubject, query: string): number {
  return searchHit(subject, query)?.score ?? 0;
}

function rowScore(row: PaletteRow, query: string): number {
  return subjectScore(rowSubject(row), query);
}

function undrawnRow(words: RowWords, draw: () => Omit<PaletteRow, keyof RowWords>): UndrawnRow {
  return { subject: rowSubject(words), draw: () => ({ ...draw(), ...words }) };
}

function pathScore(path: string, query: string): number {
  const lowered = path.toLowerCase();
  for (const letter of query.toLowerCase()) {
    if (letter.trim() !== "" && !lowered.includes(letter)) return 0;
  }
  return searchHit({ label: fileName(path), lines: [path], loose: true }, query)?.score ?? 0;
}

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

function filesAtHand(
  panel: Pick<SidePanelControl, "files" | "order">,
  taskId: string | undefined,
): readonly string[] {
  const drawn = panel.files.filter((file) => file.browsedOn === taskId);
  const placed = inTaskOrder(drawn, panel.order, (file) => ({ file: file.path }));
  return [...new Set(placed.map((file) => file.path))];
}

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

function paletteFilesQueryOptions(taskId: string | undefined) {
  return taskTreeQueryOptions(taskId === undefined ? undefined : { taskId }, "", true);
}

function filesHeld(files: UseQueryResult<TasksTreeAnswer>): FilesRead | undefined {
  if (files.isFetching) return { read: FILES_READ.READING };
  if (files.isError) return filesOf(refusedAnswer(files.error));
  return files.data === undefined ? undefined : filesOf(files.data);
}

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

function tasksNotice(
  tasks: Pick<TasksControl, "signedIn" | "listRead" | "listFailed" | "onRetryList">,
): PaletteNotice | undefined {
  if (!tasks.signedIn || tasks.listRead) return undefined;
  return tasks.listFailed
    ? { kind: PALETTE_NOTICE.FAILED, line: TASKS_FAILED_LINE, onRetry: tasks.onRetryList }
    : { kind: PALETTE_NOTICE.READING, line: TASKS_READING_LINE };
}

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

function inboxNotice(search: InboxSearch): PaletteNotice | undefined {
  if (search.reading) return { kind: PALETTE_NOTICE.READING, line: INBOX_READING_LINE };
  return search.failed
    ? { kind: PALETTE_NOTICE.FAILED, line: INBOX_FAILED_LINE, onRetry: search.onRetry }
    : undefined;
}

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

function fileRow(path: string, open: (path: string) => void): PaletteRow {
  return {
    ...fileLook(path),
    replayMasked: true,
    loose: true,
    card: <FileCard path={path} />,
    onChoose: () => open(path),
  };
}

function arrowStep(event: React.KeyboardEvent, query: string): number {
  if (query !== "" || event.nativeEvent.isComposing) return 0;
  if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return 0;
  if (event.key === SHORTCUT_KEY.LEFT.key) return -1;
  if (event.key === SHORTCUT_KEY.RIGHT.key) return 1;
  return 0;
}

function steppedFilter(
  filters: readonly PaletteFilter[],
  filter: PaletteFilter,
  step: number,
): PaletteFilter {
  const at = filters.indexOf(filter);
  const count = filters.length;
  return filters[(at + step + count) % count] ?? PALETTE_FILTER.ALL;
}

const MADE_BY_WORDS: Partial<Record<Actor["kind"], string>> = {
  [ACTOR_KIND.APP]: "app",
  [ACTOR_KIND.AGENT]: "agent",
  [ACTOR_KIND.AUTOMATION]: "automation",
};

function PaletteTaskCard({
  tasks,
  task,
}: {
  tasks: TasksControl;
  task: TaskSummary;
}): React.JSX.Element {
  return homeTaskCardOf(tasks, task, useMinute());
}

function taskDetail(
  task: TaskSummary,
  repositories: readonly { readonly repository: string | null }[],
): string | undefined {
  return task.repository === null ? undefined : repositoryLabel(task.repository, repositories);
}

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
  const repositories = [
    ...new Set([
      ...tasks.tasks.map((task) => task.repository),
      ...tasks.listedAgents.standing.map((agent) => agent.repository),
      ...tasks.listedAgents.archived.map((agent) => agent.repository),
    ]),
  ].map((repository) => ({ repository }));
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
  const pinnedFirst = (rows: readonly TaskRow[]) => [
    ...rows.filter((row) => taskRowPinnedAt(row) !== undefined),
    ...orderTaskRows(rows.filter((row) => taskRowPinnedAt(row) === undefined)),
  ];
  const { standing: agents, archived: archivedAgents } = tasks.listedAgents;
  const here = [...tasks.tasks.filter(listed).map(taskRow), ...agents.map(agentRow)];
  const elsewhere = tasks.tasks.filter((task) => !listed(task)).map(taskRow);
  const archived = orderTaskRows(archivedAgents.map(agentRow));
  return [
    ...pinnedFirst(here).map((row) => rowOf(row, false)),
    ...pinnedFirst(elsewhere).map((row) => rowOf(row, false)),
    ...archived.map((row) => rowOf(row, true)),
  ];
}

function taskRowPinnedAt(row: TaskRow): number | undefined {
  return row.kind === TASK_ROW.TASK ? row.task.pinnedAt : row.agent.pinnedAt;
}

function shownOverHistory(tasks: TasksControl, show: () => void): void {
  if (tasks.history.open) tasks.history.onClose();
  show();
}

interface PanelOfferDoors {
  readonly onNewTerminal: ((agentId: string) => void) | undefined;
  readonly onNewLocal: ((agentId: string) => void) | undefined;
}

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

function agentRows(
  tasks: TasksControl,
  doors: PanelOfferDoors,
  show: (pick: () => void) => void,
  people: ReadonlyMap<string, HeldPeople>,
): readonly PaletteRow[] {
  const taskId = tasks.activeTaskId;
  if (taskId === undefined) return [];
  const taskName = tasks.tasks.find((task) => task.id === taskId)?.name;
  const waiting = tasks.listed.inbox.some((each) => each.taskId === taskId);
  const inbox = inboxEntries(tasks.agents, waiting, () => tasks.onShowInbox({ taskId }));
  const agents = agentEntries(tasks.mainTabs, tasks.agents).map((entry) => ({
    ...entry,
    onPick: () => tasks.onShowAgent(taskId, entry.row.id),
  }));
  const holder = holdsTaskPanel(tasks) ? SIDE_PANEL_HOLDER.TASK : SIDE_PANEL_HOLDER.INBOX;
  const inboxHeld = holder === SIDE_PANEL_HOLDER.INBOX;
  const pages = (inboxHeld ? tasks.inboxView.pages : tasks.pages) ?? [];
  const places = opensTaskItems(tasks)
    ? panelOffers({
        holder,
        taskId,
        panel: tasks.sidePanel,
        agents: tasks.agents,
        pages,
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
    const heading =
      row.section === ADD_SECTION.TERMINAL || row.section === ADD_SECTION.LOCAL
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
      onChoose: () => show(() => tasks.agentView.onOpen(agent.id)),
    };
  });
}

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
      detail: automation.planName === null ? trigger : `${trigger} · ${automation.planName}`,
      card: <AutomationCard automation={automation} workspaceName={workspaceName} />,
      terms: [automation.name, trigger, automation.planName].filter((term) => term !== null),
      onChoose: () => open(automation.id),
    };
  });
}

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

function inboxWords({ holder, item }: InboxListed): RowWords {
  const title = cardTitle(item.title);
  return { label: title, terms: [title, holderName(holder)], keywords: inboxItemWords(item) };
}

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

const PLACE_COMMANDS: ReadonlySet<AppCommand> = new Set([
  APP_COMMAND.HOME,
  APP_COMMAND.TASKS,
  APP_COMMAND.INBOX,
  APP_COMMAND.AUTOMATIONS,
  APP_COMMAND.SETTINGS,
  APP_COMMAND.KEYBOARD_SHORTCUTS,
  APP_COMMAND.ADMIN,
]);

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

const OWN_ROW_COMMANDS: ReadonlySet<AppCommand> = new Set([
  APP_COMMAND.PIN,
  APP_COMMAND.VERSION_HISTORY,
]);

function openThingCommands(tasks: TasksControl): readonly AppCommand[] {
  return OPEN_THING_COMMANDS.filter(
    (command) => command !== APP_COMMAND.TOGGLE_READ || tasks.inboxView.open,
  );
}

const OPEN_THING_SHOW_COMMANDS: readonly AppCommand[] = [APP_COMMAND.SHOW_TERMINAL];

const OPEN_THING_LAST_COMMANDS: readonly AppCommand[] = [APP_COMMAND.DELETE];

const OPEN_THING_ALL: ReadonlySet<AppCommand> = new Set([
  ...OPEN_THING_COMMANDS,
  ...OPEN_THING_SHOW_COMMANDS,
  ...OPEN_THING_LAST_COMMANDS,
  ...OWN_ROW_COMMANDS,
]);

const GO_TO_COMMANDS = LISTED_COMMANDS.filter((command) => PLACE_COMMANDS.has(command));

const WINDOW_COMMANDS = LISTED_COMMANDS.filter(
  (command) => !PLACE_COMMANDS.has(command) && !OPEN_THING_ALL.has(command),
);

function commandLabel(command: AppCommand, experiments: ExperimentChoices): string {
  return isKeyedCommand(command) ? shortcutLabel(command, experiments) : appCommandLabel(command);
}

function actionLabel(command: AppCommand, experiments: ExperimentChoices): string {
  const label = commandLabel(command, experiments);
  return PLACE_COMMANDS.has(command) ? `Go to ${label.toLowerCase()}` : label;
}

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

function holdsTaskPanel(tasks: TasksControl): boolean {
  return tasks.agentView.agentId === undefined && !tasks.inboxView.open;
}

function opensTaskItems(tasks: TasksControl): boolean {
  if (holdsTaskPanel(tasks)) return true;
  if (tasks.agentView.agentId !== undefined || !tasks.inboxView.open) return false;
  const { chosen } = tasks.inboxView;
  return chosen !== undefined && "taskId" in chosen && chosen.taskId === tasks.activeTaskId;
}

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

function panelTabRows(
  tasks: TasksControl,
  show: (pick: () => void) => void,
): readonly PaletteRow[] {
  if (tasks.region.kind !== DOCUMENT_REGION.READY || !holdsTaskPanel(tasks)) return [];
  const plan = openPlanStanding(tasks);
  const kinds = offeredPanelKinds(SIDE_PANEL_HOLDER.TASK);
  return kinds.map((tab) => {
    const { icon } = tabLook({ kind: TAB_KIND.PANEL, tab, plan });
    const label = `Show ${SIDE_PANEL_TAB_KIND[tab].label.toLowerCase()}`;
    const pick = () => shownOverHistory(tasks, () => tasks.sidePanel.onChoose(tab));
    return { icon, label, terms: [label], onChoose: () => show(pick) };
  });
}

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

function taskCommandRows(
  tasks: TasksControl,
  reads: ReadMarks,
  rename: OpenTaskRename | undefined,
  choose: (run: () => void) => void,
  experiments: ExperimentChoices,
): readonly PaletteRow[] {
  const task = reads.watched === undefined ? undefined : taskOf(tasks, reads.watched);
  if (task === undefined) return [];
  const renamed = rename?.taskId === task.id ? rename.begin : undefined;
  const commands: readonly { item: PanelCommand; run: () => void }[] = [
    ...(renamed === undefined ? [] : [{ item: PANEL_COMMAND.RENAME_TASK, run: renamed }]),
    ...(experimentOn(experiments, EXPERIMENT.DESCRIPTIONS)
      ? [{ item: PANEL_COMMAND.VERSION_HISTORY, run: () => tasks.history.onOpen(task.id) }]
      : []),
    {
      item: PANEL_COMMAND.NEW_CHILD_TASK,
      run: () => tasks.onNewRelatedTask(task.id, TASK_CREATE_RELATION_KIND.SUB_TASK_OF),
    },
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

function openAgentOf(tasks: TasksControl): TasklessAgent | undefined {
  const { agentId } = tasks.agentView;
  const { standing, archived } = tasks.listedAgents;
  return [...standing, ...archived].find((each) => each.id === agentId);
}

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

function OpenAgentArchive({
  agent,
  agents,
  shown,
  asked,
}: {
  agent: TasklessAgent;
  agents: AgentsControl;
  shown: boolean;
  asked: number;
}): React.JSX.Element {
  const queryClient = useQueryClient();
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

function personFound(row: PaletteRow, tokens: readonly string[]): string | undefined {
  const people = row.people ?? [];
  if (people.length === 0 || tokens.length === 0) return undefined;
  const held = (name: string) =>
    tokens.filter((token) => matchRanges(name, [token]).length > 0).length;
  const named = people.reduce((best, name) => (held(name) > held(best) ? name : best));
  return held(named) > 0 ? named : undefined;
}

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

function paletteItem(
  row: PaletteRow,
  id: string,
  query: string,
  tokens: readonly string[],
): CommandItem {
  const subject = rowSubject(row);
  const hit = searchHit(subject, query);
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
    icon: row.replayMasked === true ? <ReplayMask>{row.icon}</ReplayMask> : row.icon,
    detail: words,
    hint: end,
    card: row.card,
    replayMasked: row.replayMasked,
    words: row.label,
    onSelect: row.onChoose,
  };
}

function revealChecked(band: HTMLElement): void {
  const bar = band.querySelector<HTMLElement>('[role="radiogroup"]');
  const checked = bar?.querySelector<HTMLElement>('[aria-checked="true"]');
  if (bar === null || bar === undefined || checked === null || checked === undefined) return;
  const start = checked.offsetLeft;
  const end = start + checked.offsetWidth;
  if (start < bar.scrollLeft) bar.scrollLeft = start;
  else if (end > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = end - bar.clientWidth;
}

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

const PaletteDialog = memo(function PaletteDialog({
  opening,
  filter,
  groups,
  query,
  ...dialog
}: {
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
  const [chosenUnder, setChosenUnder] = useState({ opening, filter });
  if (chosenUnder.opening !== opening || chosenUnder.filter !== filter) {
    setChosenUnder({ opening, filter });
    setSelected(FIRST_ROW);
  }
  const runs = groups.some(
    (group) =>
      group.id === PALETTE_FILTER.COMMANDS && group.items.some((item) => item.id === selected),
  );
  return (
    <CommandDialog
      {...dialog}
      label="Command palette"
      replayUnmasked
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
  links: CopyLink;
  settings: {
    rows: SettingsSearchInput | undefined;
    capabilities: readonly HostCapability[];
    onViewChange: (view: SettingsView) => void;
  };
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const experiments =
    useQuery({ ...appStateQuery, select: selectExperimentChoices }).data ?? NO_EXPERIMENTS;
  if (open && !available) setOpen(false);
  const [filter, setFilter] = useState<PaletteFilter>(PALETTE_FILTER.ALL);
  const [openings, setOpenings] = useState(0);
  const [query, setQuery] = useState("");
  const keystrokes = useKeystrokeSpans(PANEL_SPAN.KEYSTROKE_COMMAND_PALETTE);
  const queryClient = useQueryClient();
  const [fromPanel, setFromPanel] = useState(false);
  const chosen = useRef<(() => void) | undefined>(undefined);
  const shown = useRef(false);
  const stood = useRef<readonly CommandGroup[]>([]);
  useOverlayHold(open);

  useAppCommand(
    APP_COMMAND.COMMAND_PALETTE,
    available
      ? () => {
          setFromPanel(inSidePanel(document.activeElement));
          setFilter(PALETTE_FILTER.ALL);
          setOpenings((count) => count + 1);
          setQuery("");
          void queryClient.resetQueries({
            queryKey: paletteFilesQueryOptions(tasks.activeTaskId).queryKey,
            exact: true,
          });
          setOpen(true);
        }
      : undefined,
  );

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
  const onTasks = useCallback(
    (run: () => void) =>
      choose(() => {
        onTabChange(PANEL_TAB.TASKS);
        run();
      }),
    [choose, onTabChange],
  );
  const landing = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (tab !== PANEL_TAB.SETTINGS) landing.current?.();
  }, [tab]);
  useEffect(() => () => landing.current?.(), []);
  const land = (page: SettingsView, id: string) =>
    choose(() => {
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

  const sought = useDeferredValue(open ? query : "");
  const owedReturn = useRef<string | undefined>(undefined);
  useEffect(() => {
    const owed = owedReturn.current;
    if (!open) owedReturn.current = undefined;
    if (!open || owed === undefined || sought !== query) return;
    owedReturn.current = undefined;
    if (owed !== query) return;
    const items = stood.current.flatMap((group) => group.items);
    items.find((item) => item.disabled !== true)?.onSelect();
  }, [open, sought, query]);

  const keyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
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
      event.preventDefault();
      if (pressed === APP_COMMAND.COMMAND_PALETTE) setOpen(false);
      else setFilter(steppedFilter(PALETTE_FILTERS, filter, pressed === APP_COMMAND.BACK ? -1 : 1));
    },
    [sought, query, filter],
  );

  const tokens = searchTokens(sought);
  const membersRead = useQuery(workspaceMembersQuery(tasks.workspace?.id));
  const { mutate: retryMembers } = useMutation(workspaceMembersRetryMutation());
  const originOf = useTaskOrigin();
  const members = membersRead.data?.members;
  const tasksShown =
    open && tasks.signedIn && (filter === PALETTE_FILTER.ALL || filter === PALETTE_FILTER.TASKS);
  const taskList = useMemo(
    () =>
      tasksShown
        ? taskRows(
            tasks,
            members,
            (id) => onTasks(() => tasks.onResume(id)),
            (id) => onTasks(() => tasks.agentView.onOpen(id)),
            (taskId, agentId) => onTasks(() => tasks.onShowAgent(taskId, agentId)),
            originOf,
          )
        : [],
    [tasksShown, tasks, members, onTasks, originOf],
  );
  const reads = useReadMarks();
  const renameOffer = useTaskRenameOffer();
  const agentReads = useAgentReadMarks();
  useOpenThingKeys(tasks, reads, agentReads);
  const openAgent = openAgentOf(tasks);
  const [archiveAsks, setArchiveAsks] = useState<{ agentId: string; asked: number }>(
    NO_ARCHIVE_ASKS,
  );
  const askArchive = (agentId: string) =>
    setArchiveAsks((was) => ({ agentId, asked: was.agentId === agentId ? was.asked + 1 : 1 }));
  const limit = filter === PALETTE_FILTER.ALL ? KIND_ROWS.ALL : KIND_ROWS.FILTERED;
  const openTerminal = useOpenTerminal(tasks.sidePanel, noFocusMove);
  const openLocal = useOpenLocal(tasks.sidePanel, noFocusMove);
  const offeredChanges = tasks.sidePanel.changes;
  const changesPeople = useChangesPeopleOf(
    useMemo(() => offeredChanges.map((tab) => tab.changes), [offeredChanges]),
  );
  const offerDoors: PanelOfferDoors = {
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
  const filesOpen = opensTaskItems(tasks) && taskId !== undefined && repository !== null;
  const filesAsked = open && filesOpen && (filter === PALETTE_FILTER.FILES || tokens.length > 0);
  const inboxAsked =
    open && tasks.signedIn && (filter === PALETTE_FILTER.INBOX || tokens.length > 0);
  const inboxSearch = useInboxSearch(tasks, inboxAsked);
  const inboxList = useMemo(
    () =>
      inboxAsked ? inboxSearch.items.map((listed) => ({ listed, words: inboxWords(listed) })) : [],
    [inboxAsked, inboxSearch.items],
  );
  const automationsAsked =
    open && tasks.signedIn && (filter === PALETTE_FILTER.AUTOMATIONS || tokens.length > 0);
  const automations = useAutomations(automationsAsked ? tasks.workspace?.id : undefined);
  const now = useMinute();

  const filesQuery = useQuery({ ...paletteFilesQueryOptions(taskId), enabled: filesAsked });
  const held = filesOpen ? filesHeld(filesQuery) : undefined;
  const retryFiles = () => void filesQuery.refetch();

  const paths = held?.read === FILES_READ.LISTED ? held.paths : undefined;
  const fileQuery = filter === PALETTE_FILTER.FILES || tokens.length > 0 ? sought : undefined;
  const blankFiles = fileQuery !== undefined && searchTokens(fileQuery).length === 0;
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
  const matchedPaths =
    paths === undefined || listedPaths === undefined
      ? rankedPaths
      : leadingPaths(paths, listedPaths, filesAtHand(tasks.sidePanel, taskId), limit);

  const byRow = (row: PaletteRow) => rowScore(row, sought);
  const runCommand = (command: AppCommand) => choose(() => runAppCommand(command));
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
    [PALETTE_FILTER.COMMANDS]: () => [
      [
        ...copyLinkRows(links.linksAt(fromPanel), (held) => choose(() => links.copy(held))),
        ...actionRows(openThingCommands(tasks), runCommand, experiments),
        ...readMarkRows(tasks, reads, choose),
        ...agentReadMarkRows(tasks, agentReads, choose),
        ...taskPinRows(tasks, reads, choose),
        ...agentPinRows(tasks, choose),
        ...taskCommandRows(tasks, reads, renameOffer, choose, experiments),
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
  const noteOf = (section: PaletteSection): ReactNode =>
    section.notice !== undefined ? (
      <ReplayUnmask>
        <NoticeLine notice={section.notice} />
      </ReplayUnmask>
    ) : cut && section.kind === PALETTE_FILTER.FILES ? (
      <ReplayUnmask>{TRUNCATED_LINE}</ReplayUnmask>
    ) : undefined;
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
