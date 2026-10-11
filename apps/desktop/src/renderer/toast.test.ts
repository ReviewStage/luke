// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { MOTION_DURATION_MS } from "@sidecar/surface";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { afterEach } from "vitest";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { TOAST_HOLD, TOAST_TONE, ToastHost, type ToastNotice, useToast } from "./toast";

/** The window's toast beside a probe that hands back its show. */
function mount(registry: AtomRegistry): (notice: ToastNotice) => void {
  let show: ((notice: ToastNotice) => void) | undefined;
  function Probe() {
    show = useToast();
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const surface = createElement(Fragment, null, createElement(Probe), createElement(ToastHost));
  act(() => createRoot(container).render(onRegistry(registry, surface)));
  return (notice) => {
    assert.ok(show);
    act(() => show?.(notice));
  };
}

/** Lets what fell due land and redraw. */
const landed = Effect.promise(() =>
  act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  }),
);

/** Advances the clock the toast's hold waits on, then lets what fell due land. */
const advance = (millis: number) =>
  Effect.andThen(TestClock.adjust(Duration.millis(millis)), landed);

/** What the window's toast says, while one stands. */
function toast(): string | undefined {
  return document.querySelector(".toast")?.textContent ?? undefined;
}

function toastElement(): HTMLElement {
  const shown = document.querySelector<HTMLElement>(".toast");
  assert.ok(shown, "no toast");
  return shown;
}

function actionButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(".toast button");
  assert.ok(button, "no action on the toast");
  return button;
}

/** Fires a React-heard event on the toast: the pointer arriving or leaving, focus coming or going. */
function toastEvent(type: "pointerover" | "pointerout" | "focusin" | "focusout"): void {
  const target = toastElement();
  act(() => {
    target.dispatchEvent(
      type === "focusin" || type === "focusout"
        ? new FocusEvent(type, { bubbles: true })
        : new PointerEvent(type, { bubbles: true }),
    );
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

it.effect(
  "a toast with an action stands five seconds, and pressing its action runs it once and sends the toast away",
  () =>
    Effect.gen(function* () {
      const show = mount(yield* registryOnTestClock);
      const undone: string[] = [];
      show({
        words: "Plan archived",
        tone: TOAST_TONE.DONE,
        action: { label: "Undo", onPress: () => undone.push("undo") },
      });
      yield* landed;
      assert.equal(toast(), "Plan archivedUndo");
      yield* advance(4_999);
      assert.equal(toast(), "Plan archivedUndo");
      yield* advance(1 + MOTION_DURATION_MS.EXIT);
      assert.equal(toast(), undefined, "gone once its hold and its exit have passed");

      show({
        words: "Plan archived",
        tone: TOAST_TONE.DONE,
        action: { label: "Undo", onPress: () => undone.push("undo") },
      });
      yield* landed;
      act(() => actionButton().click());
      yield* advance(MOTION_DURATION_MS.EXIT);
      assert.deepEqual(undone, ["undo"]);
      assert.equal(toast(), undefined);
    }),
);

it.effect(
  "a toast with an action holds while the pointer is over it or focus is in it, and runs down what was left once both are gone",
  () =>
    Effect.gen(function* () {
      const show = mount(yield* registryOnTestClock);
      show({
        words: "Voice settings reset",
        tone: TOAST_TONE.DONE,
        action: { label: "Undo", onPress: () => undefined },
      });
      yield* landed;
      yield* advance(2_000);
      toastEvent("pointerover");
      yield* advance(60_000);
      assert.equal(toast(), "Voice settings resetUndo", "held while pointed at");

      toastEvent("focusin");
      toastEvent("pointerout");
      yield* advance(60_000);
      assert.equal(toast(), "Voice settings resetUndo", "held while focus is in it");

      toastEvent("focusout");
      yield* advance(2_999);
      assert.equal(toast(), "Voice settings resetUndo", "the three seconds left run down");
      yield* advance(1 + MOTION_DURATION_MS.EXIT);
      assert.equal(toast(), undefined);
    }),
);

it.effect(
  "a toast with no action offers no button and stands for the hold it was given, a new one taking its place",
  () =>
    Effect.gen(function* () {
      const show = mount(yield* registryOnTestClock);
      show({
        words: "The plan could not be archived. Try again.",
        tone: TOAST_TONE.FAILED,
        hold: TOAST_HOLD.FAILED,
      });
      yield* landed;
      assert.equal(document.querySelector(".toast button"), null);
      yield* advance(3_000);
      show({ words: "Plan deleted", tone: TOAST_TONE.DONE, hold: TOAST_HOLD.DONE });
      yield* landed;
      assert.equal(toast(), "Plan deleted");
      yield* advance(2_999);
      assert.equal(toast(), "Plan deleted", "its own hold, started afresh");
      yield* advance(1 + MOTION_DURATION_MS.EXIT);
      assert.equal(toast(), undefined);
    }),
);
