import { useAtomValue } from "@effect/atom-react/Hooks";
import type { TaskAgentLine, TaskPullRequestLine, TaskSummary } from "@luke/features/task-wire";
import type { AppStateSnapshot } from "@luke/host/app-state";
import * as Atom from "effect/reactivity/Atom";
import { appStateDerivedAtom } from "../use-app-state.js";
import { agentStillWriting } from "./coding-agent-model.js";

/**
 * use-task-work.ts -- every agent a task holds and every pull request they opened, as the cards naming them read them, where the task's row names only the first few.
 *
 * A task's row carries its agents and pull requests in brief, a few of
 * each (`TASK_AGENTS_BOUNDS`), which is what a row has room to draw. A card
 * naming them says every one, so it reads them from what the window holds
 * beside the list while it is followed live: every agent on a task
 * (`taskAgents`) and every pull request of each (`taskPullRequests`). The
 * agents stand as the row names them, those at work first, then the rest,
 * newest started first within each; the pull requests in the row's order.
 * Where the window does not hold one of the lists, as before the list is
 * followed live, the row's own few stand in for it.
 */

/** A task's agents and pull requests, every one the window holds. */
interface TaskWork {
  readonly agents: readonly TaskAgentLine[];
  readonly pullRequests: readonly TaskPullRequestLine[];
}

/** The task list's slice, which tells its readers only when it is a new object. */
const planningAtom: Atom.Atom<AppStateSnapshot["tasks"] | undefined> = Atom.withEquality(
  appStateDerivedAtom((state) => state?.tasks),
  (held, next) => held === next,
);

/** Those at work first, then the rest, newest started first within each, as a task's row names its agents. */
function workingFirst(a: TaskAgentLine & { createdAt: number }, b: typeof a): number {
  const working = Number(agentStillWriting(b.status)) - Number(agentStillWriting(a.status));
  return working !== 0 ? working : b.createdAt - a.createdAt;
}

/** What the window holds of one task's work beside the list: each list where the window holds it, apart, since each may stand without the other. */
interface HeldWork {
  readonly agents: readonly TaskAgentLine[] | undefined;
  readonly pullRequests: readonly TaskPullRequestLine[] | undefined;
}

/** Every agent and pull request of one task, as the window held them at the last delivery that moved the list; each none where it holds no such list. */
const taskWorkAtom = Atom.family((taskId: string) =>
  Atom.map(
    planningAtom,
    (planning): HeldWork => ({
      agents: planning?.taskAgents
        ?.filter((agent) => agent.planId === taskId)
        .toSorted(workingFirst),
      pullRequests:
        planning?.taskPullRequests === undefined
          ? undefined
          : (planning.taskPullRequests.find((each) => each.taskId === taskId)?.pullRequests ?? []),
    }),
  ),
);

/** Every agent a task holds and every pull request they opened; each the row's own few where the window holds no full list of it. */
export function useTaskWork(task: Pick<TaskSummary, "id" | "agents">): TaskWork {
  const held = useAtomValue(taskWorkAtom(task.id));
  return {
    agents: held.agents ?? task.agents?.agents ?? [],
    pullRequests: held.pullRequests ?? task.agents?.pullRequests ?? [],
  };
}
