/* oxlint-disable anti-slop/no-unknown-returns -- Fake Electron listeners deliberately retain the IPC boundary shape. */
import assert from "node:assert/strict";
import test from "node:test";
import type { WireRecord } from "@sidecar/wire";
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import { BRIDGE, channels } from "#shared/bridge";
import { VOICE_COMMAND } from "#shared/wire/voice-view";
import { VoiceReceiver } from "../voice-receiver";
import type { PanelManager } from "../window/panel-manager";
import { registerVoiceRuntimeIpc, type VoiceWindowSurface } from "./voice-runtime";

/**
 * The voice commands at the IPC boundary, through the real registration: a
 * panel's command reaches the voice window, and the two commands only the
 * main process may originate — the ones the History controls produce — are
 * refused from a panel rather than forwarded.
 */

function fixture() {
  const invokes = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const sentToVoice: { channel: string; payload: WireRecord }[] = [];
  // SAFETY: the registration reads senders by identity alone; two distinct inert objects are two windows.
  const panelSender = {} as WebContents;
  // SAFETY: as above, the second window.
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
  // SAFETY: the Clear path reads only `owns` off the panel manager; the rest are inert stand-ins.
  const panels = {
    owns: (sender: WebContents) => sender === panelSender,
    setVoiceExchange: () => undefined,
    displayIdFor: () => undefined,
    focusIfExpanded: () => undefined,
  } as unknown as PanelManager;
  const receiver = new VoiceReceiver();
  registerVoiceRuntimeIpc({
    ipcMain: {
      handle: (channel, listener) => {
        invokes.set(channel, listener);
      },
      // SAFETY: this inert fixture implements only the IpcMain return identity the listener API requires.
      on: () => ({}) as Electron.IpcMain,
    },
    trustedSender: () => true,
    panels,
    voiceWindow,
    receiver,
    broadcast: () => undefined,
    openExternal: async () => undefined,
    chooseRealtimeCredentials: () => undefined,
    // SAFETY: the Clear path never reads diagnostics; an inert record stands in for a minter's.
    unavailableDiagnostics: () => ({}) as never,
    recordProductEvent: () => undefined,
    recordAgentTrace: () => undefined,
    storeVoiceView: () => undefined,
    setShortcutCapturing: () => undefined,
  });
  // SAFETY: the bridge reads only the sender off the event, and an Electron invoke listener always answers a promise.
  const command = (sender: WebContents, name: string = VOICE_COMMAND.STOP_SPEAKING) =>
    invokes.get(BRIDGE.voiceCommand.channel)?.(
      { sender } as IpcMainInvokeEvent & IpcMainEvent,
      name,
    ) as Promise<unknown>;
  // SAFETY: as above, for the readiness report.
  const ready = (sender: WebContents, epoch: number) =>
    invokes.get(BRIDGE.reportVoiceReady.channel)?.(
      { sender } as IpcMainInvokeEvent & IpcMainEvent,
      epoch,
    ) as Promise<unknown>;
  return { command, ready, receiver, sentToVoice, panelSender, voiceSender };
}

test("a panel's command is forwarded to the voice window once and answers nothing", async () => {
  const f = fixture();
  assert.equal(await f.command(f.panelSender), undefined);
  assert.deepEqual(f.sentToVoice, [
    { channel: channels.onVoiceCommand, payload: { command: VOICE_COMMAND.STOP_SPEAKING } },
  ]);
});

test("the commands that retire the voice window's turns are the main process's own: a panel sending one is refused", async () => {
  const f = fixture();
  assert.equal(await f.command(f.panelSender, VOICE_COMMAND.CLEAR_CONVERSATION), undefined);
  assert.equal(await f.command(f.panelSender, VOICE_COMMAND.RETIRE_TURNS), undefined);
  assert.deepEqual(f.sentToVoice, []);
});

test("a command from anything but a panel reaches the voice window as nothing", async () => {
  const f = fixture();
  assert.equal(await f.command(f.voiceSender), undefined);
  assert.deepEqual(f.sentToVoice, []);
});

test("only the voice window may report the receiver ready, and only for the current epoch", async () => {
  const f = fixture();
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
