import {
  type AutomationRunsLiveAnswer,
  type AutomationsLiveAnswer,
  automationRunsGraceEdge,
  automationRunsLiveRowsSchema,
  automationRunsOfLiveRows,
  automationsGraceEdge,
  automationsLiveRowsSchema,
  automationsOfLiveRows,
} from "@luke/features/automation-live";
import {
  AUTOMATION_FOLLOW,
  type AutomationFollow,
  type AutomationFollowed,
  type AutomationListView,
  type AutomationRunsView,
} from "@luke/features/automation-view";
import { Clock, Duration, Effect, Option, Schema, Stream } from "effect";
import { LiveBroken, type LiveClient, liveRows, type SealedRead } from "./live-follow.js";

/**
 * automation-follow.ts -- a workspace's automations, or an automation's runs, followed over Neon Realtime for the windows that draw them, or read each minute where the service seals neither.
 *
 * The sealed statement is fetched from the service and followed
 * (`live-follow.ts`); its rows are decoded where they arrive and the list
 * or the history is built from them (`@luke/features/automation-live`) at
 * the host's own instant, and again at the one instant the clock alone
 * moves a run's agent, the end of its starting grace. The sealed statement
 * stays here, where the account's own bearer is; only what is built from it
 * is published.
 *
 * A service that seals nothing, an older one or one whose deployment has no
 * Realtime, or an automation the account no longer reads, is read as the
 * window read it before: once now and once a minute, asking again for the
 * live read every `LIVE_RETRY`. A subscription that stops for good is
 * started again after `LIVE_RESTART`.
 */

/** How long the minute's reads stand in before the live read is asked for again. */
const LIVE_RETRY = Duration.minutes(5);
/** How long after a subscription stopped for good it is started again. */
const LIVE_RESTART = Duration.seconds(5);
/** How often the list or the history is read where it is not followed live, as the window read it before. */
const HELD_EVERY = Duration.minutes(1);

export interface AutomationFollowDependencies {
  /** A workspace's automations sealed, fetched from the service; a failure where it sealed none. */
  readonly liveList: (
    workspaceId: string,
  ) => Effect.Effect<AutomationsLiveAnswer | { readonly failure: string }>;
  /** An automation's runs sealed, fetched from the service; a failure where it sealed none. */
  readonly liveRuns: (
    automationId: string,
  ) => Effect.Effect<AutomationRunsLiveAnswer | { readonly failure: string }>;
  /** A workspace's automations read once, as the window read them before. */
  readonly heldList: (workspaceId: string) => Effect.Effect<AutomationListView>;
  /** An automation's runs read once, as the window read them before. */
  readonly heldRuns: (automationId: string) => Effect.Effect<AutomationRunsView>;
  readonly openLive: (url: string) => LiveClient;
  /** Now, by the host's own clock, which renewals are timed by. */
  readonly now: () => number;
  /** The service's origin, which a webhook automation's address is written on. */
  readonly serviceBaseUrl: string;
  /** What was followed, each time it moves. */
  readonly publish: (followed: AutomationFollowed) => void;
}

/** One kind of follow: how it is sealed, read, decoded, built, and published. */
interface FollowKind<Part extends string, Rows, View> {
  readonly live: () => Effect.Effect<SealedRead<Part> | { readonly failure: string }>;
  readonly held: Effect.Effect<View>;
  readonly rows: Schema.Codec<Rows, unknown>;
  readonly build: (rows: Rows, now: number) => View;
  readonly edge: (rows: Rows, now: number) => number | undefined;
  readonly publish: (view: View) => void;
}

/** The view the rows make now, and again at each instant the clock alone moves it, until the rows move. */
function viewsOf<Rows, View>(
  kind: FollowKind<string, Rows, View>,
  rows: Rows,
): Stream.Stream<View> {
  return Stream.unwrap(
    Effect.map(Clock.currentTimeMillis, (at) => {
      const now = Stream.succeed(kind.build(rows, at));
      const edge = kind.edge(rows, at);
      if (edge === undefined) return now;
      const later = Stream.fromEffect(Effect.sleep(Duration.millis(edge - at)));
      return Stream.concat(
        now,
        Stream.flatMap(later, () => viewsOf(kind, rows)),
      );
    }),
  );
}

/** One follow until interrupted: live where the service seals it, read each minute where it does not. */
function followed<Part extends string, Rows, View>(
  dependencies: AutomationFollowDependencies,
  kind: FollowKind<Part, Rows, View>,
): Effect.Effect<never> {
  const decode = Schema.decodeUnknownOption(kind.rows);
  const held = Effect.forever(
    Effect.andThen(
      Effect.flatMap(kind.held, (view) => Effect.sync(() => kind.publish(view))),
      Effect.sleep(HELD_EVERY),
    ),
  ).pipe(Effect.timeoutOption(LIVE_RETRY), Effect.asVoid);
  const attempt = Effect.gen(function* () {
    const sealed = yield* kind.live();
    if ("failure" in sealed) return yield* held;
    const rows = liveRows(
      { openLive: dependencies.openLive, reseal: kind.live, now: dependencies.now },
      sealed,
    ).pipe(
      Stream.mapEffect((read) =>
        Option.match(decode(read), {
          onNone: () => Effect.fail(new LiveBroken({ reason: "a row did not decode" })),
          onSome: Effect.succeed,
        }),
      ),
    );
    yield* Stream.runForEach(
      Stream.switchMap(rows, (decoded) => viewsOf(kind, decoded)),
      (view) => Effect.sync(() => kind.publish(view)),
    ).pipe(Effect.catch(() => Effect.void));
    yield* Effect.sleep(LIVE_RESTART);
  });
  return Effect.forever(attempt);
}

/** What the window follows, followed until interrupted, each change published under what it is of. */
export function followAutomations(
  dependencies: AutomationFollowDependencies,
  scope: AutomationFollow,
): Effect.Effect<never> {
  switch (scope.kind) {
    case AUTOMATION_FOLLOW.WORKSPACE:
      return followed(dependencies, {
        live: () => dependencies.liveList(scope.id),
        held: dependencies.heldList(scope.id),
        rows: automationsLiveRowsSchema,
        build: (rows, now) => ({
          automations: automationsOfLiveRows(rows, now, dependencies.serviceBaseUrl),
        }),
        edge: automationsGraceEdge,
        publish: (view) => dependencies.publish({ scope, view }),
      });
    case AUTOMATION_FOLLOW.RUNS:
      return followed(dependencies, {
        live: () => dependencies.liveRuns(scope.id),
        held: dependencies.heldRuns(scope.id),
        rows: automationRunsLiveRowsSchema,
        build: (rows, now) => ({ runs: automationRunsOfLiveRows(rows, now) }),
        edge: automationRunsGraceEdge,
        publish: (view) => dependencies.publish({ scope, view }),
      });
  }
}
