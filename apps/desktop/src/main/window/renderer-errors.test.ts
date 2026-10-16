import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { reportRendererErrors } from "./renderer-errors";

/**
 * A development build's renderer errors, as the terminal the run was started
 * from reads them: each error a window's page logs is one line naming the
 * document it came from, a warning is not, and once the reporting stops no
 * window says anything, whether it was open before or opened after.
 *
 * Note that Electron's module is replaced whole, because it is the operating
 * system's door and answers nothing outside an Electron process.
 */

const { electronApp, FakeWindow } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  /** A window as Electron opens it: a page at an address, whose console speaks through its contents' events. */
  class FakeWindow {
    readonly webContents: InstanceType<typeof EventEmitter> & { getURL: () => string };
    constructor(url: string) {
      this.webContents = Object.assign(new EventEmitter(), { getURL: () => url });
    }
    log(level: string, message: string): void {
      this.webContents.emit("console-message", {
        level,
        message,
        lineNumber: 12,
        sourceId: "file:///Applications/Luke.app/renderer/index.js",
      });
    }
  }
  return { electronApp: new EventEmitter(), FakeWindow };
});

vi.mock("electron", () => ({ app: electronApp }));

afterEach(() => {
  electronApp.removeAllListeners();
});

/** Opens a window at the renderer's document of that name, as Electron announces one. */
function open(document: string): InstanceType<typeof FakeWindow> {
  const window = new FakeWindow(`file:///Applications/Luke.app/renderer/${document}`);
  electronApp.emit("browser-window-created", {}, window);
  return window;
}

test("each error a window logs is one line naming its document, and a warning is none", () => {
  const lines: string[] = [];
  reportRendererErrors((line) => lines.push(line));

  const voice = open("voice.html");
  voice.log("warning", "the microphone is slow to answer");
  voice.log("error", "Uncaught TypeError: session is undefined");

  assert.deepEqual(lines, [
    "renderer error in voice.html: Uncaught TypeError: session is undefined (index.js:12)",
  ]);
});

test("once the reporting stops, no window says anything, open before or opened after", () => {
  const lines: string[] = [];
  const stop = reportRendererErrors((line) => lines.push(line));
  const panel = open("index.html");
  stop();

  panel.log("error", "Uncaught Error: the sidebar never loaded");
  open("call.html").log("error", "Uncaught Error: the avatar never drew");

  assert.deepEqual(lines, []);
});
