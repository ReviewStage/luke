import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { Deferred, Effect, Exit, Layer, Scope } from "effect";
import { AgentNoticeDoors } from "../agent-notices.js";
import { runModeFor } from "../run-mode.js";
import { AppStateStore, initialAppState } from "./app-state-store.js";
import { linkClientNotices } from "./client-notices.js";

/**
 * The rule the notices bring with them that no notice test covers: a panel
 * coming forward reads the account's workspaces again, and that read is the
 * client's own, so it runs on the client's scope and ends with it.
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

it.effect(
  "a panel coming forward reads the workspaces again, and that read ends with the client's scope",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const ended = yield* Deferred.make<void>();
      let focus: ((focused: boolean) => void) | undefined;
      const scope = yield* Scope.make();
      yield* linkClientNotices({
        state: new AppStateStore(initialAppState(RUN, false, []), yield* Effect.context()),
        host: {
          codingAgentList: () => UNANSWERED,
          codingAgentPage: () => UNANSWERED,
          codingAgentPullRequest: () => UNANSWERED,
          codingAgentAccountInbox: () => UNANSWERED,
          onAccountChanged: () => () => undefined,
          tasksRefresh: () => Effect.void,
          // A read the host never answers, so only the scope's close can end it.
          workspacesRefresh: () =>
            Effect.andThen(Deferred.succeed(started, undefined), Effect.never).pipe(
              Effect.onInterrupt(() => Deferred.succeed(ended, undefined)),
            ),
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
        report: () => undefined,
      }).pipe(Effect.provide(SILENT_DOORS), Scope.provide(scope));

      assert.ok(focus);
      focus(true);
      yield* Deferred.await(started);
      assert.equal(yield* Deferred.isDone(ended), false);

      yield* Scope.close(scope, Exit.void);
      yield* Deferred.await(ended);
      assert.equal(focus, undefined);
    }),
);
