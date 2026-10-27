import {
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import type { AppInboxTasklessItem } from "@luke/host/app-state";
import { waitsOnReader } from "../tasks/inbox-model.js";

/**
 * finished-runs.ts -- which agents an automation started with no task stand under the sidebar's Tasks: every one but a run that finished and asks nothing more of the reader.
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

/** Whether an automation's run started the agent: one standing names it, and a deleted one's run still keeps its name. */
function automationRun(agent: TasklessAgent): boolean {
  return agent.automationId !== null || agent.automationName !== undefined;
}

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
      !automationRun(agent) ||
      agent.status !== CODING_AGENT_STATUS.COMPLETED ||
      agent.id === held.shown ||
      held.unseen(agent.id) ||
      waiting.has(agent.id) ||
      (agent.pullRequest !== undefined && OPEN_PULL_REQUEST.has(agent.pullRequest.state)),
  );
}
