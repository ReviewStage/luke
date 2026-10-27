import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  type TaskListLiveAnswer,
  type TaskListLiveRows,
  taskAgentsOfLiveRows,
  taskListGraceEdge,
  taskListLiveRowsSchema,
  taskListOfLiveRows,
  taskPullRequestsOfLiveRows,
} from "@luke/features/task-list-live";
import type { TaskListAnswer, TaskPullRequests } from "@luke/features/task-wire";
import { Clock, Duration, Effect, Stream } from "effect";
import {
  decodedLiveRows,
  LIVE_GONE,
  type LiveBroken,
  restarting,
  type TxWait,
} from "./live-follow.js";

/**
 * task-list-follow.ts -- the task list followed over the service's held poll, built again whenever its rows move and whenever the clock alone moves an agent's status.
 *
 * The read is fetched from the service and followed (`live-follow.ts`); the
 * rows are decoded where they arrive and the list
 * is built from them (`@luke/features/task-list-live`) at the host's own
 * instant. An agent with no turn yet reads starting through its grace and
 * failed past it, and one whose line no turn takes reads running through
 * the line's grace and failed past it, each with no row moving, so the list
 * is built again at the nearest such edge too (`statusClockEdge`): the one
 * clock left here, armed only while such an agent stands. Only the list
 * built from the rows leaves.
 *
 * A read the service did not answer is asked for again, and a follow that
 * stops for good started again, after `LIVE_RESTART`. Each says so as it
 * happens: an unanswered read as `failed`, a broken follow or a failed poll
 * as `behind`, until the next list is published. A read refused because the
 * session is no longer the account the follow started for ends the follow,
 * which the next sign-in starts again.
 */

/** The parts every service's answer names; a newer one may add more, which the follow takes as they come. */
type TaskListLivePart = "plans" | "agents" | "issues";
/** A read as the follow asks for it, its rows inline; a failure where the service answered none, `gone` where it never will again. */
type Sealed = TaskListLiveAnswer | { readonly failure: string; readonly gone?: boolean };
/** The list as the live rows make it at one instant, and every agent on a plan beside it. */
interface LiveTaskList {
  readonly list: TaskListAnswer;
  readonly taskAgents: readonly CodingAgentSummary[];
  readonly taskPullRequests: readonly TaskPullRequests[];
}

export interface TaskListFollowDependencies {
  /** The read with its rows inline, fetched from the service, held past `after` where it names one. */
  readonly live: (poll: boolean, after?: string) => Effect.Effect<Sealed>;
  /** The list, and every agent on a task as its task's own list names it, each time the rows or the clock move them. */
  readonly publish: (read: LiveTaskList) => void;
  /** That the list could not be read, each time a read goes unanswered; the list already drawn stands. */
  readonly failed: () => void;
  /**
   * That the list drawn may be behind what the service holds: a poll failed
   * and is asked again, or the follow broke and is read again after
   * `LIVE_RESTART`. The next list published is caught up.
   */
  readonly behind: () => void;
  /** Hears the list's wait for a write's transaction where it has one, and none once it is let go. */
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

/** The list the rows make now, and again at each instant the clock alone moves it, until the rows move. */
function listsOf(rows: TaskListLiveRows): Stream.Stream<LiveTaskList> {
  return Stream.unwrap(
    Effect.map(Clock.currentTimeMillis, (at) => {
      const now = Stream.succeed({
        list: taskListOfLiveRows(rows, at),
        taskAgents: taskAgentsOfLiveRows(rows, at),
        taskPullRequests: taskPullRequestsOfLiveRows(rows),
      });
      const edge = taskListGraceEdge(rows, at);
      if (edge === undefined) return now;
      const later = Stream.fromEffect(Effect.sleep(Duration.millis(edge - at)));
      return Stream.concat(
        now,
        Stream.flatMap(later, () => listsOf(rows)),
      );
    }),
  );
}

/** The lists the live rows make, for as long as the follow stands; it fails where the read is gone or a row does not decode. */
function liveLists(
  dependencies: TaskListFollowDependencies,
  first: TaskListLiveAnswer,
): Stream.Stream<LiveTaskList, LiveBroken> {
  // Note that the parts are named as every service answers them, because a part a newer service adds (the questions) is followed wherever the read names it, and the rows' schema reads it as optional.
  const rows = decodedLiveRows<TaskListLivePart, TaskListLiveRows>(
    {
      poll: (after) => dependencies.live(true, after),
      onTxWait: dependencies.onTxWait,
      behind: dependencies.behind,
    },
    first,
    taskListLiveRowsSchema,
  );
  return Stream.switchMap(rows, listsOf);
}

/** The task list, followed live until interrupted or until the service says it never will again. */
export function followTaskList(dependencies: TaskListFollowDependencies): Effect.Effect<void> {
  const attempt = Effect.gen(function* () {
    const sealed = yield* dependencies.live(false);
    if ("failure" in sealed) {
      if (sealed.gone === true) return false;
      dependencies.failed();
      return true;
    }
    // A read the service refused for good, as one under another session, ends the follow rather than starting it again.
    const gone = yield* Stream.runForEach(liveLists(dependencies, sealed), (read) =>
      Effect.sync(() => dependencies.publish(read)),
    ).pipe(
      Effect.as(false),
      Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
    );
    // A follow that broke draws the list it had until it is read again, so it says the list may be behind.
    if (!gone) dependencies.behind();
    return !gone;
  });
  return restarting(attempt);
}
