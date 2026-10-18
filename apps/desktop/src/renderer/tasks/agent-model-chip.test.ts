// @vitest-environment jsdom

import assert from "node:assert/strict";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@luke/features/models-wire";
import { relayout } from "@luke/panel/testing/resize-observer";
import { installScrollIntoView } from "@luke/panel/testing/scroll-into-view";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { AgentModelChip } from "./agent-model-chip";

/**
 * agent-model-chip.test.ts -- the chip's model menu stands still while it is
 * open: turning Fast on widens the chip leftward from its fixed trailing
 * edge, and the menu hung from that edge neither jumps on the frame the
 * chip widens nor once the resize is measured.
 */

const MODELS: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
  {
    id: "anthropic/claude-opus-5.5-fast",
    name: "Claude Opus 5.5 (Fast)",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
];

/** The chip's trailing edge on the composer's foot, which the controls after it hold still. */
const CHIP_RIGHT = 900;

/** The chip's width as its words draw it: wider once it says Fast. */
const CHIP_WIDTH = { STANDARD: 120, FAST: 160 } as const;

const MENU_HEIGHT = 300;

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function box(left: number, top: number, width: number, height: number): DOMRect {
  return DOMRect.fromRect({ x: left, y: top, width, height });
}

/**
 * Lays the composer's foot out as the window would, since jsdom lays out
 * nothing: the chip's box stands at a fixed trailing edge, as wide as its
 * words, and its menu's layer is as tall as a menu; the room is the window.
 */
function stageLayout(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("agent-model-chip")) {
      const fast = this.querySelector(".model-label")?.textContent?.includes("Fast") ?? false;
      const width = fast ? CHIP_WIDTH.FAST : CHIP_WIDTH.STANDARD;
      return box(CHIP_RIGHT - width, 700, width, 24);
    }
    if (this.classList.contains("luke-anchored-popover")) return box(0, 0, 340, MENU_HEIGHT);
    return box(0, 0, 0, 0);
  });
}

/** The chip over a choice it changes at once, as `use-agent-model.ts` draws a pick before the service answers. */
function Owned(): React.JSX.Element {
  const [choice, setChoice] = useState<ModelChoice>({
    model: "anthropic/claude-opus-5.5",
    effort: "high",
  });
  return createElement(AgentModelChip, {
    model: { choice, note: undefined, choose: setChoice },
    models: MODELS,
    readModels: () => undefined,
    usage: undefined,
  });
}

/** Where the open menu's left edge is drawn in the window: its layer's inset from whichever chip edge it is held by. */
function menuLeft(view: HTMLElement): number {
  const anchor = view.querySelector(".agent-model-chip");
  const layer = view.querySelector<HTMLElement>(".luke-anchored-popover");
  assert.ok(anchor !== null && layer !== null, "the menu is open over the chip");
  const chip = anchor.getBoundingClientRect();
  const width = Number.parseFloat(layer.style.width);
  if (layer.style.left !== "") return chip.left + Number.parseFloat(layer.style.left);
  assert.notEqual(layer.style.right, "", "the layer is placed by one of the chip's edges");
  return chip.right - Number.parseFloat(layer.style.right) - width;
}

test("turning Fast on in the chip's menu leaves the menu where it stood", () => {
  stageLayout();
  const view = document.createElement("div");
  document.body.append(view);
  const root = createRoot(view);
  roots.push(root);
  act(() => root.render(createElement(Owned)));

  const chip = view.querySelector<HTMLButtonElement>(".agent-model-chip button");
  assert.ok(chip);
  act(() => chip.click());
  const opened = menuLeft(view);
  assert.equal(opened, CHIP_RIGHT - 340, "the menu opens from the chip's trailing edge");

  const fast = view.querySelector<HTMLButtonElement>('[role="switch"]');
  assert.ok(fast, "the menu offers Fast");
  act(() => fast.click());
  assert.equal(fast.getAttribute("aria-checked"), "true", "Fast is on");
  assert.match(chip.textContent ?? "", /Fast/, "the chip says Fast, and is wider for it");
  assert.equal(menuLeft(view), opened, "the frame the chip widens on draws the menu in place");

  act(() => relayout());
  assert.equal(menuLeft(view), opened, "the measured resize keeps the menu in place");

  act(() => fast.click());
  act(() => relayout());
  assert.equal(menuLeft(view), opened, "turning Fast off again keeps it in place");
});
