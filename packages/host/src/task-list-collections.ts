import type { ListedAgent } from "@repo/features/agent-wire";
import { type TaskListLiveRows, taskListDrawer } from "@repo/features/task-list-live";
import type {
  ListedPullRequest,
  TaskAgentPin,
  TaskListAnswer,
  TaskPullRequests,
} from "@repo/features/task-wire";
import { type Confirmation, type EntityPool, fieldKind, type HeldRows } from "@repo/sync";
import { Effect, type Scope } from "effect";
import { drawnAtEdges } from "./live-collection.js";
import { confirmWrite, type SyncStanding, syncIdOf, type TxWait } from "./live-follow.js";

export type PlanRow = TaskListLiveRows["plans"][number];

export type AgentRow = TaskListLiveRows["agents"][number];

export const PLAN = fieldKind((row: PlanRow) => row.id);

export const AGENT = fieldKind((row: AgentRow) => row.id);

export interface LiveTaskList {
  readonly list: TaskListAnswer;
  readonly taskAgents: readonly ListedAgent[];
  readonly taskPullRequests: readonly TaskPullRequests[];
  readonly agentPullRequests: readonly ListedPullRequest[];
  readonly taskAgentPins: readonly TaskAgentPin[];
  readonly pendingTasks: readonly string[];
}

export interface TaskListDependencies {
  readonly pool: EntityPool;
  readonly draw: (read: LiveTaskList) => void;
  readonly txWait: () => TxWait | undefined;
}

export interface TaskListCollections {
  readonly answer: (rows: TaskListLiveRows, standing?: SyncStanding) => Effect.Effect<boolean>;
  readonly synced: () => TaskListLiveRows;
}

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

export function taskListCollections(
  dependencies: TaskListDependencies,
): Effect.Effect<TaskListCollections, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { pool } = dependencies;
    let planKeys: readonly string[] = [];
    let agentKeys: readonly string[] = [];
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
    const plans: HeldRows<PlanRow> = yield* pool.stand(PLAN, {
      redraw,
      confirmation,
      adopts: () => true,
    });
    const agents: HeldRows<AgentRow> = yield* pool.stand(AGENT, { redraw, confirmation });

    const drawing = taskListDrawer();
    const drawn: Effect.Effect<void> = yield* drawnAtEdges((at) => {
      if (!open) return undefined;
      const { edge, ...list } = drawing({ plans: plans.rows(), agents: agents.rows() }, at);
      dependencies.draw({ ...list, pendingTasks: plans.pending() });
      return edge;
    });

    return {
      answer: (rows, standing) =>
        Effect.suspend(() => {
          const nextPlans = joined(planKeys, rows.plans, standing);
          const nextAgents = joined(agentKeys, rows.agents, standing);
          const still =
            standing?.past !== undefined &&
            rows.plans.length + rows.agents.length === 0 &&
            nextPlans.length === planKeys.length &&
            nextAgents.length === agentKeys.length;
          if (still) return Effect.succeed(false);
          planKeys = nextPlans;
          agentKeys = nextAgents;
          const at = syncIdOf(standing);
          const answered = (held: readonly string[]) => ({
            held,
            ...(at === undefined ? undefined : { at }),
          });
          return Effect.gen(function* () {
            const plansMoved = yield* plans.answer(rows.plans, answered(planKeys));
            const agentsMoved = yield* agents.answer(rows.agents, answered(agentKeys));
            yield* drawn;
            return plansMoved.length + agentsMoved.length > 0;
          });
        }),
      synced: () => ({ plans: plans.synced(), agents: agents.synced() }),
    };
  });
}
