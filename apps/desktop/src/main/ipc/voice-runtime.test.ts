import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { runModeFor } from "@luke/host";
import type { ActSender } from "@luke/host/act-port";
import { type TestActPort, testActPort } from "@luke/host/act-port/testing";
import { ACT_KIND } from "@luke/host/acts";
import { AppStateStore, initialAppState } from "@luke/host/client";
import { PUSH, type PushEvent } from "@luke/host/contract";
import { LIVE_STATUS } from "@luke/live";
import { IDLE_VOICE_VIEW, VOICE_COMMAND, type VoiceView } from "@luke/voice/voice-view";
import type { WireRecord } from "@luke/wire";
import { Context, Effect, Option } from "effect";
import type { WebContents } from "electron";
import type { PanelManager } from "../window/panel-manager";
import { windowPushes } from "../window/window-pushes";
import {
  type VoiceRuntimeDependencies,
  voiceRuntimeProcedures,
  voiceRuntimeReports,
} from "./voice-runtime";

/** What the document is composed from; the voice rows read none of it. */
const RUN = {
  launch: {
    captureOutput: undefined,
    profile: "idle",
    captureMode: false,
    fixtureMode: false,
  },
  runMode: runModeFor({ capture: false, fixture: true }),
  appVersion: "0.0.0",
  packaged: false,
  platform: "darwin",
} as const;

/** Every act port a fixture opened, closed once its test is done. */
const ports: TestActPort<WebContents>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

function fixture() {
  const toPanels: { channel: string; payload: WireRecord }[] = [];
  let panelsFocused = 0;
  const liveCalls: string[] = [];
  // SAFETY: the row reads senders by identity alone; two distinct inert objects are two windows.
  const panelSender = {} as WebContents;
  // SAFETY: a second inert object, so the row reads two distinct windows.
  const voiceSender = {} as WebContents;
  // SAFETY: a third, for the call window.
  const callSender = {} as WebContents;
  // SAFETY: the command path reads only `owns` and `current().webContents` off the voice window surface.
  const voiceWindow = {
    owns: (sender: WebContents) => sender === voiceSender,
    current: () => ({ webContents: voiceSender }),
  } as unknown as VoiceRuntimeDependencies["voiceWindow"];
  // The voice window's push stream, open as its page holds it.
  const voiceStream = windowPushes.stream(voiceSender, undefined);
  /** Every push the voice window has heard so far, its stream then ended. */
  const sentToVoice = Effect.promise(async () => {
    windowPushes.push(voiceSender, PUSH.CALL_WINDOW_MOVED, undefined);
    const heard: PushEvent[] = [];
    for await (const event of voiceStream) {
      if (event.push === PUSH.CALL_WINDOW_MOVED) break;
      heard.push(event);
    }
    return heard;
  });
  // SAFETY: these paths read only `owns`, the exchange edge, the broadcast, and the focus off the panel manager.
  const panels = {
    owns: (sender: WebContents) => sender === panelSender,
    setVoiceExchange: () => undefined,
    broadcast: (channel: string, payload: WireRecord) => {
      toPanels.push({ channel, payload });
    },
    focusExpanded: () => {
      panelsFocused += 1;
    },
  } as unknown as PanelManager;
  const dependencies = {
    panels,
    voiceWindow,
    state: new AppStateStore(initialAppState(RUN, false, []), Context.empty()),
    openExternal: async () => undefined,
    liveSession: {
      createLiveSession: (sdp: string) =>
        Effect.sync(() => {
          liveCalls.push(`create:${sdp}`);
          return Option.some({ sessionId: "sess_1", sdpAnswer: "v=0\r\nanswer\r\n" });
        }),
      endLiveSession: ({ sessionId }: { sessionId: string }) =>
        Effect.sync(() => {
          liveCalls.push(`end:${sessionId}`);
        }),
      reportLiveTransport: ({ sessionId, state }: { sessionId: string; state: string }) =>
        Effect.sync(() => {
          liveCalls.push(`transport:${sessionId}:${state}`);
        }),
      reportLiveActivity: (idle: boolean) =>
        Effect.sync(() => {
          liveCalls.push(`activity:${idle}`);
        }),
      stopSpeaking: () =>
        Effect.sync(() => {
          liveCalls.push("stop");
          return true;
        }),
      tasksStopWork: (taskId: string) =>
        Effect.sync(() => {
          liveCalls.push(`stopWork:${taskId}`);
        }),
    },
    liveDiagnostics: () => Effect.succeedNone,
    recordProductEvent: () => undefined,
    setShortcutCapturing: () => undefined,
  };
  const reports = voiceRuntimeReports(dependencies);
  const actPort = testActPort(voiceRuntimeProcedures(dependencies));
  ports.push(actPort);
  /** One window as the port's procedures read it, the same object for every call it makes. */
  const actors = new Map<WebContents, ActSender<WebContents>>();
  const senderOf = (sender: WebContents): ActSender<WebContents> => {
    const held = actors.get(sender);
    if (held !== undefined) return held;
    const actor = {
      sender,
      panel: sender === panelSender,
      voice: sender === voiceSender,
      call: sender === callSender,
    };
    actors.set(sender, actor);
    return actor;
  };
  const command = (sender: WebContents) =>
    actPort.perform(
      { kind: ACT_KIND.VOICE_COMMAND, payload: { command: VOICE_COMMAND.END_CALL } },
      senderOf(sender),
    );
  const perform = (
    sender: WebContents,
    act: Parameters<typeof actPort.perform>[0],
    options?: { readonly trusted?: boolean },
  ) => actPort.perform(act, senderOf(sender), options);
  const report = (sender: WebContents, view: VoiceView) =>
    reports.reportVoiceView({ sender }, view, undefined);
  return {
    command,
    perform,
    report,
    reports,
    liveCalls,
    sentToVoice,
    toPanels,
    panelsFocused: () => panelsFocused,
    panelSender,
    voiceSender,
    callSender,
    state: dependencies.state,
  };
}

it.effect("the five live session acts reach the host from the voice window alone", () =>
  Effect.gen(function* () {
    const f = fixture();
    const offer = "v=0\r\noffer\r\n";
    assert.deepEqual(
      yield* f.perform(f.voiceSender, {
        kind: ACT_KIND.VOICE_CREATE_LIVE_SESSION,
        payload: { sdp: offer, taskId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10" },
      }),
      { answer: { sessionId: "sess_1", sdpAnswer: "v=0\r\nanswer\r\n" } },
    );
    yield* f.perform(f.voiceSender, {
      kind: ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT,
      payload: { sessionId: "sess_1", state: "connected" },
    });
    yield* f.perform(f.voiceSender, {
      kind: ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY,
      payload: { idle: true },
    });
    assert.deepEqual(yield* f.perform(f.voiceSender, { kind: ACT_KIND.VOICE_STOP_SPEAKING }), {
      answer: true,
    });
    yield* f.perform(f.voiceSender, {
      kind: ACT_KIND.VOICE_END_LIVE_SESSION,
      payload: { sessionId: "sess_1" },
    });
    // The hang-up and the transport reach the host naming the session they are about.
    assert.deepEqual(f.liveCalls, [
      `create:${offer}`,
      "transport:sess_1:connected",
      "activity:true",
      "stop",
      "end:sess_1",
    ]);
    // A panel offering an SDP or reporting a transport it does not hold reaches nothing.
    assert.deepEqual(
      yield* f.perform(f.panelSender, {
        kind: ACT_KIND.VOICE_CREATE_LIVE_SESSION,
        payload: { sdp: offer, taskId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10" },
      }),
      { answer: undefined },
    );
    yield* f.perform(f.panelSender, {
      kind: ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY,
      payload: { idle: false },
    });
    assert.deepEqual(yield* f.perform(f.panelSender, { kind: ACT_KIND.VOICE_STOP_SPEAKING }), {
      answer: false,
    });
    yield* f.perform(f.panelSender, {
      kind: ACT_KIND.VOICE_END_LIVE_SESSION,
      payload: { sessionId: "sess_1" },
    });
    assert.equal(f.liveCalls.length, 5);
  }),
);

const OPEN_TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const CALL_TASK = "0c4b6d1e-8a2f-4e3b-9c5d-6f7a8b9c0d1e";

it.effect("stopping Luke with no call up stops his turn on the open task and tells no call", () =>
  Effect.gen(function* () {
    const f = fixture();
    f.state.update({ tasks: { ...f.state.snapshot().tasks, activeTaskId: OPEN_TASK } });
    yield* f.perform(f.voiceSender, { kind: ACT_KIND.LUKE_STOP, payload: {} });
    assert.deepEqual(f.liveCalls, [`stopWork:${OPEN_TASK}`]);
    assert.deepEqual(yield* f.sentToVoice, []);
  }),
);

it.effect(
  "stopping Luke on a call tells the call to stop and stops his turn on the call's task",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      f.state.update({
        tasks: { ...f.state.snapshot().tasks, activeTaskId: OPEN_TASK },
        voice: {
          ...f.state.snapshot().voice,
          view: { ...IDLE_VOICE_VIEW, voiceStatus: LIVE_STATUS.LISTENING, callTaskId: CALL_TASK },
        },
      });
      yield* f.perform(f.voiceSender, { kind: ACT_KIND.LUKE_STOP, payload: {} });
      assert.deepEqual(f.liveCalls, [`stopWork:${CALL_TASK}`]);
      assert.deepEqual(yield* f.sentToVoice, [
        { push: PUSH.VOICE_COMMAND, payload: { command: VOICE_COMMAND.STOP_SPEAKING } },
      ]);
    }),
);

it.effect(
  "a frame this build does not trust is refused every voice act in the kind's own words, and the host hears nothing",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const untrusted = { trusted: false };
      assert.deepEqual(
        yield* f.perform(f.voiceSender, { kind: ACT_KIND.VOICE_STOP_SPEAKING }, untrusted),
        { refused: "Could not tell Luke to stop speaking on this system." },
      );
      assert.deepEqual(
        yield* f.perform(f.voiceSender, { kind: ACT_KIND.LUKE_STOP, payload: {} }, untrusted),
        { refused: "Could not stop Luke on this system." },
      );
      assert.deepEqual(
        yield* f.perform(
          f.panelSender,
          { kind: ACT_KIND.VOICE_COMMAND, payload: { command: VOICE_COMMAND.END_CALL } },
          untrusted,
        ),
        { refused: "Could not carry that command on this system." },
      );
      assert.deepEqual(f.liveCalls, []);
      assert.deepEqual(yield* f.sentToVoice, []);
    }),
);
