import assert from "node:assert/strict";
import { LIVE_SESSION_PHASE } from "@luke/gateway";
import {
  type ActPortDependencies,
  createActPortHandler,
  type PlatformActProcedures,
  WindowPushes,
} from "@luke/host/act-port";
import type { ActSender } from "@luke/host/act-router";
import { PUSH } from "@luke/host/contract";
import { AVATAR_FEED_KIND } from "@luke/voice/avatar";
import { VOICE_COMMAND } from "@luke/voice/voice-view";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { Context } from "effect";
import { afterEach, it } from "vitest";
import { openPushStream } from "./app-bridge.js";
import { stateWith } from "./testing/app-state.js";

/**
 * What main pushes a window, through the window's act port as the desktop
 * opens it: each push reaches the listeners on its own method with the
 * payload main pushed, in the order main pushed them; a document pushed the
 * moment the stream opens is heard; a payload its guard refuses is dropped;
 * and a window that goes, or reloads, leaves no listener behind in main.
 */

const WINDOW = Symbol("window");
const PANEL: ActSender = { sender: WINDOW, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };

const opened: MessagePort[] = [];

afterEach(() => {
  for (const port of opened.splice(0)) port.close();
});

/** Main's side of every window: the pushes it holds, and the port server each window's port is upgraded with. */
function mainProcess() {
  const pushes = new WindowPushes();
  // SAFETY: these tests open the push stream alone, so no act procedure's host is ever read.
  const acts = {
    account: {},
    accountAsks: { host: {} },
    agentInbox: { host: {} },
    agents: { host: {}, notices: {} },
    automations: { host: {} },
    factory: { host: {} },
    integrations: { host: {} },
    issues: { host: {} },
    settings: {},
    taskIssues: { host: {} },
    tasks: { host: {} },
    workspaces: { host: {} },
  } as unknown as Omit<ActPortDependencies, "pushes">;
  // SAFETY: as above, no platform kind is called here.
  const platform = {} as PlatformActProcedures<unknown>;
  const handler = createActPortHandler({ ...acts, pushes }, platform);
  /** One page of a window standing as `actor`: its act port opened, and its push stream on it. */
  const page = (actor: ActSender) => {
    const { port1, port2 } = new MessageChannel();
    opened.push(port1, port2);
    handler.upgrade(port1, {
      context: () => ({ actor, trusted: true, "effect/context": Context.empty() }),
    });
    port1.start();
    const stream = openPushStream(createORPCClient(new RPCLink({ port: port2 })));
    port2.start();
    return { ...stream, close: () => port2.close() };
  };
  return { pushes, page };
}

/** Whatever a listener hears, and a wait for the count of hearings a test expects. */
function hearing<Heard>() {
  const heard: Heard[] = [];
  const waits: { count: number; resolve: () => void }[] = [];
  const hear = (value: Heard) => {
    heard.push(value);
    for (const wait of waits.filter((each) => heard.length >= each.count)) wait.resolve();
  };
  const until = (count: number) =>
    heard.length >= count
      ? Promise.resolve()
      : new Promise<void>((resolve) => waits.push({ count, resolve }));
  return { heard, hear, until };
}

/** Waits until `holds` is true of main, which learns of a closed port as the port's own close event arrives. */
async function eventually(holds: () => boolean): Promise<void> {
  for (let turn = 0; turn < 1000 && !holds(); turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(holds());
}

it("each push reaches the listeners on its own method, with the payload main pushed, and no other", async () => {
  const main = mainProcess();
  const voice = main.page(VOICE);
  await voice.opened;
  const live = hearing<unknown>();
  const talk = hearing<unknown>();
  const command = hearing<unknown>();
  voice.listeners.onVoiceLiveSessionChanged(live.hear);
  voice.listeners.onTasksTalk(talk.hear);
  voice.listeners.onVoiceCommand(command.hear);

  main.pushes.push(WINDOW, PUSH.VOICE_LIVE_SESSION_CHANGED, {
    phase: LIVE_SESSION_PHASE.STARTED,
    sessionId: "s-1",
  });
  main.pushes.push(WINDOW, PUSH.TASKS_TALK, { taskId: "task-1" });
  main.pushes.push(WINDOW, PUSH.VOICE_COMMAND, { command: VOICE_COMMAND.STOP_SPEAKING });
  await Promise.all([live.until(1), talk.until(1), command.until(1)]);

  assert.deepEqual(live.heard, [{ phase: LIVE_SESSION_PHASE.STARTED, sessionId: "s-1" }]);
  assert.deepEqual(talk.heard, [{ taskId: "task-1" }]);
  assert.deepEqual(command.heard, [{ command: VOICE_COMMAND.STOP_SPEAKING }]);
});

it("the talk key's release is never heard before its press, even behind a burst of the avatar's feed", async () => {
  const main = mainProcess();
  const panel = main.page(PANEL);
  await panel.opened;
  const keys = hearing<string>();
  const feeds = hearing<unknown>();
  panel.listeners.onAvatarFeed(feeds.hear);
  panel.listeners.onVoiceHotkeyPress(() => keys.hear("press"));
  panel.listeners.onVoiceHotkeyRelease(() => keys.hear("release"));
  panel.listeners.onCallWindowMoved(() => keys.hear("moved"));

  for (let chunk = 0; chunk < 200; chunk += 1) {
    main.pushes.push(WINDOW, PUSH.AVATAR_FEED, { kind: AVATAR_FEED_KIND.TURN_END });
  }
  main.pushes.push(WINDOW, PUSH.VOICE_HOTKEY_PRESS, { taskId: "task-1" });
  main.pushes.push(WINDOW, PUSH.VOICE_HOTKEY_RELEASE, undefined);
  main.pushes.push(WINDOW, PUSH.CALL_WINDOW_MOVED, undefined);
  await keys.until(3);

  assert.deepEqual(keys.heard, ["press", "release", "moved"]);
  assert.equal(feeds.heard.length, 200);
});

it("a document pushed the moment the stream opens is heard, and every one after it in order", async () => {
  const main = mainProcess();
  const panel = main.page(PANEL);
  const versions = hearing<number>();
  panel.listeners.onAppState((snapshot) => versions.hear(snapshot.version));
  await panel.opened;

  for (const version of [1, 2, 3]) {
    main.pushes.push(WINDOW, PUSH.APP_STATE, stateWith({}, { version }));
  }
  await versions.until(3);

  assert.deepEqual(versions.heard, [1, 2, 3]);
});

it("a payload its push's guard refuses is dropped, and the pushes after it still arrive", async () => {
  const main = mainProcess();
  const panel = main.page(PANEL);
  await panel.opened;
  const shown = hearing<unknown>();
  panel.listeners.onShowChat(shown.hear);

  // SAFETY: a payload main's own types would refuse, standing for one a bug let through.
  main.pushes.push(WINDOW, PUSH.SHOW_CHAT, { workspace: "acme" } as never);
  main.pushes.push(WINDOW, PUSH.SHOW_CHAT, { workspaceId: "acme" });
  await shown.until(1);

  assert.deepEqual(shown.heard, [{ workspaceId: "acme" }]);
});

it("a listener that unsubscribed hears nothing more, and one that throws keeps no other from hearing", async () => {
  const main = mainProcess();
  const panel = main.page(PANEL);
  await panel.opened;
  const kept = hearing<unknown>();
  const dropped = hearing<unknown>();
  panel.listeners.onShowTask(() => {
    throw new Error("a listener's own failure");
  });
  const stop = panel.listeners.onShowTask(dropped.hear);
  panel.listeners.onShowTask(kept.hear);
  stop();

  main.pushes.push(WINDOW, PUSH.SHOW_TASK, { taskId: "task-1" });
  main.pushes.push(WINDOW, PUSH.SHOW_TASK, { taskId: "task-2" });
  await kept.until(2);

  assert.deepEqual(kept.heard, [{ taskId: "task-1" }, { taskId: "task-2" }]);
  assert.deepEqual(dropped.heard, []);
});

it("a window that closes leaves no listener in main, and a push to it is dropped", async () => {
  const main = mainProcess();
  const panel = main.page(PANEL);
  await panel.opened;
  assert.equal(main.pushes.listening(WINDOW), true);

  panel.close();
  await eventually(() => !main.pushes.listening(WINDOW));

  assert.equal(main.pushes.push(WINDOW, PUSH.SHOW_TASK, { taskId: "task-1" }), false);
});

it("a reloaded window is heard on its new page, and leaves no listener once that page closes too", async () => {
  const main = mainProcess();
  const before = main.page(PANEL);
  await before.opened;
  const after = main.page(PANEL);
  await after.opened;
  const shown = hearing<unknown>();
  after.listeners.onShowTask(shown.hear);

  before.close();
  main.pushes.push(WINDOW, PUSH.SHOW_TASK, { taskId: "task-1" });
  await shown.until(1);
  assert.deepEqual(shown.heard, [{ taskId: "task-1" }]);

  after.close();
  await eventually(() => !main.pushes.listening(WINDOW));
});
