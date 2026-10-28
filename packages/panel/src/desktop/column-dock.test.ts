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
  useColumnDock(shell, false, "agent");
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
  useColumnDock(shell, true, "panel");
  return createElement(
    "div",
    { ref: shell, className: "desktop-shell" },
    createElement(
      "aside",
      { className: "side-panel", inert: true, "data-staged": "leaving" },
      createElement("div", { className: "agent-todos-dock", "data-staged": "todos" }),
      createElement("div", { className: "agent-composer", "data-staged": "composer" }),
    ),
    createElement("aside", { className: "side-panel", "data-staged": "shown" }),
  );
}

test("a side panel on its way out lifts nothing over the panel shown, whatever docks at its foot", () => {
  stage(
    new Map([
      ["leaving", { left: 0, right: 400, top: 0, bottom: 800 }],
      ["todos", { left: 0, right: 400, top: 300, bottom: 680 }],
      ["composer", { left: 0, right: 400, top: 680, bottom: 800 }],
      ["shown", { left: 0, right: 400, top: 0, bottom: 800 }],
    ]),
  );
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(LeavingPanelShell)));
  assert.equal(document.documentElement.style.getPropertyValue("--luke-column-dock"), "0px");
});
