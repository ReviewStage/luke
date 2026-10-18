import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { TASK_WORK_STATE } from "@luke/features/tasks-view";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { AVATAR_END_REASON, AVATAR_OFF, AVATAR_STATUS } from "@luke/voice/avatar";
import { IDLE_VOICE_VIEW } from "@luke/voice/voice-view";
import { MESSAGE_ROLE } from "@luke/wire";
import { Context, Effect, Fiber, Stream } from "effect";
import { type AppState, sessionReplayBootstrap } from "../app-state.js";
import type { HostBootstrap } from "../host-operator.js";
import { runModeFor } from "../run-mode.js";
import { recordingReporter } from "../testing/recording-reporter.js";
import {
  AppStateStore,
  bootstrapPatch,
  initialAppState,
  publishAppStateChanges,
  voiceWindowGone,
  voiceWindowState,
  windowAppState,
} from "./app-state-store.js";

/**
 * The document and the one path out of it. What is proven here is what the
 * rest of the client leans on: a patch that says nothing changes nothing, a
 * slice is replaced whole, the version only ever climbs, and `changes`
 * carries exactly one document per applied patch.
 */

const RUN = {
  launch: {
    captureOutput: undefined,
    profile: "idle",
    captureMode: false,
    fixtureMode: false,
  },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "darwin",
} as const;

function store(): AppStateStore {
  return new AppStateStore(initialAppState(RUN, true, []), Context.empty());
}

/**
 * The `count` documents `changes` carries once `act` has run, starting with
 * the one standing before it: `SubscriptionRef.changes` is the current value
 * concatenated with every value set after, so this always opens with the
 * document as it stood before `act`'s own writes. The collector is forked and
 * given one turn to reach its own subscription — a `SubscriptionRef`'s
 * `changes` only delivers a write to a subscriber already reading when it
 * happens — before `act`'s synchronous writes run.
 */
function watchChanges(
  app: AppStateStore,
  count: number,
  act: () => void,
): Effect.Effect<AppState[]> {
  return Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Stream.runCollect(Stream.take(app.changes, count)));
    yield* Effect.yieldNow;
    act();
    return yield* Fiber.join(fiber);
  });
}

/**
 * A payload the document only ever carries whole. The store never reads
 * inside one — it compares and holds — so what stands in for a settings
 * snapshot, a roster entry, or a run record is an empty record, and the one
 * assertion that says so is here rather than at each of them.
 */
function inert<Value>(): Value {
  // SAFETY: nothing under test reads a field of these payloads; only their identity and equality are exercised.
  return {} as Value;
}

const SETTINGS = inert<NonNullable<AppState["settings"]>>();

it.effect("one slice patched bumps the version once and announces once on `changes`", () =>
  Effect.gen(function* () {
    const app = store();
    const seen = yield* watchChanges(app, 2, () => {
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[1]?.version, 1);
    assert.equal(seen[1]?.audio.microphoneStatus, MICROPHONE_STATUS.GRANTED);
  }),
);

it.effect("a patch that says nothing new announces nothing on `changes`", () =>
  Effect.gen(function* () {
    const app = store();
    const seen = yield* watchChanges(app, 2, () => {
      app.update({});
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.NOT_DETERMINED } });
      app.update({ voice: { avatar: AVATAR_OFF } });
      // The one real patch is the second document `changes` ever carries; the
      // three no-ops before it wrote nothing for a collector to see.
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.version, 0);
    assert.equal(seen[1]?.version, 1);
  }),
);

it("two slices in one patch are one version", () => {
  const app = store();
  app.update({
    audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED },
    voice: { view: IDLE_VOICE_VIEW, avatar: AVATAR_OFF },
  });
  assert.equal(app.snapshot().version, 1);
  assert.equal(app.snapshot().voice.view, IDLE_VOICE_VIEW);
});

it.effect("a touch re-announces the document without numbering it again", () =>
  Effect.gen(function* () {
    const app = store();
    const seen = yield* watchChanges(app, 4, () => {
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
      app.touch();
      app.touch();
    });
    assert.deepEqual(
      seen.map((state) => state.version),
      [0, 1, 1, 1],
    );
  }),
);

it("a voice window that went away leaves the document holding no view, and the avatar standing", () => {
  const app = store();
  assert.deepEqual(app.snapshot().voice.avatar, AVATAR_OFF);
  const ended = { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.SERVER_CLOSED };
  app.update({ voice: { view: { ...IDLE_VOICE_VIEW, talkOpening: true }, avatar: ended } });
  app.update({ voice: voiceWindowGone(app.snapshot().voice) });
  assert.equal(app.snapshot().voice.view, undefined);
  assert.deepEqual(app.snapshot().voice.avatar, ended);
});

const BOOT: HostBootstrap = {
  settings: SETTINGS,
  account: inert(),
  sessionReplay: { permitted: true, accountId: "person" },
  voiceAvailable: true,
  agentTraceEnabled: true,
};

it("a host bootstrap lands in the document as the host answered it", () => {
  const app = store();
  app.update(bootstrapPatch(app.snapshot(), BOOT));
  const held = app.snapshot();
  assert.equal(held.run.agentTraceEnabled, true);
  assert.deepEqual(held.sessionReplay, { permitted: true, accountId: "person", halted: false });
});

it("a halt outlives every host read until the host's own event stands it down", () => {
  const app = store();
  app.update(bootstrapPatch(app.snapshot(), BOOT));
  app.update({ sessionReplay: { ...app.snapshot().sessionReplay, halted: true } });
  // The account is going and the host still answers `permitted` until its
  // store has caught up; a window bootstrapping in that window must not
  // restart a recording that was stood down.
  app.update(bootstrapPatch(app.snapshot(), BOOT));
  assert.equal(app.snapshot().sessionReplay.halted, true);
  assert.equal(sessionReplayBootstrap(app.snapshot()).permitted, false);
});

it("recording is what the host permitted less what an account's end stood down", () => {
  const app = store();
  app.update({ sessionReplay: { permitted: true, accountId: "person", halted: false } });
  assert.deepEqual(sessionReplayBootstrap(app.snapshot()), {
    permitted: true,
    appVersion: "1.2.3",
    packaged: true,
    accountId: "person",
  });
  app.update({ sessionReplay: { ...app.snapshot().sessionReplay, halted: true } });
  assert.equal(sessionReplayBootstrap(app.snapshot()).permitted, false);
});

it("the voice and call windows are sent the document, and answered their first read of it, without the planning turns' work or the plan's planning conversation, and the rest of the plan as held", () => {
  const held = initialAppState(RUN, true, []);
  const tasks = {
    ...held.tasks,
    activeTaskId: "plan-1",
    work: [
      {
        turnId: "turn-1",
        startedAt: 0,
        state: TASK_WORK_STATE.DONE,
        earlierOmitted: false,
        journal: [{ type: "text", text: "Invites live in one file." }],
        workers: [],
      },
    ],
    conversation: {
      messages: [
        {
          id: "turn-1",
          role: MESSAGE_ROLE.ASSISTANT,
          turnId: "turn-1",
          parts: [
            {
              type: "tool-run_on_mac",
              toolCallId: "call-1",
              state: "output-available",
              input: { command: "git status" },
              output: { status: "ran", stdout: "On branch invite-expiry", stderr: "" },
            },
          ],
        },
      ],
      cursor: "1:1",
      status: CODING_AGENT_STATUS.COMPLETED,
      title: null,
    },
  } as const;
  const sent = voiceWindowState({ ...held, tasks: tasks });
  assert.equal(sent.tasks.activeTaskId, "plan-1");
  assert.equal("work" in sent.tasks, false);
  assert.equal("conversation" in sent.tasks, false);
  assert.doesNotMatch(JSON.stringify(sent), /invite-expiry/u);
  // A window's first read of the document answers the same: the voice and call windows' without either, a panel's whole.
  for (const window of [
    { voice: true, call: false },
    { voice: false, call: true },
  ]) {
    assert.doesNotMatch(
      JSON.stringify(windowAppState({ ...held, tasks: tasks }, window)),
      /invite-expiry/u,
    );
  }
  const panel = windowAppState({ ...held, tasks: tasks }, { voice: false, call: false });
  assert.equal(panel.tasks.conversation?.cursor, "1:1");
  assert.deepEqual(sent.run, held.run);
});

it.effect(
  "a push that dies is reported, to Sentry as well, and the next change is still pushed",
  () => {
    const sentry = recordingReporter();
    return Effect.gen(function* () {
      const app = store();
      const reported: string[] = [];
      let pushes = 0;
      const publish = () =>
        Effect.suspend(() => {
          pushes += 1;
          return pushes === 1 ? Effect.die(new Error("the window went away")) : Effect.void;
        });
      yield* publishAppStateChanges(app, publish, (message) => reported.push(message));
      yield* Effect.yieldNow;
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
      yield* Effect.yieldNow;
      assert.equal(pushes, 2);
      assert.deepEqual(reported, ["the app-state push to windows failed: the window went away"]);
      assert.deepEqual(sentry.reported, ["the window went away"]);
    }).pipe(Effect.scoped, Effect.provide(sentry.layer));
  },
);
