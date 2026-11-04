/**
 * task-list-collections.ts -- the account's task list, its plans and its agents each rows of the sync engine's pool: fed by the list's follow, built at the host's own instant, and changed by a write to one row the moment it is asked.
 *
 * A plan and an agent are kinds of the pool (`@repo/sync`), one row however
 * many reads hold it, and the list stands on the rows its follow answers for
 * the signed-in session. The list is built from them as the held read built
 * it (`@repo/features/task-list-live`), at the host's own instant, because
 * an agent's status moves with the clock alone and a live query reads no
 * clock. So it is built again each time either moves, and at the nearest
 * instant the clock alone moves it (`taskListGraceEdge`): the one clock
 * left here, armed only while such an agent stands.
 *
 * A write to one row, a plan's or an agent's, is a write the pool draws over
 * it at once (`compose-tasks.ts` and `compose-agents.ts` declare them),
 * standing until the list carries its transaction, or taken back where the
 * service refused it; where the list hands no wait yet, the row as the
 * write's own answer leaves it is taken in the list's place. A task the
 * service started is a row made from its answer, which the list shows while
 * it stands, so it stands in the list before the follow carries it. The
 * tasks a write stands over are the list's pending ones.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import {
  agentPullRequestsOfLiveRows,
  type TaskListLiveRows,
  taskAgentPinsOfLiveRows,
  taskAgentsOfLiveRows,
  taskListGraceEdge,
  taskListOfLiveRows,
  taskPullRequestsOfLiveRows,
} from "@repo/features/task-list-live";
import type {
  ListedPullRequest,
  TaskAgentPin,
  TaskListAnswer,
  TaskPullRequests,
} from "@repo/features/task-wire";
import {
  type Confirmation,
  type EntityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  type WriteDeclaration,
} from "@repo/sync";
import { Effect, type Scope } from "effect";
import { drawnAtEdges } from "./live-collection.js";
import { confirmWrite, type SyncStanding, syncIdOf, type TxWait } from "./live-follow.js";

/** A plan's row as the list's statement answers it. */
export type PlanRow = TaskListLiveRows["plans"][number];

/** An agent's row as the list's statement answers it. */
export type AgentRow = TaskListLiveRows["agents"][number];

/** A plan as the pool holds it, by its id. */
export const PLAN = fieldKind((row: PlanRow) => row.id);

/** An agent as the pool holds it, by its id. */
export const AGENT = fieldKind((row: AgentRow) => row.id);

/** A plan the service started, drawn as it answered it, while no answer of the list holds it, until the list carries its transaction. */
const MADE: WriteDeclaration<
  PlanRow,
  FieldChange<PlanRow>,
  { readonly row: PlanRow; readonly txid: string | undefined },
  void
> = {
  kind: PLAN,
  keys: ({ row }) => [row.id],
  change: ({ row }) => ({ made: row }),
  send: ({ txid }) => Effect.succeed({ answer: undefined, txid }),
};

/** The list as the rows make it at one instant, every agent on a plan beside it, and the plans a write stands over. */
export interface LiveTaskList {
  readonly list: TaskListAnswer;
  readonly taskAgents: readonly ListedAgent[];
  readonly taskPullRequests: readonly TaskPullRequests[];
  readonly agentPullRequests: readonly ListedPullRequest[];
  readonly taskAgentPins: readonly TaskAgentPin[];
  readonly pendingTasks: readonly string[];
}

export interface TaskListDependencies {
  /** The pool the list's rows stand in. */
  readonly pool: EntityPool;
  /** Draws the list as it now stands. */
  readonly draw: (read: LiveTaskList) => void;
  /** The followed list's wait for a write's transaction; none while the follow hands none. */
  readonly txWait: () => TxWait | undefined;
}

/** The account's task list standing in the pool, for as long as its scope stands. */
export interface TaskListCollections {
  /** Takes one answer of the list's follow, both its parts, whole or past a sync id, and draws it. */
  readonly answer: (rows: TaskListLiveRows, standing?: SyncStanding) => Effect.Effect<void>;
  /** A plan the service started, drawn at once as it answered it and held until the list carries its transaction, or taken as answered where the list hands no wait. */
  readonly made: (row: PlanRow, txid: string | undefined) => Effect.Effect<void>;
}

/**
 * The ids a part holds after an answer: a whole one's rows alone, and one
 * past a sync id joined onto those held, less those it names gone.
 */
function joined(
  held: readonly string[],
  rows: readonly { readonly id: string }[],
  standing: SyncStanding | undefined,
): readonly string[] {
  const answered = rows.map((row) => row.id);
  if (standing?.past === undefined) return answered;
  const gone = new Set(standing.gone);
  return [...new Set([...held, ...answered])].filter((id) => !gone.has(id));
}

/** The account's task list, empty until its follow first answers. */
export function taskListCollections(
  dependencies: TaskListDependencies,
): Effect.Effect<TaskListCollections, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { pool } = dependencies;
    /** The plans and the agents the list holds, by id, as its answers joined them. */
    let planKeys: readonly string[] = [];
    let agentKeys: readonly string[] = [];
    // Note that a write still standing once the scope closed draws nothing, since a sign-out closed it and its rows were the account's that left.
    let open = true;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        open = false;
      }),
    );
    const confirmation = (): Confirmation | undefined => {
      const wait = dependencies.txWait();
      return wait === undefined ? undefined : (txid) => confirmWrite(wait, txid);
    };
    const redraw = () => Effect.suspend(() => drawn);
    // Note that every plan made is the list's, since it holds every task the account reaches.
    const plans: HeldRows<PlanRow> = yield* pool.stand(PLAN, {
      redraw,
      confirmation,
      adopts: () => true,
    });
    const agents: HeldRows<AgentRow> = yield* pool.stand(AGENT, { redraw, confirmation });

    /** Draws the list as it stands now, what every standing write drew among it, and arms its next edge. */
    const drawn: Effect.Effect<void> = yield* drawnAtEdges((at) => {
      if (!open) return undefined;
      const rows = { plans: plans.rows(), agents: agents.rows() };
      dependencies.draw({
        list: taskListOfLiveRows(rows, at),
        taskAgents: taskAgentsOfLiveRows(rows, at),
        taskPullRequests: taskPullRequestsOfLiveRows(rows),
        agentPullRequests: agentPullRequestsOfLiveRows(rows),
        taskAgentPins: taskAgentPinsOfLiveRows(rows),
        pendingTasks: plans.pending(),
      });
      return taskListGraceEdge(rows, at);
    });

    return {
      answer: (rows, standing) =>
        Effect.suspend(() => {
          planKeys = joined(planKeys, rows.plans, standing);
          agentKeys = joined(agentKeys, rows.agents, standing);
          const at = syncIdOf(standing);
          const answered = (held: readonly string[]) => ({
            held,
            ...(at === undefined ? undefined : { at }),
          });
          return Effect.andThen(
            Effect.andThen(
              plans.answer(rows.plans, answered(planKeys)),
              agents.answer(rows.agents, answered(agentKeys)),
            ),
            drawn,
          );
        }),
      made: (row, txid) => pool.write(MADE, { row, txid }),
    };
  });
}
