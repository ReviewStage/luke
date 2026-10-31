import {
  TASK_STATUS,
  type Task,
  type TaskStatus,
  type TaskSummary,
} from "@luke/features/task-wire";
import {
  type RepositoryCallFailure,
  type StartCallFailure,
  TASK_CALL_FAILURE,
  TASK_PARENT_FAILURE,
  TASKS_READ,
  type TasksView,
} from "@luke/features/tasks-view";
import type { Workspace } from "@luke/features/workspace-wire";

/**
 * tasks-model.ts -- what the panel's Tasks tab draws, decided from the document alone.
 *
 * Every decision the tab makes is here and pure, so the components only lay
 * it out: which page shows, which state the document region is in, how the
 * repository chip starts on, what a refusal about a repository says, and
 * what Copy shows.
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

/** What the New task dialog says when the service answered no task, beside its Retry. */
const START_FAILED_NOTE = "Luke's service did not answer.";

/** What a call that named a repository says when the service refused it, by its reason, beside a Retry. */
const REPOSITORY_FAILURE_NOTES = {
  [TASK_CALL_FAILURE.UNANSWERED]: START_FAILED_NOTE,
  [TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]:
    "Luke cannot see that repository on GitHub. Choose which repositories Luke can see.",
} as const satisfies Record<RepositoryCallFailure, string>;

/** The same refusals of a change of the task's repository, said under its chip with no Retry beside them. */
const REPOSITORY_CHANGE_FAILURE_NOTES = {
  [TASK_CALL_FAILURE.UNANSWERED]: "Luke's service did not answer. Try again.",
  [TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]:
    "Luke cannot see that repository on GitHub. Choose which repositories Luke can see, then try again.",
} as const satisfies Record<RepositoryCallFailure, string>;

/** The sentence the page shows beside its Retry for a start or a read of repositories the service refused. */
export function repositoryFailureNote(failure: RepositoryCallFailure): string {
  return REPOSITORY_FAILURE_NOTES[failure];
}

/** The sentence the page shows for a change of the task's repository the service refused. */
export function repositoryChangeFailureNote(failure: RepositoryCallFailure): string {
  return REPOSITORY_CHANGE_FAILURE_NOTES[failure];
}

/** What a start says when the device it named for the task's agents would not take them, where the page knows no more of why. */
const DEVICE_START_FAILED_NOTE =
  "That device can't take this task's agents right now. Choose another, or Cloud.";

/** What a start says when the workspace it named is gone, or no longer the account's, or the task it was to relate to is neither. */
const RELATION_START_FAILED_NOTE =
  "That workspace or task is gone, or you're no longer a member of the workspace.";

/** What a start says when it named another repository than the one the task it joins a tree with works in. */
const TREE_REPOSITORY_START_FAILED_NOTE =
  "A task works in its tree's repository, so the two must share one.";

/** What a start says when the task it was to be the parent of has a parent already. */
const PARENT_HELD_START_FAILED_NOTE = "That task already has a parent. Choose another relation.";

/** The sentence the page shows for a start the service refused, by its reason. */
export function startFailureNote(failure: StartCallFailure): string {
  switch (failure) {
    case TASK_CALL_FAILURE.NOT_FOUND:
      return RELATION_START_FAILED_NOTE;
    case TASK_CALL_FAILURE.LOCAL_AGENT_REFUSED:
      return DEVICE_START_FAILED_NOTE;
    case TASK_PARENT_FAILURE.REPOSITORY_DIFFERS:
      return TREE_REPOSITORY_START_FAILED_NOTE;
    case TASK_PARENT_FAILURE.HELD:
      return PARENT_HELD_START_FAILED_NOTE;
    default:
      return repositoryFailureNote(failure);
  }
}

/** What a task's name says, where it was edited, when the service refused the rename. */
export const RENAME_FAILED_NOTE = "The task could not be renamed. Try again.";

/** Names drawn over the ones a view carries, by task id: a name being typed. */
export type TaskNames = ReadonlyMap<string, string>;

/** The view with each name given drawn in place of the one it replaces, in the list and on the open document alike. */
export function renamedView(view: TasksView, renames: TaskNames): TasksView {
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

/** What a press of the task menu does to a task's place: pins it or unpins it. */
export const TASK_MARK = {
  PIN: "pin",
  UNPIN: "unpin",
} as const;

export type TaskMark = (typeof TASK_MARK)[keyof typeof TASK_MARK];

/** What the toast says when the service refused a pin, by what was asked. */
export const MARK_FAILED_NOTES = {
  [TASK_MARK.PIN]: "The task could not be pinned. Try again.",
  [TASK_MARK.UNPIN]: "The task could not be unpinned. Try again.",
} as const satisfies Record<TaskMark, string>;

/** The statuses a press of the task menu settles a task at: Mark done and Cancel task. */
export const SETTLED_STATUS = {
  DONE: TASK_STATUS.DONE,
  CANCELED: TASK_STATUS.CANCELED,
} as const;

export type SettledStatus = (typeof SETTLED_STATUS)[keyof typeof SETTLED_STATUS];

/** One task's status as a press asks for it, or as its Undo puts it back. */
export interface StatusChange {
  readonly taskId: string;
  readonly status: TaskStatus;
}

/** A task's status, Todo for one from a service before statuses. */
function standingStatus(task: Pick<TaskSummary, "status">): TaskStatus {
  return task.status ?? TASK_STATUS.TODO;
}

/**
 * What setting tasks at a status asks of each, and what its Undo asks: the
 * status each stood at before. A task already there is left out of both,
 * since the press changes nothing about it.
 */
export function settleChanges(
  tasks: readonly Pick<TaskSummary, "id" | "status">[],
  status: TaskStatus,
): { readonly asked: readonly StatusChange[]; readonly undo: readonly StatusChange[] } {
  const moved = tasks.filter((task) => standingStatus(task) !== status);
  return {
    asked: moved.map((task) => ({ taskId: task.id, status })),
    undo: moved.map((task) => ({ taskId: task.id, status: standingStatus(task) })),
  };
}

/** Whether the task menu offers settling the task at a status: not where it already stands there. */
export function settleOffered(task: Pick<TaskSummary, "status">, status: SettledStatus): boolean {
  return standingStatus(task) !== status;
}

/** What the toasts say of tasks set at each status: one, several, and the refusals. */
const STATUS_NOTES = {
  [TASK_STATUS.BACKLOG]: {
    one: "Moved to Backlog",
    many: "tasks moved to Backlog",
    failedOne: "The task could not be moved to Backlog. Try again.",
    failedMany: "The tasks could not be moved to Backlog. Try again.",
  },
  [TASK_STATUS.TODO]: {
    one: "Moved to Todo",
    many: "tasks moved to Todo",
    failedOne: "The task could not be moved to Todo. Try again.",
    failedMany: "The tasks could not be moved to Todo. Try again.",
  },
  [TASK_STATUS.IN_PROGRESS]: {
    one: "Moved to In progress",
    many: "tasks moved to In progress",
    failedOne: "The task could not be moved to In progress. Try again.",
    failedMany: "The tasks could not be moved to In progress. Try again.",
  },
  [TASK_STATUS.DONE]: {
    one: "Marked done",
    many: "tasks marked done",
    failedOne: "The task could not be marked done. Try again.",
    failedMany: "The tasks could not be marked done. Try again.",
  },
  [TASK_STATUS.CANCELED]: {
    one: "Task canceled",
    many: "tasks canceled",
    failedOne: "The task could not be canceled. Try again.",
    failedMany: "The tasks could not be canceled. Try again.",
  },
} as const satisfies Record<TaskStatus, Record<string, string>>;

/**
 * What the toast says once tasks were set at a status, by how many the
 * service kept and how many it refused; one task done says "Marked done".
 */
export function settledNote(status: TaskStatus, landed: number, refused: number): string {
  const notes = STATUS_NOTES[status];
  const kept = landed === 1 ? notes.one : `${landed} ${notes.many}`;
  return refused === 0 ? kept : `${kept}, ${refused} could not be`;
}

/** What the toast says when the service refused every task a press set at a status. */
export function settleFailedNote(status: TaskStatus, refused: number): string {
  const notes = STATUS_NOTES[status];
  return refused === 1 ? notes.failedOne : notes.failedMany;
}

/** What the toast says when the service refused an Undo putting a status back. */
export const STATUS_RESTORE_FAILED_NOTE = "The task's status could not be put back. Try again.";

/**
 * What an Undo of setting tasks at a status still puts back: only the tasks
 * that still stand there, since one given another status since was chosen
 * anew and an Undo must not take that choice back.
 */
export function undoStillDue(
  undo: readonly StatusChange[],
  settled: TaskStatus,
  tasks: readonly Pick<TaskSummary, "id" | "status">[],
): readonly StatusChange[] {
  return undo.filter(({ taskId }) => {
    const task = tasks.find((each) => each.id === taskId);
    return task !== undefined && standingStatus(task) === settled;
  });
}

/** What the toast says when the service refused a repository's pin, by whether it was a pin or an unpin. */
export const REPOSITORY_PIN_FAILED_NOTES = {
  PIN: "The repository could not be pinned. Try again.",
  UNPIN: "The repository could not be unpinned. Try again.",
} as const;

/** What the toast says when the service refused an agent's pin, by whether it was a pin or an unpin. */
export const AGENT_PIN_FAILED_NOTES = {
  PIN: "The agent could not be pinned. Try again.",
  UNPIN: "The agent could not be unpinned. Try again.",
} as const;

/** What the toast says when the service refused a pin's new place, which is put back. */
export const PIN_MOVE_FAILED_NOTE = "The pin could not be moved. Try again.";

/** One pin dragged to a new place in the sidebar's Pinned section: a plan's or an agent's with no plan, and the position it takes (`@luke/features/pin-order`). */
export interface PinMove {
  readonly agent: boolean;
  readonly id: string;
  readonly position: string;
}

/** The tasks the sidebar lists, each in its place. */
export interface SidebarTasks {
  /** The pinned tasks, newest pinned first. */
  readonly pinned: readonly TaskSummary[];
  /** The rest, as the service lists them: newest started first. */
  readonly rest: readonly TaskSummary[];
}

/**
 * The account's tasks sorted into the sidebar's places, the pinned ones
 * newest pinned first until the Pinned section orders them with the rest of
 * its pins (`@luke/features/pin-order`).
 */
export function sidebarTasks(tasks: readonly TaskSummary[]): SidebarTasks {
  const pinned = tasks
    .filter((task) => task.pinnedAt !== undefined)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
  const rest = tasks.filter((task) => task.pinnedAt === undefined);
  return { pinned, rest };
}
