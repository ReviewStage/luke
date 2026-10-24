/** renderer-revival.test.ts -- a panel or voice renderer that dies is stood back up after a pause, a bounded number of times before a load succeeds. */
import type { AvatarGrant } from "@luke/features/avatar-grant";
import type { RunMode } from "@luke/host";
import { PUSH, type PushEvent } from "@luke/host/contract";
import type { WebContents } from "electron";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PanelManager } from "./panel-manager";
import { VoiceWindow } from "./voice-window";
import { windowPushes } from "./window-pushes";

/**
 * What a window does once its renderer dies or its page fails to load: the
 * panel loads its page again after a pause, the voice window is replaced,
 * and past the bound with no load finished between, the panel asks whether
 * to reload once more and the voice window stays down.
 *
 * Note that Electron's module is replaced whole, because it is the operating
 * system's door (its windows, its renderers, its sheets) and answers nothing
 * outside an Electron process, and that the pause is waited out on a fake
 * timer, since it is a plain `setTimeout`.
 */

const { windows, sheets, FakeBrowserWindow } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  const windows: InstanceType<typeof FakeBrowserWindow>[] = [];
  /** The answers the next sheets give, by button, and the windows each was shown on. */
  const sheets = { answers: [] as number[], shownOn: [] as unknown[] };
  class FakeWebContents extends EventEmitter {
    setBackgroundThrottling(): void {}
    setWindowOpenHandler(): void {}
    send(): void {}
  }
  class FakeBrowserWindow extends EventEmitter {
    readonly webContents = new FakeWebContents();
    /** How many times a page was loaded into the window. */
    loads = 0;
    shown = false;
    destroyed = false;
    constructor() {
      super();
      windows.push(this);
    }
    isDestroyed = () => this.destroyed;
    loadFile = () => {
      this.loads += 1;
      return Promise.resolve();
    };
    show = () => {
      this.shown = true;
    };
    showInactive = () => {
      this.shown = true;
    };
    destroy = () => {
      this.destroyed = true;
    };
  }
  return { windows, sheets, FakeBrowserWindow };
});

const DISPLAY = { id: 1, workArea: { x: 0, y: 0, width: 1600, height: 1000 } };

vi.mock("electron", () => ({
  BrowserWindow: FakeBrowserWindow,
  app: { focus: () => undefined, quit: () => undefined },
  dialog: {
    showMessageBox: (window: unknown) => {
      sheets.shownOn.push(window);
      return Promise.resolve({ response: sheets.answers.shift() ?? 0 });
    },
  },
  screen: { getPrimaryDisplay: () => DISPLAY, getAllDisplays: () => [DISPLAY] },
}));

const RUN_MODE: RunMode = {
  requiresAccount: false,
  observesProviders: false,
  animates: false,
  takesFocus: false,
  sendsNetwork: false,
};

const GRANT: AvatarGrant = {
  serverUrl: "wss://avatar.test",
  participantToken: "token",
  agentIdentity: "agent",
};

/** Longer than the pause before a revival. */
const PAST_THE_PAUSE_MS = 5_000;

const stops: AbortController[] = [];

/** The panel's one window, its first page drawn, and every reason its renderer was reported gone. */
function drawnPanel() {
  const gone: string[] = [];
  const panels = new PanelManager({
    runMode: RUN_MODE,
    mediaDuck: { setExchangeActive: () => undefined },
    preloadPath: "preload.js",
    rendererHtmlPath: "index.html",
    rendererUrl: "file:///index.html",
    zoomFactor: () => 1,
    placementPath: undefined,
    closing: () => false,
    onRendererGone: (reason) => gone.push(reason),
  });
  panels.reconcile();
  const [window] = windows;
  if (window === undefined) throw new Error("The panel opened no window.");
  window.emit("ready-to-show");
  return { panels, window, gone };
}

/** The renderer behind `window` crashes. */
function crash(window: InstanceType<typeof FakeBrowserWindow>): void {
  window.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
}

/** The next push a page's stream carries once everything pending has run; nothing while it waits. */
async function nextHeard(stream: AsyncIteratorObject<PushEvent>) {
  let heard: string | undefined;
  const read = stream.next().then(
    (result) => {
      if (!result.done) heard = result.value.push;
    },
    () => undefined,
  );
  await vi.advanceTimersByTimeAsync(0);
  return { heard: () => heard, read };
}

beforeEach(() => {
  vi.useFakeTimers();
  windows.length = 0;
  sheets.answers.length = 0;
  sheets.shownOn.length = 0;
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop.abort();
  vi.useRealTimers();
});

test("a panel whose renderer goes loads its page again after the pause, and says why", () => {
  const { window, gone } = drawnPanel();
  expect(window.loads).toBe(1);

  crash(window);
  expect(window.loads).toBe(1);
  vi.advanceTimersByTime(PAST_THE_PAUSE_MS);
  expect(window.loads).toBe(2);
  expect(gone).toEqual(["The panel renderer went (crashed). It is being reloaded."]);
});

test("a panel whose page fails to load loads it again, though a subframe's failure or an aborted load does not", () => {
  const { window } = drawnPanel();
  window.webContents.emit("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", "x", false);
  window.webContents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "x", true);
  vi.advanceTimersByTime(PAST_THE_PAUSE_MS);
  expect(window.loads).toBe(1);

  window.webContents.emit("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", "x", true);
  vi.advanceTimersByTime(PAST_THE_PAUSE_MS);
  expect(window.loads).toBe(2);
});

test("past the bound the panel stops reloading and asks, and Reload loads it once more", async () => {
  const { window, gone } = drawnPanel();
  for (let death = 0; death < 3; death += 1) {
    crash(window);
    vi.advanceTimersByTime(PAST_THE_PAUSE_MS);
  }
  expect(window.loads).toBe(4);
  expect(sheets.shownOn).toEqual([]);

  crash(window);
  await vi.advanceTimersByTimeAsync(PAST_THE_PAUSE_MS);
  expect(sheets.shownOn).toEqual([window]);
  expect(window.shown).toBe(true);
  expect(gone.at(-1)).toBe(
    "The panel renderer went (crashed). It stopped reloading, so the developer was asked.",
  );
  // Reload was answered: the page loads at once, and the count starts over.
  expect(window.loads).toBe(5);
  for (let death = 0; death < 3; death += 1) {
    crash(window);
    vi.advanceTimersByTime(PAST_THE_PAUSE_MS);
  }
  expect(window.loads).toBe(8);
});

test("a load that finishes between deaths starts the count over", () => {
  const { window } = drawnPanel();
  for (let death = 0; death < 5; death += 1) {
    crash(window);
    vi.advanceTimersByTime(PAST_THE_PAUSE_MS);
    window.webContents.emit("did-finish-load");
  }
  expect(window.loads).toBe(6);
  expect(sheets.shownOn).toEqual([]);
});

test("the avatar's grant handed over while the renderer is down reaches the page the reload draws", async () => {
  const { panels, window } = drawnPanel();
  // SAFETY: the page is the fake above, whose events stand for Electron's.
  const page = window.webContents as unknown as WebContents;
  const stop = new AbortController();
  stops.push(stop);
  const stream = windowPushes.stream(page, stop.signal);

  crash(window);
  panels.showAvatarSession(GRANT);
  const pending = await nextHeard(stream);
  expect(pending.heard()).toBeUndefined();

  vi.advanceTimersByTime(PAST_THE_PAUSE_MS);
  window.webContents.emit("did-finish-load");
  await pending.read;
  expect(pending.heard()).toBe(PUSH.AVATAR_SESSION);
});

test("the voice window is replaced within the same bound, then stays down", () => {
  const gone: string[] = [];
  const gaveUp: string[] = [];
  new VoiceWindow({
    runMode: RUN_MODE,
    preloadPath: "preload.js",
    rendererHtmlPath: "voice.html",
    rendererUrl: "file:///voice.html",
    onGone: (reason) => gone.push(reason),
    onGaveUp: (reason) => gaveUp.push(reason),
  }).open();
  for (let death = 0; death < 4; death += 1) {
    const window = windows.at(-1);
    if (window === undefined) throw new Error("The voice window was not opened.");
    crash(window);
    vi.advanceTimersByTime(PAST_THE_PAUSE_MS);
  }
  expect(windows).toHaveLength(4);
  expect(gone).toHaveLength(3);
  expect(gaveUp).toEqual([
    "The voice renderer went (crashed). It was replaced 3 times without loading, so it stays down for this run.",
  ]);
});
