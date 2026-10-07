import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { runModeFor } from "@sidecar/host";
import type { WireRecord } from "@sidecar/wire";
import { Context, Effect, Option } from "effect";
import type { WebContents } from "electron";
import { channels } from "#shared/bridge";
import { ACT_KIND } from "#shared/messages/acts";
import { IDLE_VOICE_VIEW, VOICE_COMMAND, type VoiceView } from "#shared/messages/voice-view";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { AppStateStore, initialAppState } from "../app-state";
import type { PanelManager } from "../window/panel-manager";
import {
  type VoiceRuntimeDependencies,
  voiceRuntimeActRows,
  voiceRuntimeReports,
} from "./voice-runtime";

/** The voice rows through the real router, over the real document. */

/** What the document is composed from; the voice rows read none of it. */
const RUN = {
  launch: {
    captureOutput: undefined,
    profile: "idle",
    fixtureName: undefined,
    captureMode: false,
    fixtureMode: false,
  },
  runMode: runModeFor({ capture: false, fixture: true }),
  appVersion: "0.0.0",
  packaged: false,
  platform: "darwin",
} as const;

function fixture() {
  const sentToVoice: { channel: string; payload: WireRecord }[] = [];
  const liveCalls: string[] = [];
  // SAFETY: the row reads senders by identity alone; two distinct inert objects are two windows.
  const panelSender = {} as WebContents;
  // SAFETY: a second inert object, so the row reads two distinct windows.
  const voiceSender = {} as WebContents;
  // SAFETY: the command path reads only `owns` and `current().webContents.send` off the voice window surface.
  const voiceWindow = {
    owns: (sender: WebContents) => sender === voiceSender,
    current: () => ({
      webContents: {
        send: (channel: string, payload: WireRecord) => {
          sentToVoice.push({ channel, payload });
        },
      },
    }),
  } as unknown as VoiceRuntimeDependencies["voiceWindow"];
  // SAFETY: this path reads only `owns` and the exchange edge off the panel manager.
  const panels = {
    owns: (sender: WebContents) => sender === panelSender,
    setVoiceExchange: () => undefined,
    broadcast: () => undefined,
  } as unknown as PanelManager;
  const dependencies = {
    panels,
    voiceWindow,
    state: new AppStateStore(initialAppState(RUN, false), Context.empty()),
    openExternal: async () => undefined,
    liveSession: {
      createLiveSession: (sdp: string) =>
        Effect.sync(() => {
          liveCalls.push(`create:${sdp}`);
          return Option.some({ sessionId: "sess_1", sdpAnswer: "v=0\r\nanswer\r\n" });
        }),
      endLiveSession: () =>
        Effect.sync(() => {
          liveCalls.push("end");
        }),
      reportLiveTransport: ({ state }: { state: string }) =>
        Effect.sync(() => {
          liveCalls.push(`transport:${state}`);
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
    },
    liveDiagnostics: () => Effect.succeedNone,
    recordProductEvent: () => undefined,
    setShortcutCapturing: () => undefined,
  };
  const reports = voiceRuntimeReports(dependencies);
  // SAFETY: only the voice rows are under test; the router dispatches on the
  // kind alone, so the kinds this fragment does not answer are never reached.
  const router = createActRouter(voiceRuntimeActRows(dependencies) as ActRows);
  const senderOf = (sender: WebContents): ActSender => ({
    sender,
    panel: sender === panelSender,
    voice: sender === voiceSender,
    introduction: false,
  });
  const command = (sender: WebContents) =>
    router.performAct(
      { kind: ACT_KIND.VOICE_COMMAND, payload: { command: VOICE_COMMAND.END_CALL } },
      senderOf(sender),
    );
  const perform = (sender: WebContents, act: Parameters<typeof router.performAct>[0]) =>
    router.performAct(act, senderOf(sender));
  const report = (sender: WebContents, view: VoiceView) =>
    reports.reportVoiceView({ sender }, view, undefined);
  return {
    command,
    perform,
    report,
    liveCalls,
    sentToVoice,
    panelSender,
    voiceSender,
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
        payload: { sdp: offer },
      }),
      { status: "done", value: { sessionId: "sess_1", sdpAnswer: "v=0\r\nanswer\r\n" } },
    );
    yield* f.perform(f.voiceSender, {
      kind: ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT,
      payload: { state: "connected" },
    });
    yield* f.perform(f.voiceSender, {
      kind: ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY,
      payload: { idle: true },
    });
    assert.deepEqual(yield* f.perform(f.voiceSender, { kind: ACT_KIND.VOICE_STOP_SPEAKING }), {
      status: "done",
      value: true,
    });
    yield* f.perform(f.voiceSender, { kind: ACT_KIND.VOICE_END_LIVE_SESSION });
    assert.deepEqual(f.liveCalls, [
      `create:${offer}`,
      "transport:connected",
      "activity:true",
      "stop",
      "end",
    ]);
    // A panel offering an SDP or reporting a transport it does not hold reaches nothing.
    assert.deepEqual(
      yield* f.perform(f.panelSender, {
        kind: ACT_KIND.VOICE_CREATE_LIVE_SESSION,
        payload: { sdp: offer },
      }),
      { status: "done", value: undefined },
    );
    yield* f.perform(f.panelSender, {
      kind: ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY,
      payload: { idle: false },
    });
    assert.deepEqual(yield* f.perform(f.panelSender, { kind: ACT_KIND.VOICE_STOP_SPEAKING }), {
      status: "done",
      value: false,
    });
    yield* f.perform(f.panelSender, { kind: ACT_KIND.VOICE_END_LIVE_SESSION });
    assert.equal(f.liveCalls.length, 5);
  }),
);

it.effect(
  "a panel's command reaches the voice window, and one from anything else reaches nothing",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      assert.deepEqual(yield* f.command(f.voiceSender), { status: "done", value: undefined });
      assert.deepEqual(f.sentToVoice, []);
      assert.deepEqual(yield* f.command(f.panelSender), { status: "done", value: undefined });
      assert.deepEqual(f.sentToVoice, [
        { channel: channels.onVoiceCommand, payload: { command: VOICE_COMMAND.END_CALL } },
      ]);
    }),
);

it("the voice window's report is written to the document; a panel's report is ignored", () => {
  const f = fixture();
  const speaking: VoiceView = {
    ...IDLE_VOICE_VIEW,
    voiceStatus: "speaking",
    lukeSpeaking: true,
    lukeCaptions: ["Two sessions"],
  };
  f.report(f.voiceSender, speaking);
  assert.deepEqual(f.state.snapshot().voice.view, speaking);
  f.report(f.panelSender, IDLE_VOICE_VIEW);
  assert.deepEqual(f.state.snapshot().voice.view, speaking);
});
