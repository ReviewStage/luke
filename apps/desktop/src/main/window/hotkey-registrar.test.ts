import assert from "node:assert/strict";
import test from "node:test";
import { VOICE_HOTKEY_NONE } from "@sidecar/settings";
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

function harness(options: { credentials?: boolean; registers?: boolean } = {}) {
  const registered: RecordedShortcut[] = [];
  const unregistered: string[] = [];
  let unregisterAllCount = 0;
  const broadcasts: { channel: string; payload: unknown }[] = [];
  const talkStops: number[] = [];
  let talkEdges: TalkKeyEdges | undefined;
  let talkStart = true;

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
      return {
        start: () => talkStart,
        stop: () => {
          talkStops.push(1);
          return Promise.resolve();
        },
      };
    },
    recordProductEvent: () => undefined,
    host: {
      voiceHost: () => undefined,
      displayIdFor: () => undefined,
      modeFor: () => "compact",
      setMode: () => undefined,
      broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
    },
  });

  return {
    registrar,
    registered: () => registered.map((entry) => entry.accelerator),
    unregistered: () => unregistered,
    unregisterAllCount: () => unregisterAllCount,
    broadcasts: () => broadcasts,
    talkStops: () => talkStops,
    failTalkStart() {
      talkStart = false;
    },
    announceTalk(accelerator: string) {
      talkEdges?.onRegistered(accelerator);
    },
  };
}

test("reserve answers from the pecking order instead of re-deriving it", async () => {
  const context = harness();
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  context.announceTalk("Alt+Space");

  // Talk's whole candidate list is reserved, not just the chord it holds.
  assert.equal(context.registrar.reserve("Alt+Space", HOTKEY_RANK.ASK), HOTKEY_RANK.TALK);
  assert.equal(context.registrar.reserve("Alt+L", HOTKEY_RANK.ASK), undefined);

  // Stop yields to both: talk first, then ask's own candidates.
  assert.equal(context.registrar.reserve("Alt+Space", HOTKEY_RANK.STOP), HOTKEY_RANK.TALK);
  assert.equal(context.registrar.reserve("Alt+L", HOTKEY_RANK.STOP), HOTKEY_RANK.ASK);
  assert.equal(context.registrar.reserve("Alt+S", HOTKEY_RANK.STOP), undefined);
});

test("reapply from talk unregisters everything, then ask and stop in order", async () => {
  const context = harness();
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  context.announceTalk("Alt+Space");

  assert.equal(context.unregisterAllCount(), 1);
  // Ask then stop: Option-L before Option-S, and never a chord talk sits on.
  assert.deepEqual(context.registered(), ["Alt+L", "Alt+S"]);
  assert.equal(context.registrar.ask, "Alt+L");
  assert.equal(context.registrar.stop, "Alt+S");
});

test("reapply from ask leaves talk alone and re-takes stop behind it", async () => {
  const context = harness();
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  context.announceTalk("Alt+Space");
  const afterTalk = context.unregisterAllCount();

  context.registrar.setChosen(HOTKEY_RANK.ASK, "Control+Alt+K");
  await context.registrar.reapply(HOTKEY_RANK.ASK);

  assert.equal(context.unregisterAllCount(), afterTalk);
  assert.ok(context.unregistered().includes("Alt+L"));
  assert.ok(context.unregistered().includes("Alt+S"));
  assert.deepEqual(context.registered().slice(-2), ["Control+Alt+K", "Alt+S"]);
  assert.equal(context.registrar.ask, "Control+Alt+K");
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
  assert.equal(context.registrar.ask, "Alt+L");
});

test("a deleted talk key spawns no helper and reserves no chord", async () => {
  const context = harness();
  context.registrar.setChosen(HOTKEY_RANK.TALK, VOICE_HOTKEY_NONE);
  await context.registrar.reapply(HOTKEY_RANK.TALK);

  // Nothing registered and nothing promised: no helper, no toggle fallback,
  // and the panel is told the honest absence.
  assert.equal(context.registrar.talk, undefined);
  assert.deepEqual(context.registered(), ["Alt+L", "Alt+S"]);
  // A key that will never register defends no candidate list, so the ranks
  // below may sit even on the talk key's own default.
  assert.equal(context.registrar.reserve("Alt+Space", HOTKEY_RANK.ASK), undefined);
});

test("a deleted ask key takes no chord and stop keeps its own", async () => {
  const context = harness();
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  context.announceTalk("Alt+Space");

  context.registrar.setChosen(HOTKEY_RANK.ASK, VOICE_HOTKEY_NONE);
  await context.registrar.reapply(HOTKEY_RANK.ASK);

  assert.equal(context.registrar.ask, undefined);
  assert.equal(context.registrar.stop, "Alt+S");
  // The deleted key's defaults are no longer spoken for either: the stop key
  // could be moved onto Option-L now without a refusal.
  assert.equal(context.registrar.reserve("Alt+L", HOTKEY_RANK.STOP), undefined);
});

test("a deleted stop key lets its chord go and takes nothing back", async () => {
  const context = harness();
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  context.announceTalk("Alt+Space");

  context.registrar.setChosen(HOTKEY_RANK.STOP, VOICE_HOTKEY_NONE);
  await context.registrar.reapply(HOTKEY_RANK.STOP);

  assert.equal(context.registrar.stop, undefined);
  assert.ok(context.unregistered().includes("Alt+S"));
  assert.equal(context.registrar.ask, "Alt+L");
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

test("a helper that cannot start falls back to a toggle", async () => {
  const context = harness();
  context.failTalkStart();
  await context.registrar.reapply(HOTKEY_RANK.TALK);
  assert.equal(context.registrar.talk, "Alt+Space");
  assert.equal(context.registrar.held, false);
});
