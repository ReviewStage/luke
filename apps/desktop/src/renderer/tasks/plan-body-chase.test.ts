// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_ACTOR, type Task } from "@luke/features/task-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { DOCUMENT_TASK } from "#testing/document-task";
import { PlanBody } from "./plan-body";

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
