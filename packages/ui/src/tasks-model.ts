import type { TasklessAgent } from "@luke/features/coding-agent-wire";
import {
  LINEAR_BOUNDS,
  type LinearIssueSummary,
  linearIssueIdentifierIn,
} from "@luke/features/linear-wire";
import {
  type RepositoryPin,
  TASK_BOUNDS,
  type Task,
  type TaskSummary,
} from "@luke/features/task-wire";
import {
  type RepositoryCallFailure,
  type StartCallFailure,
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TaskActivity,
  type TasksView,
  VOICE_PHASE,
  type VoicePhase,
} from "@luke/features/tasks-view";
import type { LinearIssuesRequest, Workspace } from "@luke/features/workspace-wire";
import { LIVE_STATUS, type LiveStatus } from "@luke/live";
import { MICROPHONE_STATUS, type MicrophoneStatus } from "@luke/voice/audio";
import { microphoneAccessRow, VOICE_KEYLESS_NOTE } from "@luke/voice/microphone-access";
import type { VoiceView } from "@luke/voice/voice-view";
import { matchesTokens, searchTokens } from "./search-tokens.js";

/**
 * tasks-model.ts -- what the panel's Tasks tab draws, decided from the document and the voice view alone.
 *
 * Every decision the tab makes is here and pure, so the components only lay
 * it out: which page shows, which state the document region is in, how the
 * repository chip starts on, what a refusal about a repository says, what
 * Copy shows, and the word beside the microphone.
 */

/** How many recent repositories the chip's menu offers. */
const RECENT_REPOSITORY_LIMIT = 5;

/** Which of the Tasks tab's pages shows. */
export const TASKS_PAGE = {
  /** The tab's home, whenever no task is open: a line saying so, and New task. */
  HOME: "home",
  /** The open task's saved document and its microphone. */
  DOCUMENT: "document",
} as const;

export type TasksPage = (typeof TASKS_PAGE)[keyof typeof TASKS_PAGE];

/**
 * The page the tab shows. An open task is the document page, in every panel
 * alike, because the task open is the host's and not one panel's: it stands
 * until the developer leaves it, whatever tab or shape the panel is in.
 * With none open, the tab is the home page, which offers New task; the
 * task list is the sidebar's.
 */
export function tasksPage(view: TasksView): TasksPage {
  return view.activeTaskId === undefined ? TASKS_PAGE.HOME : TASKS_PAGE.DOCUMENT;
}

/** Which state the document region draws. */
export const DOCUMENT_REGION = {
  /** No task is open: the tab shows the list instead. */
  NONE: "none",
  READING: "reading",
  /** The saved document, read. */
  READY: "ready",
  /** The read failed and nothing is held: the failure and Try again. */
  FAILED: "failed",
  /** The task is gone. */
  MISSING: "missing",
} as const;

export type DocumentRegion =
  | { readonly kind: typeof DOCUMENT_REGION.NONE }
  | { readonly kind: typeof DOCUMENT_REGION.READING }
  | { readonly kind: typeof DOCUMENT_REGION.READY; readonly task: Task }
  | { readonly kind: typeof DOCUMENT_REGION.FAILED }
  | { readonly kind: typeof DOCUMENT_REGION.MISSING };

/**
 * The document region's state. The tab never draws a document it did not
 * read: a task is drawn only when the held document is the active task's.
 */
export function documentRegion(view: TasksView): DocumentRegion {
  const { activeTaskId, document } = view;
  if (activeTaskId === undefined) return { kind: DOCUMENT_REGION.NONE };
  if (document.status === TASKS_READ.MISSING) return { kind: DOCUMENT_REGION.MISSING };
  const task = document.task;
  if (task !== undefined && task.id === activeTaskId) return { kind: DOCUMENT_REGION.READY, task };
  if (document.status === TASKS_READ.FAILED) return { kind: DOCUMENT_REGION.FAILED };
  return { kind: DOCUMENT_REGION.READING };
}

/**
 * The repositories the account's tasks are about, the newest started task's
 * first and each once, so the chip can start on the repository the last
 * task was about and offer a few before it. The list is already newest
 * started first, and a task with no repository adds none.
 */
export function recentRepositories(tasks: TasksView["tasks"]): string[] {
  const recent: string[] = [];
  for (const task of tasks) {
    const { repository } = task;
    if (repository !== null && !recent.includes(repository)) recent.push(repository);
    if (recent.length === RECENT_REPOSITORY_LIMIT) break;
  }
  return recent;
}

/**
 * Whether a workspace's GitHub reaches a repository, as far as the window can
 * tell before the service is asked: its installation is active and on the
 * repository's owner. Since #2524 a workspace reaches only its own installation's
 * repositories, so one with no GitHub connected reaches none, whatever its
 * tasks still name. The service's read is the last word, since an
 * installation on the owner may not have been given the repository.
 */
export function workspaceReaches(
  workspace: Pick<Workspace, "github">,
  repository: string,
): boolean {
  const { github } = workspace;
  const [owner] = repository.split("/");
  return github != null && github.active && github.login.toLowerCase() === owner?.toLowerCase();
}

/**
 * The name a plan started from a Linear issue takes: the issue's title,
 * its ends trimmed and cut to a plan name's bound, or the issue's key where
 * its title is blank.
 */
export function taskNameOfIssue(issue: Pick<LinearIssueSummary, "identifier" | "title">): string {
  const title = issue.title.trim().slice(0, TASK_BOUNDS.MAX_NAME_CHARS).trim();
  return title === "" ? issue.identifier : title;
}

/** The characters a markdown link's label escapes to stay one label. */
const LABEL_SPECIAL = /[[\]\\]/gu;

/** The characters a markdown link's target encodes so it ends where it should. */
const TARGET_SPECIAL = /[()]/gu;

/**
 * The prompt a coding agent New task starts is handed: a mention of the
 * issue picked, where one was, by its key and title over its own address,
 * a Linear issue's as the app writes its link
 * (`[@ENG-1 Title](https://linear.app/…)`) and one of the workspace's own
 * over its Luke link (`[@ACME-7 Title](https://tryluke.dev/…/issue/…)`),
 * then a blank line and the words, trimmed; the issue alone where no words
 * were written, and the words alone where no issue was picked.
 */
export function agentPromptOf(
  issue: Pick<LinearIssueSummary, "identifier" | "title" | "url"> | undefined,
  words: string,
): string {
  const said = words.trim();
  if (issue === undefined) return said;
  const name = `${issue.identifier} ${issue.title.trim()}`.trim();
  const label = `@${name}`.replace(LABEL_SPECIAL, (special) => `\\${special}`);
  const target = issue.url.replace(TARGET_SPECIAL, (special) => (special === "(" ? "%28" : "%29"));
  const mention = `[${label}](${target})`;
  return said === "" ? mention : `${mention}\n\n${said}`;
}

/** How many of a workspace's Linear issues New task offers under its name field at once. */
export const ISSUE_MATCH_LIMIT = 6;

/** What New task asks a workspace's Linear for beyond the issues it listed: the one issue a key or link names, or a search. */
export type LinearIssuesAsk = Omit<LinearIssuesRequest, "workspaceId">;

/**
 * What New task asks Linear for, for the name as typed: the one issue a key
 * or a link to it names, which a search may not find, or a search over
 * every issue for any other words; nothing for a blank name, which the
 * issues listed as the card opened answer.
 */
export function linearIssuesAskOf(typed: string): LinearIssuesAsk | undefined {
  const words = typed.trim();
  if (words === "") return undefined;
  const identifier = linearIssueIdentifierIn(words);
  return identifier === undefined
    ? { query: words.slice(0, LINEAR_BOUNDS.MAX_QUERY_CHARS) }
    : { identifier };
}

/** How near an issue Linear found for the words, though neither its title nor its key holds them all, stands: after every one that does. */
const FOUND_ELSEWHERE = 3;

/**
 * How closely an issue answers what was typed, nearest first: its key or
 * its number typed whole, or a link to it pasted, then every word typed at
 * the start of a word of its title, then every word anywhere in its title or
 * key, then words Linear's search found elsewhere in it.
 */
function issueNearness(
  issue: Pick<LinearIssueSummary, "identifier" | "title">,
  tokens: readonly string[],
  named: string | undefined,
): number {
  if (issue.identifier === named) return 0;
  if (!matchesTokens([issue.title, issue.identifier], tokens)) return FOUND_ELSEWHERE;
  const key = issue.identifier.toLowerCase();
  const number = key.slice(key.lastIndexOf("-") + 1);
  if (tokens.some((token) => token === key || token === number)) return 0;
  const words = issue.title.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  if (tokens.every((token) => words.some((word) => word.startsWith(token)))) return 1;
  return 2;
}

/**
 * The issues New task offers for the name typed so far, at most
 * `ISSUE_MATCH_LIMIT` of them: those listed whose title or key holds every
 * word typed, case aside, and every issue Linear answered for the words
 * (`found`: what its search matched, or the one issue a key or link names),
 * each once, nearest first and otherwise listed first; none for a blank
 * name, which leaves the field a plain name.
 */
export function offeredIssues<Issue extends Pick<LinearIssueSummary, "identifier" | "title">>(
  listed: readonly Issue[],
  typed: string,
  found: readonly Issue[] = [],
): readonly Issue[] {
  const tokens = searchTokens(typed);
  if (tokens.length === 0) return [];
  const named = linearIssueIdentifierIn(typed);
  const foundKeys = new Set(found.map((issue) => issue.identifier));
  const once = new Map<string, Issue>();
  for (const issue of [...listed, ...found]) {
    if (!once.has(issue.identifier)) once.set(issue.identifier, issue);
  }
  return [...once.values()]
    .filter(
      (issue) =>
        foundKeys.has(issue.identifier) || matchesTokens([issue.title, issue.identifier], tokens),
    )
    .map((issue, order) => ({ issue, order, nearness: issueNearness(issue, tokens, named) }))
    .sort((first, second) => first.nearness - second.nearness || first.order - second.order)
    .slice(0, ISSUE_MATCH_LIMIT)
    .map(({ issue }) => issue);
}

/**
 * The other workspace a task's repository belongs to, where its own
 * workspace's GitHub does not reach it and one of the account's other
 * workspaces' does: the task stranded there by #2524, which moving it to
 * that workspace mends. None for a task with no repository, one its own
 * workspace reaches, or one no workspace of the account's reaches.
 */
export function strandedTaskHome(
  task: Pick<TaskSummary, "workspaceId" | "repository">,
  workspaces: readonly Workspace[],
): Workspace | undefined {
  const { repository } = task;
  if (repository === null) return undefined;
  const own = workspaces.find((workspace) => workspace.id === task.workspaceId);
  if (own === undefined || workspaceReaches(own, repository)) return undefined;
  return workspaces.find(
    (workspace) => workspace.id !== task.workspaceId && workspaceReaches(workspace, repository),
  );
}

/** The page of a repository on GitHub, which Open on GitHub opens. */
export function repositoryPageUrl(repository: string): string {
  return `https://github.com/${repository}`;
}

/**
 * The picture of a GitHub account by its login, an organization's logo or a
 * person's avatar: asked of github.com, which redirects to the picture's
 * address, because the picture host answers an organization's name with
 * GitHub's default face. Asked at twice the largest size it is drawn, for a
 * Retina screen.
 */
export function githubAccountPictureUrl(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}.png?size=32`;
}

/** The picture of a repository's owner on GitHub, which is drawn wherever a repository is named or picked. */
export function repositoryOwnerPictureUrl(repository: string): string {
  return githubAccountPictureUrl(repository.slice(0, repository.indexOf("/")));
}

/** What the New task dialog says when the service answered no task. */
const START_FAILED_NOTE = "Luke's service could not be reached. Try again.";

/** What a call that named a repository says when the service refused it, by its reason. */
const REPOSITORY_FAILURE_NOTES = {
  [TASK_CALL_FAILURE.UNANSWERED]: START_FAILED_NOTE,
  [TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]:
    "Luke can't see that repository on GitHub. Choose which repositories Luke can see, then try again.",
} as const satisfies Record<RepositoryCallFailure, string>;

/** The sentence the page shows for a start or a repository change the service refused. */
export function repositoryFailureNote(failure: RepositoryCallFailure): string {
  return REPOSITORY_FAILURE_NOTES[failure];
}

/** What a start from a Linear issue says when the workspace's Linear could not be read for it. */
const LINEAR_START_FAILED_NOTE =
  "Linear is not connected to this workspace, or it stopped answering. An owner or admin can connect it.";

/** What a start from one of the workspace's issues says when the issue is gone, or is another workspace's. */
const ISSUE_START_FAILED_NOTE = "That issue is gone, or it belongs to another workspace.";

/** The sentence the page shows for a start the service refused, by its reason. */
export function startFailureNote(failure: StartCallFailure): string {
  if (failure === TASK_CALL_FAILURE.LINEAR_UNAVAILABLE) return LINEAR_START_FAILED_NOTE;
  if (failure === TASK_CALL_FAILURE.NOT_FOUND) return ISSUE_START_FAILED_NOTE;
  return repositoryFailureNote(failure);
}

/** What a task's name says, where it was edited, when the service refused the rename. */
export const RENAME_FAILED_NOTE = "The task could not be renamed. Try again.";

/** The names given to tasks that main's view has yet to carry, by task id. */
export type PendingRenames = ReadonlyMap<string, string>;

/** The name the view gives a task: its row's in the list, else the open document's. */
function viewedName(view: TasksView, taskId: string): string | undefined {
  const listed = view.tasks.find((task) => task.id === taskId);
  if (listed !== undefined) return listed.name;
  const held = view.document.task;
  return held?.id === taskId ? held.name : undefined;
}

/** The view with each pending name drawn in place of the one it replaces, in the list and on the open document alike. */
export function renamedView(view: TasksView, renames: PendingRenames): TasksView {
  if (renames.size === 0) return view;
  const named = <Named extends { id: string; name: string }>(task: Named): Named => {
    const name = renames.get(task.id);
    return name === undefined ? task : { ...task, name };
  };
  const held = view.document.task;
  return {
    ...view,
    tasks: view.tasks.map(named),
    document: held === undefined ? view.document : { ...view.document, task: named(held) },
  };
}

/**
 * The pending names the view still contradicts. One the view now carries
 * has landed, and one of a task the view no longer holds has nothing left
 * to name, so both are let go.
 */
export function unsettledRenames(renames: PendingRenames, view: TasksView): PendingRenames {
  const unsettled = [...renames].filter(([taskId, name]) => {
    const viewed = viewedName(view, taskId);
    return viewed !== undefined && viewed !== name;
  });
  return unsettled.length === renames.size ? renames : new Map(unsettled);
}

/** What a press of the task menu does to a task's place: pins it or unpins it, archives it or brings it back. */
export const TASK_MARK = {
  PIN: "pin",
  UNPIN: "unpin",
  ARCHIVE: "archive",
  UNARCHIVE: "unarchive",
} as const;

export type TaskMark = (typeof TASK_MARK)[keyof typeof TASK_MARK];

/** What the toast says when the service refused a pin or an archive, by what was asked. */
export const MARK_FAILED_NOTES = {
  [TASK_MARK.PIN]: "The task could not be pinned. Try again.",
  [TASK_MARK.UNPIN]: "The task could not be unpinned. Try again.",
  [TASK_MARK.ARCHIVE]: "The task could not be archived. Try again.",
  [TASK_MARK.UNARCHIVE]: "The task could not be unarchived. Try again.",
} as const satisfies Record<TaskMark, string>;

/**
 * What the toast says once an archive, or its undoing, landed, and the mark
 * its Undo asks for. A pin says nothing, since the row it moves is in sight.
 */
export const MARK_UNDOS = {
  [TASK_MARK.ARCHIVE]: { note: "Task archived", undo: TASK_MARK.UNARCHIVE },
  [TASK_MARK.UNARCHIVE]: { note: "Task unarchived", undo: TASK_MARK.ARCHIVE },
} as const satisfies Partial<Record<TaskMark, { note: string; undo: TaskMark }>>;

/**
 * What the toast says once a repository's tasks were archived together, by
 * how many the service kept and how many it refused; one task says what an
 * archive of one says.
 */
export function archivedTasksNote(landed: number, refused: number): string {
  const kept = landed === 1 ? MARK_UNDOS[TASK_MARK.ARCHIVE].note : `${landed} tasks archived`;
  return refused === 0 ? kept : `${kept}, ${refused} could not be`;
}

/** What the toast says when the service refused every task of a repository's Archive tasks. */
export function archiveTasksFailedNote(refused: number): string {
  return refused === 1
    ? MARK_FAILED_NOTES[TASK_MARK.ARCHIVE]
    : "The tasks could not be archived. Try again.";
}

/**
 * Whether archiving the tasks asks first: any of them has a coding agent
 * not yet archived, which the archive stops and archives with it. A task
 * whose agents the list has yet to read asks nothing, as one with none.
 */
export function archiveAsks(tasks: readonly Pick<TaskSummary, "agents">[]): boolean {
  return tasks.some((task) => (task.agents?.total ?? 0) > 0);
}

/** A task's pin and archive as the list carries them, each only where it stands. */
type MarkStamps = Pick<TaskSummary, "pinnedAt" | "archivedAt">;

/** A pin or an archive given to a task that main's view has yet to carry: the instant it was asked, or null for one taken away. */
export interface PendingMark {
  readonly pinnedAt?: number | null;
  readonly archivedAt?: number | null;
}

/** The pins and archives given to tasks that main's view has yet to carry, by task id. */
export type PendingMarks = ReadonlyMap<string, PendingMark>;

/** The pending stamps a press asks for, made at `at`. */
export function pendingMark(mark: TaskMark, at: number): PendingMark {
  switch (mark) {
    case TASK_MARK.PIN:
      return { pinnedAt: at };
    case TASK_MARK.UNPIN:
      return { pinnedAt: null };
    case TASK_MARK.ARCHIVE:
      return { archivedAt: at };
    case TASK_MARK.UNARCHIVE:
      return { archivedAt: null };
  }
}

/**
 * A stamp after a pending change: none asked leaves the one standing, null
 * takes it away, and an instant stands only where none already does, so a
 * task pinned twice keeps its place among the pinned.
 */
function stampAfter(standing: number | undefined, asked: number | null | undefined) {
  if (asked === undefined) return standing;
  if (asked === null) return undefined;
  return standing ?? asked;
}

/** A row or the open document with its pending pin and archive drawn in place of what it carries; an unpin takes the pin's place with it. */
function marked<Row extends TaskSummary>(
  row: Row,
  mark: PendingMark | undefined,
): Omit<Row, keyof MarkStamps | "pinPosition"> & MarkStamps & Pick<TaskSummary, "pinPosition"> {
  const { pinnedAt, pinPosition, archivedAt, ...rest } = row;
  const pinned = stampAfter(pinnedAt, mark?.pinnedAt);
  const archived = stampAfter(archivedAt, mark?.archivedAt);
  return {
    ...rest,
    ...(pinned === undefined ? undefined : { pinnedAt: pinned }),
    ...(pinned === undefined || pinPosition === undefined ? undefined : { pinPosition }),
    ...(archived === undefined ? undefined : { archivedAt: archived }),
  };
}

/** The view with each pending pin and archive drawn in place, in the list and on the open document alike. */
export function markedView(view: TasksView, marks: PendingMarks): TasksView {
  if (marks.size === 0) return view;
  const held = view.document.task;
  return {
    ...view,
    tasks: view.tasks.map((task) => marked(task, marks.get(task.id))),
    document:
      held === undefined
        ? view.document
        : { ...view.document, task: marked(held, marks.get(held.id)) },
  };
}

/** Whether the view carries every stamp a pending mark asks for: each standing where it is asked, and gone where it is taken away. */
function markLanded(row: MarkStamps, mark: PendingMark): boolean {
  const pinLanded =
    mark.pinnedAt === undefined || (mark.pinnedAt === null) === (row.pinnedAt === undefined);
  const archiveLanded =
    mark.archivedAt === undefined || (mark.archivedAt === null) === (row.archivedAt === undefined);
  return pinLanded && archiveLanded;
}

/**
 * The pending marks the view still contradicts. One the view now carries
 * has landed, and one of a task the view no longer holds has nothing left
 * to mark, so both are let go.
 */
export function unsettledMarks(marks: PendingMarks, view: TasksView): PendingMarks {
  const unsettled = [...marks].filter(([taskId, mark]) => {
    const held = view.document.task;
    const viewed =
      view.tasks.find((task) => task.id === taskId) ?? (held?.id === taskId ? held : undefined);
    return viewed !== undefined && !markLanded(viewed, mark);
  });
  return unsettled.length === marks.size ? marks : new Map(unsettled);
}

/** What the toast says when the service refused a repository's pin, by whether it was a pin or an unpin. */
export const REPOSITORY_PIN_FAILED_NOTES = {
  PIN: "The repository could not be pinned. Try again.",
  UNPIN: "The repository could not be unpinned. Try again.",
} as const;

/** A repository pinned or unpinned here that main's view has yet to carry: which, and the instant it was asked. */
export interface PendingRepositoryPin {
  readonly pinned: boolean;
  readonly at: number;
}

/** The repository pins given here that main's view has yet to carry, by repository. */
export type PendingRepositoryPins = ReadonlyMap<string, PendingRepositoryPin>;

/**
 * The repositories the sidebar draws pinned, newest pinned first: the pins
 * main's view carries, with every pin and unpin given here and not yet
 * carried drawn over them, so a press moves its group at once.
 */
export function pinnedRepositories(
  pins: readonly RepositoryPin[] | undefined,
  pending: PendingRepositoryPins,
): readonly string[] {
  const standing = (pins ?? []).filter((pin) => pending.get(pin.repository)?.pinned !== false);
  const added = [...pending]
    .filter(
      ([repository, pin]) => pin.pinned && !standing.some((each) => each.repository === repository),
    )
    .map(([repository, pin]) => ({ repository, pinnedAt: pin.at }));
  return [...added, ...standing]
    .sort((a, b) => b.pinnedAt - a.pinnedAt)
    .map((pin) => pin.repository);
}

/** The pending repository pins the view still contradicts; one it now carries has landed and is let go. */
export function unsettledRepositoryPins(
  pending: PendingRepositoryPins,
  pins: readonly RepositoryPin[] | undefined,
): PendingRepositoryPins {
  const unsettled = [...pending].filter(
    ([repository, pin]) =>
      (pins ?? []).some((each) => each.repository === repository) !== pin.pinned,
  );
  return unsettled.length === pending.size ? pending : new Map(unsettled);
}

/** What the toast says when the service refused an agent's pin, by whether it was a pin or an unpin. */
export const AGENT_PIN_FAILED_NOTES = {
  PIN: "The agent could not be pinned. Try again.",
  UNPIN: "The agent could not be unpinned. Try again.",
} as const;

/** An agent with no plan pinned or unpinned here that main's view has yet to carry: which, and the instant it was asked. */
interface PendingAgentPin {
  readonly pinned: boolean;
  readonly at: number;
}

/** The agent pins given here that main's view has yet to carry, by agent. */
export type PendingAgentPins = ReadonlyMap<string, PendingAgentPin>;

/**
 * The agents with no plan as the sidebar draws them: every pin and unpin
 * given here and not yet carried drawn over the pin main's view carries, so
 * a press moves the agent's row at once, as a plan's pin does. A pin
 * already carried keeps its instant, as the service keeps it.
 */
export function agentsPinned(
  agents: readonly TasklessAgent[],
  pending: PendingAgentPins,
): readonly TasklessAgent[] {
  if (pending.size === 0) return agents;
  return agents.map((agent) => {
    const pin = pending.get(agent.id);
    if (pin === undefined) return agent;
    const { pinnedAt, ...unpinned } = agent;
    return pin.pinned ? { ...unpinned, pinnedAt: pinnedAt ?? pin.at } : unpinned;
  });
}

/** The pending agent pins the view still contradicts; one it now carries has landed, and one of an agent it no longer lists is let go. */
export function unsettledAgentPins(
  pending: PendingAgentPins,
  agents: readonly TasklessAgent[],
): PendingAgentPins {
  const unsettled = [...pending].filter(([agentId, pin]) => {
    const agent = agents.find((each) => each.id === agentId);
    return agent !== undefined && (agent.pinnedAt !== undefined) !== pin.pinned;
  });
  return unsettled.length === pending.size ? pending : new Map(unsettled);
}

/** What the toast says when the service refused a pin's new place, which is put back. */
export const PIN_MOVE_FAILED_NOTE = "The pin could not be moved. Try again.";

/** One pin dragged to a new place in the sidebar's Pinned section: a plan's or an agent's with no plan, and the position it takes (`@luke/features/pin-order`). */
export interface PinMove {
  readonly agent: boolean;
  readonly id: string;
  readonly position: string;
}

/** A place a drag here gave a pin: the position, and whether the service has answered the write. */
interface PendingPinPosition {
  readonly position: string;
  readonly answered: boolean;
}

/** Where pins dragged here stand until main's view carries them, by the plan's or the agent's id. */
export type PendingPinPositions = ReadonlyMap<string, PendingPinPosition>;

/** A row of the list with the place a drag here gave its pin drawn over the one it carries. */
function placed<Row extends { readonly id: string; readonly pinPosition?: string }>(
  row: Row,
  pending: PendingPinPositions,
): Row {
  const place = pending.get(row.id);
  return place === undefined ? row : { ...row, pinPosition: place.position };
}

/** The view with each pin dragged here drawn at its new place, the plans' and the agents' with no plan alike, so a drop stands at once. */
export function positionedView(view: TasksView, pending: PendingPinPositions): TasksView {
  if (pending.size === 0) return view;
  const agents = view.tasklessAgents;
  return {
    ...view,
    tasks: view.tasks.map((task) => placed(task, pending)),
    ...(agents === undefined
      ? undefined
      : { tasklessAgents: agents.map((agent) => placed(agent, pending)) }),
  };
}

/**
 * The dragged places the view still contradicts. One it now carries has
 * landed, one of a pin it no longer holds has nothing left to place, and one
 * the service already answered is let go too, since the host wrote what it
 * answered before it answered: a view that still differs is newer word, a
 * drag on another Mac since, which the pin then follows.
 */
export function unsettledPinPositions(
  pending: PendingPinPositions,
  view: TasksView,
): PendingPinPositions {
  const rows: readonly {
    readonly id: string;
    readonly pinnedAt?: number;
    readonly pinPosition?: string;
  }[] = [...view.tasks, ...(view.tasklessAgents ?? [])];
  const unsettled = [...pending].filter(([id, place]) => {
    const row = rows.find((each) => each.id === id);
    return !place.answered && row?.pinnedAt !== undefined && row.pinPosition !== place.position;
  });
  return unsettled.length === pending.size ? pending : new Map(unsettled);
}

/** The tasks the sidebar lists, each in its place. */
export interface SidebarTasks {
  /** The pinned tasks, newest pinned first. */
  readonly pinned: readonly TaskSummary[];
  /** The rest, as the service lists them: newest started first. */
  readonly rest: readonly TaskSummary[];
  /** The archived tasks, newest archived first, whether or not they are pinned. */
  readonly archived: readonly TaskSummary[];
}

/**
 * The account's tasks sorted into the sidebar's places, the pinned ones
 * newest pinned first until the Pinned section orders them with the rest of
 * its pins (`@luke/features/pin-order`). Note that an
 * archived task is drawn only among the archived, pinned or not, because its
 * pin is kept for when it is brought back rather than shown while it is away.
 */
export function sidebarTasks(tasks: readonly TaskSummary[]): SidebarTasks {
  const archived = tasks
    .filter((task) => task.archivedAt !== undefined)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  const standing = tasks.filter((task) => task.archivedAt === undefined);
  const pinned = standing
    .filter((task) => task.pinnedAt !== undefined)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
  const rest = standing.filter((task) => task.pinnedAt === undefined);
  return { pinned, rest, archived };
}

/** The status word beside the microphone for a call, or nothing where none stands. */
const STATUS_WORD = {
  [LIVE_STATUS.UNAVAILABLE]: undefined,
  [LIVE_STATUS.IDLE]: undefined,
  [LIVE_STATUS.CONNECTING]: "Connecting",
  [LIVE_STATUS.MUTED]: "Muted",
  [LIVE_STATUS.LISTENING]: "Listening",
  [LIVE_STATUS.SPEAKING]: "Luke speaking",
  [LIVE_STATUS.CLOSING]: "Closing",
  [LIVE_STATUS.FAILED]: undefined,
} as const satisfies Record<LiveStatus, string | undefined>;

/** The voice's word for each of its waits the service names, in place of the call's own. */
const VOICE_PHASE_WORD = {
  [VOICE_PHASE.HANDING_OFF]: "Handing off",
  [VOICE_PHASE.ABOUT_TO_ANSWER]: "About to answer",
} as const satisfies Record<VoicePhase, string>;

/** The statuses whose own word gives way to the voice's wait: Luke is not speaking, and the call is not opening or closing. */
const VOICE_PHASE_SHOWN: ReadonlySet<LiveStatus> = new Set([
  LIVE_STATUS.MUTED,
  LIVE_STATUS.LISTENING,
]);

/**
 * The open task's call as the microphone row draws it: the voice's word, and
 * the backend's line, which is the brain while it works, with its
 * pending command where it has one, and whether the notetaker is writing.
 */
export interface CallStatus {
  voiceWord: string;
  backend: { brain: { action: string | undefined } | undefined; notes: boolean };
}

/**
 * The microphone row's two lines while a call stands about the open task,
 * and nothing otherwise. A voice error or notice is not repeated here, since
 * the panel's own strip already carries it under the shape, exactly as it
 * does for any call. The voice line is the call's status, except that a
 * listening or muted call reads the wait the service says the voice is in;
 * speaking, connecting, and closing keep their own word, since each says
 * more. The backend line is each backend part's own, so neither stands in
 * for the voice.
 */
export function callStatus(
  view: Pick<VoiceView, "voiceStatus" | "callTaskId">,
  tasks: Pick<TasksView, "activeTaskId" | "activity">,
): CallStatus | undefined {
  const { activeTaskId, activity } = tasks;
  if (activeTaskId === undefined || view.callTaskId !== activeTaskId) return undefined;
  return standingCallStatus(view, activity);
}

/**
 * The standing call's two lines whichever task it is about, read off that
 * call's own activity: the call bar's words, which the call card draws in
 * the same bar while the call's task is off screen.
 */
export function standingCallStatus(
  view: Pick<VoiceView, "voiceStatus">,
  activity: TaskActivity | undefined,
): CallStatus | undefined {
  const word = STATUS_WORD[view.voiceStatus];
  if (word === undefined) return undefined;
  const phase = VOICE_PHASE_SHOWN.has(view.voiceStatus) ? activity?.voice : undefined;
  const brain = activity?.planner;
  return {
    voiceWord: phase === undefined ? word : VOICE_PHASE_WORD[phase],
    backend: {
      brain: brain === undefined ? undefined : { action: brain.action },
      notes: activity?.notes ?? false,
    },
  };
}

/** What the microphone button does when pressed. */
export const MICROPHONE_PRESS = {
  /** Nothing: voice cannot run, or no task is open. */
  NONE: "none",
  /** Raises macOS's own microphone prompt. */
  ASK_ACCESS: "ask-access",
  /** Opens System Settings, the one place a denial can be changed. */
  OPEN_SETTINGS: "open-settings",
  /** Talks to Luke about the open task: opens the task's call and hears it, or toggles its microphone. */
  TALK: "talk",
} as const;

type MicrophonePress = (typeof MICROPHONE_PRESS)[keyof typeof MICROPHONE_PRESS];

export interface MicrophoneButton {
  readonly press: MicrophonePress;
  /** The button's name for a reader and its hover. */
  readonly label: string;
  /** Whether the open task's call stands with the developer not heard, which the button draws struck through. */
  readonly muted: boolean;
}

/** What the microphone button says on an archived task, which no call is about. */
const ARCHIVED_CALL_LABEL = "Unarchive the task to talk about it";

/** The statuses of a call that has a session, the ones whose microphone is either heard or muted. */
const CALL_STANDING: ReadonlySet<LiveStatus> = new Set([
  LIVE_STATUS.MUTED,
  LIVE_STATUS.LISTENING,
  LIVE_STATUS.SPEAKING,
]);

/**
 * The microphone button, from what voice can run on and which task is open.
 * The microphone permission comes first, on the panel's own rules, because a
 * press that cannot be heard is no press; then the task, since a call is
 * always about the open task. The press toggles: while the developer is
 * heard on this task's own call it mutes, and otherwise it opens the task's
 * call or hears it again, hanging up another task's first,
 * which is also how a call that failed or was lost is tried again. Muted is
 * this task's own call standing with the developer not heard, so the button
 * says so rather than reading as a call not yet begun. An archived task
 * opens no call, so its press is none until it is brought back; a call of
 * its own still standing, which only a race leaves, is still muted and
 * heard again.
 */
export function microphoneButton(input: {
  voiceAvailable: boolean;
  microphoneStatus: MicrophoneStatus;
  activeTaskId: string | undefined;
  /** Whether the open task is archived. */
  archived: boolean;
  listening: boolean;
  /** The task the standing call is about, as the voice window reports it. */
  callTaskId: string | undefined;
  voiceStatus: LiveStatus;
}): MicrophoneButton {
  if (!input.voiceAvailable) {
    return { press: MICROPHONE_PRESS.NONE, label: VOICE_KEYLESS_NOTE, muted: false };
  }
  const row = microphoneAccessRow({ voiceAvailable: true, status: input.microphoneStatus });
  if (row.offerAccess) {
    return { press: MICROPHONE_PRESS.ASK_ACCESS, label: "Allow the microphone", muted: false };
  }
  if (input.microphoneStatus === MICROPHONE_STATUS.DENIED) {
    return {
      press: MICROPHONE_PRESS.OPEN_SETTINGS,
      label: "Allow the microphone in System Settings",
      muted: false,
    };
  }
  if (!row.ready) {
    return { press: MICROPHONE_PRESS.NONE, label: row.detail ?? VOICE_KEYLESS_NOTE, muted: false };
  }
  if (input.activeTaskId === undefined) {
    return { press: MICROPHONE_PRESS.NONE, label: "Open a task to talk about it", muted: false };
  }
  const ownCall = input.callTaskId === input.activeTaskId;
  if (ownCall && input.listening) {
    return { press: MICROPHONE_PRESS.TALK, label: "Mute the microphone", muted: false };
  }
  if (ownCall && CALL_STANDING.has(input.voiceStatus)) {
    return { press: MICROPHONE_PRESS.TALK, label: "Unmute the microphone", muted: true };
  }
  if (input.archived) {
    return { press: MICROPHONE_PRESS.NONE, label: ARCHIVED_CALL_LABEL, muted: false };
  }
  return { press: MICROPHONE_PRESS.TALK, label: "Talk about this task", muted: false };
}
