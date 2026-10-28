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

import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  type TaskListLiveRows,
  taskAgentsOfLiveRows,
  taskListGraceEdge,
  taskListOfLiveRows,
  taskPullRequestsOfLiveRows,
} from "@luke/features/task-list-live";
import type { TaskListAnswer, TaskPullRequests } from "@luke/features/task-wire";
import { Clock, Data, Deferred, Duration, Effect, Queue, type Scope, Stream } from "effect";
import {
  type AnsweredCollection,
  answeredCollection,
  optimistically,
  rowsOf,
} from "./live-collection.js";
import { confirmWrite, type TxWait } from "./live-follow.js";

/** A plan's row as the list's statement answers it. */
export type PlanRow = TaskListLiveRows["plans"][number];

/** An agent's row as the list's statement answers it. */
export type AgentRow = TaskListLiveRows["agents"][number];

/** The list as the rows make it at one instant, every agent on a plan beside it, and the plans a write stands over. */
export interface LiveTaskList {
  readonly list: TaskListAnswer;
  readonly taskAgents: readonly CodingAgentSummary[];
  readonly taskPullRequests: readonly TaskPullRequests[];
  readonly pendingTasks: readonly string[];
}

/**
 * What a write's service call answered: the caller's own answer, the
 * transaction it committed in, and the row's fields as the service then
 * holds them, taken in the list's place where it hands no wait; where the
 * answer says none of them, the fields the write drew are taken instead.
 */
export interface RowWritten<Row, Answer> {
  readonly answer: Answer;
  readonly txid: string | undefined;
  readonly fields?: Partial<Row>;
}

/** A write the service refused, which takes back what it drew, and what the caller answers for it. */
export interface RowRefused<Answer> {
  readonly refused: Answer;
}

/** A write the service did not answer, which takes back what it drew. */
class Unwritten extends Data.TaggedError("Unwritten") {}

export interface TaskListDependencies {
  /** Draws the list as it now stands. */
  readonly draw: (read: LiveTaskList) => void;
  /** The followed list's wait for a write's transaction; none while the follow hands none. */
  readonly txWait: () => TxWait | undefined;
}

/**
 * A write to one row: what the row's fields become, from the row as it is
 * drawn now, and the service call that writes it, answering what the caller
 * answers either way.
 */
export type RowWrite<Row> = <Answer>(
  key: string,
  change: (row: Row) => Partial<Row>,
  written: Effect.Effect<RowWritten<Row, Answer> | RowRefused<Answer>>,
) => Effect.Effect<Answer>;

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

    /** The instant the clock alone next moves the list drawn, none where nothing waits on it. */
    const edges = yield* Queue.sliding<number | undefined>(1);

    /** Draws the list as it stands now, what every standing write drew among it, and arms its next edge. */
    const drawn: Effect.Effect<void> = Effect.gen(function* () {
      if (!open) return;
      const at = yield* Clock.currentTimeMillis;
      const rows = { plans: rowsOf(plans.collection), agents: rowsOf(agents.collection) };
      dependencies.draw({
        list: taskListOfLiveRows(rows, at),
        taskAgents: taskAgentsOfLiveRows(rows, at),
        taskPullRequests: taskPullRequestsOfLiveRows(rows),
        pendingTasks: plans.collection.toArray.flatMap((row) =>
          row.$hasPendingWrites ? [row.id] : [],
        ),
      });
      yield* Queue.offer(edges, taskListGraceEdge(rows, at));
    });

    // The list drawn again at each edge the clock alone moves it, the wait for one drawn since replacing the wait for the one before.
    yield* Effect.forkScoped(
      Stream.fromQueue(edges).pipe(
        Stream.switchMap((edge) =>
          edge === undefined
            ? Stream.empty
            : Stream.fromEffect(
                Effect.flatMap(Clock.currentTimeMillis, (now) =>
                  Effect.sleep(Duration.millis(Math.max(0, edge - now))),
                ),
              ),
        ),
        Stream.runForEach(() => drawn),
      ),
    );

    /** Confirms a write on the followed list where it hands a wait, or takes the write's own answer in its place where it does not. */
    const confirmed = (txid: string | undefined, answered: () => void) => {
      const wait = dependencies.txWait();
      return wait === undefined || txid === undefined
        ? Effect.sync(answered)
        : confirmWrite(wait, txid);
    };

    /** The writes to one collection's rows, each row's newest settling the next write to it waits on. */
    function rowWrite<Row extends object>(
      collection: AnsweredCollection<Row, string>,
    ): RowWrite<Row> {
      const lastWrites = new Map<string, Deferred.Deferred<void>>();
      return <Answer>(
        key: string,
        change: (row: Row) => Partial<Row>,
        written: Effect.Effect<RowWritten<Row, Answer> | RowRefused<Answer>>,
      ) =>
        Effect.gen(function* () {
          const before = lastWrites.get(key);
          const settled = yield* Deferred.make<void>();
          lastWrites.set(key, settled);
          const answered: { value?: Answer } = {};
          const draw = () => {
            const row = collection.collection.get(key);
            if (row === undefined) return;
            const fields = change(row);
            collection.collection.update(key, (draft) => Object.assign(draft, fields));
          };
          const work = Effect.gen(function* () {
            yield* drawn;
            if (before !== undefined) yield* Deferred.await(before);
            const result = yield* written;
            if ("refused" in result) {
              answered.value = result.refused;
              return yield* new Unwritten();
            }
            answered.value = result.answer;
            yield* confirmed(result.txid, () =>
              collection.confirmRow(key, (row) => result.fields ?? change(row)),
            );
          });
          yield* optimistically(draw, work).pipe(
            Effect.catchTag("Unwritten", () => Effect.void),
            Effect.ensuring(drawn),
            Effect.ensuring(
              Effect.andThen(
                Deferred.succeed(settled, undefined),
                Effect.sync(() => {
                  if (lastWrites.get(key) === settled) lastWrites.delete(key);
                }),
              ),
            ),
          );
          // SAFETY: the work sets the answer before it settles, whether the service wrote or refused the row.
          return answered.value as Answer;
        });
    }

    return {
      answer: (rows) =>
        Effect.suspend(() => {
          plans.answer(rows.plans);
          agents.answer(rows.agents);
          return drawn;
        }),
      writePlan: rowWrite(plans),
      writeAgent: rowWrite(agents),
    };
  });
}
