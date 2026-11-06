import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { reportRendererErrors } from "./renderer-errors";

const { electronApp, FakeWindow } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
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
        sourceId: "file:///Applications/Vespin.app/renderer/index.js",
      });
    }
  }
  return { electronApp: new EventEmitter(), FakeWindow };
});

vi.mock("electron", () => ({ app: electronApp }));

afterEach(() => {
  electronApp.removeAllListeners();
});

function open(document: string): InstanceType<typeof FakeWindow> {
  const window = new FakeWindow(`file:///Applications/Vespin.app/renderer/${document}`);
  electronApp.emit("browser-window-created", {}, window);
  return window;
}

test("each error a window logs is one line naming its document, and a warning is none", () => {
  const lines: string[] = [];
  reportRendererErrors((line) => lines.push(line));

  const panel = open("index.html");
  panel.log("warning", "the microphone is slow to answer");
  panel.log("error", "Uncaught TypeError: session is undefined");

  assert.deepEqual(lines, [
    "renderer error in index.html: Uncaught TypeError: session is undefined (index.js:12)",
  ]);
});

test("an error naming an access token says only that one happened, and none of its words", () => {
  const lines: string[] = [];
  reportRendererErrors((line) => lines.push(line));

  open("index.html").log(
    "error",
    "GET https://service.example.test/v1/validate?access_token=eyJhbGciOi.secret 401",
  );

  assert.deepEqual(lines, [
    "renderer error in index.html, withheld because it names an access token",
  ]);
});

test("once the reporting stops, no window says anything, open before or opened after", () => {
  const lines: string[] = [];
  const stop = reportRendererErrors((line) => lines.push(line));
  const panel = open("index.html");
  stop();

  panel.log("error", "Uncaught Error: the sidebar never loaded");
  open("index.html").log("error", "Uncaught Error: the task list never drew");

  assert.deepEqual(lines, []);
});
