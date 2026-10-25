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
 * under the card, past a rail narrower than the card. A part landing after
 * the column stands, a to-do list over an agent's composer, raises the dock
 * at the frame after it lands. A toast standing lifts itself and writes
 * nothing a page under it reads. jsdom lays nothing out, so each box is staged
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

/** Where the boxes stand; the channel's composer begins where the rail ends. */
function staged(railEnd: number): ReadonlyMap<string, Staged> {
  return new Map([
    ["chat-view", { left: 0, right: 1000, top: 0, bottom: 800 }],
    ["reply", { left: railEnd, right: 1000, top: 300, bottom: 380 }],
    ["foot", { left: railEnd, right: 1000, top: 700, bottom: 800 }],
    ["card", { left: 16, right: 264, top: 680, bottom: 784 }],
  ]);
}

/** The Chat page as the shell draws it, a thread's reply open above the channel's composer, each the shared composer card (`.agent-composer`), and the folded sidebar's card over its foot. */
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
        className: "agent-composer chat-composer",
        "data-compact": "true",
        "data-staged": "reply",
      }),
      createElement("div", {
        className: "agent-composer chat-composer",
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
        createElement("div", {
          className: "agent-composer chat-composer",
          "data-compact": "false",
        }),
      ),
    ),
  );
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

/** Draws `shell` in the room given, over a rail ending where given, answering the dock it writes on the document's root. */
function dockOf(
  shell: (props: { narrow: boolean }) => React.JSX.Element,
  narrow: boolean,
  railEnd = 212,
): string {
  stage(staged(railEnd));
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(shell, { narrow })));
  return document.documentElement.style.getPropertyValue("--luke-column-dock");
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

/** A task beside its side panel, the panel's agent composer at its foot under the toasts' corner, and the window's toasts, portalled out of the shell. */
function PanelShell(): React.JSX.Element {
  const shell = useRef<HTMLDivElement>(null);
  useColumnDock(shell, false, false, "task");
  return createElement(
    "div",
    { ref: shell, className: "desktop-shell", "data-staged": "window" },
    createElement("div", { className: "desktop-task-main", "data-staged": "main" }),
    createElement(
      "aside",
      { className: "side-panel", "data-staged": "panel" },
      createElement("div", { className: "agent-composer", "data-staged": "composer" }),
    ),
  );
}

test("beside the work, the toasts stand above an agent's composer under their corner, in the side panel rather than the column", () => {
  stage(
    new Map([
      ["window", { left: 0, right: 1200, top: 0, bottom: 800 }],
      ["main", { left: 0, right: 700, top: 0, bottom: 800 }],
      ["panel", { left: 700, right: 1200, top: 0, bottom: 800 }],
      ["composer", { left: 700, right: 1200, top: 680, bottom: 784 }],
      ["toasts", { left: 844, right: 1184, top: 734, bottom: 784 }],
    ]),
  );
  const toasts = document.body.appendChild(document.createElement("section"));
  toasts.className = "luke-toast-stack";
  toasts.dataset.staged = "toasts";
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(PanelShell)));
  assert.equal(document.documentElement.style.getPropertyValue("--luke-toast-dock"), "120px");
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

/** An Inbox thread beside the work, its draft reply flowing at the end of its scrolled board, and the window's toasts. */
function InboxShell(): React.JSX.Element {
  const shell = useRef<HTMLDivElement>(null);
  useColumnDock(shell, false, false, "inbox");
  return createElement(
    "div",
    { ref: shell, className: "desktop-shell", "data-staged": "window" },
    createElement(
      "section",
      { className: "inbox-view-items", "data-staged": "board" },
      createElement("div", { className: "agent-composer", "data-staged": "reply" }),
    ),
  );
}

/** Stands the window's toasts where the test stages them, portalled out of the shell. */
function standToasts(): void {
  const toasts = document.body.appendChild(document.createElement("section"));
  toasts.className = "luke-toast-stack";
  toasts.dataset.staged = "toasts";
}

/** The length named, as the shell last wrote it on the document's root. */
function written(length: string): string {
  return document.documentElement.style.getPropertyValue(length);
}

test("a draft reply scrolled up under the toasts raises them at the frame after the scroll", () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((heard) => frames.push(heard));
  const boxes = new Map([
    ["window", { left: 0, right: 1200, top: 0, bottom: 800 }],
    ["board", { left: 600, right: 1200, top: 0, bottom: 800 }],
    ["reply", { left: 600, right: 1200, top: 900, bottom: 1000 }],
    ["toasts", { left: 844, right: 1184, top: 734, bottom: 784 }],
  ]);
  stage(boxes);
  standToasts();
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(InboxShell)));
  assert.equal(written("--luke-toast-dock"), "0px", "the reply below the window docks nothing");

  boxes.set("reply", { left: 600, right: 1200, top: 680, bottom: 780 });
  act(() => {
    document.querySelector(".inbox-view-items")?.dispatchEvent(new Event("scroll"));
    for (const heard of frames.splice(0)) heard(0);
  });

  assert.equal(
    written("--luke-toast-dock"),
    "120px",
    "the reply scrolled up under the corner docks",
  );
});

/** Every length written on the document's root and on the shell, by name, but the one the toasts themselves stand on. */
function lengthsUnderToasts(): ReadonlyMap<string, string> {
  const shell = document.querySelector<HTMLElement>(".desktop-shell");
  const styles = [document.documentElement.style, ...(shell === null ? [] : [shell.style])];
  return new Map(
    styles.flatMap((style) =>
      [...style]
        .filter((name) => name !== "--luke-toast-dock")
        .map((name) => [name, style.getPropertyValue(name)] as const),
    ),
  );
}

test("a toast standing over an Inbox thread's end moves nothing under it, only itself above the reply", () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((heard) => frames.push(heard));
  stage(
    new Map([
      ["window", { left: 0, right: 1200, top: 0, bottom: 800 }],
      ["board", { left: 600, right: 1200, top: 0, bottom: 800 }],
      ["reply", { left: 600, right: 1200, top: 680, bottom: 784 }],
      ["toasts", { left: 844, right: 1184, top: 622, bottom: 672 }],
    ]),
  );
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(InboxShell)));
  const untoasted = lengthsUnderToasts();

  standToasts();
  act(() => {
    document.querySelector(".inbox-view-items")?.dispatchEvent(new Event("scroll"));
    for (const heard of frames.splice(0)) heard(0);
  });

  assert.equal(written("--luke-toast-dock"), "120px", "the toast stands above the reply");
  assert.deepEqual(lengthsUnderToasts(), untoasted, "the page under it reads what it read before");
});

/** A phone's Inbox list, the places bar at the screen's foot under it. */
function PhoneListShell(): React.JSX.Element {
  const shell = useRef<HTMLDivElement>(null);
  useColumnDock(shell, false, true, "inbox");
  return createElement(
    "div",
    { ref: shell, className: "desktop-shell", "data-staged": "window" },
    createElement("nav", { className: "inbox-tasks", "data-staged": "list" }),
    createElement("nav", { className: "mobile-bar", "data-staged": "bar" }),
  );
}

test("on a phone the toasts stand above the places bar", () => {
  stage(
    new Map([
      ["window", { left: 0, right: 400, top: 0, bottom: 800 }],
      ["list", { left: 0, right: 400, top: 0, bottom: 740 }],
      ["bar", { left: 0, right: 400, top: 740, bottom: 800 }],
      ["toasts", { left: 52, right: 392, top: 672, bottom: 732 }],
    ]),
  );
  standToasts();
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(PhoneListShell)));
  assert.equal(written("--luke-toast-dock"), "60px");
});
