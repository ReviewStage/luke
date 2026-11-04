import type { DatabaseServices } from "@repo/database/core/query";
import { readAgent } from "@repo/database/models/agent-store";
import { isRunTask } from "@repo/database/models/automation-store";
import { isSlackTask } from "@repo/database/models/slack-installation-store";
import {
  archiveAgentOfDoneTask,
  beginTaskWork,
  finishTaskWork,
  readTaskWorkspace,
  type TaskArchivedAgent,
} from "@repo/database/models/task-store";
import { TASK_STATUS } from "@repo/features/task-wire";
import { failureKind } from "@repo/runtime/effect";
import { Effect, Option } from "effect";
import {
  idleStandingAgents,
  standsFinishedWell,
  standsStopped,
} from "../agents/coder-host/stop.js";
import { discardedOrLogged } from "../agents/device-discard.js";
import {
  recordServerEventIn,
  SERVER_EVENT,
  SERVER_TASK_FINISHER,
} from "../events/server-events.js";

/**
 * task-finish.ts -- a task's status following its work: done once the work is finished, in progress again once an agent takes it up.
 *
 * A task is finished when one of its agents has a merged pull request, none
 * of them has one still open or a draft, every one of them stands idle, and
 * no inbox question of its waits on the developer; its status then moves to
 * done on its own (`task-store.ts`'s `finishTaskWork`), under the task's
 * lock, so nobody finishes a task by hand that its agents finished. The
 * check is asked at the three moments that may finish a task, each of which
 * the service already handles: a coding agent's turn ends, the agent whose
 * turn ended reading as idle since its turn row is settled before the ask;
 * a pull request is first seen merged (`coder-host/published.ts`); and the
 * developer settles an inbox question, by answering it, ticking its to-do,
 * or closing its thread (`inbox/inbox-procedures.ts`), asked once the
 * answer was handed to the agent, so an agent woken by the answer reads as
 * running and the task stays in progress until it is done. An orchestrated
 * rollout needs no reading of its own: a worker merges and then messages
 * its orchestrator, which wakes and starts the next, so some agent is at
 * work at every hand-off, and the task finishes once the last pull request
 * merged and everyone is idle. The agents' standing is read as the sidebar
 * reads it (`stop.ts`'s `standsStopped`): a line awaiting its turn reads as
 * running, an agent started blank with no turn as idle.
 *
 * A task an automation's run or a Slack message made for itself asks no
 * merged pull request: it is done once every agent of it finished well and
 * nothing it holds waits on the developer, so a run that failed, was
 * stopped, or asked something leaves it in progress, as does a Slack
 * agent's turn that did, or one that opened a pull request, which its merge
 * then finishes.
 *
 * The finish archives no agent, since someone may be talking to one: an
 * agent brought back and messaged on a task we finished takes the task up,
 * and its reply finishes it again. Only a member's or an agent's move to Done
 * archives the task's agents standing idle with it, as them
 * (`task-store.ts`'s `updateTaskCommitted`), never the agent that moved it. An
 * agent still at work then, a turn whose Stop is on its way among it, since
 * its runner still holds its folder, is not stopped: its turn's end archives
 * it, as whoever moved the task, where the task still stands Done by their
 * move (`settleTaskAfterTurn`). Each agent archived here is let go of on its
 * device, its folder removed (`device-discard.ts`), as the agent tools'
 * archive lets one go; its sandbox already stopped as its turn ended.
 *
 * The other way, a task done or canceled moves back to in progress when an
 * agent is started on it (`coder-host/start.ts`) and when a coding agent's
 * turn starts on it, as one in the backlog or to do does
 * (`beginTaskWork`); a voice call alone reopens nothing, and neither brings
 * back an agent its Done archived, which only a member's or an agent's move
 * off Done does. Either move is a change beside the turn, the merge read, or
 * the inbox answer it rides on: a failure is logged and never theirs.
 */

/** The task's move logged rather than failed, since it rides on another write. */
function logged<A>(what: string, move: Effect.Effect<A, unknown, DatabaseServices>) {
  return move.pipe(
    Effect.asVoid,
    Effect.catch((failure) =>
      Effect.logWarning(`${what} was not settled: ${failureKind(failure)}`),
    ),
  );
}

/** What made the task for itself, which finishes it with no merge asked: an automation's run, or a Slack message; none for any other task. */
const madeForItselfBy = Effect.fnUntraced(function* (taskId: string) {
  if (yield* isRunTask(taskId)) return SERVER_TASK_FINISHER.RUN;
  if (yield* isSlackTask(taskId)) return SERVER_TASK_FINISHER.SLACK;
  return undefined;
});

/**
 * The task moved to done where its work is finished, counted under the
 * account it was made for, in the task's workspace, where it moved. A task
 * an automation's run or a Slack message made for itself is finished once
 * every agent of it finished well, with no merge asked, since its agent may
 * publish nothing; one that failed, was stopped, or waits on someone leaves
 * it in progress.
 */
function finishCounted(userId: string, taskId: string) {
  return Effect.gen(function* () {
    const madeBy = yield* madeForItselfBy(taskId);
    const moved =
      madeBy === undefined
        ? yield* finishTaskWork(userId, taskId, standsStopped)
        : yield* finishTaskWork(userId, taskId, standsFinishedWell, false);
    if (!moved) return;
    yield* recordServerEventIn(
      SERVER_EVENT.TASK_FINISH,
      userId,
      readTaskWorkspace(userId, taskId),
      {
        status: TASK_STATUS.DONE,
        by: madeBy ?? SERVER_TASK_FINISHER.MERGE,
      },
    );
  });
}

/** The agents a task's Done archived let go of on their devices, under the members who started them; each failure logged. */
function letGo(archived: readonly TaskArchivedAgent[]) {
  return Effect.forEach(archived, discardedOrLogged, { discard: true });
}

/** The task moved to done where its work is finished, as the account reaches it; nothing otherwise, and a failure logged. */
export function settleTaskIfFinished(
  userId: string,
  taskId: string,
): Effect.Effect<void, never, DatabaseServices> {
  return logged("a task's finish", finishCounted(userId, taskId));
}

/**
 * What a coding agent's turn ending asks of its task: moved to done where
 * the turn finished its work, and else, where a member or another agent
 * moved the task to Done while the agent worked, the agent archived with it
 * as them and let go of; each failure logged.
 */
export function settleTaskAfterTurn(
  userId: string,
  taskId: string,
  agentId: string,
): Effect.Effect<void, never, DatabaseServices> {
  return Effect.andThen(
    settleTaskIfFinished(userId, taskId),
    logged(
      "a done task's agent archive",
      Effect.flatMap(archiveAgentOfDoneTask(userId, taskId, agentId, idleStandingAgents), letGo),
    ),
  );
}

/** The task moved back to in progress where it was done or canceled, as a turn starting on it does; a failure logged. */
export function reopenTaskForWork(
  userId: string,
  taskId: string,
): Effect.Effect<void, never, DatabaseServices> {
  return logged("a task's reopening", beginTaskWork(userId, taskId));
}

/** The agent's task settled done where its work is finished, as an inbox question of the agent's settled asks; nothing for an agent on no task, or one the account does not reach. */
export function settleAgentTaskIfFinished(
  userId: string,
  agentId: string,
): Effect.Effect<void, never, DatabaseServices> {
  return logged(
    "a task's finish",
    Effect.flatMap(readAgent(userId, agentId), (agent) =>
      Option.isSome(agent) && agent.value.taskId !== null
        ? finishCounted(userId, agent.value.taskId)
        : Effect.void,
    ),
  );
}
