// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { useColumnDock } from "./column-dock.js";

/**
 * column-dock.test.ts -- what floats over a column's foot reads how tall its
 * dock stands: on the Chat page, the channel's composer at its foot, and
 * never a thread's reply box open among the messages above it. jsdom lays
 * nothing out, so each box is staged where a phone lays it.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("style");
});

/** Where each staged box stands, top and bottom, in pixels. */
const STAGED = new Map<string, { top: number; bottom: number }>([
  ["chat-view", { top: 0, bottom: 800 }],
  ["chat-composer reply", { top: 300, bottom: 380 }],
  ["chat-composer foot", { top: 700, bottom: 800 }],
]);

/** The Chat rail standing alone in a narrow room, the channel it left mounted in a pane hidden beside it. */
function RailShell(): React.JSX.Element {
  const shell = useRef<HTMLDivElement>(null);
  useColumnDock(shell, false, "chat");
  return createElement(
    "div",
    { ref: shell, className: "desktop-shell" },
    createElement(
      "div",
      { className: "chat-view", "data-staged": "chat-view" },
      createElement(
        "div",
        { hidden: true },
        createElement("div", { className: "chat-composer", "data-compact": "false" }),
      ),
    ),
  );
}

/** The Chat page as the shell draws it, a thread's reply open above the channel's composer. */
function ChatShell(): React.JSX.Element {
  const shell = useRef<HTMLDivElement>(null);
  useColumnDock(shell, false, "chat");
  return createElement(
    "div",
    { ref: shell, className: "desktop-shell" },
    createElement(
      "div",
      { className: "chat-view", "data-staged": "chat-view" },
      createElement("div", {
        className: "chat-composer",
        "data-compact": "true",
        "data-staged": "chat-composer reply",
      }),
      createElement("div", {
        className: "chat-composer",
        "data-compact": "false",
        "data-staged": "chat-composer foot",
      }),
    ),
  );
}

/** Lays each staged box where a phone does, and every box not staged as one drawn nowhere. */
function stage(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const box = STAGED.get(this.dataset.staged ?? "");
    if (box === undefined) return DOMRect.fromRect({});
    return DOMRect.fromRect({ y: box.top, height: box.bottom - box.top, width: 390 });
  });
}

/** Draws `shell`, answering the dock it writes on the document's root. */
function dockOf(shell: () => React.JSX.Element): string {
  stage();
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(shell)));
  return document.documentElement.style.getPropertyValue("--column-dock");
}

test("on the Chat page the dock is the channel's composer at its foot, not a thread's reply above it", () => {
  assert.equal(dockOf(ChatShell), "100px");
});

test("on the Chat rail a channel's composer left in a hidden pane docks nothing", () => {
  assert.equal(dockOf(RailShell), "0px");
});
