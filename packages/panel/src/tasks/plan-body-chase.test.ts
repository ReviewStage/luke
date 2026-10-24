// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_ACTOR, type Task } from "@luke/features/task-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { PlanBody } from "./plan-body.js";

/**
 * plan-body-chase.test.ts -- a teammate's edit to a shared task types in as
 * Luke's does, while the reader's own lands at once, since only the reader
 * watched it being typed.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };
const BEFORE = "## Goal\nInvite a teammate by email.";
const AFTER = `${BEFORE}\n\n## Approach\nModel an invite as a pending membership, so removal covers both.`;

const roots: Root[] = [];
const standingMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  if (standingMatchMedia === undefined) Reflect.deleteProperty(window, "matchMedia");
  else Object.defineProperty(window, "matchMedia", standingMatchMedia);
});

/** Whether the new section is still typing in, not yet drawn whole, the moment `by`'s edit to it reaches Dean's window. */
function typesIn(by: typeof DEAN): boolean {
  // The OS's motion setting, which jsdom has none of: motion is not reduced.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query }),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const reader = { readerId: DEAN.userId };
  const task = (body: string, at: number): Task => ({
    ...DOCUMENT_TASK,
    document: { body, assumptions: [] },
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, by, at, duringCall: false },
  });
  const draw = (shown: Task) =>
    act(() =>
      root.render(
        onRegistry(registry, createElement(PlanBody, { task: shown, live: true, reader })),
      ),
    );
  draw(task(BEFORE, 1));
  draw(task(AFTER, 2));
  return !(container.textContent ?? "").includes("so removal covers both.");
}

test("a teammate's edit types in, and the reader's own lands at once", () => {
  assert.equal(typesIn(CHARLES), true);
  assert.equal(typesIn(DEAN), false);
});

test("a caret typing below the document's view scrolls the document's own scroller, never a box around it", () => {
  vi.useFakeTimers();
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  let caretY = 480;
  // jsdom lays nothing out: the scroller is 300px tall at the window's top and the caret stands 500px down.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const caret = this.classList.contains("markdown-caret");
    // The caret moves up the window as the scroller scrolls, as a laid-out one does.
    const scrolledBy = document.querySelector(".luke-scroll-area")?.scrollTop ?? 0;
    return DOMRect.fromRect(caret ? { y: caretY - scrolledBy, height: 20 } : { y: 0, height: 300 });
  });
  // jsdom keeps no scroll position, so a scroller's offset is kept here.
  const scrolled = new WeakMap<Element, number>();
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
    return scrolled.get(this) ?? 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (
    this: Element,
    value: number,
  ) {
    scrolled.set(this, value);
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const reader = { readerId: DEAN.userId };
  const task = (body: string, at: number): Task => ({
    ...DOCUMENT_TASK,
    document: { body, assumptions: [] },
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at, duringCall: false },
  });
  const draw = (shown: Task) =>
    act(() =>
      root.render(
        onRegistry(registry, createElement(PlanBody, { task: shown, live: true, reader })),
      ),
    );
  draw(task(BEFORE, 1));
  draw(task(AFTER, 2));
  const scroller =
    container.querySelector<HTMLElement>(".luke-scroll-area") ?? assert.fail("a scroller");
  // The room its faded bottom edge reserves, which the caret is kept clear of.
  scroller.style.setProperty("scroll-padding-bottom", "26px");
  // The caret travels to the new section for a moment, then types.
  act(() => vi.advanceTimersByTime(500));
  // A jump of the caret is brought to the middle of the view.
  assert.equal(scroller.scrollTop, 340, "the caret's arrival is centred");
  // Typing on past the foot of the view brings the caret just clear of the faded edge.
  caretY = 700;
  act(() => vi.advanceTimersByTime(16));
  assert.equal(
    scroller.scrollTop,
    340 + (700 + 20 - 340 - (300 - 26)),
    "the caret stands clear of the faded edge",
  );
  assert.equal(scrollIntoView.mock.calls.length, 0, "no box around it was scrolled");
});
