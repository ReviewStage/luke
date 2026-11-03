// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MOTION_DELAY_MS } from "@repo/brand";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { ArchivedComposerNote } from "./tasks/archived-note.js";

/**
 * banner.test.ts -- an archived agent's notice: the strip is named by its
 * words and carries the presses it offers. Synthetic throughout.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

/** What a reader hears the strip named: the words it is labeled by. */
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
      stop: () => Promise.resolve(true),
    }),
  );
  assert.equal(named(note), "Unarchive to send messages");
  press(note, "Stop");
  press(note, "Unarchive");
});

test("an archived agent's Stop the service took stays Stopping until the agent offers none, and one it refused is offered again", async () => {
  const answers: ((took: boolean) => void)[] = [];
  const stop = () => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    answers.push(resolve);
    return promise;
  };
  const note = drawn(createElement(ArchivedComposerNote, { onUnarchive: () => undefined, stop }));
  act(() => press(note, "Stop").click());
  const busy = press(note, "Stop");
  assert.equal(busy.getAttribute("aria-label"), "Stopping");
  assert.equal(busy.getAttribute("aria-disabled"), "true");
  await act(async () => answers[0]?.(false));
  assert.equal(busy.getAttribute("aria-label"), null, "a refused Stop is offered again");
  act(() => busy.click());
  await act(async () => answers[1]?.(true));
  assert.equal(
    busy.getAttribute("aria-label"),
    "Stopping",
    "the task list has not carried the stop",
  );
  act(() => root?.render(createElement(ArchivedComposerNote, { onUnarchive: () => undefined })));
  act(() =>
    root?.render(createElement(ArchivedComposerNote, { onUnarchive: () => undefined, stop })),
  );
  assert.equal(
    press(note, "Stop").getAttribute("aria-label"),
    null,
    "a later turn's Stop is fresh",
  );
});

test("an archived agent's Unarchive is named Unarchiving while the service answers, shows its ring once the settle delay has passed, holds Stop meanwhile, and clears when it answers", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    let answer: () => void = () => undefined;
    let unarchives = 0;
    const note = drawn(
      createElement(ArchivedComposerNote, {
        onUnarchive: () => {
          unarchives += 1;
          return new Promise<void>((resolve) => {
            answer = resolve;
          });
        },
        stop: () => Promise.resolve(true),
      }),
    );
    const unarchive = press(note, "Unarchive");
    const stop = press(note, "Stop");
    const ring = () => unarchive.querySelector(".ui-spinner-ring") !== null;
    act(() => unarchive.click());
    assert.equal(unarchive.getAttribute("aria-label"), "Unarchiving");
    assert.equal(stop.disabled, true);
    assert.equal(ring(), false);
    act(() => vi.advanceTimersByTime(MOTION_DELAY_MS.SETTLE));
    assert.equal(ring(), true);
    act(() => unarchive.click());
    assert.equal(unarchives, 1);
    await act(async () => answer());
    assert.equal(unarchive.getAttribute("aria-label"), null);
    assert.equal(stop.disabled, false);
    assert.equal(ring(), false);
  } finally {
    vi.useRealTimers();
  }
});

test("an Unarchive that answers at once shows nothing busy", () => {
  const note = drawn(createElement(ArchivedComposerNote, { onUnarchive: () => undefined }));
  const unarchive = press(note, "Unarchive");
  act(() => unarchive.click());
  assert.equal(unarchive.getAttribute("aria-busy"), null);
});
