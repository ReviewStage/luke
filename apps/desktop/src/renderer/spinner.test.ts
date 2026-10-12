// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { PAST_SPINNER_DELAY, waitsIn } from "#testing/spinner";
import { BusyLabel, SPINNER_SIZE, Spinner, SpinnerRegion } from "./spinner";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: Root[] = [];

/** Lets a wait that ended, and the redraw it causes, land with no time passing. */
const settle = Effect.promise(() =>
  act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  }),
);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** `element` drawn into the page on the test's clock, and a way to draw something else in its place. */
const mount = (element: ReactElement) =>
  Effect.gen(function* () {
    const registry = yield* registryOnTestClock;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const draw = (next: ReactElement) => act(() => root.render(onRegistry(registry, next)));
    draw(element);
    return { container, draw };
  });

/** A button whose words give way to the ring while `busy`. */
const checkButton = (busy: boolean) =>
  createElement(
    "button",
    { type: "button" },
    createElement(BusyLabel, {
      busy,
      label: "Checking for updates",
      children: "Check for updates",
    }),
  );

it.effect(
  "a wait shows nothing for a read that lands at once, then the ring with its words said to a reader",
  () =>
    Effect.gen(function* () {
      const { container } = yield* mount(createElement(Spinner, { label: "Loading transcript" }));
      assert.deepEqual(waitsIn(container), [{ says: "", ring: false }]);

      yield* TestClock.adjust(Duration.millis(100));
      yield* settle;
      assert.deepEqual(
        waitsIn(container),
        [{ says: "", ring: false }],
        "no flash for a quick read",
      );

      yield* TestClock.adjust(PAST_SPINNER_DELAY);
      yield* settle;
      assert.deepEqual(waitsIn(container), [{ says: "Loading transcript", ring: true }]);
    }),
);

it.effect("a region's wait stands at the region's size, and each wait mounted waits afresh", () =>
  Effect.gen(function* () {
    const { container, draw } = yield* mount(
      createElement(SpinnerRegion, { label: "Loading plan" }),
    );
    yield* TestClock.adjust(PAST_SPINNER_DELAY);
    yield* settle;
    assert.deepEqual(waitsIn(container), [{ says: "Loading plan", ring: true }]);
    assert.equal(
      container.querySelector('[role="status"]')?.getAttribute("data-size"),
      SPINNER_SIZE.REGION,
    );

    draw(createElement("p", null, "The plan"));
    draw(createElement(Spinner, { label: "Loading plan" }));
    assert.deepEqual(waitsIn(container), [{ says: "", ring: false }]);
  }),
);

it.effect(
  "a busy button keeps its words until the wait has stood, then the ring stands over them under the busy label",
  () =>
    Effect.gen(function* () {
      const { container, draw } = yield* mount(checkButton(false));
      const button = () => container.querySelector("button");
      assert.equal(button()?.textContent, "Check for updates");

      draw(checkButton(true));
      yield* TestClock.adjust(Duration.millis(100));
      yield* settle;
      assert.equal(button()?.querySelector(".spinner-ring"), null);
      assert.equal(button()?.querySelector(".visually-hidden"), null);

      yield* TestClock.adjust(PAST_SPINNER_DELAY);
      yield* settle;
      assert.ok(button()?.querySelector(".spinner-ring"));
      assert.equal(
        button()?.querySelector(".visually-hidden")?.textContent,
        "Checking for updates",
      );
      assert.equal(
        button()?.querySelector('[data-shown="true"] > .busy-label-words')?.textContent,
        "Check for updates",
        "the words keep their room, hidden under the ring",
      );

      draw(checkButton(false));
      assert.equal(button()?.textContent, "Check for updates");
      assert.equal(button()?.querySelector(".spinner-ring"), null);
    }),
);
