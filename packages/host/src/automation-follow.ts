import {
  type AutomationRunsLiveAnswer,
  type AutomationsLiveAnswer,
  type AutomationsLiveRows,
  type AutomationWorkspaceRunsLiveAnswer,
  automationRunsGraceEdge,
  automationRunsLiveRowsSchema,
  automationRunsOfLiveRows,
  automationsLiveRowsSchema,
  automationWorkspaceRunsGraceEdge,
  automationWorkspaceRunsLiveRowsSchema,
  automationWorkspaceRunsOfLiveRows,
} from "@luke/features/automation-live";
import {
  AUTOMATION_CALL_FAILURE,
  AUTOMATION_FOLLOW,
  type AutomationFollow,
  type AutomationFollowed,
} from "@luke/features/automation-view";
import { LIVE_SIGNED_OUT } from "@luke/features/live-wire";
import { Clock, Duration, Effect, Option, Schema, Stream } from "effect";
import {
  decodedLiveRows,
  LIVE_GONE,
  LiveBroken,
  liveRows,
  restarting,
  type SealedRead,
  type TxWait,
} from "./live-follow.js";

/**
 * automation-follow.ts -- a workspace's automations, an automation's runs, or a workspace's runs, followed on the service's live read for the windows that draw them, built again whenever the rows move and whenever the clock alone moves a run's agent.
 *
 * The live read is fetched from the service and followed over its held poll
 * (`live-follow.ts`). The rows are decoded where they arrive. A workspace's
 * automations are taken the moment their poll answers
 * (`automation-collections.ts` keeps them and builds the list), before the
 * follow carries the answer's txids on to a write waiting for them, so a
 * write confirmed on the list finds its rows already taken. A history is
 * built from its rows (`@luke/features/automation-live`) at the host's own
 * instant, and again at the one instant the clock alone moves a run's
 * agent, the end of a grace. Only what is built from the rows leaves here.
 *
 * A read the service did not answer is told as unanswered, which the window
 * says while it holds nothing, and asked for again, as a follow that stops
 * for good is started again, after `LIVE_RESTART`. One the account does not
 * reach is told not found and ends the follow; one refused because the
 * session is no longer the account the follow started for ends it unsaid,
 * and the next sign-in's window follows it again.
 */

/** A live read as the follow asks for it, its rows inline; a failure where the service answered none. */
type Sealed<Answer> = Answer | { readonly failure: string };

export interface AutomationFollowDependencies {
  /** A workspace's automations as a live read, or with `poll` their rows inline, held past `after`. */
  readonly liveList: (
    workspaceId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<Sealed<AutomationsLiveAnswer>>;
  /** An automation's runs as a live read, or with `poll` their rows inline, held past `after`. */
  readonly liveRuns: (
    automationId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<Sealed<AutomationRunsLiveAnswer>>;
  /** Every run of a workspace's automations the account reads, as a live read, or with `poll` their rows inline, held past `after`. */
  readonly liveWorkspaceRuns: (
    workspaceId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<Sealed<AutomationWorkspaceRunsLiveAnswer>>;
  /** Takes a workspace's automations, decoded, as each poll answers them, which draws its list. */
  readonly takeList: (rows: AutomationsLiveRows) => Effect.Effect<void>;
  /** A history followed, each time it moves, and why there is nothing to draw where a follow says so. */
  readonly publish: (followed: AutomationFollowed) => void;
  /** Hears the follow's wait for a write's transaction where it has one, and none once it is let go. */
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

/** How a follow's rows are followed from its first answer, its polls asked through `poll`, until the read breaks. */
type RowsFollow<Part extends string> = (
  first: SealedRead<Part>,
  poll: (
    after: string | undefined,
  ) => Effect.Effect<SealedRead<Part> | { readonly failure: string; readonly gone: boolean }>,
  onTxWait: AutomationFollowDependencies["onTxWait"],
) => Effect.Effect<void, LiveBroken>;

/** One kind of follow: how it is read, how its rows are followed, and how it says there is nothing to draw. */
interface FollowKind<Part extends string> {
  readonly live: (poll: boolean, after?: string) => Effect.Effect<Sealed<SealedRead<Part>>>;
  readonly rows: RowsFollow<Part>;
  /** Why there is nothing to draw, told as the view says it. */
  readonly failed: (
    failure: typeof AUTOMATION_CALL_FAILURE.UNANSWERED | typeof AUTOMATION_CALL_FAILURE.NOT_FOUND,
  ) => void;
}

/** A read with one the account no longer reaches marked gone, so its follow ends rather than asks again. */
function goneWhereNotFound<Part extends string>(
  read: Sealed<SealedRead<Part>>,
): SealedRead<Part> | { readonly failure: string; readonly gone: boolean } {
  return "failure" in read
    ? { failure: read.failure, gone: read.failure === AUTOMATION_CALL_FAILURE.NOT_FOUND }
    : read;
}

/** The view the rows make now, and again at each instant the clock alone moves it, until the rows move. */
function viewsOf<Rows, View>(
  rows: Rows,
  build: (rows: Rows, now: number) => View,
  edge: (rows: Rows, now: number) => number | undefined,
): Stream.Stream<View> {
  return Stream.unwrap(
    Effect.map(Clock.currentTimeMillis, (at) => {
      const now = Stream.succeed(build(rows, at));
      const next = edge(rows, at);
      if (next === undefined) return now;
      const later = Stream.fromEffect(Effect.sleep(Duration.millis(next - at)));
      return Stream.concat(
        now,
        Stream.flatMap(later, () => viewsOf(rows, build, edge)),
      );
    }),
  );
}

/** Rows followed as each answer is handed on, the view they make built and published, and again at each instant the clock alone moves it. */
function builtViews<Part extends string, Rows, View>(
  schema: Schema.Codec<Rows, unknown>,
  build: (rows: Rows, now: number) => View,
  edge: (rows: Rows, now: number) => number | undefined,
  publish: (view: View) => void,
): RowsFollow<Part> {
  return (first, poll, onTxWait) =>
    Stream.runForEach(
      Stream.switchMap(decodedLiveRows({ poll, onTxWait }, first, schema), (decoded) =>
        viewsOf(decoded, build, edge),
      ),
      (view) => Effect.sync(() => publish(view)),
    );
}

/** Rows taken, decoded, the moment each poll answers them, before the follow carries the answer's txids on to a write waiting for them. */
function takenRows<Part extends string, Rows>(
  schema: Schema.Codec<Rows, unknown>,
  take: (rows: Rows) => Effect.Effect<void>,
): RowsFollow<Part> {
  const decode = Schema.decodeUnknownOption(schema);
  /** Takes an answer's rows, answering whether they decoded; one carrying none inline takes nothing. */
  const taken = (read: SealedRead<Part>) => {
    const parts = Object.entries<{ readonly rows?: readonly unknown[] }>(read.queries);
    if (parts.some(([, query]) => query.rows === undefined)) return Effect.succeed(true);
    const rows = decode(Object.fromEntries(parts.map(([part, query]) => [part, query.rows])));
    return Option.isSome(rows) ? Effect.as(take(rows.value), true) : Effect.succeed(false);
  };
  return (first, poll, onTxWait) =>
    Effect.gen(function* () {
      if (!(yield* taken(first))) return yield* new LiveBroken({ reason: "a row did not decode" });
      const takenPoll = (after: string | undefined) =>
        Effect.flatMap(poll(after), (read) =>
          "failure" in read
            ? Effect.succeed(read)
            : Effect.map(taken(read), (decoded) =>
                decoded ? read : { failure: "a row did not decode" },
              ),
        );
      yield* Stream.runDrain(
        liveRows(
          { poll: takenPoll, ...(onTxWait === undefined ? undefined : { onTxWait }) },
          first,
        ),
      );
    });
}

/** One follow until interrupted or until the service says it never will again. */
function followed<Part extends string>(
  dependencies: AutomationFollowDependencies,
  kind: FollowKind<Part>,
): Effect.Effect<void> {
  const attempt = Effect.gen(function* () {
    const sealed = yield* kind.live(false);
    if ("failure" in sealed) {
      if (sealed.failure === LIVE_SIGNED_OUT.failure) return false;
      if (sealed.failure === AUTOMATION_CALL_FAILURE.NOT_FOUND) {
        kind.failed(AUTOMATION_CALL_FAILURE.NOT_FOUND);
        return false;
      }
      kind.failed(AUTOMATION_CALL_FAILURE.UNANSWERED);
      return true;
    }
    /**
     * Why the follow ended for good, the first poll's terminal failure, kept
     * whatever answers after it, so a follow that ends is told as not found
     * or ended unsaid.
     */
    let endedBy: string | undefined;
    const noted = (read: Sealed<SealedRead<Part>>) => {
      if (
        endedBy === undefined &&
        "failure" in read &&
        (read.failure === AUTOMATION_CALL_FAILURE.NOT_FOUND ||
          read.failure === LIVE_SIGNED_OUT.failure)
      ) {
        endedBy = read.failure;
      }
      return goneWhereNotFound(read);
    };
    // A follow the service ended for good, as one whose automation is gone, ends here at once, rather than starting again.
    const gone = yield* kind
      .rows(sealed, (after) => Effect.map(kind.live(true, after), noted), dependencies.onTxWait)
      .pipe(
        Effect.as(false),
        Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
      );
    if (gone) {
      if (endedBy === AUTOMATION_CALL_FAILURE.NOT_FOUND) {
        kind.failed(AUTOMATION_CALL_FAILURE.NOT_FOUND);
      }
      return false;
    }
    return true;
  });
  return restarting(attempt);
}

/** What the window follows, followed until interrupted or signed out: a list's rows taken, a history's each change published under what it is of. */
export function followAutomations(
  dependencies: AutomationFollowDependencies,
  scope: AutomationFollow,
): Effect.Effect<void> {
  switch (scope.kind) {
    case AUTOMATION_FOLLOW.WORKSPACE:
      return followed(dependencies, {
        live: (poll, after) => dependencies.liveList(scope.id, poll, after),
        rows: takenRows(automationsLiveRowsSchema, dependencies.takeList),
        failed: (failure) => dependencies.publish({ scope, view: { failure } }),
      });
    case AUTOMATION_FOLLOW.RUNS:
      return followed(dependencies, {
        live: (poll, after) => dependencies.liveRuns(scope.id, poll, after),
        rows: builtViews(
          automationRunsLiveRowsSchema,
          (rows, now) => ({ runs: automationRunsOfLiveRows(rows, now) }),
          automationRunsGraceEdge,
          (view) => dependencies.publish({ scope, view }),
        ),
        failed: (failure) => dependencies.publish({ scope, view: { failure } }),
      });
    case AUTOMATION_FOLLOW.WORKSPACE_RUNS:
      return followed(dependencies, {
        live: (poll, after) => dependencies.liveWorkspaceRuns(scope.id, poll, after),
        rows: builtViews(
          automationWorkspaceRunsLiveRowsSchema,
          (rows, now) => ({ runs: automationWorkspaceRunsOfLiveRows(rows, now) }),
          automationWorkspaceRunsGraceEdge,
          (view) => dependencies.publish({ scope, view }),
        ),
        failed: (failure) => dependencies.publish({ scope, view: { failure } }),
      });
  }
}
