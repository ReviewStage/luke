import assert from "node:assert/strict";
import test from "node:test";
import { runModeFor } from "@sidecar/host";
import type { WireRecord } from "@sidecar/wire";
import type { WebContents } from "electron";
import { channels } from "#shared/bridge";
import { ACT_KIND } from "#shared/messages/acts";
import { VOICE_COMMAND, VOICE_COMMAND_OUTCOME } from "#shared/messages/voice-view";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { AppStateStore, initialAppState } from "../app-state";
import type { PanelManager } from "../window/panel-manager";
import { type VoiceWindowSurface, voiceRuntimeActRows, voiceRuntimeReports } from "./voice-runtime";

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

/**
 * The retired receiver as this runtime's seam sees it: one epoch at a time,
 * ready only on the current epoch's first report, unready again on the next
 * begin.
 */
class EpochReceiver {
  #epoch = 0;
  #ready = false;

  begin(): number {
    this.#epoch += 1;
    this.#ready = false;
    return this.#epoch;
  }

  isReady(): boolean {
    return this.#ready;
  }

  markReady(epoch: number): boolean {
    if (epoch !== this.#epoch || this.#ready) return false;
    this.#ready = true;
    return true;
  }
}

function fixture(clearConversation: () => Promise<boolean>) {
  const sentToVoice: { channel: string; payload: WireRecord }[] = [];
  const liveCalls: string[] = [];
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
  } as unknown as VoiceWindowSurface;
  // SAFETY: this path reads only `owns` and the exchange edge off the panel manager.
  const panels = {
    owns: (sender: WebContents) => sender === panelSender,
    setVoiceExchange: () => undefined,
    broadcast: () => undefined,
  } as unknown as PanelManager;
  const receiver = new EpochReceiver();
  const dependencies = {
    panels,
    voiceWindow,
    receiver: { markReady: (epoch: number) => receiver.markReady(epoch) },
    state: new AppStateStore(initialAppState(RUN, false)),
    openExternal: async () => undefined,
    liveSession: {
      createLiveSession: async (sdp: string) => {
        liveCalls.push(`create:${sdp}`);
        return { sessionId: "sess_1", sdpAnswer: "v=0\r\nanswer\r\n" };
      },
      endLiveSession: async () => {
        liveCalls.push("end");
      },
      reportLiveTransport: async (state: string) => {
        liveCalls.push(`transport:${state}`);
      },
      reportLiveActivity: async (idle: boolean) => {
        liveCalls.push(`activity:${idle}`);
      },
    },
    liveDiagnostics: async () => undefined,
    recordProductEvent: () => undefined,
    clearConversation,
    setShortcutCapturing: () => undefined,
  };
  // SAFETY: only the voice rows are under test; the router dispatches on the
  // kind alone, so the kinds this fragment does not answer are never reached.
  const router = createActRouter(voiceRuntimeActRows(dependencies) as ActRows);
  const reports = voiceRuntimeReports(dependencies);
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
  const ready = (sender: WebContents, epoch: number) => reports.reportVoiceReady({ sender }, epoch);
  const perform = (sender: WebContents, act: Parameters<typeof router.performAct>[0]) =>
    router.performAct(act, senderOf(sender));
  return { command, ready, perform, liveCalls, receiver, sentToVoice, panelSender, voiceSender };
}

test("the four live session acts reach the host from the voice window alone", async () => {
  const f = fixture(async () => true);
  const offer = "v=0\r\noffer\r\n";
  assert.deepEqual(
    await f.perform(f.voiceSender, {
      kind: ACT_KIND.VOICE_CREATE_LIVE_SESSION,
      payload: { sdp: offer },
    }),
    { status: "done", value: { sessionId: "sess_1", sdpAnswer: "v=0\r\nanswer\r\n" } },
  );
  await f.perform(f.voiceSender, {
    kind: ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT,
    payload: { state: "connected" },
  });
  await f.perform(f.voiceSender, {
    kind: ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY,
    payload: { idle: true },
  });
  await f.perform(f.voiceSender, { kind: ACT_KIND.VOICE_END_LIVE_SESSION });
  assert.deepEqual(f.liveCalls, [`create:${offer}`, "transport:connected", "activity:true", "end"]);
  // A panel offering an SDP or reporting a transport it does not hold reaches nothing.
  assert.deepEqual(
    await f.perform(f.panelSender, {
      kind: ACT_KIND.VOICE_CREATE_LIVE_SESSION,
      payload: { sdp: offer },
    }),
    { status: "done", value: undefined },
  );
  await f.perform(f.panelSender, {
    kind: ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY,
    payload: { idle: false },
  });
  await f.perform(f.panelSender, { kind: ACT_KIND.VOICE_END_LIVE_SESSION });
  assert.equal(f.liveCalls.length, 4);
});

test("the voice window is told to clear at the fence, before the disk answers, and the panel hears the disk's answer", async () => {
  for (const erased of [true, false]) {
    let fenced = false;
    let release: ((erased: boolean) => void) | undefined;
    const f = fixture(() => {
      // The row fences in its synchronous prefix, then waits on disk.
      fenced = true;
      return new Promise<boolean>((resolve) => {
        release = resolve;
      });
    });
    const outcome = f.command(f.panelSender);
    assert.equal(fenced, true);
    assert.deepEqual(f.sentToVoice, [
      { channel: channels.onVoiceCommand, payload: { command: VOICE_COMMAND.CLEAR_CONVERSATION } },
    ]);
    assert.ok(release, "the erasure is waiting on disk");
    release(erased);
    assert.deepEqual(await outcome, {
      status: "done",
      value: erased ? VOICE_COMMAND_OUTCOME.ACCEPTED : VOICE_COMMAND_OUTCOME.REFUSED,
    });
    // The command went once; a slow disk does not send it again.
    assert.equal(f.sentToVoice.length, 1);
  }
});

test("a Clear from anything but a panel clears nothing and tells the voice window nothing", async () => {
  let cleared = 0;
  const f = fixture(async () => {
    cleared += 1;
    return true;
  });
  assert.deepEqual(await f.command(f.voiceSender), { status: "done", value: undefined });
  assert.equal(cleared, 0);
  assert.deepEqual(f.sentToVoice, []);
});

test("only the voice window may report the receiver ready, and only for the current epoch", async () => {
  const f = fixture(async () => true);
  const epoch = f.receiver.begin();
  // A panel claiming to be the voice renderer readies nothing.
  assert.equal(await f.ready(f.panelSender, epoch), false);
  assert.equal(f.receiver.isReady(), false);
  // The voice renderer naming a stale epoch — one before its own load — is refused.
  assert.equal(await f.ready(f.voiceSender, epoch - 1), false);
  assert.equal(f.receiver.isReady(), false);
  assert.equal(await f.ready(f.voiceSender, epoch), true);
  assert.equal(f.receiver.isReady(), true);
  // The same report again is not a second readiness.
  assert.equal(await f.ready(f.voiceSender, epoch), false);
  // A reload begins a new epoch; the old renderer's report no longer counts.
  const next = f.receiver.begin();
  assert.equal(f.receiver.isReady(), false);
  assert.equal(await f.ready(f.voiceSender, epoch), false);
  assert.equal(await f.ready(f.voiceSender, next), true);
});
