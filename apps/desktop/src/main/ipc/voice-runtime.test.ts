import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { runModeFor } from "@luke/host";
import { type ActRows, type ActSender, createActRouter } from "@luke/host/act-router";
import { ACT_KIND } from "@luke/host/acts";
import { VOICE_COMMAND, type VoiceView } from "@luke/voice/voice-view";
import type { WireRecord } from "@luke/wire";
import { Context, Effect, Option } from "effect";
import type { WebContents } from "electron";
import { AppStateStore, initialAppState } from "../app-state";
import type { PanelManager } from "../window/panel-manager";
import {
  type VoiceRuntimeDependencies,
  voiceRuntimeActRows,
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

function fixture() {
  const sentToVoice: { channel: string; payload: WireRecord }[] = [];
  const toPanels: { channel: string; payload: WireRecord }[] = [];
  let panelsFocused = 0;
  const liveCalls: string[] = [];
  // SAFETY: the row reads senders by identity alone; two distinct inert objects are two windows.
  const panelSender = {} as WebContents;
  // SAFETY: a second inert object, so the row reads two distinct windows.
  const voiceSender = {} as WebContents;
  // SAFETY: a third, for the call window.
  const callSender = {} as WebContents;
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
    state: new AppStateStore(initialAppState(RUN, false), Context.empty()),
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
    call: sender === callSender,
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
      { status: "done", value: { sessionId: "sess_1", sdpAnswer: "v=0\r\nanswer\r\n" } },
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
      status: "done",
      value: true,
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
    yield* f.perform(f.panelSender, {
      kind: ACT_KIND.VOICE_END_LIVE_SESSION,
      payload: { sessionId: "sess_1" },
    });
    assert.equal(f.liveCalls.length, 5);
  }),
);
