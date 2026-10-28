/**
 * task-list-collections.ts -- the account's task list held in TanStack DB collections: its plans and its agents, fed by the list's follow, built at the host's own instant, and changed by a write to one row the moment it is asked.
 *
 * The list's two parts are collections of their own (`live-collection.ts`)
 * of the rows as the service answers them. The list is built from them as
 * the held read built it (`@luke/features/task-list-live`), at the host's
 * own instant, because an agent's status moves with the clock alone and a
 * live query reads no clock. So it is built again each time either moves,
 * and at the nearest instant the clock alone moves it (`taskListGraceEdge`):
 * the one clock left here, armed only while such an agent stands.
 *
 * A write to one row, a plan's or an agent's, is drawn over it at once and
 * stands while the service writes it: kept once the followed list carries
 * its transaction, and taken back where the service refused it. Where the
 * list hands no wait yet, the row as the write's own answer leaves it is
 * taken in the read's place. Either lands with the drop of what was drawn,
 * so nothing flickers back between the two. Writes to one row go to the
 * service in the order asked, since each was drawn over the ones before.
 */

import type { AgentSummary } from "@luke/features/agent-wire";
import {
  type TaskListLiveRows,
  taskAgentsOfLiveRows,
  taskListGraceEdge,
  taskListOfLiveRows,
  taskPullRequestsOfLiveRows,
} from "@luke/features/task-list-live";
import type { TaskListAnswer, TaskPullRequests } from "@luke/features/task-wire";
import { Effect, type Scope } from "effect";
import {
  answeredCollection,
  drawnAtEdges,
  type RowWrite,
  rowsOf,
  rowWrites,
} from "./live-collection.js";
import type { TxWait } from "./live-follow.js";

/** A plan's row as the list's statement answers it. */
export type PlanRow = TaskListLiveRows["plans"][number];

/** An agent's row as the list's statement answers it. */
export type AgentRow = TaskListLiveRows["agents"][number];

/** The list as the rows make it at one instant, every agent on a plan beside it, and the plans a write stands over. */
export interface LiveTaskList {
  readonly list: TaskListAnswer;
  readonly taskAgents: readonly AgentSummary[];
  readonly taskPullRequests: readonly TaskPullRequests[];
  readonly pendingTasks: readonly string[];
}

export interface TaskListDependencies {
  /** Draws the list as it now stands. */
  readonly draw: (read: LiveTaskList) => void;
  /** The followed list's wait for a write's transaction; none while the follow hands none. */
  readonly txWait: () => TxWait | undefined;
}

/** The account's task list in collections, for as long as its scope stands. */
export interface TaskListCollections {
  /** Takes one answer of the list's follow, both its parts, and draws it. */
  readonly answer: (rows: TaskListLiveRows) => Effect.Effect<void>;
  /** A change to a plan's row: drawn at once, kept or taken back as the service answers it. */
  readonly writePlan: RowWrite<PlanRow>;
  /** A change to an agent's row, as a plan's is. */
  readonly writeAgent: RowWrite<AgentRow>;
}

/** The account's task list, empty until its follow first answers. */
export function taskListCollections(
  dependencies: TaskListDependencies,
): Effect.Effect<TaskListCollections, never, Scope.Scope> {
  return Effect.gen(function* () {
    const plans = yield* answeredCollection({ getKey: (row: PlanRow) => row.id });
    const agents = yield* answeredCollection({ getKey: (row: AgentRow) => row.id });
    // Note that a write still standing once the scope closed draws nothing, since a sign-out closed it and its rows were the account's that left.
    let open = true;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        open = false;
      }),
    );

    /** Draws the list as it stands now, what every standing write drew among it, and arms its next edge. */
    const drawn = yield* drawnAtEdges((at) => {
      if (!open) return undefined;
      const rows = { plans: rowsOf(plans.collection), agents: rowsOf(agents.collection) };
      dependencies.draw({
        list: taskListOfLiveRows(rows, at),
        taskAgents: taskAgentsOfLiveRows(rows, at),
        taskPullRequests: taskPullRequestsOfLiveRows(rows),
        pendingTasks: plans.collection.toArray.flatMap((row) =>
          row.$hasPendingWrites ? [row.id] : [],
        ),
      });
      return taskListGraceEdge(rows, at);
    });

    return {
      answer: (rows) =>
        Effect.suspend(() => {
          plans.answer(rows.plans);
          agents.answer(rows.agents);
          return drawn;
        }),
      writePlan: rowWrites(plans, { drawn, txWait: dependencies.txWait }),
      writeAgent: rowWrites(agents, { drawn, txWait: dependencies.txWait }),
    };
  });
}
