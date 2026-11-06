import type { DatabaseServices } from "@repo/database/core/query";
import { readAgent } from "@repo/database/models/agent-store";
import { isRunTask } from "@repo/database/models/automation-store";
import { isSlackTask } from "@repo/database/models/slack-installation-store";
import {
  archiveAgentOfDoneTask,
  beginTaskWork,
  finishTaskWork,
  isStartTask,
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

function logged<A>(what: string, move: Effect.Effect<A, unknown, DatabaseServices>) {
  return move.pipe(
    Effect.asVoid,
    Effect.catch((failure) =>
      Effect.logWarning(`${what} was not settled: ${failureKind(failure)}`),
    ),
  );
}

const madeForItselfBy = Effect.fnUntraced(function* (taskId: string) {
  if (yield* isRunTask(taskId)) return SERVER_TASK_FINISHER.RUN;
  if (yield* isSlackTask(taskId)) return SERVER_TASK_FINISHER.SLACK;
  if (yield* isStartTask(taskId)) return SERVER_TASK_FINISHER.START;
  return undefined;
});

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

function letGo(archived: readonly TaskArchivedAgent[]) {
  return Effect.forEach(archived, discardedOrLogged, { discard: true });
}

export function settleTaskIfFinished(
  userId: string,
  taskId: string,
): Effect.Effect<void, never, DatabaseServices> {
  return logged("a task's finish", finishCounted(userId, taskId));
}

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

export function reopenTaskForWork(
  userId: string,
  taskId: string,
): Effect.Effect<void, never, DatabaseServices> {
  return logged("a task's reopening", beginTaskWork(userId, taskId));
}

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
