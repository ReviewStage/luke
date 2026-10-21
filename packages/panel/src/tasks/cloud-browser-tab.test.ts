// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AgentBrowserTab } from "@luke/features/agent-browser-tab-wire";
import { BROWSER_LIVE_CLIENT, BROWSER_LIVE_SERVER } from "@luke/features/browser-live-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { WireBoundaryInput } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { fakeActPortAnswering, type SentPortAct } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import type { BrowserLiveListener } from "./cloud-browser-live.js";
import { CloudBrowserPane } from "./cloud-browser-pane.js";
import { useCloudBrowserTabs } from "./cloud-browser-tabs.js";
import {
  type OpenTask,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  type SidePanelControl,
  useSidePanel,
} from "./use-side-panel.js";

/**
 * The side panel's cloud Browser tabs: the task's tabs as the service lists
 * them, read only while the Browser tab experiment is on; each drawn in the
 * strip, kept chosen while the list is on its way, and closed in this window
 * alone; and one tab's pane, which waits quietly for the page, draws it once
 * a frame arrives, and takes the tab over and hands it back. A synthetic
 * task and tab throughout, the live view over a fake door.
 */

const TASK = "2e4a6c8e-0b1d-4f3a-8c5e-7a9b1c3d5e7f";
const TAB = "5a0e1f2b-3c4d-4e5f-9a6b-7c8d9e0f1a2b";
const OTHER_TAB = "6b1f2a3c-4d5e-4f6a-8b7c-9d0e1f2a3b4c";

const LISTED: AgentBrowserTab = {
  id: TAB,
  agentId: null,
  address: "https://example.com/sign-in",
  title: "Sign in",
  openedBy: { kind: "agent" },
  driver: null,
  createdAt: 1_000,
  lastActedAt: 2_000,
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

/** Lets the window's reads, and the redraws they cause, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** Draws an element under a fresh atom registry, as the window's root does. */
function draw(element: React.ReactElement): { rerender: (next: React.ReactElement) => void } {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  act(() => root.render(onRegistry(registry, element)));
  return { rerender: (next) => act(() => root.render(onRegistry(registry, next))) };
}

/** A task that has used every fixed tab. */
const USED: OpenTask = {
  id: TASK,
  holds: Object.fromEntries(SIDE_PANEL_TABS.map((tab) => [tab, true])),
};

/** A follow the test pushes changes through, as the host's stream tells them, and which it sees closed. */
function pushedFollow<View>(): {
  stream: AsyncIteratorObject<View, undefined, unknown>;
  push: (view: View) => void;
  closed: () => boolean;
} {
  const waiting: ((result: IteratorResult<View, undefined>) => void)[] = [];
  const queued: View[] = [];
  let ended = false;
  const close = () => {
    ended = true;
    for (const resolve of waiting.splice(0)) resolve({ done: true, value: undefined });
  };
  const stream: AsyncIteratorObject<View, undefined, unknown> = {
    next: () => {
      const view = queued.shift();
      if (view !== undefined) return Promise.resolve({ done: false, value: view });
      if (ended) return Promise.resolve({ done: true, value: undefined });
      return new Promise((resolve) => waiting.push(resolve));
    },
    return: async () => {
      close();
      return { done: true, value: undefined };
    },
    [Symbol.asyncIterator]: () => stream,
    [Symbol.asyncDispose]: async () => close(),
  };
  return {
    stream,
    push: (view) => {
      const resolve = waiting.shift();
      if (resolve === undefined) queued.push(view);
      else resolve({ done: false, value: view });
    },
    closed: () => ended,
  };
}

test("the task's cloud Browser tabs are read once and then followed live, the agent's pointer moving with them, let go as no reader stands, and not read at all while the experiment is off", async () => {
  const asked: SentPortAct[] = [];
  const follow = pushedFollow<{ tabs: readonly AgentBrowserTab[] } | { failure: string }>();
  fakeActPortAnswering((request) => {
    asked.push(request);
    if (request.kind === ACT_KIND.TASKS_BROWSER_TABS_FOLLOW) {
      // SAFETY: the window reads oRPC's stream as an async iterator alone, which this is.
      return Promise.resolve(follow.stream as unknown as WireBoundaryInput);
    }
    return Promise.resolve({ tabs: [LISTED] });
  });
  let read: readonly AgentBrowserTab[] | undefined;
  function Probe({ listing }: { listing: boolean }) {
    read = useCloudBrowserTabs(TASK, listing);
    return null;
  }

  const panel = draw(createElement(Probe, { listing: false }));
  await settle();
  assert.deepEqual(read, []);
  assert.deepEqual([...asked], []);

  panel.rerender(createElement(Probe, { listing: true }));
  await settle();
  assert.deepEqual(read, [LISTED]);
  assert.deepEqual(
    [...asked],
    [
      { kind: ACT_KIND.TASKS_BROWSER_TABS, payload: { taskId: TASK } },
      { kind: ACT_KIND.TASKS_BROWSER_TABS_FOLLOW, payload: { taskId: TASK } },
    ],
  );

  const pointed: AgentBrowserTab = {
    ...LISTED,
    lastActedAt: 3_000,
    cursor: { x: 640, y: 400, kind: "click", viewport: { width: 1280, height: 800 }, at: 3_000 },
  };
  await act(async () => follow.push({ tabs: [pointed] }));
  await settle();
  assert.deepEqual(read, [pointed], "a move the follow tells is drawn without another read");
  await act(async () => follow.push({ failure: "unanswered" }));
  await settle();
  assert.deepEqual(read, [pointed], "a change the host could not read keeps the list");
  assert.equal(
    asked.filter((each) => each.kind === ACT_KIND.TASKS_BROWSER_TABS).length,
    1,
    "the tabs are never read again on a beat",
  );

  panel.rerender(createElement(Probe, { listing: false }));
  await settle();
  assert.ok(follow.closed(), "the follow is let go once no reader stands");
});

test("a listed cloud Browser tab stands in the strip, stays chosen while the list is on its way, and closes in this window alone", () => {
  let control: SidePanelControl | undefined;
  function Probe({ listed }: { listed: readonly string[] | undefined }) {
    control = useSidePanel(undefined, USED, [], [], [], [], [], undefined, listed);
    return null;
  }
  const current = () => {
    assert.ok(control);
    return control;
  };
  const panel = draw(createElement(Probe, { listed: [TAB, OTHER_TAB] }));
  assert.deepEqual(
    current().strip.filter((tab) => tab instanceof Object && "cloudBrowser" in tab),
    [{ cloudBrowser: TAB }, { cloudBrowser: OTHER_TAB }],
  );

  act(() => current().onChoose({ cloudBrowser: TAB }));
  panel.rerender(createElement(Probe, { listed: undefined }));
  assert.deepEqual(current().tab, { cloudBrowser: TAB }, "kept while the list is read again");

  panel.rerender(createElement(Probe, { listed: [TAB, OTHER_TAB] }));
  act(() => current().onClose({ cloudBrowser: TAB }));
  assert.deepEqual(
    current().strip.filter((tab) => tab instanceof Object && "cloudBrowser" in tab),
    [{ cloudBrowser: OTHER_TAB }],
  );
  assert.notDeepEqual(current().tab, { cloudBrowser: TAB });

  act(() => current().onChoose({ cloudBrowser: OTHER_TAB }));
  panel.rerender(createElement(Probe, { listed: [] }));
  assert.equal(current().tab, SIDE_PANEL_TAB.PLAN, "a tab the service no longer lists gives way");
});

test("a cloud Browser tab's pane waits quietly for the page, draws it once a frame arrives, and takes the tab over and hands it back", async () => {
  const sent: unknown[] = [];
  let listener: BrowserLiveListener | undefined;
  fakeAppPlatform({
    openBrowserLive: (target, heard) => {
      assert.deepEqual(target, { taskId: TASK, tabId: TAB });
      listener = heard;
      return { send: (text) => sent.push(JSON.parse(text)), close: () => undefined };
    },
  });
  const say = async (message: object) => {
    await act(async () => listener?.message(JSON.stringify(message)));
    await settle();
  };
  const press = async (name: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (each) => each.textContent === name,
    );
    assert.ok(button, `a ${name} button`);
    await act(async () => button.click());
  };
  const status = () => document.querySelector('[role="status"]')?.textContent;

  draw(
    createElement(CloudBrowserPane, {
      taskId: TASK,
      tab: LISTED,
      owner: "Luke",
      shown: true,
      memberName: () => undefined,
    }),
  );
  await settle();
  assert.ok(listener, "the pane opened its view");
  assert.equal(status(), "Waiting for the page");
  assert.ok(
    document.querySelector("section.ph-no-capture"),
    "the pane is left out of the recording",
  );

  await say({
    type: BROWSER_LIVE_SERVER.FRAME,
    data: "/9j/AA==",
    pageWidth: 1280,
    pageHeight: 800,
  });
  assert.equal(status(), undefined);

  await press("Take over");
  await say({
    type: BROWSER_LIVE_SERVER.DRIVER,
    driver: { userId: "user-dean", heldUntil: 60_000 },
    yours: true,
  });
  assert.ok(document.body.textContent?.includes("You're driving"));
  await press("Hand back");

  assert.deepEqual(
    sent.filter(
      (message) =>
        message instanceof Object &&
        "type" in message &&
        message.type !== BROWSER_LIVE_CLIENT.VIEWPORT,
    ),
    [{ type: BROWSER_LIVE_CLIENT.TAKE_OVER }, { type: BROWSER_LIVE_CLIENT.HAND_BACK }],
  );
});

test("while the member drives, a paste reaches the page as text, Control-V and ⌘V leave the paste to the window, and the wheel scrolls the page alone", async () => {
  const sent: { type: string }[] = [];
  let listener: BrowserLiveListener | undefined;
  fakeAppPlatform({
    openBrowserLive: (_target, heard) => {
      listener = heard;
      return { send: (text) => sent.push(JSON.parse(text)), close: () => undefined };
    },
  });
  draw(
    createElement(CloudBrowserPane, {
      taskId: TASK,
      tab: LISTED,
      owner: "Luke",
      shown: true,
      memberName: () => undefined,
    }),
  );
  await settle();
  const canvas = document.querySelector("canvas");
  assert.ok(canvas);
  const wheel = () => {
    const event = new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(wheel(), false, "watching, the wheel is the panel's");

  await act(async () =>
    listener?.message(
      JSON.stringify({
        type: BROWSER_LIVE_SERVER.DRIVER,
        driver: { userId: "user-dean", heldUntil: 60_000 },
        yours: true,
      }),
    ),
  );
  await settle();
  const keyDown = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    act(() => {
      canvas.dispatchEvent(event);
    });
    return event.defaultPrevented;
  };
  assert.equal(keyDown({ key: "v", code: "KeyV", ctrlKey: true }), false);
  assert.equal(keyDown({ key: "v", code: "KeyV", metaKey: true }), false);
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.assign(paste, { clipboardData: { getData: () => "hello" } });
  act(() => {
    canvas.dispatchEvent(paste);
  });
  assert.equal(wheel(), true, "driving, the wheel is the page's alone");

  assert.deepEqual(
    sent.filter(
      (message) =>
        message.type === BROWSER_LIVE_CLIENT.KEY || message.type === BROWSER_LIVE_CLIENT.TEXT,
    ),
    [{ type: BROWSER_LIVE_CLIENT.TEXT, text: "hello" }],
  );
});
