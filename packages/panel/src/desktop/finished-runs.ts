import { AGENT_STATUS, PULL_REQUEST_STATE, type TasklessAgent } from "@repo/features/agent-wire";
import { automationRun } from "@repo/features/model-label";
import type { TaskSummary } from "@repo/features/task-wire";
import type { AppInboxTask, AppInboxTasklessItem } from "@repo/host/app-state";
import { waitsOnReader } from "../tasks/inbox-model.js";

export interface RunsHeld {
  readonly unseen: (agentId: string) => boolean;
  readonly inbox: readonly Pick<AppInboxTasklessItem, "agentId" | "startedBy" | "waitsOn">[];
  readonly me: string | undefined;
  readonly shown: string | undefined;
}

const OPEN_PULL_REQUEST: ReadonlySet<string> = new Set([
  PULL_REQUEST_STATE.OPEN,
  PULL_REQUEST_STATE.DRAFT,
]);

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

export interface RunTasksHeld {
  readonly unread: (task: TaskSummary) => boolean;
  readonly inbox: readonly Pick<AppInboxTask, "taskId">[];
  readonly shown: (taskId: string) => boolean;
}

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
      (task.agents?.pullRequests ?? []).some((pullRequest) =>
        OPEN_PULL_REQUEST.has(pullRequest.state),
      ),
  );
}
