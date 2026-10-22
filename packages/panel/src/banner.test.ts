// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ArchivedComposerNote } from "./tasks/archived-note.js";

/**
 * banner.test.ts -- an archived agent's notice: the strip is named by its
 * words and carries the presses it offers. Synthetic throughout.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Draws a strip, answering the strip. */
function drawn(strip: ReactNode): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(strip));
  const section = container.querySelector<HTMLElement>("section");
  assert.ok(section, "the strip is drawn");
  return section;
}

/** What a reader hears the strip named: the words it is labelled by. */
function named(section: HTMLElement): string | undefined {
  return (
    document.getElementById(section.getAttribute("aria-labelledby") ?? "")?.textContent ?? undefined
  );
}

/** The press a strip carries with these words. */
function press(section: HTMLElement, words: string): HTMLButtonElement {
  const found = [...section.querySelectorAll("button")].find(
    (button) => button.textContent === words,
  );
  assert.ok(found, `the strip carries ${words}`);
  return found;
}

test("an archived agent's composer row is named by its words and carries Stop and Unarchive", () => {
  const note = drawn(
    createElement(ArchivedComposerNote, {
      onUnarchive: () => undefined,
      stop: () => Promise.resolve(),
    }),
  );
  assert.equal(named(note), "Unarchive to send messages");
  press(note, "Stop");
  press(note, "Unarchive");
});

test("an archived agent's Stop is named Stopping and unavailable until the service answers", async () => {
  let answer: () => void = () => undefined;
  const note = drawn(
    createElement(ArchivedComposerNote, {
      onUnarchive: () => undefined,
      stop: () => {
        return new Promise<void>((resolve) => {
          answer = resolve;
        });
      },
    }),
  );
  const stop = press(note, "Stop");
  act(() => stop.click());
  assert.equal(stop.getAttribute("aria-label"), "Stopping");
  assert.equal(stop.getAttribute("aria-disabled"), "true");
  await act(async () => answer());
  assert.equal(stop.getAttribute("aria-label"), null);
  assert.equal(stop.getAttribute("aria-disabled"), null);
});
