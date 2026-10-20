import path from "node:path";
import type { AvatarGrant } from "@luke/features/avatar-grant";
import type { RunMode } from "@luke/host";
import { beforeEach, expect, test, vi } from "vitest";
import { CallWindow } from "./call-window";
import { PanelManager } from "./panel-manager";
import { VoiceWindow } from "./voice-window";

/**
 * Which windows Chromium may throttle while they are hidden or covered: the
 * panel and the call window may, the voice window never, and a panel runs
 * unthrottled only while the avatar's session stands in it.
 */

const { windows, FakeBrowserWindow } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  const windows: InstanceType<typeof FakeBrowserWindow>[] = [];
  class FakeWebContents extends EventEmitter {
    /** Whether Chromium may throttle the page, as the window's page preference and any later call say. */
    throttled: boolean;
    constructor(preferences: { backgroundThrottling?: boolean } | undefined) {
      super();
      this.throttled = preferences?.backgroundThrottling ?? true;
    }
    setBackgroundThrottling(allowed: boolean): void {
      this.throttled = allowed;
    }
    setWindowOpenHandler(): void {}
    send(): void {}
  }
  class FakeBrowserWindow extends EventEmitter {
    readonly webContents: FakeWebContents;
    excludedFromShownWindowsMenu = false;
    constructor(options: { webPreferences?: { backgroundThrottling?: boolean } }) {
      super();
      this.webContents = new FakeWebContents(options.webPreferences);
      windows.push(this);
    }
    isDestroyed = () => false;
    loadFile = () => Promise.resolve();
    getBounds = () => ({ x: 0, y: 0, width: 1, height: 1 });
    setAlwaysOnTop = () => undefined;
    setVisibleOnAllWorkspaces = () => undefined;
    destroy = () => undefined;
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

const GRANT: AvatarGrant = {
  serverUrl: "wss://avatar.test",
  participantToken: "token",
  agentIdentity: "agent",
};

function panels() {
  const manager = new PanelManager({
    runMode: RUN_MODE,
    mediaDuck: { setExchangeActive: () => undefined },
    preloadPath: "preload.js",
    rendererHtmlPath: "index.html",
    rendererUrl: "file:///index.html",
    zoomFactor: () => 1,
    placementPath: undefined,
    closing: () => false,
  });
  manager.reconcile();
  return manager;
}

function throttled(window: ReturnType<PanelManager["primaryPanel"]>): boolean {
  expect(window).toBeDefined();
  // SAFETY: the window is one of the fakes above.
  return (window as unknown as InstanceType<typeof FakeBrowserWindow>).webContents.throttled;
}

beforeEach(() => {
  windows.length = 0;
});

test("the panel opens throttled, and the voice window does not", () => {
  const panel = panels();
  expect(throttled(panel.primaryPanel())).toBe(true);

  new VoiceWindow({
    runMode: RUN_MODE,
    preloadPath: "preload.js",
    rendererHtmlPath: "voice.html",
    rendererUrl: "file:///voice.html",
    onGone: () => undefined,
    onGaveUp: () => undefined,
  }).open();
  expect(windows).toHaveLength(2);
  expect(windows[1]?.webContents.throttled).toBe(false);
});

test("the call window opens throttled", () => {
  new CallWindow({
    runMode: RUN_MODE,
    preloadPath: "preload.js",
    rendererHtmlPath: "call.html",
    rendererUrl: "file:///call.html",
    placementPath: path.join("missing", "call-placement.json"),
  }).show();
  expect(windows).toHaveLength(1);
  expect(windows[0]?.webContents.throttled).toBe(true);
});

test("a panel running the avatar's session is unthrottled until the grant is withdrawn", () => {
  const panel = panels();
  const window = panel.primaryPanel();
  panel.showAvatarSession(GRANT);
  expect(throttled(window)).toBe(false);
  panel.showAvatarSession(undefined);
  expect(throttled(window)).toBe(true);
});

test("a panel opened or reloaded while the avatar's session stands is unthrottled", () => {
  const panel = panels();
  panel.showAvatarSession(GRANT);
  const window = panel.primaryPanel();
  // A reload: the page finishes loading again, and the renderer's throttle must not have been lost.
  windows[0]?.webContents.setBackgroundThrottling(true);
  windows[0]?.webContents.emit("did-finish-load");
  expect(throttled(window)).toBe(false);

  windows.length = 0;
  const reopened = new PanelManager({
    runMode: RUN_MODE,
    mediaDuck: { setExchangeActive: () => undefined },
    preloadPath: "preload.js",
    rendererHtmlPath: "index.html",
    rendererUrl: "file:///index.html",
    zoomFactor: () => 1,
    placementPath: undefined,
    closing: () => false,
  });
  reopened.showAvatarSession(GRANT);
  reopened.reconcile();
  expect(windows[0]?.webContents.throttled).toBe(false);
});
