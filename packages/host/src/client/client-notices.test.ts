import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { AGENT_STATUS, type AgentStatus, type TasklessAgent } from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { Deferred, Effect, Exit, Layer, Scope } from "effect";
import { type AgentNotice, AgentNoticeDoors, NOTICE_KIND } from "../agent-notices.js";
import { type AppHostRead, type AppTranscript, OWN_TRANSCRIPT } from "../app-state.js";
import { runModeFor } from "../run-mode.js";
import { recordingReporter } from "../testing/recording-reporter.js";
import { AppStateStore, initialAppState } from "./app-state-store.js";
import { linkClientNotices } from "./client-notices.js";

const RUN = {
  launch: { profile: "idle", captureMode: false, fixtureMode: false },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "darwin",
} as const;

const posted: AgentNotice[] = [];

const SILENT_DOORS = Layer.succeed(AgentNoticeDoors, {
  post: (notice) => {
    posted.push(notice);
  },
  badge: () => undefined,
});

const UNANSWERED = Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED });

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
        agentList: () => UNANSWERED,
        agentPage: () => UNANSWERED,
        agentAccountInboxFollow: () => Effect.void,
        agentAccountInboxUnfollow: () => Effect.void,
        onAccountInboxChanged: () => () => undefined,
        onAccountChanged: () => () => undefined,
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

const TASKLESS: TasklessAgent = {
  id: "a1b2c3d4-0000-4000-8000-0000000000aa",
  planId: null,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: null,
  createdAt: 1,
  status: AGENT_STATUS.RUNNING,
  turnId: "turn-1",
  automationId: null,
  workspaceId: "workspace-personal",
  repository: null,
  activityAt: 1,
};

function transcriptAt(status: AgentStatus, pages = 1): AppHostRead<AppTranscript> {
  return {
    rows: { messages: [], cursor: "1:0", word: { status, title: null, caughtUp: true }, pages },
  };
}

it.effect(
  "an agent's own transcript a window holds notes the agent's end as its read moves, and a worker's transcript settling says nothing of the agent",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const { state } = yield* linked(scope, () => Effect.void, []);
      const settled = Effect.repeat(Effect.yieldNow, { times: 20 });
      state.update({ tasks: { ...state.snapshot().tasks, tasklessAgents: [TASKLESS] } });
      yield* settled;
      const held = (...[worker, own]: readonly AgentStatus[]) => ({
        [TASKLESS.id]: {
          "call-7": transcriptAt(worker ?? AGENT_STATUS.RUNNING),
          ...(own === undefined ? undefined : { [OWN_TRANSCRIPT]: transcriptAt(own) }),
        },
      });

      state.update({ [LIVE_READ.TRANSCRIPT]: held(AGENT_STATUS.COMPLETED) });
      yield* settled;
      assert.deepEqual(
        state.snapshot().agents.unseen,
        [],
        "a worker's end is no word on the agent",
      );

      state.update({ [LIVE_READ.TRANSCRIPT]: held(AGENT_STATUS.COMPLETED, AGENT_STATUS.RUNNING) });
      yield* settled;
      state.update({
        [LIVE_READ.TRANSCRIPT]: {
          [TASKLESS.id]: { [OWN_TRANSCRIPT]: transcriptAt(AGENT_STATUS.COMPLETED, 2) },
        },
      });
      yield* settled;
      assert.deepEqual(state.snapshot().agents.unseen, [TASKLESS.id]);

      yield* Scope.close(scope, Exit.void);
    }),
);

it.effect(
  "an agent's own transcript held again as it was let go says nothing of the turn now running, and a page read since does",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const { state } = yield* linked(scope, () => Effect.void, []);
      const settled = Effect.repeat(Effect.yieldNow, { times: 20 });
      const own = (read: AppHostRead<AppTranscript>) => ({
        [LIVE_READ.TRANSCRIPT]: { [TASKLESS.id]: { [OWN_TRANSCRIPT]: read } },
      });

      const ended = transcriptAt(AGENT_STATUS.COMPLETED, 2);
      state.update(own(ended));
      yield* settled;
      state.update({
        tasks: { ...state.snapshot().tasks, tasklessAgents: [{ ...TASKLESS, turnId: "turn-2" }] },
      });
      yield* settled;
      const word = { status: AGENT_STATUS.COMPLETED, title: null, caughtUp: false };
      state.update(own({ rows: { messages: [], cursor: "1:0", word, pages: 2 } }));
      yield* settled;
      assert.deepEqual(
        state.snapshot().agents.unseen,
        [],
        "the last turn's end does not close the turn now running",
      );

      state.update(own(transcriptAt(AGENT_STATUS.COMPLETED, 3)));
      yield* settled;
      assert.deepEqual(state.snapshot().agents.unseen, [TASKLESS.id]);

      yield* Scope.close(scope, Exit.void);
    }),
);

it.effect(
  "an agent's own transcript let go for good while a worker's stands, and read anew, notes its pages from the first",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const { state } = yield* linked(scope, () => Effect.void, []);
      const settled = Effect.repeat(Effect.yieldNow, { times: 20 });
      const worker = { "call-7": transcriptAt(AGENT_STATUS.RUNNING) };
      const held = (own?: AppHostRead<AppTranscript>) => ({
        [LIVE_READ.TRANSCRIPT]: {
          [TASKLESS.id]: own === undefined ? worker : { ...worker, [OWN_TRANSCRIPT]: own },
        },
      });
      state.update({ tasks: { ...state.snapshot().tasks, tasklessAgents: [TASKLESS] } });
      yield* settled;

      state.update(held(transcriptAt(AGENT_STATUS.RUNNING, 1)));
      yield* settled;
      state.update(held());
      yield* settled;
      state.update(held(transcriptAt(AGENT_STATUS.COMPLETED, 1)));
      yield* settled;
      assert.deepEqual(state.snapshot().agents.unseen, [TASKLESS.id]);

      yield* Scope.close(scope, Exit.void);
    }),
);
