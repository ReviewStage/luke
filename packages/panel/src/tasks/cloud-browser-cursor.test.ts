// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AgentBrowserTab } from "@luke/features/agent-browser-tab-wire";
import { BROWSER_LIVE_SERVER } from "@luke/features/browser-live-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import type { BrowserLiveListener } from "./cloud-browser-live.js";
import { CloudBrowserPane } from "./cloud-browser-pane.js";

/**
 * The agent's pointer over a cloud Browser tab's live view: drawn at the
 * agent's point scaled onto the drawn page, out of the recording and the
 * pointer's way; hidden while a member drives the tab, faded once the agent
 * has stood idle, and held still where motion is reduced. A synthetic task
 * and tab throughout, the live view over a fake door, the clock pinned, and
 * the pane's body 640 by 600 pixels, which fits a 1280 by 800 page at half
 * its size.
 */

const TASK = "2e4a6c8e-0b1d-4f3a-8c5e-7a9b1c3d5e7f";
const TAB = "5a0e1f2b-3c4d-4e5f-9a6b-7c8d9e0f1a2b";

/** Now, by the pinned clock, in epoch milliseconds. */
const NOW = 1_800_000_000_000;

/** A tab the agent clicked on a moment ago, at (640, 300) of its 1280 by 800 page. */
const CLICKED: AgentBrowserTab = {
  id: TAB,
  agentId: null,
  address: "https://example.com/sign-in",
  title: "Sign in",
  openedBy: { kind: "agent" },
  driver: null,
  createdAt: NOW - 60_000,
  lastActedAt: NOW - 1_000,
  cursor: {
    x: 640,
    y: 300,
    kind: "click",
    viewport: { width: 1280, height: 800 },
    at: NOW - 1_000,
  },
};

const roots: Root[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Lets the window's reads, and the redraws they cause, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The pane of `tab`, its page painted at 1280 by 800, and a door to say more on its live view. */
async function paneOf(tab: AgentBrowserTab): Promise<{
  say: (message: object) => Promise<void>;
  redraw: (next: AgentBrowserTab) => Promise<void>;
}> {
  let listener: BrowserLiveListener | undefined;
  fakeAppPlatform({
    openBrowserLive: (_target, heard) => {
      listener = heard;
      return { send: () => undefined, close: () => undefined };
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const pane = (shown: AgentBrowserTab) =>
    onRegistry(
      registry,
      createElement(CloudBrowserPane, {
        taskId: TASK,
        tab: shown,
        owner: { name: "Luke", icon: createElement("span") },
        shown: true,
        memberName: () => undefined,
      }),
    );
  act(() => root.render(pane(tab)));
  await settle();
  const say = async (message: object) => {
    await act(async () => listener?.message(JSON.stringify(message)));
    await settle();
  };
  await say({
    type: BROWSER_LIVE_SERVER.FRAME,
    data: "/9j/AA==",
    pageWidth: 1280,
    pageHeight: 800,
  });
  return {
    say,
    redraw: async (next) => {
      act(() => root.render(pane(next)));
      await settle();
    },
  };
}

/** The agent's pointer as drawn, if it is. */
function pointer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".cloud-browser-cursor");
}

test("the agent's pointer stands at its point scaled onto the drawn page, out of the recording and the pointer's way, and moves with the agent", async () => {
  const { redraw } = await paneOf(CLICKED);
  const drawn = pointer();
  assert.ok(drawn, "the pointer is drawn over the page");
  assert.equal(drawn.style.getPropertyValue("--cloud-browser-cursor-x"), "320px");
  assert.equal(drawn.style.getPropertyValue("--cloud-browser-cursor-y"), "150px");
  assert.ok(drawn.hasAttribute("data-shown"), "shown while the agent is active");
  assert.equal(drawn.hasAttribute("data-flip-x") || drawn.hasAttribute("data-flip-y"), false);
  assert.ok(drawn.classList.contains("ph-no-capture"), "left out of the recording");
  assert.equal(drawn.getAttribute("aria-hidden"), "true");
  assert.equal(drawn.querySelector("canvas"), null, "never part of the frame");
  assert.ok(drawn.querySelector(".cloud-browser-cursor-ripple"), "a click ripples at its point");

  await redraw({
    ...CLICKED,
    lastActedAt: NOW,
    cursor: { x: 1280, y: 800, kind: "type", viewport: { width: 1280, height: 800 }, at: NOW },
  });
  const moved = pointer();
  assert.ok(moved);
  assert.equal(moved.style.getPropertyValue("--cloud-browser-cursor-x"), "640px");
  assert.equal(moved.style.getPropertyValue("--cloud-browser-cursor-y"), "400px");
  assert.equal(moved.dataset.kind, "type");
  assert.ok(
    moved.hasAttribute("data-flip-x") && moved.hasAttribute("data-flip-y"),
    "at the page's corner the arrow is mirrored about its tip, onto the page",
  );
  assert.equal(moved.querySelector(".cloud-browser-cursor-ripple"), null, "typing ripples nothing");
});

test("the agent's pointer hides while a member drives the tab, and fades once the agent has stood idle", async () => {
  const { say, redraw } = await paneOf(CLICKED);
  assert.ok(pointer()?.hasAttribute("data-shown"));

  await say({
    type: BROWSER_LIVE_SERVER.DRIVER,
    driver: { userId: "user-dean", heldUntil: NOW + 60_000 },
    yours: false,
  });
  assert.equal(pointer()?.hasAttribute("data-shown"), false, "hidden while a member drives");
  await say({ type: BROWSER_LIVE_SERVER.DRIVER, driver: null, yours: false });
  assert.ok(pointer()?.hasAttribute("data-shown"), "back once the tab is handed back");

  await redraw({
    ...CLICKED,
    lastActedAt: NOW - 10_000,
    cursor: { ...(CLICKED.cursor ?? assert.fail("a cursor")), at: NOW - 10_000 },
  });
  assert.equal(pointer()?.hasAttribute("data-shown"), false, "faded once the agent is idle");
});

test("where motion is reduced the agent's pointer is held still: it neither rocks, glides, nor ripples", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  await paneOf(CLICKED);
  const drawn = pointer();
  assert.ok(drawn);
  assert.ok(drawn.hasAttribute("data-shown"), "still drawn where the agent points");
  assert.ok(drawn.hasAttribute("data-still"), "held still");
  assert.equal(drawn.querySelector(".cloud-browser-cursor-ripple"), null, "no ripple");
});

test("over a dark or mid-grey page the agent's pointer is drawn in its lighter grey, and over a light one in its own", async () => {
  let shade = 0;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: () => undefined,
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4).fill(shade),
    }),
  } as unknown as CanvasRenderingContext2D);
  const { redraw } = await paneOf(CLICKED);
  assert.equal(pointer()?.dataset.ground, "dark", "a black page reads as dark");

  // A mid-grey page (#777777), whose bytes average past the middle but whose light is dark.
  shade = 0x77;
  await redraw({
    ...CLICKED,
    lastActedAt: NOW,
    cursor: { x: 200, y: 200, kind: "move", viewport: { width: 1280, height: 800 }, at: NOW },
  });
  assert.equal(pointer()?.dataset.ground, "dark", "a mid-grey page reads as dark");

  shade = 255;
  await redraw({
    ...CLICKED,
    lastActedAt: NOW,
    cursor: { x: 100, y: 100, kind: "move", viewport: { width: 1280, height: 800 }, at: NOW },
  });
  assert.equal(pointer()?.dataset.ground, undefined, "a white page reads as light");
});
