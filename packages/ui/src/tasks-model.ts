import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  TASK_STATUS,
  type Task,
  type TaskStatus,
  type TaskSummary,
} from "@repo/features/task-wire";
import {
  type HeldDescriptionDocument,
  type RepositoryCallFailure,
  type StartCallFailure,
  TASK_CALL_FAILURE,
  TASK_PARENT_FAILURE,
  type TasksView,
} from "@repo/features/tasks-view";
import type { Workspace } from "@repo/features/workspace-wire";

const RECENT_REPOSITORY_LIMIT = 5;

export const TASKS_PAGE = {
  HOME: "home",
  DOCUMENT: "document",
} as const;

export type TasksPage = (typeof TASKS_PAGE)[keyof typeof TASKS_PAGE];

export function tasksPage(view: TasksView): TasksPage {
  return view.activeTaskId === undefined ? TASKS_PAGE.HOME : TASKS_PAGE.DOCUMENT;
}

export const DOCUMENT_REGION = {
  NONE: "none",
  READING: "reading",
  READY: "ready",
  FAILED: "failed",
  MISSING: "missing",
} as const;

export type DocumentRegion =
  | { readonly kind: typeof DOCUMENT_REGION.NONE }
  | { readonly kind: typeof DOCUMENT_REGION.READING }
  | { readonly kind: typeof DOCUMENT_REGION.READY; readonly task: Task }
  | { readonly kind: typeof DOCUMENT_REGION.FAILED }
  | { readonly kind: typeof DOCUMENT_REGION.MISSING };

export interface HeldDocumentRead {
  readonly rows?: HeldDescriptionDocument | undefined;
  readonly failed?: boolean;
}

export function documentRegion(
  view: { readonly activeTaskId?: string | undefined },
  held: HeldDocumentRead | undefined,
): DocumentRegion {
  const { activeTaskId } = view;
  if (activeTaskId === undefined) return { kind: DOCUMENT_REGION.NONE };
  const rows = held?.rows;
  if (rows !== undefined && !("task" in rows)) return { kind: DOCUMENT_REGION.MISSING };
  if (rows !== undefined && rows.task.id === activeTaskId) {
    return { kind: DOCUMENT_REGION.READY, task: rows.task };
  }
  if (rows === undefined && held?.failed === true) return { kind: DOCUMENT_REGION.FAILED };
  return { kind: DOCUMENT_REGION.READING };
}

export function recentRepositories(tasks: TasksView["tasks"]): string[] {
  const recent: string[] = [];
  for (const task of tasks) {
    const { repository } = task;
    if (repository !== null && !recent.includes(repository)) recent.push(repository);
    if (recent.length === RECENT_REPOSITORY_LIMIT) break;
  }
  return recent;
}

export function workspaceReaches(
  workspace: Pick<Workspace, "github">,
  repository: string,
): boolean {
  const { github } = workspace;
  const [owner] = repository.split("/");
  return github != null && github.active && github.login.toLowerCase() === owner?.toLowerCase();
}

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

export function repositoryPageUrl(repository: string): string {
  return `https://github.com/${repository}`;
}

export function githubAccountPageUrl(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}`;
}

export function githubAccountPictureUrl(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}.png?size=32`;
}

export function repositoryOwnerPictureUrl(repository: string): string {
  return githubAccountPictureUrl(repository.slice(0, repository.indexOf("/")));
}

const START_FAILED_NOTE = "The service did not answer.";

const REPOSITORY_FAILURE_NOTES = {
  [TASK_CALL_FAILURE.UNANSWERED]: START_FAILED_NOTE,
  [TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]: `${PRODUCT_NAME} cannot see that repository on GitHub. Choose which repositories ${PRODUCT_NAME} can see.`,
} as const satisfies Record<RepositoryCallFailure, string>;

const REPOSITORY_CHANGE_FAILURE_NOTES = {
  [TASK_CALL_FAILURE.UNANSWERED]: "The service did not answer. Try again.",
  [TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]: `${PRODUCT_NAME} cannot see that repository on GitHub. Choose which repositories ${PRODUCT_NAME} can see, then try again.`,
} as const satisfies Record<RepositoryCallFailure, string>;

export function repositoryFailureNote(failure: RepositoryCallFailure): string {
  return REPOSITORY_FAILURE_NOTES[failure];
}

export function repositoryChangeFailureNote(failure: RepositoryCallFailure): string {
  return REPOSITORY_CHANGE_FAILURE_NOTES[failure];
}

const DEVICE_START_FAILED_NOTE =
  "That device can't take this task's agents right now. Choose another, or Cloud.";

const RELATION_START_FAILED_NOTE =
  "That workspace or task is gone, or you're no longer a member of the workspace.";

const TREE_REPOSITORY_START_FAILED_NOTE =
  "A task works in its tree's repository, so the two must share one.";

const PARENT_HELD_START_FAILED_NOTE = "That task already has a parent. Choose another relation.";

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

export const RENAME_FAILED_NOTE = "The task could not be renamed. Try again.";

export type TaskNames = ReadonlyMap<string, string>;

function named<Named extends { id: string; name: string }>(task: Named, renames: TaskNames): Named {
  const name = renames.get(task.id);
  return name === undefined ? task : { ...task, name };
}

export function renamedView(view: TasksView, renames: TaskNames): TasksView {
  if (renames.size === 0) return view;
  return { ...view, tasks: view.tasks.map((task) => named(task, renames)) };
}

export function renamedRegion(region: DocumentRegion, renames: TaskNames): DocumentRegion {
  if (region.kind !== DOCUMENT_REGION.READY) return region;
  const task = named(region.task, renames);
  return task === region.task ? region : { ...region, task };
}

export const TASK_MARK = {
  PIN: "pin",
  UNPIN: "unpin",
} as const;

export type TaskMark = (typeof TASK_MARK)[keyof typeof TASK_MARK];

export const MARK_FAILED_NOTES = {
  [TASK_MARK.PIN]: "The task could not be pinned. Try again.",
  [TASK_MARK.UNPIN]: "The task could not be unpinned. Try again.",
} as const satisfies Record<TaskMark, string>;

export const SETTLED_STATUS = {
  DONE: TASK_STATUS.DONE,
  CANCELED: TASK_STATUS.CANCELED,
} as const;

export type SettledStatus = (typeof SETTLED_STATUS)[keyof typeof SETTLED_STATUS];

export interface StatusChange {
  readonly taskId: string;
  readonly status: TaskStatus;
}

function standingStatus(task: Pick<TaskSummary, "status">): TaskStatus {
  return task.status ?? TASK_STATUS.TODO;
}

export function settleChanges(
  tasks: readonly Pick<TaskSummary, "id" | "status">[],
  status: TaskStatus,
): readonly StatusChange[] {
  return tasks
    .filter((task) => standingStatus(task) !== status)
    .map((task) => ({ taskId: task.id, status }));
}

export function settleOffered(task: Pick<TaskSummary, "status">, status: SettledStatus): boolean {
  return standingStatus(task) !== status;
}

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

export function settledNote(status: TaskStatus, landed: number, refused: number): string {
  const notes = STATUS_NOTES[status];
  const kept = landed === 1 ? notes.one : `${landed} ${notes.many}`;
  return refused === 0 ? kept : `${kept}, ${refused} could not be`;
}

export function settleFailedNote(status: TaskStatus, refused: number): string {
  const notes = STATUS_NOTES[status];
  return refused === 1 ? notes.failedOne : notes.failedMany;
}

export const REPOSITORY_PIN_FAILED_NOTES = {
  PIN: "The repository could not be pinned. Try again.",
  UNPIN: "The repository could not be unpinned. Try again.",
} as const;

export const AGENT_PIN_FAILED_NOTES = {
  PIN: "The agent could not be pinned. Try again.",
  UNPIN: "The agent could not be unpinned. Try again.",
} as const;

export const PIN_MOVE_FAILED_NOTE = "The pin could not be moved. Try again.";

export interface PinMove {
  readonly agent: boolean;
  readonly id: string;
  readonly position: string;
}

export interface SidebarTasks {
  readonly pinned: readonly TaskSummary[];
  readonly rest: readonly TaskSummary[];
}

export function sidebarTasks(tasks: readonly TaskSummary[]): SidebarTasks {
  const pinned = tasks
    .filter((task) => task.pinnedAt !== undefined)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
  const rest = tasks.filter((task) => task.pinnedAt === undefined);
  return { pinned, rest };
}
