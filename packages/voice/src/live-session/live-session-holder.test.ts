import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  type TaskActivityFrame,
  type TaskCallEndingFrame,
  type TaskCodeFrame,
  VOICE_SERVICE_FRAME,
} from "@luke/features";
import { LIVE_SESSION_PHASE, type VoiceLiveSessionChanged } from "@luke/gateway";
import { LIVE_SERVER_EVENT, type LiveClientEvent, parseLiveServerEvent } from "@luke/live";
import type { WireRecord } from "@luke/wire";
import { Effect, type Scope, type Stream } from "effect";
import { holdSocket, type SocketHold } from "../held-socket.js";
import type { LiveSessionOpened, LiveSessionSource } from "../live-session-source.js";
import { type LiveSideband, type SidebandArrival, sidebandOverSocket } from "../live-socket.js";
import type { VoiceCallAbout } from "../voice-view.js";
import { LiveSessionHolder } from "./live-session-holder.js";

/**
 * The peer's holder of one hosted task call, over a scripted source and
 * sideband. What these hold to is the whole of what the desktop still sends
 * once the exchange is the service's: the task at creation, the stop, the
 * hang-up, and the idle report through the source's own door, and nothing on
 * a delegation, a transcript, or an acknowledgment, which are the service's
 * to read.
 */

const INVITES_TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
/** The agent of a task every call in these tests speaks into; only its task matters to the holder. */
const INVITES_AGENT = "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40";

class FakeSideband implements LiveSideband {
  readonly sent: LiveClientEvent[] = [];
  /** How many times the source's hang-up door asked the service to close this session. */
  hangUps = 0;
  closed = false;
  readonly #hold: SocketHold = holdSocket({
    send: () => undefined,
    ping: () => undefined,
    close: () => {
      this.closed = true;
    },
  });
  readonly #sideband: LiveSideband = sidebandOverSocket(this.#hold.socket);

  get arrivals(): Stream.Stream<SidebandArrival> {
    return this.#sideband.arrivals;
  }

  send(event: LiveClientEvent): Effect.Effect<void> {
    return Effect.sync(() => {
      this.sent.push(event);
    });
  }

  get close(): Effect.Effect<void> {
    return this.#sideband.close;
  }

  receive(payload: WireRecord): void {
    const frame = JSON.stringify(payload);
    assert.ok(parseLiveServerEvent(frame), `a test event must parse: ${frame}`);
    this.#hold.hear({ frame });
  }

  started(sessionId: string): void {
    this.receive({
      type: LIVE_SERVER_EVENT.SESSION_STARTED,
      event_id: "started",
      session: { id: sessionId },
    });
  }

  closedBy(reason: string, seconds: number): void {
    this.receive({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "closed",
      reason,
      usage: { seconds },
    });
  }

  dropConnection(): void {
    this.#hold.hear({ close: { code: 1006 } });
  }
}

function settle() {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
  });
}

interface Fixture {
  holder: LiveSessionHolder;
  sidebands: FakeSideband[];
  /** The task each session was created about, in order; none for a call into an agent with no task. */
  tasks: (string | undefined)[];
  changes: VoiceLiveSessionChanged[];
  /** Every idle report the source's door was handed, in order. */
  reports: boolean[];
  /** How many times the source's stop door was asked. */
  stops: number;
  /** Every line the source's typed door was handed, in order. */
  typed: string[];
  /** Every activity frame the holder told its caller, in order. */
  activity: TaskActivityFrame[];
  /** The service's activity frame, as the source's door would deliver it. */
  tellActivity(activity: TaskActivityFrame): void;
  /** Every code frame the holder told its caller, in order. */
  code: TaskCodeFrame[];
  /** The service's code frame, as the source's door would deliver it. */
  tellCode(code: TaskCodeFrame): void;
  /** The service's word that Luke is ending the call, as the source's door would deliver it. */
  tellEnding(ending: TaskCallEndingFrame): void;
  /** Every call the holder told its caller ended, in order. */
  callsEnded: VoiceCallAbout[];
  created: number;
  sourceAvailable: boolean;
  /** Whether the source opens the doors for the idle report and the stop, as the hosted source does and the keyed one does not. */
  reportsActivity: boolean;
  /** Where a creation waits before the source answers, so a test can hold one in flight. */
  createGate: Effect.Effect<void>;
  open(taskId?: string): Effect.Effect<FakeSideband>;
}

function fixture(): Effect.Effect<Fixture, never, Scope.Scope> {
  return Effect.gen(function* () {
    const sidebands: FakeSideband[] = [];
    const tasks: (string | undefined)[] = [];
    const changes: VoiceLiveSessionChanged[] = [];
    const reports: boolean[] = [];
    const activity: TaskActivityFrame[] = [];
    let activityListener: ((activity: TaskActivityFrame) => void) | undefined;
    const code: TaskCodeFrame[] = [];
    let codeListener: ((code: TaskCodeFrame) => void) | undefined;
    let endingListener: ((ending: TaskCallEndingFrame) => void) | undefined;
    const callsEnded: VoiceCallAbout[] = [];
    const typed: string[] = [];
    const state = {
      sourceAvailable: true,
      reportsActivity: true,
      created: 0,
      stops: 0,
      createGate: Effect.void satisfies Effect.Effect<void>,
    };
    const source: LiveSessionSource = {
      create: (input) =>
        Effect.map(state.createGate, () => {
          tasks.push(input.taskId);
          const sideband = new FakeSideband();
          sidebands.push(sideband);
          const opened: LiveSessionOpened = {
            sessionId: `sess-${sidebands.length}`,
            sdpAnswer: `answer-for-${input.sdpOffer}`,
            attach: () => Effect.succeed(sideband),
            hangUp: () => {
              sideband.hangUps += 1;
            },
            ...(state.reportsActivity
              ? {
                  reportActivity: (idle: boolean) => {
                    reports.push(idle);
                  },
                  stopSpeaking: () => {
                    state.stops += 1;
                  },
                  typeLine: (text: string, clientKey: string) => {
                    typed.push(`${clientKey}:${text}`);
                  },
                  onTaskActivity: (listener: (activity: TaskActivityFrame) => void) => {
                    activityListener = listener;
                  },
                  onTaskCode: (listener: (code: TaskCodeFrame) => void) => {
                    codeListener = listener;
                  },
                  onTaskCallEnding: (listener: (ending: TaskCallEndingFrame) => void) => {
                    endingListener = listener;
                  },
                }
              : undefined),
          };
          return opened;
        }),
      setVoice: () => undefined,
      diagnostics: () => {
        throw new Error("not read here");
      },
    };
    const holder = yield* LiveSessionHolder.make({
      source: () => (state.sourceAvailable ? source : undefined),
      createId: () => "request",
      emit: (change) => changes.push(change),
      onTaskActivity: (word) => {
        activity.push(word);
      },
      onTaskCode: (frame) => {
        code.push(frame);
      },
      onTaskCallEnded: (about) => {
        callsEnded.push(about);
      },
      onSessionCreated: () => {
        state.created += 1;
      },
    });
    return {
      holder,
      sidebands,
      tasks,
      changes,
      reports,
      get created() {
        return state.created;
      },
      get sourceAvailable() {
        return state.sourceAvailable;
      },
      set sourceAvailable(value: boolean) {
        state.sourceAvailable = value;
      },
      get stops() {
        return state.stops;
      },
      typed,
      activity,
      tellActivity: (word) => {
        activityListener?.(word);
      },
      code,
      tellCode: (frame) => {
        codeListener?.(frame);
      },
      tellEnding: (frame) => {
        endingListener?.(frame);
      },
      callsEnded,
      get reportsActivity() {
        return state.reportsActivity;
      },
      set reportsActivity(value: boolean) {
        state.reportsActivity = value;
      },
      get createGate() {
        return state.createGate;
      },
      set createGate(value: Effect.Effect<void>) {
        state.createGate = value;
      },
      open: (taskId = INVITES_TASK) =>
        Effect.gen(function* () {
          const created = yield* holder.createSession("offer", { taskId, agentId: INVITES_AGENT });
          assert.ok(created);
          const sideband = sidebands[sidebands.length - 1];
          assert.ok(sideband);
          sideband.started(created.sessionId);
          yield* settle();
          return sideband;
        }),
    };
  });
}

function phases(changes: readonly VoiceLiveSessionChanged[]) {
  return changes.map((change) => change.phase);
}

it.effect(
  "a created session is about its plan, attached before the answer, and its phases are announced",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const created = yield* f.holder.createSession("offer", {
        taskId: INVITES_TASK,
        agentId: INVITES_AGENT,
      });
      assert.deepEqual(created, {
        sessionId: "sess-1",
        sdpAnswer: "answer-for-offer",
      });
      assert.equal(f.created, 1);
      assert.equal(f.holder.sessionStands(), true);
      assert.deepEqual(f.tasks, [INVITES_TASK]);
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.CREATED]);
      f.sidebands[0]?.started("sess-1");
      yield* settle();
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.CREATED, LIVE_SESSION_PHASE.STARTED]);
      // Nothing is sent at creation or start: the exchange is the service's, and it seeds nothing twice.
      assert.deepEqual(f.sidebands[0]?.sent, []);
    }),
);

it.effect(
  "a line typed to the agent the standing call speaks into reaches the service's door, and one typed to another agent, before the call starts, or after it ends does not",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const created = yield* f.holder.createSession("offer", {
        taskId: INVITES_TASK,
        agentId: INVITES_AGENT,
      });
      assert.ok(created);
      // Not started yet: nothing can hear it, so the line is the composer's to steer.
      assert.equal(f.holder.typeLine(INVITES_AGENT, "Too early.", "send-0"), false);
      f.sidebands[0]?.started(created.sessionId);
      yield* settle();
      assert.equal(f.holder.typeLine("another-agent", "Not this call's.", "send-1"), false);
      assert.equal(f.holder.typeLine(INVITES_AGENT, "Use the fixture branch.", "send-2"), true);
      assert.deepEqual(f.typed, ["send-2:Use the fixture branch."]);
      f.sidebands[0]?.closedBy("close_requested", 3);
      yield* settle();
      assert.equal(f.holder.typeLine(INVITES_AGENT, "After the call.", "send-3"), false);
      assert.deepEqual(f.typed, ["send-2:Use the fixture branch."]);
    }),
);

/** An agent an automation started with no task, whose call is keyed by the agent alone. */
const TASKLESS_AGENT = "5e2c9a7d-1b3f-4c8e-a6d0-3f7b2e9c1a58";

it.effect(
  "a call into an agent with no task names none, hears the service's frames about that agent and no other, and its end names the agent",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const created = yield* f.holder.createSession("offer", { agentId: TASKLESS_AGENT });
      assert.ok(created);
      assert.deepEqual(f.tasks, [undefined]);
      f.sidebands[0]?.started(created.sessionId);
      yield* settle();
      const shown = { callId: "call-1", turnId: "turn-1", shownAt: 1, agentId: TASKLESS_AGENT };
      const code = {
        ref: { path: "src/app.ts", startLine: 1, endLine: 2 },
        repository: "acme/app",
        firstLine: 1,
        lineCount: 2,
        lines: ["one", "two"],
      };
      f.tellActivity({
        type: VOICE_SERVICE_FRAME.TASK_ACTIVITY,
        agentId: TASKLESS_AGENT,
        notes: true,
      });
      f.tellActivity({
        type: VOICE_SERVICE_FRAME.TASK_ACTIVITY,
        agentId: INVITES_AGENT,
        notes: true,
      });
      f.tellActivity({
        type: VOICE_SERVICE_FRAME.TASK_ACTIVITY,
        planId: INVITES_TASK,
        notes: true,
      });
      f.tellCode({ type: VOICE_SERVICE_FRAME.TASK_CODE, ...shown, code });
      f.tellCode({
        type: VOICE_SERVICE_FRAME.TASK_CODE,
        ...shown,
        agentId: INVITES_AGENT,
        callId: "call-2",
        code,
      });
      assert.deepEqual(
        f.activity.map((word) => word.agentId),
        [TASKLESS_AGENT],
      );
      assert.deepEqual(
        f.code.map((frame) => frame.callId),
        ["call-1"],
      );
      f.sidebands[0]?.closedBy("close_requested", 3);
      yield* settle();
      assert.deepEqual(f.callsEnded, [{ agentId: TASKLESS_AGENT }]);
      // The end says nothing doing about the agent, which names no task.
      assert.deepEqual(f.activity.at(-1), {
        type: VOICE_SERVICE_FRAME.TASK_ACTIVITY,
        agentId: TASKLESS_AGENT,
        notes: false,
      });
    }),
);

it.effect(
  "a task's call still hears a service that names its task alone, and a delete of another task ends nothing",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* f.open();
      f.tellActivity({
        type: VOICE_SERVICE_FRAME.TASK_ACTIVITY,
        planId: INVITES_TASK,
        notes: true,
      });
      assert.equal(f.activity.length, 1);
      yield* f.holder.endTaskCall("another-task");
      assert.equal(f.holder.sessionStands(), true);
      f.sidebands[0]?.closedBy("close_requested", 3);
      yield* settle();
      assert.deepEqual(f.callsEnded, [{ agentId: INVITES_AGENT, taskId: INVITES_TASK }]);
    }),
);
