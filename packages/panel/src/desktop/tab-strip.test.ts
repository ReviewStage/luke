// @vitest-environment jsdom

import assert from "node:assert/strict";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { appCommandOffered, runAppCommand } from "../app-commands.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { MenuTab, TabStrip } from "./tab-strip.js";

const ignore = () => undefined;

const roots: Root[] = [];

afterEach(() => {
  moves = [];
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pointerMedia(finger: boolean) {
  return (query: string) => ({
    matches: finger && query === "(pointer: coarse)",
    addEventListener: ignore,
    removeEventListener: ignore,
  });
}

let moves: [number, number][] = [];

function pill(container: HTMLElement, label: string): HTMLElement {
  const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (each) => each.querySelector(".ui-tab-label")?.textContent === label,
  );
  return tab?.closest<HTMLElement>(".ui-tab") ?? assert.fail(`${label}'s tab stands`);
}

function MenuStrip(): ReactNode {
  return createElement(TabStrip, {
    label: "Tabs",
    onMove: (from: number, to: number) => moves.push([from, to]),
    children: ["Plan", "Changes", "Terminal"].map((label, at) =>
      createElement(MenuTab, {
        key: label,
        icon: createElement("svg"),
        label,
        selected: at === 0,
        onSelect: ignore,
        groups: () => [[{ label: "Close", onSelect: ignore }]],
      }),
    ),
  });
}

function menuWords(): string[] {
  return [...document.querySelectorAll(".ui-menu-item-label")].map(
    (each) => each.textContent ?? "",
  );
}

function menuItem(label: string): HTMLElement {
  const name = [...document.querySelectorAll(".ui-menu-item-label")].find(
    (each) => each.textContent === label,
  );
  return name?.closest<HTMLElement>('[role="menuitem"]') ?? assert.fail(`no ${label} item`);
}

async function menuStripTab(label: string): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(onRegistry(AtomRegistry.make(), createElement(MenuStrip))));
  return pill(container, label).querySelector<HTMLElement>('[role="tab"]') ?? assert.fail("a tab");
}

const touch = (type: string) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    clientX: 10,
    clientY: 10,
  });

test("under a finger, a tab held offers Move left and Move right, and Move right moves it a place along", async () => {
  vi.stubGlobal("matchMedia", pointerMedia(true));
  const tab = await menuStripTab("Changes");
  vi.useFakeTimers();
  try {
    act(() => {
      tab.dispatchEvent(touch("pointerdown"));
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
  } finally {
    vi.useRealTimers();
  }
  act(() => {
    tab.dispatchEvent(touch("pointerup"));
  });

  assert.deepEqual(menuWords(), ["Move left", "Move right", "Close"]);
  act(() => menuItem("Move right").click());
  assert.deepEqual(moves, [[1, 2]]);
});

test("with a mouse, a tab's menu offers Move left and Move right too, each with its chord", async () => {
  const tab = await menuStripTab("Changes");

  act(() => {
    tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });

  assert.deepEqual(menuWords(), ["Move left", "Move right", "Close"]);
  assert.equal(menuItem("Move left").querySelector(".ui-menu-item-hint")?.textContent, "⇧⌘←");
  act(() => menuItem("Move right").click());
  assert.deepEqual(moves, [[1, 2]]);
});

test("a tab's menu standing open leaves the strip's row holding its tabs alone", async () => {
  const tab = await menuStripTab("Plan");
  const strip = tab.closest<HTMLElement>('[role="tablist"]') ?? assert.fail("a strip");

  act(() => {
    tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });

  assert.deepEqual(menuWords(), ["Move right", "Close"]);
  assert.deepEqual(
    [...strip.children].map((each) => each.classList.contains("ui-tab")),
    [true, true, true],
  );
});

test("a tab other than the chosen one names itself in its hint, though its label may stand as its glyph alone", async () => {
  const tab = await menuStripTab("Changes");
  restOn(tab);
  assert.equal(document.querySelector('[role="tooltip"]')?.textContent, "Changes");
});

test("Move Tab Right moves the focused tab a place along, and is offered only while a tab of the strip has the focus", async () => {
  const tab = await menuStripTab("Changes");
  assert.equal(appCommandOffered(APP_COMMAND.MOVE_TAB_RIGHT), false);
  act(() => tab.focus());
  act(() => {
    runAppCommand(APP_COMMAND.MOVE_TAB_RIGHT);
  });
  assert.deepEqual(moves, [[1, 2]]);
  assert.equal(document.activeElement, tab);
});
