import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  BROWSER_AGENT_ACTION,
  BROWSER_AGENT_LIMITS,
  BROWSER_SCREENSHOT,
  BROWSER_STEP_STATUS,
  type BrowserAgentAction,
  type BrowserAgentStep,
  type BrowserCursorMove,
} from "@luke/features/browser-agent-actions";
import {
  BROWSER_CURSOR_BEAT,
  type BrowserCursor,
  runBrowserActions,
} from "@luke/features/browser-agent-cdp";
import type { CdpEvent, PageTarget } from "@luke/features/browser-cdp";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import {
  type FakeCdpAnswer,
  type FakeCdpCommand,
  type FakeCdpPeer,
  fakeBridgePty,
  fakeCdpPeer,
  fakeSandboxApi,
} from "../../testing/agent-browser-fake.js";
import { agentBrowserOver } from "./agent-browser.js";

/**
 * An agent's browser actions over a fake Chromium behind the real CDP
 * session: each action sends the browser's own commands for it on the tab's
 * flattened session, a ref a snapshot printed resolves to the middle of its
 * element, a sequence stops at its first failure and says why, every action
 * is bounded, and every result holds to its cap.
 */

const SESSION = "wrun_actions_fixture";

/** The commands a page answers with nothing much, as Chrome does once they are done. */
const PLAIN = new Set([
  "Target.detachFromTarget",
  "Target.activateTarget",
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
  "Input.insertText",
  "DOM.scrollIntoViewIfNeeded",
  "DOM.focus",
  "Page.navigateToHistoryEntry",
  "Runtime.enable",
  "Runtime.disable",
  "Log.enable",
  "Log.disable",
]);

const LAYOUT = {
  cssLayoutViewport: { clientWidth: 1280, clientHeight: 800 },
  cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 1280, clientHeight: 800 },
};

/** A fake Chromium that answers what a page does, then the suite's own answers, recording every command it is sent. */
function browser(
  own: (command: FakeCdpCommand) => FakeCdpAnswer | undefined = () => undefined,
  pages?: readonly PageTarget[],
) {
  const sent: FakeCdpCommand[] = [];
  const answer = (command: FakeCdpCommand): FakeCdpAnswer | undefined => {
    sent.push(command);
    const answered = own(command);
    if (answered !== undefined) return answered;
    if (command.method === "Target.attachToTarget") {
      return { result: { sessionId: `session-${String(command.params.targetId)}` } };
    }
    if (command.method === "Page.navigate") return { result: { frameId: "frame-1" } };
    if (command.method === "Page.getLayoutMetrics") return { result: LAYOUT };
    return PLAIN.has(command.method) ? { result: {} } : undefined;
  };
  return Effect.map(fakeCdpPeer(pages === undefined ? { answer } : { answer, pages }), (peer) => ({
    peer,
    sent,
  }));
}

/** Runs the actions on a session with the peer's browser, as the tool will, with the cursor given. */
function run(peer: FakeCdpPeer, actions: readonly BrowserAgentAction[], cursor?: BrowserCursor) {
  const { api } = fakeSandboxApi({ status: "running", sessionId: SESSION });
  const service = agentBrowserOver(api, fakeBridgePty(peer));
  return Effect.scoped(
    Effect.flatMap(service.connect(SESSION), (cdp) =>
      runBrowserActions(cdp, actions, cursor === undefined ? {} : { cursor }),
    ),
  );
}

/** A cursor that writes each move it hears into the browser's own record, so the order of moves and commands reads as one. */
function cursorInto(sent: FakeCdpCommand[], watched: boolean) {
  const moves: BrowserCursorMove[] = [];
  const cursor: BrowserCursor = {
    watched,
    report: (move) =>
      Effect.sync(() => {
        moves.push(move);
        sent.push({ method: "cursor", params: { kind: move.kind, x: move.x, y: move.y } });
      }),
  };
  return { cursor, moves };
}

/** The commands sent to pages and to the browser about them, without the listing a step reads along the way. */
function pageCommands(sent: readonly FakeCdpCommand[]) {
  return sent
    .filter((command) => command.method !== "Target.getTargets")
    .map(({ method, params, sessionId }) =>
      sessionId === undefined ? { method, params } : { method, params, sessionId },
    );
}

function failureOf(step: BrowserAgentStep | undefined): string | undefined {
  return step?.status === BROWSER_STEP_STATUS.FAILED ? step.error : undefined;
}

it.effect("each action sends the browser's own commands, on the tab's flattened session", () =>
  Effect.gen(function* () {
    const { peer, sent } = yield* browser((command) =>
      command.method === "Page.getNavigationHistory"
        ? {
            result: {
              currentIndex: 1,
              entries: [{ id: 7, url: "http://localhost:3000/" }, { id: 8 }],
            },
          }
        : undefined,
    );

    const ran = yield* run(peer, [
      { action: BROWSER_AGENT_ACTION.OPEN, url: "http://localhost:3000/" },
      { action: BROWSER_AGENT_ACTION.NAVIGATE, url: "https://example.com/" },
      { action: BROWSER_AGENT_ACTION.CLICK, x: 40, y: 60 },
      { action: BROWSER_AGENT_ACTION.TYPE, text: "héllo" },
      { action: BROWSER_AGENT_ACTION.KEY, key: "Enter" },
      { action: BROWSER_AGENT_ACTION.KEY, key: "a", modifiers: ["control"] },
      { action: BROWSER_AGENT_ACTION.KEY, key: "a", modifiers: ["shift"] },
      { action: BROWSER_AGENT_ACTION.SCROLL, deltaY: 300 },
      { action: BROWSER_AGENT_ACTION.BACK },
      { action: BROWSER_AGENT_ACTION.CLOSE },
      { action: BROWSER_AGENT_ACTION.LIST },
    ]);

    const page = { sessionId: "session-page-1" };
    const keyA = { modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 };
    const shiftA = { modifiers: 8, key: "A", code: "KeyA", windowsVirtualKeyCode: 65 };
    const enter = { modifiers: 0, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
    assert.deepEqual(pageCommands(sent), [
      { method: "Target.createTarget", params: { url: "http://localhost:3000/" } },
      { method: "Target.attachToTarget", params: { targetId: "page-1", flatten: true } },
      { method: "Page.navigate", params: { url: "https://example.com/" }, ...page },
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseMoved", x: 40, y: 60, button: "none", buttons: 0, clickCount: 0 },
        ...page,
      },
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mousePressed", x: 40, y: 60, button: "left", buttons: 1, clickCount: 1 },
        ...page,
      },
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseReleased", x: 40, y: 60, button: "left", buttons: 0, clickCount: 1 },
        ...page,
      },
      { method: "Input.insertText", params: { text: "héllo" }, ...page },
      {
        method: "Input.dispatchKeyEvent",
        params: { type: "keyDown", ...enter, text: "\r" },
        ...page,
      },
      { method: "Input.dispatchKeyEvent", params: { type: "keyUp", ...enter }, ...page },
      { method: "Input.dispatchKeyEvent", params: { type: "rawKeyDown", ...keyA }, ...page },
      { method: "Input.dispatchKeyEvent", params: { type: "keyUp", ...keyA }, ...page },
      {
        method: "Input.dispatchKeyEvent",
        params: { type: "keyDown", ...shiftA, text: "A" },
        ...page,
      },
      { method: "Input.dispatchKeyEvent", params: { type: "keyUp", ...shiftA }, ...page },
      { method: "Page.getLayoutMetrics", params: {}, ...page },
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseWheel", x: 640, y: 400, deltaX: 0, deltaY: 300 },
        ...page,
      },
      { method: "Page.getNavigationHistory", params: {}, ...page },
      { method: "Page.navigateToHistoryEntry", params: { entryId: 7 }, ...page },
      { method: "Target.closeTarget", params: { targetId: "page-1" } },
    ]);
    assert.deepEqual(
      ran.steps.map((step) => [step.action, step.status]),
      [
        ["open", "done"],
        ["navigate", "done"],
        ["click", "done"],
        ["type", "done"],
        ["key", "done"],
        ["key", "done"],
        ["key", "done"],
        ["scroll", "done"],
        ["back", "done"],
        ["close", "done"],
        ["list", "done"],
      ],
    );
    assert.deepEqual(ran.steps.at(-1), {
      action: "list",
      status: "done",
      tabs: [{ tab: "page-blank", url: "about:blank", title: "" }],
    });
    assert.equal(ran.skipped, 0);
  }),
);

/** A shop's page as Chromium's accessibility tree has it, wrappers, ignored nodes, and text runs among it. */
const SHOP_TREE = {
  nodes: [
    {
      nodeId: "1",
      role: { value: "RootWebArea" },
      name: { value: "Shop" },
      childIds: ["2", "9"],
      backendDOMNodeId: 1,
    },
    {
      nodeId: "2",
      parentId: "1",
      role: { value: "generic" },
      name: { value: "" },
      childIds: ["3", "4", "7"],
      backendDOMNodeId: 2,
    },
    {
      nodeId: "3",
      parentId: "2",
      role: { value: "heading" },
      name: { value: "Welcome\n  back" },
      properties: [{ name: "level", value: { value: 1 } }],
      backendDOMNodeId: 5,
    },
    {
      nodeId: "4",
      parentId: "2",
      role: { value: "button" },
      name: { value: "Buy now" },
      childIds: ["5"],
      backendDOMNodeId: 42,
    },
    {
      nodeId: "5",
      parentId: "4",
      role: { value: "StaticText" },
      name: { value: "Buy now" },
      childIds: ["6"],
      backendDOMNodeId: 43,
    },
    { nodeId: "6", parentId: "5", role: { value: "InlineTextBox" }, name: { value: "Buy now" } },
    {
      nodeId: "7",
      parentId: "2",
      role: { value: "textbox" },
      name: { value: "Email" },
      value: { value: "dean@example.com" },
      properties: [
        { name: "focused", value: { value: true } },
        { name: "disabled", value: { value: false } },
      ],
      childIds: ["8"],
      backendDOMNodeId: 7,
    },
    { nodeId: "8", parentId: "7", ignored: true, role: { value: "none" }, childIds: [] },
    {
      nodeId: "9",
      parentId: "1",
      role: { value: "StaticText" },
      name: { value: "Free returns" },
      backendDOMNodeId: 11,
    },
  ],
};

it.effect(
  "a snapshot prints the page's elements with refs, and a ref clicks the middle of its element",
  () =>
    Effect.gen(function* () {
      const { peer, sent } = yield* browser(
        (command) => {
          if (command.method === "Accessibility.getFullAXTree") return { result: SHOP_TREE };
          if (command.method === "DOM.getContentQuads" && command.params.backendNodeId === 42) {
            return { result: { quads: [[100, 200, 140, 200, 140, 220, 100, 220]] } };
          }
          if (
            command.method === "DOM.scrollIntoViewIfNeeded" &&
            command.params.backendNodeId === 99
          ) {
            return { error: { code: -32000, message: "No node with given id found" } };
          }
          return undefined;
        },
        [{ targetId: "page-shop", url: "https://shop.example/", title: "Shop" }],
      );

      const snapshotted = yield* run(peer, [
        { action: BROWSER_AGENT_ACTION.SNAPSHOT, tab: "page-shop" },
      ]);
      const clicked = yield* run(peer, [
        { action: BROWSER_AGENT_ACTION.CLICK, tab: "page-shop", ref: "e42" },
        { action: BROWSER_AGENT_ACTION.CLICK, ref: "e99" },
      ]);

      assert.deepEqual(snapshotted.steps, [
        {
          action: "snapshot",
          status: "done",
          tab: "page-shop",
          url: "https://shop.example/",
          title: "Shop",
          text: [
            '- page "Shop"',
            '  - heading "Welcome back" [level=1, ref=e5]',
            '  - button "Buy now" [ref=e42]',
            '  - textbox "Email" value="dean@example.com" [focused, ref=e7]',
            '  - text "Free returns"',
          ].join("\n"),
          truncated: false,
        },
      ]);
      const pressed = sent.find(
        (command) =>
          command.method === "Input.dispatchMouseEvent" && command.params.type === "mousePressed",
      );
      assert.deepEqual([pressed?.params.x, pressed?.params.y], [120, 210]);
      assert.equal(clicked.steps[0]?.status, BROWSER_STEP_STATUS.DONE);
      assert.match(
        failureOf(clicked.steps[1]) ?? "",
        /^e99 is not on the page any more; take a new snapshot/u,
      );
    }),
);

it.effect("a sequence stops at its first failure, says why, and counts what never ran", () =>
  Effect.gen(function* () {
    const { peer } = yield* browser((command) => {
      if (command.method === "Target.closeTarget" && command.params.targetId === "page-vanished") {
        return { result: { success: false } };
      }
      if (command.method === "Target.attachToTarget" && command.params.targetId === "page-gone") {
        return { error: { code: -32602, message: "No target with given id found" } };
      }
      return command.method === "Page.navigate" && command.params.url === "https://nowhere.invalid/"
        ? { result: { frameId: "frame-1", errorText: "net::ERR_NAME_NOT_RESOLVED" } }
        : undefined;
    });

    const navigated = yield* run(peer, [
      { action: BROWSER_AGENT_ACTION.OPEN, url: "http://localhost:3000/" },
      { action: BROWSER_AGENT_ACTION.NAVIGATE, url: "https://nowhere.invalid/" },
      { action: BROWSER_AGENT_ACTION.SNAPSHOT },
      { action: BROWSER_AGENT_ACTION.CLOSE },
    ]);
    const unnamed = yield* run(peer, [{ action: BROWSER_AGENT_ACTION.SCREENSHOT }]);
    const unclosed = yield* run(peer, [
      { action: BROWSER_AGENT_ACTION.CLOSE, tab: "page-vanished" },
      { action: BROWSER_AGENT_ACTION.LIST },
    ]);
    const unknown = yield* run(peer, [
      { action: BROWSER_AGENT_ACTION.KEY, tab: "page-gone", key: "Enter" },
      { action: BROWSER_AGENT_ACTION.LIST },
    ]);

    assert.deepEqual(navigated.steps, [
      { action: "open", status: "done", tab: "page-1" },
      {
        action: "navigate",
        status: "failed",
        tab: "page-1",
        error: "the page at https://nowhere.invalid/ did not load: net::ERR_NAME_NOT_RESOLVED",
      },
    ]);
    assert.equal(navigated.skipped, 2);
    assert.match(failureOf(unnamed.steps[0]) ?? "", /^name the tab/u);
    assert.deepEqual(unclosed.steps, [
      {
        action: "close",
        status: "failed",
        tab: "page-vanished",
        error: "there is no tab page-vanished; list the tabs to see which are open",
      },
    ]);
    assert.deepEqual(unknown.steps, [
      {
        action: "key",
        status: "failed",
        tab: "page-gone",
        error: "there is no tab page-gone; list the tabs to see which are open",
      },
    ]);
    assert.equal(unknown.skipped, 1);
  }),
);

it.effect(
  "an action that takes too long fails, and a wait asks until the page loads or its timeout",
  () =>
    Effect.gen(function* () {
      let asked = 0;
      const { peer } = yield* browser((command) => {
        if (command.method === "Input.dispatchMouseEvent") return { silent: true };
        if (command.method !== "Runtime.evaluate") return undefined;
        asked += 1;
        return { result: { result: { value: asked < 3 || asked > 10 ? "loading" : "complete" } } };
      });
      const tab = "page-blank";

      const loading = yield* Effect.forkChild(
        run(peer, [{ action: BROWSER_AGENT_ACTION.WAIT, tab }]),
      );
      yield* TestClock.adjust(Duration.seconds(1));
      const loaded = yield* Fiber.join(loading);
      asked = 10;
      const stuck = yield* Effect.forkChild(
        run(peer, [{ action: BROWSER_AGENT_ACTION.WAIT, tab, timeoutMs: 2_000 }]),
      );
      const slow = yield* Effect.forkChild(
        run(peer, [{ action: BROWSER_AGENT_ACTION.CLICK, tab, x: 1, y: 1 }]),
      );
      yield* TestClock.adjust(Duration.millis(BROWSER_AGENT_LIMITS.ACTION_TIMEOUT_MS));

      assert.deepEqual(loaded.steps, [{ action: "wait", status: "done", tab }]);
      assert.equal(
        failureOf((yield* Fiber.join(stuck)).steps[0]),
        "the page did not finish loading within 2 seconds",
      );
      assert.equal(
        failureOf((yield* Fiber.join(slow)).steps[0]),
        "click did not finish within 20 seconds",
      );
    }),
);

it.effect(
  "a screenshot is the visible page downscaled to the longest side, under the byte cap",
  () =>
    Effect.gen(function* () {
      const tooLarge = "A".repeat(Math.ceil((BROWSER_SCREENSHOT.MAX_BYTES + 3) / 3) * 4);
      const qualities: unknown[] = [];
      const { peer, sent } = yield* browser((command) => {
        if (command.method === "Page.getLayoutMetrics") {
          return {
            result: {
              cssLayoutViewport: { clientWidth: 1600, clientHeight: 1000 },
              cssVisualViewport: { pageX: 0, pageY: 300, clientWidth: 1600, clientHeight: 1000 },
            },
          };
        }
        if (command.method === "Runtime.evaluate") return { result: { result: { value: 2 } } };
        if (command.method !== "Page.captureScreenshot") return undefined;
        qualities.push(command.params.quality);
        return { result: { data: command.params.quality === 70 ? tooLarge : "/9j/AAAA" } };
      });

      const ran = yield* run(peer, [
        { action: BROWSER_AGENT_ACTION.SCREENSHOT, tab: "page-blank" },
      ]);

      assert.deepEqual(ran.steps, [
        {
          action: "screenshot",
          status: "done",
          tab: "page-blank",
          image: { mime: "image/jpeg", data: "/9j/AAAA", width: 1280, height: 800 },
        },
      ]);
      const capture = sent.find((command) => command.method === "Page.captureScreenshot");
      assert.deepEqual(capture?.params, {
        format: "jpeg",
        quality: 70,
        clip: { x: 0, y: 300, width: 1600, height: 1000, scale: 0.4 },
        captureBeyondViewport: false,
      });
      assert.deepEqual(qualities, [70, 50]);
      assert.ok(sent.some((command) => command.method === "Target.activateTarget"));
    }),
);

it.effect("a screenshot that never fits the byte cap fails and says what to do instead", () =>
  Effect.gen(function* () {
    const tooLarge = "A".repeat(Math.ceil((BROWSER_SCREENSHOT.MAX_BYTES + 3) / 3) * 4);
    const { peer } = yield* browser((command) => {
      if (command.method === "Runtime.evaluate") return { result: { result: { value: 1 } } };
      return command.method === "Page.captureScreenshot"
        ? { result: { data: tooLarge } }
        : undefined;
    });

    const ran = yield* run(peer, [{ action: BROWSER_AGENT_ACTION.SCREENSHOT, tab: "page-blank" }]);

    assert.match(failureOf(ran.steps[0]) ?? "", /take a snapshot instead$/u);
  }),
);

/** A console call on the session given, at the time given. */
function consoleCall(sessionId: string, timestamp: number, type: string, text: string): CdpEvent {
  return {
    method: "Runtime.consoleAPICalled",
    params: {
      type,
      timestamp,
      args: [
        { type: "string", value: text },
        { type: "number", value: timestamp },
      ],
    },
    sessionId,
  };
}

it.effect("the console answers the page's latest messages, oldest first, each cut to its cap", () =>
  Effect.gen(function* () {
    const { peer: inner } = yield* browser();
    const own = "session-page-blank";
    const replayed: CdpEvent[] = [
      ...Array.from({ length: 55 }, (_, index) =>
        consoleCall(own, index + 1, index % 2 === 0 ? "log" : "warning", "message"),
      ),
      consoleCall("session-other", 100, "error", "another tab's"),
      {
        method: "Log.entryAdded",
        params: {
          entry: { source: "network", level: "error", text: "x".repeat(2_000), timestamp: 60 },
        },
        sessionId: own,
      },
    ];
    // Note that the browser replays what a page logged before it answers the enable, as Chrome does.
    const peer: FakeCdpPeer = {
      ...inner,
      answer: (command) =>
        command.method === "Runtime.enable" && command.sessionId === own
          ? Effect.andThen(
              Effect.forEach(replayed, inner.emit, { discard: true }),
              inner.answer(command),
            )
          : inner.answer(command),
    };

    const ran = yield* run(peer, [{ action: BROWSER_AGENT_ACTION.CONSOLE, tab: "page-blank" }]);

    const [step] = ran.steps;
    assert.equal(step?.action, BROWSER_AGENT_ACTION.CONSOLE);
    assert.ok(
      step?.action === BROWSER_AGENT_ACTION.CONSOLE && step.status === BROWSER_STEP_STATUS.DONE,
    );
    assert.equal(step.messages.length, BROWSER_AGENT_LIMITS.CONSOLE_MAX_MESSAGES);
    assert.deepEqual(step.messages[0], { level: "log", text: "message 7" });
    assert.deepEqual(step.messages[1], { level: "warning", text: "message 8" });
    const last = step.messages.at(-1);
    assert.equal(last?.level, "error");
    assert.equal(last?.text.length, BROWSER_AGENT_LIMITS.CONSOLE_MESSAGE_MAX_CHARS);
    assert.ok(last?.text.endsWith("…"));
    assert.ok(step.messages.every((message) => message.text !== "another tab's 100"));
    assert.equal(step.truncated, true);
  }),
);

it.effect("a listed title and a long page's snapshot hold to their caps", () =>
  Effect.gen(function* () {
    const buttons = Array.from({ length: 2_000 }, (_, index) => ({
      nodeId: String(index + 2),
      parentId: "1",
      role: { value: "button" },
      name: { value: `Button number ${index}` },
      backendDOMNodeId: index + 100,
    }));
    const tree = {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          name: { value: "Long" },
          childIds: buttons.map((node) => node.nodeId),
        },
        ...buttons,
      ],
    };
    const { peer } = yield* browser(
      (command) =>
        command.method === "Accessibility.getFullAXTree" ? { result: tree } : undefined,
      [{ targetId: "page-long", url: "https://long.example/", title: "t".repeat(9_000) }],
    );

    const ran = yield* run(peer, [
      { action: BROWSER_AGENT_ACTION.LIST },
      { action: BROWSER_AGENT_ACTION.SNAPSHOT, tab: "page-long" },
    ]);

    const [listed, snapshotted] = ran.steps;
    assert.ok(
      listed?.action === BROWSER_AGENT_ACTION.LIST && listed.status === BROWSER_STEP_STATUS.DONE,
    );
    assert.equal(listed.tabs[0]?.title.length, BROWSER_AGENT_LIMITS.SHOWN_MAX_CHARS);
    assert.ok(
      snapshotted?.action === BROWSER_AGENT_ACTION.SNAPSHOT &&
        snapshotted.status === BROWSER_STEP_STATUS.DONE,
    );
    assert.equal(snapshotted.truncated, true);
    assert.ok(snapshotted.text.length <= BROWSER_AGENT_LIMITS.SNAPSHOT_MAX_CHARS);
    assert.ok(
      snapshotted.text.startsWith('- page "Long"\n  - button "Button number 0" [ref=e100]'),
    );
    assert.match(
      snapshotted.text,
      /\n… the rest of the page was left out; scroll and take a snapshot again to read it$/u,
    );
  }),
);

it.effect(
  "a cursor hears each click, type, and wheel point before its input, with the page's visible size",
  () =>
    Effect.gen(function* () {
      const { peer, sent } = yield* browser(
        (command) => {
          if (command.method === "DOM.getContentQuads" && command.params.backendNodeId === 42) {
            return { result: { quads: [[100, 200, 140, 200, 140, 220, 100, 220]] } };
          }
          if (command.method === "DOM.getContentQuads" && command.params.backendNodeId === 7) {
            return { result: { quads: [[10, 20, 50, 20, 50, 40, 10, 40]] } };
          }
          if (command.method === "Runtime.evaluate") {
            return { result: { result: { value: { x: 300, y: 400 } } } };
          }
          return undefined;
        },
        [{ targetId: "page-shop", url: "https://shop.example/", title: "Shop" }],
      );
      const { cursor, moves } = cursorInto(sent, false);
      const tab = "page-shop";

      const ran = yield* run(
        peer,
        [
          { action: BROWSER_AGENT_ACTION.CLICK, tab, ref: "e42" },
          { action: BROWSER_AGENT_ACTION.TYPE, ref: "e7", text: "dean@example.com" },
          { action: BROWSER_AGENT_ACTION.TYPE, text: "hello" },
          { action: BROWSER_AGENT_ACTION.CLICK, x: 5, y: 6 },
          { action: BROWSER_AGENT_ACTION.SCROLL, deltaY: 300 },
        ],
        cursor,
      );

      assert.ok(ran.steps.every((step) => step.status === BROWSER_STEP_STATUS.DONE));
      const viewport = { width: 1280, height: 800 };
      assert.deepEqual(
        moves.map(({ at: _at, ...move }) => move),
        [
          { tab, x: 120, y: 210, kind: "click", viewport },
          { tab, x: 30, y: 30, kind: "type", viewport },
          { tab, x: 300, y: 400, kind: "type", viewport },
          { tab, x: 5, y: 6, kind: "click", viewport },
          { tab, x: 640, y: 400, kind: "move", viewport },
        ],
      );
      // Each move is heard after its point is found and before the input that acts there.
      const order = sent
        .filter((command) =>
          ["cursor", "Input.dispatchMouseEvent", "Input.insertText"].includes(command.method),
        )
        .map((command) => String(command.params.kind ?? command.params.type ?? "insertText"));
      assert.deepEqual(order, [
        "click",
        "mouseMoved",
        "mousePressed",
        "mouseReleased",
        "type",
        "insertText",
        "type",
        "insertText",
        "click",
        "mouseMoved",
        "mousePressed",
        "mouseReleased",
        "move",
        "mouseWheel",
      ]);
    }),
);

it.effect("typing nowhere the page can point to moves no cursor, and the text still goes in", () =>
  Effect.gen(function* () {
    const { peer, sent } = yield* browser(
      (command) =>
        command.method === "Runtime.evaluate" ? { result: { result: { value: null } } } : undefined,
      [{ targetId: "page-shop", url: "https://shop.example/", title: "Shop" }],
    );
    const { cursor, moves } = cursorInto(sent, false);

    const ran = yield* run(
      peer,
      [{ action: BROWSER_AGENT_ACTION.TYPE, tab: "page-shop", text: "hello" }],
      cursor,
    );

    assert.deepEqual(moves, []);
    assert.deepEqual(ran.steps, [{ action: "type", status: "done", tab: "page-shop" }]);
    assert.ok(sent.some((command) => command.method === "Input.insertText"));
  }),
);

it.effect("while someone watches, a click waits the cursor's beat after its move is heard", () =>
  Effect.gen(function* () {
    const { peer, sent } = yield* browser(undefined, [
      { targetId: "page-shop", url: "https://shop.example/", title: "Shop" },
    ]);
    const { cursor, moves } = cursorInto(sent, true);
    const pressed = () =>
      sent.some(
        (command) =>
          command.method === "Input.dispatchMouseEvent" && command.params.type === "mousePressed",
      );

    const clicking = yield* Effect.forkChild(
      run(peer, [{ action: BROWSER_AGENT_ACTION.CLICK, tab: "page-shop", x: 40, y: 60 }], cursor),
    );
    yield* TestClock.adjust(Duration.subtract(BROWSER_CURSOR_BEAT, Duration.millis(1)));
    const heardBeforeBeat = moves.length;
    const pressedBeforeBeat = pressed();
    yield* TestClock.adjust(Duration.millis(1));
    const clicked = yield* Fiber.join(clicking);

    assert.equal(heardBeforeBeat, 1);
    assert.equal(pressedBeforeBeat, false);
    assert.deepEqual(clicked.steps, [{ action: "click", status: "done", tab: "page-shop" }]);
    assert.ok(pressed());
  }),
);
