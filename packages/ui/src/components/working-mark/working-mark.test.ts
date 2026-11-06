// @vitest-environment jsdom

import assert from "node:assert/strict";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { it } from "@effect/vitest";
import { Clock, Context, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { Shimmer } from "../shimmer/shimmer.js";
import { timeRuntime } from "../time/time-clock.js";
import { WorkingMark } from "./working-mark.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(element: React.ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  act(() => createRoot(container).render(element));
  return container;
}

test("the working mark is hidden from a reader", () => {
  const mark = render(createElement(WorkingMark)).querySelector("svg.ui-working-mark");
  assert.equal(mark?.getAttribute("aria-hidden"), "true");
});

test("a still working mark lights at least three cells, not one stacked dot", () => {
  const dots = render(createElement(WorkingMark)).querySelectorAll<SVGElement>(
    ".ui-working-mark-dot",
  );
  const cells = new Set([...dots].map((dot) => dot.style.transform));
  assert.ok(cells.size >= 3, `the still mark lights ${cells.size} cells`);
});

it.effect("each pixel steps one cell on along the lap on each beat", () =>
  Effect.gen(function* () {
    const registry = AtomRegistry.make({
      initialValues: [
        [timeRuntime, AsyncResult.success(Context.make(Clock.Clock, yield* Clock.Clock))],
      ],
    });
    const mark = render(
      createElement(RegistryContext.Provider, { value: registry }, createElement(WorkingMark)),
    );
    const cells = () =>
      [...mark.querySelectorAll<SVGElement>(".ui-working-mark-dot")].map(
        (dot) => dot.style.transform,
      );
    assert.deepEqual(cells(), [
      "translate(5px, 0px)",
      "translate(0px, 0px)",
      "translate(5px, 10px)",
      "translate(10px, 10px)",
    ]);
    yield* TestClock.adjust("200 millis");
    yield* Effect.promise(() => act(() => Promise.resolve()));
    assert.deepEqual(cells(), [
      "translate(10px, 0px)",
      "translate(5px, 0px)",
      "translate(0px, 10px)",
      "translate(5px, 10px)",
    ]);
  }),
);

it.effect("a mark committed under a capture stage holds its resting frame on the beat", () =>
  Effect.gen(function* () {
    const registry = AtomRegistry.make({
      initialValues: [
        [timeRuntime, AsyncResult.success(Context.make(Clock.Clock, yield* Clock.Clock))],
      ],
    });
    const stage = (element: HTMLElement | null) => {
      if (element !== null) document.body.style.setProperty("--ui-duration-fast", "0s");
    };
    const mark = render(
      createElement(
        RegistryContext.Provider,
        { value: registry },
        createElement("div", { ref: stage }, createElement(WorkingMark)),
      ),
    );
    yield* TestClock.adjust("200 millis");
    yield* Effect.promise(() => act(() => Promise.resolve()));
    document.body.style.removeProperty("--ui-duration-fast");
    assert.deepEqual(
      [...mark.querySelectorAll<SVGElement>(".ui-working-mark-dot")].map(
        (dot) => dot.style.transform,
      ),
      [
        "translate(5px, 0px)",
        "translate(0px, 0px)",
        "translate(5px, 10px)",
        "translate(10px, 10px)",
      ],
    );
  }),
);

test("the shimmer says its words and passes props on", () => {
  const line = render(createElement(Shimmer, { children: "Working", "aria-live": "polite" }));
  const span = line.querySelector(".ui-shimmer");
  assert.equal(span?.textContent, "Working");
  assert.equal(span?.getAttribute("aria-live"), "polite");
});
