import type { AvatarGrant } from "@luke/features/avatar-grant";
import type { RunMode } from "@luke/host";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { initialAppState } from "@luke/host/client";
import { PUSH, type PushEvent } from "@luke/host/contract";
import type { WebContents } from "electron";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PanelManager } from "./panel-manager";
import { windowPushes } from "./window-pushes";

/**
 * What a panel no one can see is pushed: no document while it is hidden, the
 * newest one the moment it shows, every document as before while it is in
 * view, and every one while it runs the avatar's session.
 */

const { windows, FakeBrowserWindow } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  const windows: InstanceType<typeof FakeBrowserWindow>[] = [];
  class FakeWebContents extends EventEmitter {
    setBackgroundThrottling(): void {}
    setWindowOpenHandler(): void {}
    send(): void {}
  }
  class FakeBrowserWindow extends EventEmitter {
    readonly webContents = new FakeWebContents();
    constructor() {
      super();
      windows.push(this);
    }
    isDestroyed = () => false;
    loadFile = () => Promise.resolve();
  }
  return { windows, FakeBrowserWindow };
});

const DISPLAY = { id: 1, workArea: { x: 0, y: 0, width: 1600, height: 1000 } };

vi.mock("electron", () => ({
  BrowserWindow: FakeBrowserWindow,
  app: {},
  screen: { getPrimaryDisplay: () => DISPLAY, getAllDisplays: () => [DISPLAY] },
}));

const RUN_MODE: RunMode = {
  requiresAccount: false,
  observesProviders: false,
  registersGlobalKeys: false,
  animates: false,
  takesFocus: false,
  sendsNetwork: false,
};

const RUN = {
  launch: { profile: "idle", captureMode: false, fixtureMode: false },
  runMode: RUN_MODE,
  appVersion: "1.2.3",
  packaged: true,
  platform: "darwin",
} as const;

const GRANT: AvatarGrant = {
  serverUrl: "wss://avatar.test",
  participantToken: "token",
  agentIdentity: "agent",
};

const stops: AbortController[] = [];

function documentAt(version: number): AppStateSnapshot {
  return { ...initialAppState(RUN, true, []), version, window: { fullScreen: false } };
}

/** The panel's one window, shown, with its page's push stream open. */
function shownPanel() {
  const panels = new PanelManager({
    runMode: RUN_MODE,
    mediaDuck: { setExchangeActive: () => undefined },
    preloadPath: "preload.js",
    rendererHtmlPath: "index.html",
    rendererUrl: "file:///index.html",
    zoomFactor: () => 1,
    placementPath: undefined,
    closing: () => false,
  });
  panels.reconcile();
  const [window] = windows;
  expect(window).toBeDefined();
  // SAFETY: the window is the fake above, whose page stands for Electron's.
  const page = window?.webContents as unknown as WebContents;
  window?.emit("show");
  const stop = new AbortController();
  stops.push(stop);
  return { panels, window, stream: windowPushes.stream(page, stop.signal), page };
}

/** What the next read of a stream carries once everything pending has run, a document by its version; nothing while it waits. */
async function nextHeard(stream: AsyncIteratorObject<PushEvent>) {
  let heard: number | string | undefined;
  // Note that a read still waiting when its test ends is refused by the stream's abort, which ends nothing here.
  const read = stream.next().then(
    (result) => {
      if (result.done) return;
      heard =
        result.value.push === PUSH.APP_STATE ? result.value.payload.version : result.value.push;
    },
    () => undefined,
  );
  await new Promise((resolve) => setImmediate(resolve));
  return { heard: () => heard, read };
}

beforeEach(() => {
  windows.length = 0;
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop.abort();
});

test("three documents pushed while the panel is hidden are one delivery, the third, as it shows", async () => {
  const { window, stream, page } = shownPanel();
  window?.emit("hide");
  for (const version of [1, 2, 3]) windowPushes.push(page, PUSH.APP_STATE, documentAt(version));

  const pending = await nextHeard(stream);
  expect(pending.heard()).toBeUndefined();

  window?.emit("show");
  await pending.read;
  expect(pending.heard()).toBe(3);
  // Nothing else was held for it: the next read is the event pushed after.
  windowPushes.push(page, PUSH.SHOW_TASK, { taskId: "task-1" });
  expect((await nextHeard(stream)).heard()).toBe(PUSH.SHOW_TASK);
});

test("a minimized panel is held until it is restored", async () => {
  const { window, stream, page } = shownPanel();
  window?.emit("minimize");
  windowPushes.push(page, PUSH.APP_STATE, documentAt(1));
  const pending = await nextHeard(stream);
  expect(pending.heard()).toBeUndefined();

  window?.emit("restore");
  await pending.read;
  expect(pending.heard()).toBe(1);
});

test("a document pushed while the panel is in view is delivered as before", async () => {
  const { window, stream, page } = shownPanel();
  window?.emit("hide");
  window?.emit("show");
  windowPushes.push(page, PUSH.APP_STATE, documentAt(1));

  expect((await nextHeard(stream)).heard()).toBe(1);
});

test("an event reaches a hidden panel, behind the document held before it", async () => {
  const { window, stream, page } = shownPanel();
  window?.emit("hide");
  windowPushes.push(page, PUSH.APP_STATE, documentAt(1));
  windowPushes.push(page, PUSH.SHOW_TASK, { taskId: "task-1" });

  expect((await nextHeard(stream)).heard()).toBe(1);
  expect((await nextHeard(stream)).heard()).toBe(PUSH.SHOW_TASK);
});

test("a hidden panel running the avatar's session is told every document until the grant is withdrawn", async () => {
  const { panels, window, stream, page } = shownPanel();
  panels.showAvatarSession(GRANT);
  window?.emit("hide");
  windowPushes.push(page, PUSH.APP_STATE, documentAt(1));
  expect((await nextHeard(stream)).heard()).toBe(1);
  windowPushes.push(page, PUSH.APP_STATE, documentAt(2));
  expect((await nextHeard(stream)).heard()).toBe(2);

  panels.showAvatarSession(undefined);
  windowPushes.push(page, PUSH.APP_STATE, documentAt(3));
  expect((await nextHeard(stream)).heard()).toBeUndefined();
});
