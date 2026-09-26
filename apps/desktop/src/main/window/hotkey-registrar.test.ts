import assert from "node:assert/strict";
import { VOICE_HOTKEY_NONE } from "@sidecar/settings";
import type { UnparsedWireValue } from "@sidecar/wire";
import type { BrowserWindow } from "electron";
import { test } from "vitest";
import { channels } from "#shared/bridge";
import type { TalkKeyEdges } from "../native/talk-key";
import {
  HOTKEY_RANK,
  HotkeyRegistrar,
  type ShortcutSurface,
  type TalkKeyHandle,
} from "./hotkey-registrar";

interface RecordedShortcut {
  accelerator: string;
  callback: () => void;
}

function harness(
  options: {
    credentials?: boolean;
    registers?: boolean;
    talkPlanId?: () => string | undefined;
  } = {},
) {
  const registered: RecordedShortcut[] = [];
  const unregistered: string[] = [];
  let unregisterAllCount = 0;
  let talkEdges: TalkKeyEdges | undefined;
  let talkStart = true;
  const voiceHostSent: string[] = [];
  const voiceHostPayloads: (UnparsedWireValue | undefined)[] = [];
  // SAFETY: the registrar reaches only `webContents.send` on the voice host.
  const voiceHost = {
    webContents: {
      send: (channel: string, payload?: UnparsedWireValue) => {
        voiceHostSent.push(channel);
        voiceHostPayloads.push(payload);
      },
    },
  } as unknown as BrowserWindow;

  const shortcut: ShortcutSurface = {
    register(accelerator, callback) {
      registered.push({ accelerator, callback });
      return true;
    },
    unregister(accelerator) {
      unregistered.push(accelerator);
    },
    unregisterAll() {
      unregisterAllCount += 1;
      registered.length = 0;
    },
  };

  const registrar = new HotkeyRegistrar({
    registersGlobalKeys: options.registers ?? true,
    hasCredentials: () => options.credentials ?? true,
    shortcut,
    createTalkKeyWatcher: (edges): TalkKeyHandle => {
      talkEdges = edges;
      return { start: () => talkStart, stop: () => Promise.resolve() };
    },
    host: {
      voiceHost: () => voiceHost,
      talkPlanId: options.talkPlanId ?? (() => undefined),
      hotkeyChanged: () => {},
    },
  });

  return {
    registrar,
    registered: () => registered.map((entry) => entry.accelerator),
    unregistered: () => unregistered,
    unregisterAllCount: () => unregisterAllCount,
    voiceHostSent: () => voiceHostSent,
    voiceHostPayloads: () => voiceHostPayloads,
    pressTalk() {
      const talk = registered.find((entry) => entry.accelerator === registrar.talk);
      assert.ok(talk, "the talk key is registered with Electron");
      talk.callback();
    },
    pressStop() {
      const stop = registered.find((entry) => entry.accelerator === registrar.stop);
      assert.ok(stop, "the stop key is registered with Electron");
      stop.callback();
    },
    failTalkStart() {
      talkStart = false;
    },
    announceTalk(accelerator: string) {
      talkEdges?.onRegistered(accelerator);
    },
    talkEdges: () => talkEdges,
  };
}

test("reserve answers from the pecking order instead of re-deriving it", async () => {
  const context = harness();
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  context.announceTalk("Alt+Space");

  // Talk's whole candidate list is reserved, not just the chord it holds.
  assert.equal(context.registrar.reserve("Alt+Space", HOTKEY_RANK.STOP), HOTKEY_RANK.TALK);
  assert.equal(context.registrar.reserve("Alt+S", HOTKEY_RANK.STOP), undefined);
  assert.equal(context.registrar.reserve("Alt+L", HOTKEY_RANK.STOP), undefined);
});

test("reapply from talk unregisters everything, then takes stop behind it", async () => {
  const context = harness();
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  context.announceTalk("Alt+Space");

  assert.equal(context.unregisterAllCount(), 1);
  // Stop after talk: Option-S, and never a chord talk sits on.
  assert.deepEqual(context.registered(), ["Alt+S"]);
  assert.equal(context.registrar.stop, "Alt+S");
});

test("reapply from stop lets only itself go", async () => {
  const context = harness();
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  context.announceTalk("Alt+Space");
  const afterTalk = context.unregistered().length;

  context.registrar.setChosen(HOTKEY_RANK.STOP, "Control+Alt+X");
  await context.registrar.reapply(HOTKEY_RANK.STOP);

  assert.equal(context.unregisterAllCount(), 1);
  assert.deepEqual(context.unregistered().slice(afterTalk), ["Alt+S"]);
  assert.equal(context.registrar.stop, "Control+Alt+X");
});

test("a deleted talk key spawns no helper and reserves no chord", async () => {
  const context = harness();
  context.registrar.setChosen(HOTKEY_RANK.TALK, VOICE_HOTKEY_NONE);
  await context.registrar.reapply(HOTKEY_RANK.TALK);

  // Nothing registered and nothing promised: no helper, no toggle fallback,
  // and the panel is told the honest absence.
  assert.equal(context.registrar.talk, undefined);
  assert.deepEqual(context.registered(), ["Alt+S"]);
  // A key that will never register defends no candidate list, so the rank
  // below may sit even on the talk key's own default.
  assert.equal(context.registrar.reserve("Alt+Space", HOTKEY_RANK.STOP), undefined);
});

test("a deleted stop key lets its chord go and takes nothing back", async () => {
  const context = harness();
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  context.announceTalk("Alt+Space");

  context.registrar.setChosen(HOTKEY_RANK.STOP, VOICE_HOTKEY_NONE);
  await context.registrar.reapply(HOTKEY_RANK.STOP);

  assert.equal(context.registrar.stop, undefined);
  assert.ok(context.unregistered().includes("Alt+S"));
  assert.equal(context.registrar.talk, "Alt+Space");
});

test("a capture run takes no system key", async () => {
  const context = harness({ registers: false });
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  assert.deepEqual(context.registered(), []);
});

test("no credential takes no system key", async () => {
  const context = harness({ credentials: false });
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  assert.deepEqual(context.registered(), []);
});

test("a helper that cannot start falls back to Electron, whose talk key reports no hold", async () => {
  const context = harness();
  context.failTalkStart();
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  assert.equal(context.registrar.talk, "Alt+Space");
  assert.equal(context.registrar.held, false);
});

test("the Electron fallback alternates press and release across presses, and a stop ends the pair", async () => {
  const context = harness();
  context.failTalkStart();
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  context.pressTalk();
  context.pressTalk();
  context.pressTalk();
  assert.deepEqual(context.voiceHostSent(), [
    channels.onVoiceHotkeyPress,
    channels.onVoiceHotkeyRelease,
    channels.onVoiceHotkeyPress,
  ]);
  context.pressStop();
  context.pressTalk();
  assert.deepEqual(context.voiceHostSent().slice(3), [
    channels.onStopHotkeyPress,
    channels.onVoiceHotkeyPress,
  ]);
  // A press held back by a chord being recorded moves the pair nowhere.
  context.registrar.setShortcutCapturing(true);
  context.pressTalk();
  context.registrar.setShortcutCapturing(false);
  context.pressTalk();
  assert.deepEqual(context.voiceHostSent().slice(5), [channels.onVoiceHotkeyRelease]);
});

test("the native watcher's edges reach the voice host as they are", async () => {
  const context = harness();
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  context.talkEdges()?.onPress();
  context.talkEdges()?.onRelease();
  assert.deepEqual(context.voiceHostSent(), [
    channels.onVoiceHotkeyPress,
    channels.onVoiceHotkeyRelease,
  ]);
});

test("a talk press names the planning window's open plan where it has one, and a release names nothing", async () => {
  let planId: string | undefined = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
  const context = harness({ talkPlanId: () => planId });
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  context.talkEdges()?.onPress();
  context.talkEdges()?.onRelease();
  planId = undefined;
  context.talkEdges()?.onPress();
  assert.deepEqual(context.voiceHostPayloads(), [
    { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10" },
    undefined,
    undefined,
  ]);

  const fallback = harness({ talkPlanId: () => "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10" });
  fallback.failTalkStart();
  await fallback.registrar.reapply(HOTKEY_RANK.TALK);
  fallback.pressTalk();
  fallback.pressTalk();
  assert.deepEqual(fallback.voiceHostPayloads(), [
    { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10" },
    undefined,
  ]);
});
