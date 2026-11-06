import type { RunMode } from "@repo/host";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PanelManager } from "./panel-manager";

const { windows, sheets, quit, FakeBrowserWindow } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  const windows: InstanceType<typeof FakeBrowserWindow>[] = [];
  const sheets = { answers: [] as number[], shownOn: [] as unknown[] };
  const quit = { goes: true, asked: false, tearingDown: false };
  class FakeWebContents extends EventEmitter {
    setBackgroundThrottling(): void {}
    setWindowOpenHandler(): void {}
    send(): void {}
  }
  class FakeBrowserWindow extends EventEmitter {
    readonly webContents = new FakeWebContents();
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
  return { windows, sheets, quit, FakeBrowserWindow };
});

const DISPLAY = { id: 1, workArea: { x: 0, y: 0, width: 1600, height: 1000 } };

vi.mock("electron", () => ({
  BrowserWindow: FakeBrowserWindow,
  app: {
    focus: () => undefined,
    quit: () => {
      quit.asked = true;
      if (quit.goes) quit.tearingDown = true;
    },
  },
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

const PAST_THE_PAUSE_MS = 5_000;

function drawnPanel() {
  const gone: string[] = [];
  const panels = new PanelManager({
    runMode: RUN_MODE,
    preloadPath: "preload.js",
    rendererHtmlPath: "index.html",
    rendererUrl: "file:///index.html",
    zoomFactor: () => 1,
    placementPath: undefined,
    closing: () => quit.tearingDown,
    onRendererGone: (reason) => gone.push(reason),
  });
  panels.reconcile();
  const [window] = windows;
  if (window === undefined) throw new Error("The panel opened no window.");
  window.emit("ready-to-show");
  return { window, gone };
}

function crash(window: InstanceType<typeof FakeBrowserWindow>): void {
  window.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
}

beforeEach(() => {
  vi.useFakeTimers();
  windows.length = 0;
  sheets.answers.length = 0;
  sheets.shownOn.length = 0;
  Object.assign(quit, { goes: true, asked: false, tearingDown: false });
});

afterEach(() => {
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
  expect(window.loads).toBe(5);
  for (let death = 0; death < 3; death += 1) {
    crash(window);
    vi.advanceTimersByTime(PAST_THE_PAUSE_MS);
  }
  expect(window.loads).toBe(8);
});

async function crashPastTheBound(window: InstanceType<typeof FakeBrowserWindow>, answer: number) {
  sheets.answers.push(answer);
  for (let death = 0; death < 4; death += 1) {
    crash(window);
    await vi.advanceTimersByTimeAsync(PAST_THE_PAUSE_MS);
  }
}

test("Quit Vespin quits, and loads nothing more", async () => {
  const { window } = drawnPanel();
  await crashPastTheBound(window, 1);
  expect(quit.asked).toBe(true);
  expect(window.loads).toBe(4);
});

test("Quit Vespin held by a live call that is kept loads the panel once more rather than leaving it blank", async () => {
  quit.goes = false;
  const { window } = drawnPanel();
  await crashPastTheBound(window, 1);
  expect(quit.asked).toBe(true);
  expect(window.loads).toBe(5);
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
