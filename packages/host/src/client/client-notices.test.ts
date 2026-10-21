import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { Deferred, Effect, Exit, Layer, Scope } from "effect";
import { AgentNoticeDoors } from "../agent-notices.js";
import { runModeFor } from "../run-mode.js";
import { recordingReporter } from "../testing/recording-reporter.js";
import { AppStateStore, initialAppState } from "./app-state-store.js";
import { linkClientNotices } from "./client-notices.js";

/**
 * The rule the notices bring with them that no notice test covers: a panel
 * coming forward reads the account's workspaces again, and that read is the
 * client's own, so it runs on the client's scope, ends with it, and reports a
 * defect rather than losing it.
 */

const RUN = {
  launch: { profile: "idle", captureMode: false, fixtureMode: false },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "darwin",
} as const;

const SILENT_DOORS = Layer.succeed(AgentNoticeDoors, {
  post: () => undefined,
  toast: () => undefined,
  toastInbox: () => undefined,
  toastFailedRun: () => undefined,
  toastChat: () => undefined,
  badge: () => undefined,
});

const UNANSWERED = Effect.succeed({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });

/**
 * The notices linked into `scope` over a host whose workspaces read is
 * `workspacesRefresh`, with every report written to `reported`; the focus
 * listener the panel would call is answered by `focus()`.
 */
function linked(
  scope: Scope.Closeable,
  workspacesRefresh: () => Effect.Effect<void>,
  reported: string[],
) {
  let focus: ((focused: boolean) => void) | undefined;
  return Effect.gen(function* () {
    yield* linkClientNotices({
      state: new AppStateStore(initialAppState(RUN, false, []), yield* Effect.context()),
      host: {
        codingAgentList: () => UNANSWERED,
        codingAgentPage: () => UNANSWERED,
        codingAgentPullRequest: () => UNANSWERED,
        codingAgentAccountInboxFollow: () => Effect.void,
        codingAgentAccountInboxUnfollow: () => Effect.void,
        onAccountInboxChanged: () => () => undefined,
        onAccountChanged: () => () => undefined,
        tasksRefresh: () => Effect.void,
        workspacesRefresh,
      },
      presenter: {
        open: () => undefined,
        openInbox: () => undefined,
        openTasklessItem: () => undefined,
        openFailedRun: () => undefined,
        openChat: () => undefined,
      },
      onPanelFocusChanged: (listener) => {
        focus = listener;
        return () => {
          focus = undefined;
        };
      },
      report: (message) => reported.push(message),
    }).pipe(Effect.provide(SILENT_DOORS), Scope.provide(scope));
    return { focus: () => focus };
  });
}

it.effect(
  "a panel coming forward reads the workspaces again, and that read ends with the client's scope",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const ended = yield* Deferred.make<void>();
      const scope = yield* Scope.make();
      // A read the host never answers, so only the scope's close can end it.
      const { focus } = yield* linked(
        scope,
        () =>
          Effect.andThen(Deferred.succeed(started, undefined), Effect.never).pipe(
            Effect.onInterrupt(() => Deferred.succeed(ended, undefined)),
          ),
        [],
      );

      focus()?.(true);
      yield* Deferred.await(started);
      assert.equal(yield* Deferred.isDone(ended), false);

      yield* Scope.close(scope, Exit.void);
      yield* Deferred.await(ended);
      assert.equal(focus(), undefined);
    }),
);

it.effect("a workspaces read that dies is reported, to Sentry as well, rather than lost", () => {
  const sentry = recordingReporter();
  return Effect.gen(function* () {
    const reported: string[] = [];
    const scope = yield* Scope.make();
    const { focus } = yield* linked(
      scope,
      () => Effect.die(new Error("the gateway went away")),
      reported,
    );

    focus()?.(true);
    yield* Effect.yieldNow;

    assert.deepEqual(reported, ["the workspaces refresh failed: the gateway went away"]);
    assert.deepEqual(sentry.reported, ["the gateway went away"]);
    yield* Scope.close(scope, Exit.void);
  }).pipe(Effect.provide(sentry.layer));
});
