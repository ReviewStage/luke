import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { Deferred, Effect, Exit, Layer, Scope } from "effect";
import { type AgentNotice, AgentNoticeDoors, NOTICE_KIND } from "../agent-notices.js";
import { runModeFor } from "../run-mode.js";
import { recordingReporter } from "../testing/recording-reporter.js";
import { AppStateStore, initialAppState } from "./app-state-store.js";
import { linkClientNotices } from "./client-notices.js";

/**
 * The rules the notices bring with them that no notice test covers: a panel
 * coming forward reads the account's workspaces again, and that read is the
 * client's own, so it runs on the client's scope, ends with it, and reports a
 * defect rather than losing it; and a command an agent asked to run on this
 * Mac is announced once while the panel is behind, its click bringing the
 * window forward, and never while the panel is in front, where the prompt
 * itself stands.
 */

const RUN = {
  launch: { profile: "idle", captureMode: false, fixtureMode: false },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "darwin",
} as const;

/** The notifications posted, as macOS would be handed them. */
const posted: AgentNotice[] = [];

const SILENT_DOORS = Layer.succeed(AgentNoticeDoors, {
  post: (notice) => {
    posted.push(notice);
  },
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
  let forward = 0;
  return Effect.gen(function* () {
    const state = new AppStateStore(initialAppState(RUN, false, []), yield* Effect.context());
    yield* linkClientNotices({
      state,
      host: {
        codingAgentList: () => UNANSWERED,
        codingAgentPage: () => UNANSWERED,
        codingAgentAccountInboxFollow: () => Effect.void,
        codingAgentAccountInboxUnfollow: () => Effect.void,
        onAccountInboxChanged: () => () => undefined,
        onAccountChanged: () => () => undefined,
        tasksRefresh: () => Effect.void,
        workspacesRefresh,
      },
      presenter: {
        openMacCommandAsk: () => {
          forward += 1;
        },
      },
      onPanelFocusChanged: (listener) => {
        focus = listener;
        return () => {
          focus = undefined;
        };
      },
      report: (message) => reported.push(message),
    }).pipe(Effect.provide(SILENT_DOORS), Scope.provide(scope));
    return { focus: () => focus, state, forwarded: () => forward };
  });
}

it.effect(
  "a command asked while the panel is behind is announced once, its click bringing the window forward, and one asked in front is not",
  () =>
    Effect.gen(function* () {
      posted.length = 0;
      const scope = yield* Scope.make();
      const { focus, state, forwarded } = yield* linked(scope, () => Effect.void, []);
      const ask = (id: string) => ({ id, command: "node --version", askedAt: 1 });

      state.update({ macCommands: { asks: [ask("first")] } });
      yield* Effect.yieldNow;
      assert.equal(posted.length, 1);
      assert.deepEqual(posted[0]?.subject, { kind: NOTICE_KIND.MAC_COMMAND_ASK, askId: "first" });
      assert.ok(posted[0]?.title.includes("command"));
      assert.equal(posted[0]?.body.includes("node"), false, "the command itself is not said");
      posted[0]?.onClick();
      assert.equal(forwarded(), 1);

      // The same ask told again, beside a second, announces only the second.
      state.update({ macCommands: { asks: [ask("first"), ask("second")] } });
      yield* Effect.yieldNow;
      assert.deepEqual(
        posted.map((notice) => notice.subject),
        [
          { kind: NOTICE_KIND.MAC_COMMAND_ASK, askId: "first" },
          { kind: NOTICE_KIND.MAC_COMMAND_ASK, askId: "second" },
        ],
      );

      focus()?.(true);
      state.update({ macCommands: { asks: [ask("first"), ask("second"), ask("third")] } });
      yield* Effect.yieldNow;
      assert.equal(posted.length, 2, "the panel in front shows the prompt itself");

      yield* Scope.close(scope, Exit.void);
    }),
);

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
