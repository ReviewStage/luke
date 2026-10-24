// @vitest-environment jsdom

import assert from "node:assert/strict";
import { STATUS_TONE, TOAST_LOOK, type ToastLook } from "@luke/ui";
import { Duration } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { onRegistry } from "./testing/copy-feedback.js";
import {
  TOAST_HOLD,
  ToastHost,
  type ToastNotice,
  undoToast,
  useToast,
  useWorkingToast,
} from "./toast.js";

/**
 * toast.test.ts -- the window's toasts against the window they stand in: a
 * window too short for three stands two, setting the oldest aside until
 * there is room again; one whose hold runs down with an action draws that
 * hold as its countdown; work under way settles into its own card in
 * place; and an act's Undo toast takes the act back and stands for the Undo
 * hold; a window that draws them compact, too small for more, stands
 * the newest alone. jsdom lays nothing out, so the window's height is given. Synthetic
 * throughout.
 */

/** The window's heights: its least, and one with room for three toasts. */
const WINDOW = {
  SHORT: 520,
  TALL: 800,
} as const;

let root: Root | undefined;
let registry: AtomRegistry.AtomRegistry | undefined;
let show: ((notice: ToastNotice) => void) | undefined;
let work: ((words: string) => (notice: ToastNotice) => void) | undefined;

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  root = undefined;
  registry?.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** Hands the test the window's way of showing a toast. */
function Shower(): null {
  show = useToast();
  work = useWorkingToast();
  return null;
}

/** The toasts, mounted as the window's root mounts them, in a window `height` tall, in `look`. */
function mount(height: number, look: ToastLook = TOAST_LOOK.CARD): void {
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(height);
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  registry = AtomRegistry.make();
  const held = registry;
  act(() =>
    root?.render(
      onRegistry(
        held,
        createElement(Fragment, null, createElement(Shower), createElement(ToastHost, { look })),
      ),
    ),
  );
}

/** A toast that stands until it is dismissed, as an agent's end does. */
function persisting(words: string): ToastNotice {
  return {
    words,
    tone: STATUS_TONE.COMPLETE,
    action: { label: "View", onPress: () => undefined },
    persists: true,
  };
}

/** What each toast standing says, oldest first, leaving out those on their way out. */
function standing(): string[] {
  return [...document.querySelectorAll(".luke-toast:not([data-leaving]) .luke-toast-words")].map(
    (words) => words.textContent ?? "",
  );
}

/** Lets `ms` pass on the faked clock the toasts' holds run down on. */
function pass(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** The button a standing toast labels `label`. */
function toastButton(label: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>(".luke-toast:not([data-leaving]) button"),
  ].find((button) => button.textContent === label);
  return found ?? assert.fail(`a toast button named ${label}`);
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

test("a window that draws its toasts compact stands the newest alone, setting the one it pushed aside until it leaves", () => {
  mount(WINDOW.TALL, TOAST_LOOK.COMPACT);

  act(() => show?.(persisting("Retry the webhook finished")));
  act(() => show?.(persisting("Nightly upgrade couldn't start")));
  assert.deepEqual(standing(), ["Nightly upgrade couldn't start"]);

  act(() => toastButton("View").click());
  assert.deepEqual(standing(), ["Retry the webhook finished"]);
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

test("a toast with an action carries a Dismiss button the keyboard reaches, and its press or Escape from it sends the toast away", () => {
  mount(WINDOW.TALL);
  act(() => show?.(persisting("Retry the webhook finished")));
  act(() => show?.(persisting("Nightly upgrade couldn't start")));
  const dismissButtons = () =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(".luke-toast:not([data-leaving]) button"),
    ].filter((button) => button.getAttribute("aria-label") === "Dismiss");

  const [first, second] = dismissButtons();
  assert.ok(first && second);
  act(() => first.click());
  const afterPress = standing();
  act(() => second.focus());
  const focused = document.activeElement === second;
  act(() => {
    second.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  assert.deepEqual(afterPress, ["Nightly upgrade couldn't start"]);
  assert.ok(focused, "the Dismiss button takes focus");
  assert.deepEqual(standing(), []);
});

test("a phone's keyboard rising in a tall window leaves room for two toasts, setting the oldest aside until it goes down", () => {
  const seen: EventTarget & { height: number } = Object.assign(new EventTarget(), {
    offsetTop: 0,
    offsetLeft: 0,
    width: 390,
    height: WINDOW.TALL,
  });
  vi.stubGlobal("visualViewport", seen);
  mount(WINDOW.TALL);
  act(() => show?.(persisting("Retry the webhook finished")));
  act(() => show?.(persisting("Should withdrawn invitations count?")));
  act(() => show?.(persisting("Nightly upgrade couldn't start")));

  seen.height = WINDOW.SHORT;
  act(() => seen.dispatchEvent(new Event("resize")));
  const keyboardUp = standing();
  seen.height = WINDOW.TALL;
  act(() => seen.dispatchEvent(new Event("resize")));

  assert.deepEqual(keyboardUp, [
    "Should withdrawn invitations count?",
    "Nightly upgrade couldn't start",
  ]);
  assert.equal(standing().length, 3);
});

test("a toast with an action and a hold draws its countdown over that hold, and one that persists or has no action draws none", () => {
  mount(WINDOW.TALL);
  act(() =>
    show?.({
      words: "Task archived",
      tone: STATUS_TONE.COMPLETE,
      action: { label: "Undo", onPress: () => undefined },
    }),
  );
  act(() => show?.(persisting("Retry the webhook finished")));
  act(() => show?.({ words: "Link copied", tone: STATUS_TONE.COMPLETE, hold: TOAST_HOLD.DONE }));

  const countdowns = [...document.querySelectorAll<HTMLElement>(".luke-toast")].map((toast) =>
    toast
      .querySelector<HTMLElement>(".luke-toast-countdown")
      ?.style.getPropertyValue("--luke-toast-hold"),
  );
  assert.deepEqual(countdowns, ["5000ms", undefined, undefined]);
});

test("two pieces of work under way stand apart, each settles its own card in place, and a refusal is said as an alert", () => {
  mount(WINDOW.TALL);
  let first: ((notice: ToastNotice) => void) | undefined;
  let second: ((notice: ToastNotice) => void) | undefined;
  act(() => {
    first = work?.("Saving…");
    second = work?.("Saving…");
  });
  const working = [...document.querySelectorAll(".luke-toast")];

  act(() =>
    second?.({ words: "Couldn't save", tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED }),
  );
  act(() => first?.({ words: "Saved", tone: STATUS_TONE.COMPLETE, hold: TOAST_HOLD.DONE }));

  assert.deepEqual(standing(), ["Saved", "Couldn't save"]);
  assert.deepEqual([...document.querySelectorAll(".luke-toast")], working, "the same two cards");
  assert.deepEqual(
    working.map((toast) => (toast as HTMLElement).dataset.tone),
    [STATUS_TONE.COMPLETE, STATUS_TONE.DANGER],
  );
  assert.equal(document.querySelector('[role="alert"]')?.textContent, "Couldn't save");
});

test("an Undo toast says the act in the success tone, and its Undo takes the act back and sends the toast away", () => {
  mount(WINDOW.TALL);
  const undone: string[] = [];
  act(() => show?.(undoToast("Task archived", () => undone.push("Task archived"))));
  const tone = document.querySelector<HTMLElement>(".luke-toast")?.dataset.tone;

  act(() => toastButton("Undo").click());

  assert.equal(tone, STATUS_TONE.COMPLETE);
  assert.deepEqual(undone, ["Task archived"]);
  assert.deepEqual(standing(), []);
});

test("an Undo toast nobody points at stands for the Undo hold, then leaves without taking the act back", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  mount(WINDOW.TALL);
  const hold = Duration.toMillis(TOAST_HOLD.UNDO);
  const undone: string[] = [];
  act(() => show?.(undoToast("Settings reset", () => undone.push("Settings reset"))));

  pass(hold - 1);
  const justBefore = standing();
  pass(1);

  assert.deepEqual(justBefore, ["Settings reset"]);
  assert.deepEqual(standing(), []);
  assert.deepEqual(undone, []);
});
