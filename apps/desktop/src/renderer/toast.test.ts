// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { TOAST_TONE, ToastHost, type ToastNotice, useToast } from "./toast";

/**
 * toast.test.ts -- the window's toasts against the window they stand in: a
 * window too short for three stands two, setting the oldest aside until
 * there is room again. jsdom lays nothing out, so the window's height is
 * given. Synthetic throughout.
 */

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
