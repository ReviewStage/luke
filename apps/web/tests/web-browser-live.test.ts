// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { webPlatform } from "../src/app/web-platform";

/**
 * The web's door to a cloud Browser tab's live view: the socket is opened
 * from the page on its own origin at the tab's path, as a plain same-origin
 * WebSocket the browser carries the session cookie on; what the panel sends
 * while it opens is held for it; and the service's frames and its close
 * reach the panel. A stand-in WebSocket, which jsdom opens nothing with.
 */

const TARGET = {
  taskId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  tabId: "5a0e1f2b-3c4d-4e5f-9a6b-7c8d9e0f1a2b",
} as const;

/** A WebSocket the test opens and closes by hand, keeping what was sent on it. */
class StandInSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static opened: StandInSocket[] = [];
  readyState = StandInSocket.CONNECTING;
  readonly sent: string[] = [];
  constructor(readonly url: URL) {
    super();
    StandInSocket.opened.push(this);
  }
  send(text: string): void {
    this.sent.push(text);
  }
  close(): void {
    this.readyState = 3;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  StandInSocket.opened = [];
});

test("the socket opens on the page's own origin at the tab's path, sends what was held once open, and hands the service's frames and its close to the panel", () => {
  vi.stubGlobal("WebSocket", StandInSocket);
  const heard: string[] = [];
  const platform = webPlatform({ recordSurfaceEvent: () => undefined });

  const socket = platform.openBrowserLive(TARGET, {
    message: (text) => heard.push(`message:${text}`),
    closed: (code) => heard.push(`closed:${code}`),
  });
  socket.send('{"type":"viewport","width":640,"height":400}');
  const [opened] = StandInSocket.opened;
  assert.ok(opened);
  assert.equal(
    opened.url.href,
    `ws://${location.host}/api/browser/live?task=${TARGET.taskId}&tab=${TARGET.tabId}`,
  );
  assert.deepEqual(opened.sent, []);

  opened.readyState = StandInSocket.OPEN;
  opened.dispatchEvent(new Event("open"));
  socket.send('{"type":"take-over"}');
  opened.dispatchEvent(new MessageEvent("message", { data: '{"type":"page"}' }));
  opened.dispatchEvent(new CloseEvent("close", { code: 4000 }));

  assert.deepEqual(opened.sent, [
    '{"type":"viewport","width":640,"height":400}',
    '{"type":"take-over"}',
  ]);
  assert.deepEqual(heard, ['message:{"type":"page"}', "closed:4000"]);
});
