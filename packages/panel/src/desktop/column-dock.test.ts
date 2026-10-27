// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { useColumnDock } from "./column-dock.js";

/**
 * column-dock.test.ts -- what floats over a column's foot reads how tall its
 * dock stands. A part landing after
 * the column stands, a to-do list over an agent's composer, raises the dock
 * at the frame after it lands. jsdom lays nothing out, so each box is staged
 * where the window lays it, and each frame is the test's.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("style");
});

/** A box as the window lays it, in pixels. */
interface Staged {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Lays each element out where `boxes` stages it by its `data-staged` name, and nowhere else. */
function stage(boxes: ReadonlyMap<string, Staged>): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const box = boxes.get(this.dataset.staged ?? "");
    if (box === undefined) return DOMRect.fromRect({});
    return DOMRect.fromRect({
      x: box.left,
      y: box.top,
      width: box.right - box.left,
      height: box.bottom - box.top,
    });
  });
}

/** An agent's page in a narrow room, its composer at its foot and, where it stands, the to-do list over it. */
function AgentShell({ todos }: { todos: boolean }): React.JSX.Element {
  const shell = useRef<HTMLDivElement>(null);
  useColumnDock(shell, false, true, "agent");
  return createElement(
    "div",
    { ref: shell, className: "desktop-shell" },
    createElement(
      "div",
      { className: "agent-page", "data-staged": "page" },
      todos
        ? createElement("div", { className: "agent-todos-dock", "data-staged": "todos" })
        : null,
      createElement("div", { className: "agent-composer", "data-staged": "composer" }),
    ),
  );
}

test("a to-do list landing over an agent's composer raises the dock at the frame after it lands", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((heard) => frames.push(heard));
  stage(
    new Map([
      ["page", { left: 0, right: 1000, top: 0, bottom: 800 }],
      ["todos", { left: 0, right: 1000, top: 600, bottom: 700 }],
      ["composer", { left: 0, right: 1000, top: 700, bottom: 800 }],
    ]),
  );
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(AgentShell, { todos: false })));
  const dock = () => document.documentElement.style.getPropertyValue("--luke-column-dock");
  assert.equal(dock(), "100px", "the composer alone docks");

  await act(async () => root?.render(createElement(AgentShell, { todos: true })));
  act(() => {
    for (const heard of frames.splice(0)) heard(0);
  });

  assert.equal(dock(), "200px", "the to-do list over it docks with it");
});

/** A phone's side panel filling the window, a panel on its way out still standing before it, inert, its agent's video and composer at its foot. */
function LeavingPanelShell(): React.JSX.Element {
  const shell = useRef<HTMLDivElement>(null);
  useColumnDock(shell, true, true, "panel");
  return createElement(
    "div",
    { ref: shell, className: "desktop-shell" },
    createElement(
      "aside",
      { className: "side-panel", inert: true, "data-staged": "leaving" },
      createElement("div", { className: "agent-call-foot", "data-staged": "video" }),
      createElement("div", { className: "agent-composer", "data-staged": "composer" }),
    ),
    createElement("aside", { className: "side-panel", "data-staged": "shown" }),
  );
}

test("a side panel on its way out lifts nothing over the panel shown, whatever docks at its foot", () => {
  stage(
    new Map([
      ["leaving", { left: 0, right: 400, top: 0, bottom: 800 }],
      ["video", { left: 0, right: 400, top: 300, bottom: 680 }],
      ["composer", { left: 0, right: 400, top: 680, bottom: 800 }],
      ["shown", { left: 0, right: 400, top: 0, bottom: 800 }],
    ]),
  );
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(LeavingPanelShell)));
  assert.equal(document.documentElement.style.getPropertyValue("--luke-column-dock"), "0px");
});

/** What the card's tile draws in its video's place: nothing, its still saying the video ended, or its wait, gone from over the first frame but still laid out. */
const STILL = { NONE: "none", ENDED: "ended", GONE: "gone" } as const;

type Still = (typeof STILL)[keyof typeof STILL];

/** Where the window lays out a phone's call card, its video tile, and the lines of the tile's still, which a rise or a lift moves only on screen, by `data-staged` name. */
const LAID_OUT: ReadonlyMap<
  string,
  { top: number; height: number; width: number; client: number }
> = new Map([
  ["card", { top: 175, height: 225, width: 248, client: 225 }],
  ["tile", { top: 0, height: 125, width: 222, client: 123 }],
  ["face", { top: 8, height: 40, width: 40, client: 40 }],
  ["restart", { top: 80, height: 30, width: 30, client: 30 }],
]);

/** A phone's side panel filling the window, a pull request's tab bar in it, a Chapters view's own head under it where one is staged, and the call card floating over it with its video up (`STILL`). */
function PhoneCardShell({ still }: { still: Still }): React.JSX.Element {
  const shell = useRef<HTMLDivElement>(null);
  const words = createElement(
    "div",
    { className: "luke-call-video-still", style: { padding: "8px" } },
    createElement("span", { "data-staged": "face" }),
    createElement("span", { "data-staged": "restart" }),
  );
  useColumnDock(shell, true, true, "panel");
  return createElement(
    "div",
    { ref: shell, className: "desktop-shell" },
    createElement(
      "aside",
      { className: "side-panel", "data-staged": "panel" },
      createElement("header", { className: "luke-pane-bar", "data-staged": "tabs" }),
      createElement("header", { className: "luke-pane-bar", "data-staged": "chapter" }),
    ),
    createElement(
      "section",
      { className: "call-card", "data-surface": "floating", "data-staged": "card" },
      createElement(
        "div",
        { className: "luke-call-video-tile", "data-staged": "tile" },
        still === STILL.NONE
          ? null
          : still === STILL.ENDED
            ? words
            : createElement(
                "div",
                { className: "luke-call-video-waiting", "data-gone": "true" },
                words,
              ),
      ),
    ),
  );
}

test.each([
  {
    room: "a tab bar the full card would reach over",
    tabs: [181, 222],
    still: STILL.NONE,
    height: "70px",
  },
  { room: "no room under the tab bar at all", tabs: [181, 380], still: STILL.NONE, height: "30px" },
  {
    room: "a tab bar a wrapped title pushes past the middle",
    tabs: [300, 341],
    still: STILL.NONE,
    height: "30px",
  },
  { room: "its video ended over a tab bar", tabs: [181, 222], still: STILL.ENDED, height: "120px" },
  {
    room: "its video's first frame drawn, its wait gone but laid out",
    tabs: [181, 222],
    still: STILL.GONE,
    height: "70px",
  },
  {
    room: "a Chapters head under the tab bar that it cannot clear too",
    tabs: [181, 222],
    chapter: [250, 290],
    still: STILL.NONE,
    height: "70px",
  },
])(
  "on a phone, with $room, the card's video gives up what it must, down to a control's height or what its words need",
  ({ tabs, chapter, still, height }) => {
    const bar = ([top = 0, bottom = 0]: readonly number[]) => ({
      left: 0,
      right: 608,
      top,
      bottom,
    });
    stage(
      new Map([
        ["panel", { left: 0, right: 608, top: 49, bottom: 416 }],
        ["tabs", bar(tabs)],
        ...(chapter === undefined ? [] : [["chapter", bar(chapter)] as const]),
        ["card", { left: 16, right: 264, top: 175, bottom: 400 }],
      ]),
    );
    for (const [side, read] of [
      ["offsetTop", "top"],
      ["offsetHeight", "height"],
      ["offsetWidth", "width"],
      ["clientHeight", "client"],
    ] as const)
      vi.spyOn(HTMLElement.prototype, side, "get").mockImplementation(function (this: HTMLElement) {
        return LAID_OUT.get(this.dataset.staged ?? "")?.[read] ?? 0;
      });
    const tokens = document.documentElement.style;
    tokens.setProperty("--luke-space-8", "8px");
    tokens.setProperty("--luke-space-16", "16px");
    tokens.setProperty("--luke-control-height", "30px");
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root?.render(createElement(PhoneCardShell, { still })));
    const card = document.querySelector<HTMLElement>(".call-card");
    assert.equal(card?.style.getPropertyValue("--luke-call-video-height"), height);
  },
);
