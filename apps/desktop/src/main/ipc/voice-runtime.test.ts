import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { runModeFor } from "@sidecar/host";
import { CONVERSATION_ENTRY_KIND, type LiveConversationLine } from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import { Context, Deferred, Effect, Fiber, Option } from "effect";
import type { WebContents } from "electron";
import { channels } from "#shared/bridge";
import { ACT_KIND } from "#shared/messages/acts";
import {
  IDLE_VOICE_VIEW,
  VOICE_COMMAND,
  VOICE_COMMAND_OUTCOME,
  type VoiceView,
} from "#shared/messages/voice-view";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { AppStateStore, initialAppState } from "../app-state";
import type { PanelManager } from "../window/panel-manager";
import {
  type VoiceRuntimeDependencies,
  voiceRuntimeActRows,
  voiceRuntimeReports,
} from "./voice-runtime";

/**
 * The Clear through the real row and the real router: the voice window must be
 * told at the fence, before the disk answers, and the panel must hear the
 * disk's answer and nothing sooner.
 */

/** What the document is composed from; the Clear path reads none of it. */
const RUN = {
  launch: {
    captureOutput: undefined,
    profile: "idle",
    fixtureName: undefined,
    startPeeked: false,
    startInSlot: false,
    captureMode: false,
    fixtureMode: false,
  },
  runMode: runModeFor({ capture: false, fixture: true }),
  appVersion: "0.0.0",
  packaged: false,
  platform: "darwin",
} as const;

function fixture(clearConversation: () => Effect.Effect<boolean>) {
  const sentToVoice: { channel: string; payload: WireRecord }[] = [];
  const liveCalls: string[] = [];
  let refreshes = 0;
  // SAFETY: the row reads senders by identity alone; two distinct inert objects are two windows.
  const panelSender = {} as WebContents;
  // SAFETY: a second inert object, so the row reads two distinct windows.
  const voiceSender = {} as WebContents;
  // SAFETY: the Clear path reads only `owns` and `current().webContents.send` off the voice window surface.
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
      reportLiveTransport: (state: string) =>
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
    clearConversation,
    setShortcutCapturing: () => undefined,
    refreshConversation: () => {
      refreshes += 1;
    },
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
      { kind: ACT_KIND.VOICE_COMMAND, payload: { command: VOICE_COMMAND.CLEAR_CONVERSATION } },
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
    refreshes: () => refreshes,
  };
}

function line(rowId: string, words: string, settled: boolean): LiveConversationLine {
  return {
    rowId,
    entry: { kind: CONVERSATION_ENTRY_KIND.REPLY, words },
    startMs: 0,
    endMs: 1_000,
    settled,
  };
}

it.effect("the five live session acts reach the host from the voice window alone", () =>
  Effect.gen(function* () {
    const f = fixture(() => Effect.succeed(true));
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
  "the voice window is told to clear at the fence, before the disk answers, and the panel hears the disk's answer",
  () =>
    Effect.gen(function* () {
      for (const erased of [true, false]) {
        let fenced = false;
        const disk = yield* Deferred.make<boolean>();
        const f = fixture(() =>
          Effect.gen(function* () {
            // The row fences in its synchronous prefix, then waits on disk.
            fenced = true;
            return yield* Deferred.await(disk);
          }),
        );
        const outcome = yield* Effect.forkChild(f.command(f.panelSender), {
          startImmediately: true,
        });
        assert.equal(fenced, true);
        assert.deepEqual(f.sentToVoice, [
          {
            channel: channels.onVoiceCommand,
            payload: { command: VOICE_COMMAND.CLEAR_CONVERSATION },
          },
        ]);
        yield* Deferred.succeed(disk, erased);
        assert.deepEqual(yield* Fiber.join(outcome), {
          status: "done",
          value: erased ? VOICE_COMMAND_OUTCOME.ACCEPTED : VOICE_COMMAND_OUTCOME.REFUSED,
        });
        // The command went once; a slow disk does not send it again.
        assert.equal(f.sentToVoice.length, 1);
      }
    }),
);

it.effect(
  "a Clear from anything but a panel clears nothing and tells the voice window nothing",
  () =>
    Effect.gen(function* () {
      let cleared = 0;
      const f = fixture(() =>
        Effect.sync(() => {
          cleared += 1;
          return true;
        }),
      );
      assert.deepEqual(yield* f.command(f.voiceSender), { status: "done", value: undefined });
      assert.equal(cleared, 0);
      assert.deepEqual(f.sentToVoice, []);
    }),
);

it("the voice window's report is written to the document and asks for a read only when the record moved under a line; a panel's report is ignored", () => {
  const f = fixture(() => Effect.succeed(true));
  const speaking: VoiceView = {
    ...IDLE_VOICE_VIEW,
    voiceStatus: "speaking",
    lukeSpeaking: true,
    liveConversationLines: [line("row-1", "Two sessions", false)],
  };
  f.report(f.voiceSender, speaking);
  assert.deepEqual(
    f.state.snapshot().voice.view?.liveConversationLines,
    speaking.liveConversationLines,
  );
  assert.equal(f.refreshes(), 0);
  const settled: VoiceView = {
    ...speaking,
    liveConversationLines: [line("row-1", "Two sessions finished.", true)],
  };
  f.report(f.voiceSender, settled);
  assert.equal(f.refreshes(), 1);
  f.report(f.voiceSender, { ...settled, lukeSpeaking: false });
  assert.equal(f.refreshes(), 1, "a report that moved only the speaker asks for nothing");
  f.report(f.voiceSender, IDLE_VOICE_VIEW);
  assert.equal(f.refreshes(), 2, "the call closing writes what stood");
  f.report(f.panelSender, settled);
  assert.deepEqual(f.state.snapshot().voice.view, IDLE_VOICE_VIEW);
  assert.equal(f.refreshes(), 2);
});
