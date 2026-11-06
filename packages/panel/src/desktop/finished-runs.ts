import { AGENT_STATUS, PULL_REQUEST_STATE, type TasklessAgent } from "@repo/features/agent-wire";
import { automationRun } from "@repo/features/model-label";
import { pullRequestsOfTask } from "@repo/features/task-agents-model";
import type { TaskPullRequests, TaskSummary } from "@repo/features/task-wire";
import type { AppInboxTask, AppInboxTasklessItem } from "@repo/host/app-state";
import { waitsOnReader } from "../tasks/inbox-model.js";

/**
 * finished-runs.ts -- which of an automation's runs stand under the sidebar's Tasks: every one but a run that finished and asks nothing more of the reader, whether its agent works on no task or on the task the run made.
 *
 * An automation fires again and again, so the runs it finished would bury
 * the tasks under them. A run's agent stands while it has not completed
 * (it works, is starting, failed, or was stopped), while it ended unseen,
 * while an Inbox item of its waits on the reader, while its pull request
 * is open or a draft, and while its page is the one shown, so the row
 * pressed never leaves under the reader's hand. An agent started by hand
 * stands as a task does. Pinned and sectioned agents are the reader's own
 * choice and never pass through here; a finished run stays on its
 * automation's page and in ⌘K.
 *
 * A task a run made for itself (`madeByRun`) is held the same way, save that
 * a run that failed or was stopped leaves too: a good run's task is moved to
 * Done, which the list never shows, so one still standing once no agent of it
 * works is a run that went wrong or holds something. It stands while an agent
 * of it works, while it is unread, while an Inbox item of it waits on the
 * reader, while a pull request of it is open or a draft, and while it is the
 * task shown. Its status is left as it stands, and it stays on its
 * automation's page and in ⌘K. Every other task, a same-agent automation's
 * standing task among them, stands as it did.
 */

/** What else holds a finished run's agent in the list: the agents ended unseen, the reader's waiting Inbox items, and the agent shown. */
export interface RunsHeld {
  readonly unseen: (agentId: string) => boolean;
  readonly inbox: readonly Pick<AppInboxTasklessItem, "agentId" | "startedBy" | "waitsOn">[];
  readonly me: string | undefined;
  readonly shown: string | undefined;
}

/** The pull request states that leave work on the run: open, or a draft. */
const OPEN_PULL_REQUEST: ReadonlySet<string> = new Set([
  PULL_REQUEST_STATE.OPEN,
  PULL_REQUEST_STATE.DRAFT,
]);

/** The agents of the list that stand under Tasks, in the list's order: all but an automation's finished runs that hold nothing of the reader's. */
export function withoutFinishedRuns(
  agents: readonly TasklessAgent[],
  held: RunsHeld,
): readonly TasklessAgent[] {
  const waiting = new Set(
    held.inbox.filter((item) => waitsOnReader(item, held.me)).map((item) => item.agentId),
  );
  return agents.filter(
    (agent) =>
      automationRun(agent) === undefined ||
      agent.status !== AGENT_STATUS.COMPLETED ||
      agent.id === held.shown ||
      held.unseen(agent.id) ||
      waiting.has(agent.id) ||
      (agent.pullRequest !== undefined && OPEN_PULL_REQUEST.has(agent.pullRequest.state)),
  );
}

/** What else holds a finished run's task in the list: the tasks unread, the reader's waiting Inbox items by task, the task shown, and every task's pull requests (`pullRequestsOfTask`). */
export interface RunTasksHeld {
  readonly unread: (task: TaskSummary) => boolean;
  readonly inbox: readonly Pick<AppInboxTask, "taskId">[];
  readonly shown: (taskId: string) => boolean;
  readonly pullRequests: readonly TaskPullRequests[] | undefined;
}

/** The tasks of the list that stand under Tasks, in the list's order: all but the tasks a run made whose run finished and holds nothing of the reader's. */
export function withoutFinishedRunTasks(
  tasks: readonly TaskSummary[],
  held: RunTasksHeld,
): readonly TaskSummary[] {
  const waiting = new Set(held.inbox.map((item) => item.taskId));
  return tasks.filter(
    (task) =>
      task.madeByRun !== true ||
      (task.agents?.working ?? 0) > 0 ||
      held.shown(task.id) ||
      held.unread(task) ||
      waiting.has(task.id) ||
      pullRequestsOfTask(held.pullRequests, task.id).some((pullRequest) =>
        OPEN_PULL_REQUEST.has(pullRequest.state),
      ),
  );
}
