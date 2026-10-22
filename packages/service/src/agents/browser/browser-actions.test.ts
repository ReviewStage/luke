import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  BROWSER_AGENT_ACTION,
  BROWSER_AGENT_LIMITS,
  BROWSER_KEPT_SCREENSHOT,
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

/** Runs the actions on a session with the peer's browser, as the tool will, with the cursor given, keeping each screenshot's transcript copy where `keep` asks. */
function run(
  peer: FakeCdpPeer,
  actions: readonly BrowserAgentAction[],
  cursor?: BrowserCursor,
  keep = false,
) {
  const { api } = fakeSandboxApi({ status: "running", sessionId: SESSION });
  const service = agentBrowserOver(api, fakeBridgePty(peer));
  const options = {
    ...(cursor === undefined ? undefined : { cursor }),
    ...(keep ? { keepScreenshots: true } : undefined),
  };
  return Effect.scoped(
    Effect.flatMap(service.connect(SESSION), (cdp) => runBrowserActions(cdp, actions, options)),
  );
}

/** Base64 that spells `bytes` bytes, as a capture of that size answers. */
const base64Of = (bytes: number) => "A".repeat(Math.ceil(bytes / 3) * 4);

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

/** The commands sent to pages and to the browser about them, without the listing a step reads along the way, and a script asked of a page by its method alone. */
function pageCommands(sent: readonly FakeCdpCommand[]) {
  return sent
    .filter((command) => command.method !== "Target.getTargets")
    .map(({ method, params, sessionId }) => {
      if (method === "Runtime.evaluate") return { method, sessionId };
      return sessionId === undefined ? { method, params } : { method, params, sessionId };
    });
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
      { method: "Emulation.setFocusEmulationEnabled", params: { enabled: true }, ...page },
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
      { method: "Runtime.evaluate", ...page },
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
        /^e99 is not on the page any more; take a new snapshot.*\(the browser said: No node with given id found\)$/u,
      );
    }),
);

it.effect("a ref whose middle another element covers fails before it is clicked", () =>
  Effect.gen(function* () {
    const { peer, sent } = yield* browser(
      (command) => {
        if (command.method === "DOM.getContentQuads") {
          return { result: { quads: [[100, 200, 140, 200, 140, 220, 100, 220]] } };
        }
        if (command.method === "DOM.resolveNode") {
          return {
            result: { object: { objectId: `node-${String(command.params.backendNodeId)}` } },
          };
        }
        if (command.method === "Runtime.callFunctionOn") {
          // A cookie banner lies over e42; e5 is clear.
          return {
            result: { result: { value: command.params.objectId === "node-42" ? "div" : "" } },
          };
        }
        return undefined;
      },
      [{ targetId: "page-shop", url: "https://shop.example/", title: "Shop" }],
    );

    const covered = yield* run(peer, [
      { action: BROWSER_AGENT_ACTION.CLICK, tab: "page-shop", ref: "e42" },
    ]);
    const pressedBefore = sent.filter((command) => command.params.type === "mousePressed").length;
    const clear = yield* run(peer, [
      { action: BROWSER_AGENT_ACTION.CLICK, tab: "page-shop", ref: "e5" },
    ]);

    assert.match(failureOf(covered.steps[0]) ?? "", /^e42 is covered at its middle by a div/u);
    assert.equal(pressedBefore, 0);
    assert.deepEqual(clear.steps, [{ action: "click", status: "done", tab: "page-shop" }]);
    assert.ok(sent.some((command) => command.params.type === "mousePressed"));
  }),
);

it.effect("typing where nothing that takes text has the focus fails, and sends no text", () =>
  Effect.gen(function* () {
    const { peer, sent } = yield* browser(
      (command) => {
        if (command.method !== "Runtime.evaluate") return undefined;
        // The page's body has the focus, so only the check that asks whether it takes text answers no.
        const asksTakesText = String(command.params.expression).includes("isContentEditable");
        return { result: { result: { value: asksTakesText ? false : null } } };
      },
      [{ targetId: "page-shop", url: "https://shop.example/", title: "Shop" }],
    );

    const nowhere = yield* run(peer, [
      { action: BROWSER_AGENT_ACTION.TYPE, tab: "page-shop", text: "hello" },
    ]);
    const button = yield* run(peer, [
      { action: BROWSER_AGENT_ACTION.TYPE, tab: "page-shop", ref: "e42", text: "hello" },
    ]);

    assert.match(failureOf(nowhere.steps[0]) ?? "", /^nothing that takes text has the focus/u);
    assert.equal(failureOf(button.steps[0]), "e42 does not take text; name a text field's ref");
    assert.ok(!sent.some((command) => command.method === "Input.insertText"));
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

it.effect(
  "a screenshot kept for the transcript is the page at its own pixels, the smaller of a good JPEG and a PNG, beside the model's bounded copy",
  () =>
    Effect.gen(function* () {
      const kept = base64Of(600_000);
      const captures: unknown[] = [];
      const { peer } = yield* browser((command) => {
        if (command.method === "Page.getLayoutMetrics") {
          return {
            result: {
              cssLayoutViewport: { clientWidth: 1600, clientHeight: 1000 },
              cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 1600, clientHeight: 1000 },
            },
          };
        }
        if (command.method === "Runtime.evaluate") return { result: { result: { value: 2 } } };
        if (command.method !== "Page.captureScreenshot") return undefined;
        const { format, quality, clip } = command.params;
        captures.push({ format, quality, clip });
        if (format === "png") return { result: { data: base64Of(900_000) } };
        return { result: { data: quality === 85 ? kept : "/9j/AAAA" } };
      });

      const ran = yield* run(
        peer,
        [{ action: BROWSER_AGENT_ACTION.SCREENSHOT, tab: "page-blank" }],
        undefined,
        true,
      );

      assert.deepEqual(ran.steps, [
        {
          action: "screenshot",
          status: "done",
          tab: "page-blank",
          image: { mime: "image/jpeg", data: "/9j/AAAA", width: 1280, height: 800 },
          kept: { mime: "image/jpeg", data: kept, width: 2560, height: 1600 },
        },
      ]);
      const full = { x: 0, y: 0, width: 1600, height: 1000, scale: 0.8 };
      assert.deepEqual(captures, [
        { format: "jpeg", quality: 70, clip: { ...full, scale: 0.4 } },
        { format: "png", quality: undefined, clip: full },
        { format: "jpeg", quality: 85, clip: full },
      ]);
    }),
);

it.effect("a kept copy is a PNG where the PNG is the smaller", () =>
  Effect.gen(function* () {
    const png = base64Of(200_000);
    const { peer } = yield* browser((command) => {
      if (command.method === "Runtime.evaluate") return { result: { result: { value: 1 } } };
      if (command.method !== "Page.captureScreenshot") return undefined;
      if (command.params.format === "png") return { result: { data: png } };
      return { result: { data: command.params.quality === 85 ? base64Of(400_000) : "/9j/AAAA" } };
    });

    const ran = yield* run(
      peer,
      [{ action: BROWSER_AGENT_ACTION.SCREENSHOT, tab: "page-blank" }],
      undefined,
      true,
    );

    const [step] = ran.steps;
    assert.ok(step?.action === "screenshot" && step.status === "done");
    assert.deepEqual(step.kept, { mime: "image/png", data: png, width: 1280, height: 800 });
  }),
);

it.effect(
  "a kept copy holds to its cap, trying lower qualities, and is left out where nothing fits while the model's copy stands",
  () =>
    Effect.gen(function* () {
      const over = base64Of(BROWSER_KEPT_SCREENSHOT.MAX_BYTES + 3);
      const fits = base64Of(BROWSER_KEPT_SCREENSHOT.MAX_BYTES);
      let fitAt = 50;
      let shown = false;
      const kept: unknown[] = [];
      const { peer } = yield* browser((command) => {
        if (command.method === "Runtime.evaluate") return { result: { result: { value: 1 } } };
        if (command.method !== "Page.captureScreenshot") return undefined;
        // Note that the model's copy is asked for first, so the first JPEG is its own.
        if (command.params.format === "jpeg" && !shown) {
          shown = true;
          return { result: { data: "/9j/AAAA" } };
        }
        kept.push(command.params.quality ?? command.params.format);
        return { result: { data: command.params.quality === fitAt ? fits : over } };
      });
      const screenshot = [{ action: BROWSER_AGENT_ACTION.SCREENSHOT, tab: "page-blank" }] as const;

      const lowered = yield* run(peer, screenshot, undefined, true);
      const keptAt = kept.splice(0);
      shown = false;
      fitAt = 0;
      const unkept = yield* run(peer, screenshot, undefined, true);

      const [low] = lowered.steps;
      assert.ok(low?.action === "screenshot" && low.status === "done");
      assert.equal(low.kept?.data, fits);
      assert.deepEqual(keptAt, ["png", 85, 70, 50]);
      assert.deepEqual(unkept.steps, [
        {
          action: "screenshot",
          status: "done",
          tab: "page-blank",
          image: { mime: "image/jpeg", data: "/9j/AAAA", width: 1280, height: 800 },
        },
      ]);
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

/**
 * Moves the clock on in small steps, so a fiber still crossing the fake PTY
 * as the move begins has armed its timer before the time it waits for has
 * passed.
 */
function advance(by: Duration.Duration) {
  const step = Duration.millis(50);
  const steps = Math.ceil(Duration.toMillis(by) / Duration.toMillis(step));
  return Effect.repeat(TestClock.adjust(step), { times: steps - 1 });
}

/** A page's tree that is only its root, named as the page is. */
function pageTree(name: string) {
  return { nodes: [{ nodeId: "1", role: { value: "RootWebArea" }, name: { value: name } }] };
}

/** A frame event on the blank page's session, as Chromium sends it with the page's events on. */
function frameEvent(method: string, frameId = "main"): CdpEvent {
  return { method, params: { frameId }, sessionId: "session-page-blank" };
}

it.effect(
  "a wait after a click waits out the navigation the click started, as the old page still reads loaded",
  () =>
    Effect.gen(function* () {
      let shown = "Login";
      const { peer } = yield* browser((command) => {
        if (command.method === "Page.enable") return { result: {} };
        if (command.method === "Accessibility.getFullAXTree") return { result: pageTree(shown) };
        // The login page stays loaded until the next document commits.
        return command.method === "Runtime.evaluate"
          ? { result: { result: { value: "complete" } } }
          : undefined;
      });
      const tab = "page-blank";

      const running = yield* Effect.forkChild(
        run(peer, [
          { action: BROWSER_AGENT_ACTION.CLICK, tab, x: 40, y: 60 },
          { action: BROWSER_AGENT_ACTION.WAIT },
          { action: BROWSER_AGENT_ACTION.SNAPSHOT },
        ]),
      );
      yield* advance(Duration.millis(100));
      yield* peer.emit(frameEvent("Page.frameStartedLoading"));
      yield* advance(Duration.seconds(1));
      shown = "Secure area";
      yield* peer.emit(frameEvent("Page.frameStoppedLoading"));
      const ran = yield* Fiber.join(running);

      assert.deepEqual(
        ran.steps.map((step) => [step.action, step.status]),
        [
          ["click", "done"],
          ["wait", "done"],
          ["snapshot", "done"],
        ],
      );
      const snapshotted = ran.steps[2];
      assert.ok(snapshotted !== undefined && "text" in snapshotted);
      assert.equal(snapshotted.text, '- page "Secure area"');
    }),
);

it.effect("a wait after a click is let go by a loading iframe the page removes mid-load", () =>
  Effect.gen(function* () {
    const { peer } = yield* browser((command) => {
      if (command.method === "Page.enable") return { result: {} };
      return command.method === "Runtime.evaluate"
        ? { result: { result: { value: "complete" } } }
        : undefined;
    });
    const tab = "page-blank";

    const running = yield* Effect.forkChild(
      run(peer, [
        { action: BROWSER_AGENT_ACTION.CLICK, tab, x: 40, y: 60 },
        { action: BROWSER_AGENT_ACTION.WAIT, timeoutMs: 2_000 },
      ]),
    );
    yield* advance(Duration.millis(100));
    yield* peer.emit(frameEvent("Page.frameStartedLoading", "auth-frame"));
    yield* advance(Duration.millis(100));
    yield* peer.emit(frameEvent("Page.frameDetached", "auth-frame"));
    yield* advance(Duration.seconds(3));
    const ran = yield* Fiber.join(running);

    assert.deepEqual(ran.steps.at(-1), { action: "wait", status: "done", tab });
  }),
);

it.effect(
  "a wait after a click that navigates nowhere answers after the grace, and one after typing at once",
  () =>
    Effect.gen(function* () {
      const { peer } = yield* browser((command) => {
        if (command.method === "Page.enable") return { result: {} };
        return command.method === "Runtime.evaluate"
          ? { result: { result: { value: "complete" } } }
          : undefined;
      });
      const tab = "page-blank";

      const typed = yield* run(peer, [
        { action: BROWSER_AGENT_ACTION.TYPE, tab, text: "dean" },
        { action: BROWSER_AGENT_ACTION.WAIT },
      ]);
      const clicked = yield* Effect.forkChild(
        run(peer, [
          { action: BROWSER_AGENT_ACTION.CLICK, tab, x: 40, y: 60 },
          { action: BROWSER_AGENT_ACTION.WAIT },
        ]),
      );
      yield* advance(Duration.seconds(1));
      const still = yield* Fiber.join(clicked);

      assert.deepEqual(typed.steps.at(-1), { action: "wait", status: "done", tab });
      assert.deepEqual(still.steps.at(-1), { action: "wait", status: "done", tab });
    }),
);

it.effect(
  "a screenshot of a tab that has drawn nothing yet is asked again for a moment before it fails",
  () =>
    Effect.gen(function* () {
      let refusals = 3;
      const { peer } = yield* browser((command) => {
        if (command.method === "Runtime.evaluate") return { result: { result: { value: 1 } } };
        if (command.method !== "Page.captureScreenshot") return undefined;
        if (refusals <= 0) return { result: { data: "/9j/AAAA" } };
        refusals -= 1;
        return { error: { code: -32000, message: "Unable to capture screenshot" } };
      });
      const tab = "page-blank";

      const painting = yield* Effect.forkChild(
        run(peer, [{ action: BROWSER_AGENT_ACTION.SCREENSHOT, tab }]),
      );
      yield* advance(Duration.seconds(1));
      const painted = yield* Fiber.join(painting);
      refusals = Number.POSITIVE_INFINITY;
      const blank = yield* Effect.forkChild(
        run(peer, [{ action: BROWSER_AGENT_ACTION.SCREENSHOT, tab }]),
      );
      yield* advance(Duration.seconds(2));
      const never = yield* Fiber.join(blank);

      assert.deepEqual(painted.steps, [
        {
          action: "screenshot",
          status: "done",
          tab,
          image: { mime: "image/jpeg", data: "/9j/AAAA", width: 1280, height: 800 },
        },
      ]);
      assert.equal(
        failureOf(never.steps[0]),
        "the browser refused Page.captureScreenshot: Unable to capture screenshot",
      );
    }),
);

it.effect(
  "a page that never answers the cursor's measure, or a report that stalls, costs the input nothing past a moment",
  () =>
    Effect.gen(function* () {
      const { peer, sent } = yield* browser(
        (command) => (command.method === "Page.getLayoutMetrics" ? { silent: true } : undefined),
        [{ targetId: "page-shop", url: "https://shop.example/", title: "Shop" }],
      );
      const pressed = () =>
        sent.filter(
          (command) =>
            command.method === "Input.dispatchMouseEvent" && command.params.type === "mousePressed",
        ).length;
      const click = [
        { action: BROWSER_AGENT_ACTION.CLICK, tab: "page-shop", x: 40, y: 60 },
      ] as const;
      const reported: BrowserCursorMove[] = [];
      const hearing: BrowserCursor = {
        watched: true,
        report: (move) => Effect.sync(() => void reported.push(move)),
      };

      const unmeasured = yield* Effect.forkChild(run(peer, click, hearing));
      yield* advance(Duration.seconds(2));
      const measureless = yield* Fiber.join(unmeasured);

      const { peer: answering, sent: answered } = yield* browser(undefined, [
        { targetId: "page-shop", url: "https://shop.example/", title: "Shop" },
      ]);
      const stalled: BrowserCursor = { watched: true, report: () => Effect.never };
      const stalling = yield* Effect.forkChild(run(answering, click, stalled));
      yield* advance(Duration.seconds(2));
      const reportless = yield* Fiber.join(stalling);

      assert.deepEqual(measureless.steps, [{ action: "click", status: "done", tab: "page-shop" }]);
      assert.equal(pressed(), 1);
      assert.deepEqual(reported, []);
      assert.deepEqual(reportless.steps, [{ action: "click", status: "done", tab: "page-shop" }]);
      assert.ok(
        answered.some(
          (command) =>
            command.method === "Input.dispatchMouseEvent" && command.params.type === "mousePressed",
        ),
      );
    }),
);

/**
 * An option of a native select as a page holds it. Note that `disabled` is
 * its own attribute alone, while `:disabled` also holds under a disabled
 * optgroup, as the DOM has it.
 */
class PageOption {
  selected = false;
  constructor(
    readonly label: string,
    readonly value: string,
    readonly disabled: boolean,
    readonly inDisabledGroup: boolean,
  ) {}
  matches(selector: string): boolean {
    return selector === ":disabled" && (this.disabled || this.inDisabledGroup);
  }
}

/** How an option's disabledness is set: by its own attribute, or by a disabled optgroup around it. */
const DISABLED_BY = { ITSELF: "itself", GROUP: "group" } as const;

/**
 * A native select as a page holds one, for the function the browser is
 * asked to call on it: its options, which of them is selected, and every
 * event dispatched on it with whether it bubbles and the value it carried.
 */
class PageSelect extends EventTarget {
  readonly disabled = false;
  readonly options: PageOption[];
  /** Whether a disabled fieldset around it disables it, which its own property does not show. */
  inDisabledFieldset = false;
  readonly heard: { readonly type: string; readonly bubbles: boolean; readonly value: string }[] =
    [];

  constructor(
    options: readonly (readonly [
      label: string,
      value: string,
      disabledBy?: (typeof DISABLED_BY)[keyof typeof DISABLED_BY],
    ])[],
  ) {
    super();
    this.options = options.map(
      ([label, value, disabledBy]) =>
        new PageOption(
          label,
          value,
          disabledBy === DISABLED_BY.ITSELF,
          disabledBy === DISABLED_BY.GROUP,
        ),
    );
    for (const type of ["input", "change"]) {
      this.addEventListener(type, (event) => {
        const value = this.options.find((option) => option.selected)?.value ?? "";
        this.heard.push({ type: event.type, bubbles: event.bubbles, value });
      });
    }
  }

  matches(selector: string): boolean {
    return selector === ":disabled" && (this.disabled || this.inDisabledFieldset);
  }
}

/** The page's answer to `Runtime.callFunctionOn`: the function the browser was sent, called on the select, its value returned by value. */
function callOnSelect(select: PageSelect, params: FakeCdpCommand["params"]): FakeCdpAnswer {
  const declaration = String(params.functionDeclaration);
  const args = Array.isArray(params.arguments) ? params.arguments : [];
  // Note that the page's own class is the fake's, so the function's guard reads it as a select.
  const made: unknown = new Function("HTMLSelectElement", `return (${declaration});`)(PageSelect);
  assert.equal(typeof made, "function");
  const called = Reflect.apply(
    made as (...values: unknown[]) => unknown,
    select,
    args.map((arg: { readonly value?: unknown }) => arg.value),
  );
  return { result: { result: { type: "object", value: called } } };
}

/** A page with a dropdown at e7 and a heading at e5, as Chromium's accessibility tree has it, its popup's wrapper among it. */
const DROPDOWN_TREE = {
  nodes: [
    { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Dropdown" }, childIds: ["2"] },
    {
      nodeId: "2",
      parentId: "1",
      role: { value: "combobox" },
      name: { value: "" },
      value: { value: "Please select an option" },
      properties: [{ name: "expanded", value: { value: false } }],
      childIds: ["3"],
      backendDOMNodeId: 7,
    },
    {
      nodeId: "3",
      parentId: "2",
      role: { value: "MenuListPopup" },
      name: { value: "" },
      childIds: ["4", "5", "6"],
      backendDOMNodeId: 10,
    },
    ...[
      ["4", "Please select an option", 14],
      ["5", "Option 1", 17],
      ["6", "Option 2", 20],
    ].map(([nodeId, name, backendDOMNodeId]) => ({
      nodeId,
      parentId: "3",
      role: { value: "option" },
      name: { value: name },
      backendDOMNodeId,
    })),
  ],
};

/** A fake Chromium whose page holds the select at e7, a heading at e5, and nothing at e99. */
function dropdownBrowser(select: PageSelect) {
  return browser(
    (command) => {
      const node = command.params.backendNodeId;
      if (command.method === "Accessibility.getFullAXTree") return { result: DROPDOWN_TREE };
      if (command.method === "DOM.resolveNode" && node === 7) {
        return { result: { object: { objectId: "select-7", className: "HTMLSelectElement" } } };
      }
      if (command.method === "DOM.resolveNode" && node === 5) {
        return { result: { object: { objectId: "heading-5", className: "HTMLHeadingElement" } } };
      }
      if (command.method === "DOM.resolveNode") {
        return { error: { code: -32000, message: "No node with given id found" } };
      }
      if (command.method === "DOM.getContentQuads" && node === 7) {
        return { result: { quads: [[100, 200, 300, 200, 300, 230, 100, 230]] } };
      }
      return command.method === "Runtime.callFunctionOn" && command.params.objectId === "select-7"
        ? callOnSelect(select, command.params)
        : undefined;
    },
    [{ targetId: "page-drop", url: "https://the-internet.test/dropdown", title: "Dropdown" }],
  );
}

it.effect(
  "a snapshot lists a dropdown's options under it, and select chooses one by label or else value, firing input then change",
  () =>
    Effect.gen(function* () {
      const select = new PageSelect([
        ["Please select an option", "", DISABLED_BY.ITSELF],
        ["Option 1", "1"],
        ["Option 2", "2"],
      ]);
      const { peer, sent } = yield* dropdownBrowser(select);
      const tab = "page-drop";

      const ran = yield* run(peer, [
        { action: BROWSER_AGENT_ACTION.SNAPSHOT, tab },
        { action: BROWSER_AGENT_ACTION.SELECT, ref: "e7", option: "Option 2" },
        { action: BROWSER_AGENT_ACTION.SELECT, ref: "e7", option: "1" },
      ]);

      const [snapshotted, byLabel, byValue] = ran.steps;
      assert.ok(snapshotted !== undefined && "text" in snapshotted);
      assert.equal(
        snapshotted.text,
        [
          '- page "Dropdown"',
          '  - combobox value="Please select an option" [expanded=false, ref=e7]',
          '    - option "Please select an option" [ref=e14]',
          '    - option "Option 1" [ref=e17]',
          '    - option "Option 2" [ref=e20]',
        ].join("\n"),
      );
      assert.deepEqual(byLabel, {
        action: "select",
        status: "done",
        tab,
        label: "Option 2",
        value: "2",
      });
      assert.deepEqual(byValue, {
        action: "select",
        status: "done",
        tab,
        label: "Option 1",
        value: "1",
      });
      assert.deepEqual(select.heard, [
        { type: "input", bubbles: true, value: "2" },
        { type: "change", bubbles: true, value: "2" },
        { type: "input", bubbles: true, value: "1" },
        { type: "change", bubbles: true, value: "1" },
      ]);
      assert.deepEqual(
        select.options.map((option) => option.selected),
        [false, true, false],
      );
      const resolved = sent.find((command) => command.method === "DOM.resolveNode");
      assert.deepEqual(resolved?.params, { backendNodeId: 7 });
      assert.equal(resolved?.sessionId, "session-page-drop");
    }),
);

it.effect(
  "a select with no such option lists the labels, capped, and a ref that is no dropdown, or is gone, is refused",
  () =>
    Effect.gen(function* () {
      const select = new PageSelect([
        ["Please select an option", "", DISABLED_BY.ITSELF],
        ["Option 1", "1"],
        ["Option 2", "2"],
      ]);
      const { peer, sent } = yield* dropdownBrowser(select);
      const tab = "page-drop";

      const unmatched = yield* run(peer, [
        { action: BROWSER_AGENT_ACTION.SELECT, tab, ref: "e7", option: "Option 3" },
      ]);
      const disabled = yield* run(peer, [
        { action: BROWSER_AGENT_ACTION.SELECT, tab, ref: "e7", option: "Please select an option" },
      ]);
      const heading = yield* run(peer, [
        { action: BROWSER_AGENT_ACTION.SELECT, tab, ref: "e5", option: "Option 1" },
      ]);
      const gone = yield* run(peer, [
        { action: BROWSER_AGENT_ACTION.SELECT, tab, ref: "e99", option: "Option 1" },
      ]);
      const long = new PageSelect(
        Array.from(
          { length: 300 },
          (_, index) => [`Country number ${index}`, String(index)] as const,
        ),
      );
      const { peer: longPeer } = yield* dropdownBrowser(long);
      const many = yield* run(longPeer, [
        { action: BROWSER_AGENT_ACTION.SELECT, tab, ref: "e7", option: "Atlantis" },
      ]);

      assert.deepEqual(unmatched.steps, [
        {
          action: "select",
          status: "failed",
          tab,
          error:
            'e7 has no option labelled or valued "Option 3"; its options are ' +
            '"Please select an option", "Option 1", "Option 2"',
        },
      ]);
      assert.match(failureOf(disabled.steps[0]) ?? "", /is disabled$/u);
      assert.match(failureOf(heading.steps[0]) ?? "", /^e5 is not a dropdown \(a native select\)/u);
      assert.match(failureOf(gone.steps[0]) ?? "", /^e99 is not on the page any more/u);
      const listed = failureOf(many.steps[0]) ?? "";
      assert.equal(listed.length, BROWSER_AGENT_LIMITS.ERROR_MAX_CHARS);
      assert.ok(
        listed.startsWith(
          'e7 has no option labelled or valued "Atlantis"; its options are "Country number 0"',
        ),
      );
      assert.ok(listed.endsWith("…"));
      assert.deepEqual(select.heard, []);
      assert.ok(
        !sent.some(
          (command) =>
            command.method === "Runtime.callFunctionOn" && command.params.objectId !== "select-7",
        ),
      );
    }),
);

it.effect("a select moves the cursor to the dropdown's middle as a click, before the choice", () =>
  Effect.gen(function* () {
    const select = new PageSelect([
      ["Option 1", "1"],
      ["Option 2", "2"],
    ]);
    const { peer, sent } = yield* dropdownBrowser(select);
    const { cursor, moves } = cursorInto(sent, false);
    const tab = "page-drop";

    const ran = yield* run(
      peer,
      [{ action: BROWSER_AGENT_ACTION.SELECT, tab, ref: "e7", option: "Option 2" }],
      cursor,
    );

    assert.equal(ran.steps[0]?.status, BROWSER_STEP_STATUS.DONE);
    assert.deepEqual(
      moves.map(({ at: _at, ...move }) => move),
      [{ tab, x: 200, y: 215, kind: "click", viewport: { width: 1280, height: 800 } }],
    );
    const order = sent
      .map((command) => command.method)
      .filter((method) => method === "cursor" || method === "Runtime.callFunctionOn");
    assert.deepEqual(order, ["cursor", "Runtime.callFunctionOn"]);
  }),
);

it.effect(
  "a select refuses an option a disabled optgroup holds, or a select a disabled fieldset holds, and reports what a handler left selected",
  () =>
    Effect.gen(function* () {
      const grouped = new PageSelect([
        ["Basic", "basic"],
        ["Old", "old", DISABLED_BY.GROUP],
      ]);
      const fenced = new PageSelect([["Basic", "basic"]]);
      fenced.inDisabledFieldset = true;
      const reset = new PageSelect([
        ["Basic", "basic"],
        ["Premium", "premium"],
      ]);
      // The page's own handler takes Premium back, as a page with none left would.
      reset.addEventListener("change", () => {
        for (const option of reset.options) option.selected = option.value === "basic";
      });
      const tab = "page-drop";
      const choose = (select: PageSelect, option: string) =>
        Effect.flatMap(dropdownBrowser(select), ({ peer }) =>
          run(peer, [{ action: BROWSER_AGENT_ACTION.SELECT, tab, ref: "e7", option }]),
        );

      const old = yield* choose(grouped, "Old");
      const fenceless = yield* choose(fenced, "Basic");
      const premium = yield* choose(reset, "Premium");

      assert.match(failureOf(old.steps[0]) ?? "", /is disabled$/u);
      assert.match(failureOf(fenceless.steps[0]) ?? "", /is disabled$/u);
      assert.deepEqual(grouped.heard, []);
      assert.deepEqual(fenced.heard, []);
      assert.deepEqual(premium.steps, [
        { action: "select", status: "done", tab, label: "Basic", value: "basic" },
      ]);
    }),
);
