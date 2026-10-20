// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { useColumnDock } from "./column-dock.js";

/**
 * column-dock.test.ts -- what floats over a column's foot reads how tall its
 * dock stands. On a phone's Chat page the dock is the channel's composer at
 * its foot, and never a thread's reply box open among the messages above it,
 * nor a composer left in a hidden pane. Beside the work, where only the
 * folded sidebar's card reads it, the composer docks only where it reaches
 * under the card, past a rail narrower than the card. jsdom lays nothing
 * out, so each box is staged where the window lays it.
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

/** Where the boxes stand; the channel's composer begins where the rail ends. */
function staged(railEnd: number): ReadonlyMap<string, Staged> {
  return new Map([
    ["chat-view", { left: 0, right: 1000, top: 0, bottom: 800 }],
    ["reply", { left: railEnd, right: 1000, top: 300, bottom: 380 }],
    ["foot", { left: railEnd, right: 1000, top: 700, bottom: 800 }],
    ["card", { left: 16, right: 264, top: 680, bottom: 784 }],
  ]);
}

/** The Chat page as the shell draws it, a thread's reply open above the channel's composer, and the folded sidebar's card over its foot. */
function ChatShell({ narrow }: { narrow: boolean }): React.JSX.Element {
  const shell = useRef<HTMLDivElement>(null);
  useColumnDock(shell, false, narrow, "chat");
  return createElement(
    "div",
    { ref: shell, className: "desktop-shell" },
    createElement(
      "div",
      { className: "chat-view", "data-staged": "chat-view" },
      createElement("div", {
        className: "chat-composer",
        "data-compact": "true",
        "data-staged": "reply",
      }),
      createElement("div", {
        className: "chat-composer",
        "data-compact": "false",
        "data-staged": "foot",
      }),
    ),
    createElement("div", {
      className: "call-card",
      "data-surface": "floating",
      "data-staged": "card",
    }),
  );
}

/** The Chat rail standing alone in a narrow room, the channel it left mounted in a pane hidden beside it. */
function RailShell({ narrow }: { narrow: boolean }): React.JSX.Element {
  const shell = useRef<HTMLDivElement>(null);
  useColumnDock(shell, false, narrow, "chat");
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

/** Draws `shell` in the room given, over a rail ending where given, answering the dock it writes on the document's root. */
function dockOf(
  shell: (props: { narrow: boolean }) => React.JSX.Element,
  narrow: boolean,
  railEnd = 212,
): string {
  const boxes = staged(railEnd);
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
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(shell, { narrow })));
  return document.documentElement.style.getPropertyValue("--column-dock");
}

test("on a phone's Chat page the dock is the channel's composer at its foot, not a thread's reply above it", () => {
  assert.equal(dockOf(ChatShell, true), "100px");
});

test("on the Chat rail a channel's composer left in a hidden pane docks nothing", () => {
  assert.equal(dockOf(RailShell, true), "0px");
});

test("beside the work, a rail narrower than the folded sidebar's card leaves the composer under it, which docks", () => {
  assert.equal(dockOf(ChatShell, false, 212), "100px");
});

test("beside the work, a rail as wide as the card holds it over its rows, and the composer beside it docks nothing", () => {
  assert.equal(dockOf(ChatShell, false, 300), "0px");
});
