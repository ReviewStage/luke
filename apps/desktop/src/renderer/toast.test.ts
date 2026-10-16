// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { relayout } from "#testing/resize-observer";
import { TOAST_TONE, ToastHost, type ToastNotice, useToast } from "./toast";

/**
 * toast.test.ts -- the window's toasts against the window they stand in: a
 * window too short for three stands two, setting the oldest aside until
 * there is room again, and the stack stands clear of a call bar docked at
 * the window's foot under it. jsdom lays nothing out, so the window's height
 * and the boxes the stack and the bar stand in are given. Synthetic
 * throughout.
 */

/** The window's own stylesheet, which says where the stack stands. */
const DESKTOP_CSS = readFileSync(path.join(import.meta.dirname, "styles/desktop.css"), "utf8");

/** The window's heights: its least, and one with room for three toasts. */
const WINDOW = {
  SHORT: 520,
  TALL: 800,
} as const;

let root: Root | undefined;
let registry: AtomRegistry.AtomRegistry | undefined;
let show: ((notice: ToastNotice) => void) | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  registry?.dispose();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

/** Hands the test the window's way of showing a toast. */
function Shower(): null {
  show = useToast();
  return null;
}

/** The toasts, mounted as the window's root mounts them, in a window `height` tall. */
function mount(height: number): void {
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(height);
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  registry = AtomRegistry.make();
  const held = registry;
  act(() =>
    root?.render(
      onRegistry(
        held,
        createElement(Fragment, null, createElement(Shower), createElement(ToastHost)),
      ),
    ),
  );
}

/** A toast that stands until it is dismissed, as an agent's end does. */
function persisting(words: string): ToastNotice {
  return {
    words,
    tone: TOAST_TONE.DONE,
    action: { label: "View", onPress: () => undefined },
    persists: true,
  };
}

/** What each toast standing says, oldest first, leaving out those on their way out. */
function standing(): string[] {
  return [...document.querySelectorAll(".toast:not([data-leaving]) .toast-words")].map(
    (words) => words.textContent ?? "",
  );
}

/** The window grown or shrunk to `height`, as a drag of its edge reports it. */
function resizeTo(height: number): void {
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(height);
  act(() => window.dispatchEvent(new Event("resize")));
}

/** The box each element stands in, by the class that names it, every other at none. */
function layOut(boxes: Readonly<Record<string, DOMRect>>): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const named = Object.keys(boxes).find((name) => this.classList.contains(name));
    return named === undefined ? new DOMRect() : (boxes[named] ?? new DOMRect());
  });
}

test("a window too short for three toasts stands the two newest, and the one set aside stands again once the window is tall enough", () => {
  mount(WINDOW.SHORT);

  act(() => show?.(persisting("Retry the webhook finished")));
  act(() => show?.(persisting("Should withdrawn invitations count?")));
  act(() => show?.(persisting("Nightly upgrade couldn't start")));
  const short = standing();
  resizeTo(WINDOW.TALL);

  assert.deepEqual(short, [
    "Should withdrawn invitations count?",
    "Nightly upgrade couldn't start",
  ]);
  assert.deepEqual(standing(), [
    "Should withdrawn invitations count?",
    "Nightly upgrade couldn't start",
    "Retry the webhook finished",
  ]);
});

test("a window made too short for three toasts sets the oldest aside, without dismissing it", () => {
  mount(WINDOW.TALL);
  act(() => show?.(persisting("Retry the webhook finished")));
  act(() => show?.(persisting("Should withdrawn invitations count?")));
  act(() => show?.(persisting("Nightly upgrade couldn't start")));
  const tall = standing();

  resizeTo(WINDOW.SHORT);
  const short = standing();
  resizeTo(WINDOW.TALL);

  assert.equal(tall.length, 3);
  assert.deepEqual(short, [
    "Should withdrawn invitations count?",
    "Nightly upgrade couldn't start",
  ]);
  assert.ok(standing().includes("Retry the webhook finished"), "the toast set aside comes back");
});

test("the stack stands clear of a call bar docked at the window's foot under it, and in its corner beside a bar that is not", () => {
  document.head.appendChild(document.createElement("style")).textContent = DESKTOP_CSS;
  const bar = document.body.appendChild(document.createElement("div"));
  bar.className = "desktop-call-bar";
  // The plan's column fills the window, its call bar 60px tall across it.
  layOut({
    "toast-stack": new DOMRect(404, 504, 340, 0),
    "desktop-call-bar": new DOMRect(0, 460, 760, 60),
  });
  mount(WINDOW.SHORT);

  act(() => show?.(persisting("Retry the webhook finished")));
  const stack = document.querySelector<HTMLElement>(".toast-stack") ?? assert.fail("the stack");
  const over = stack.style.getPropertyValue("--toast-dock");
  // The side panel opens, and the bar now runs under the plan's column alone.
  layOut({
    "toast-stack": new DOMRect(404, 504, 340, 0),
    "desktop-call-bar": new DOMRect(0, 460, 380, 60),
  });
  act(relayout);

  assert.equal(over, "60px");
  assert.equal(stack.style.getPropertyValue("--toast-dock"), "0px");
  assert.match(
    getComputedStyle(stack).bottom,
    /var\(--toast-dock/u,
    "the stack stands on the dock",
  );
});
