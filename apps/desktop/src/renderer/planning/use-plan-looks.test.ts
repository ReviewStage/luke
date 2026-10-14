// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_ACTOR, type Plan, type PlanSectionEdit } from "@luke/features/plan-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { DOCUMENT_PLAN } from "#testing/document-plan";
import { usePlanLooks } from "./use-plan-looks";

/**
 * use-plan-looks.test.ts -- the sections a reader is shown as changed since
 * they last looked: a teammate's saves, Luke's and an agent's, never the
 * reader's own.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };
const LOOKED_AT = 1_000;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  window.localStorage.clear();
});

/** The sections `readerId` is shown as changed on a plan they last looked at before every save here. */
function changedFor(
  readerId: string | undefined,
  edits: readonly Omit<PlanSectionEdit, "at" | "duringCall">[],
): string[] {
  const plan: Plan = {
    ...DOCUMENT_PLAN,
    sectionEdits: edits.map((edit) => ({ ...edit, at: LOOKED_AT + 1, duringCall: false })),
  };
  window.localStorage.setItem("luke.planLooks", JSON.stringify({ [plan.id]: LOOKED_AT }));
  let changed: readonly string[] = [];
  function Reader() {
    changed = [...usePlanLooks(plan, readerId).changed];
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(Reader))));
  return [...changed].sort();
}

const EDITS = [
  { section: "Goal", actor: PLAN_ACTOR.DEVELOPER, by: DEAN },
  { section: "Approach", actor: PLAN_ACTOR.DEVELOPER, by: CHARLES },
  { section: "Context", actor: PLAN_ACTOR.NOTETAKER },
];

test("a teammate's saves are shown as changed, and the reader's own are not", () => {
  assert.deepEqual(changedFor(DEAN.userId, EDITS), ["Approach", "Context"]);
  assert.deepEqual(changedFor(CHARLES.userId, EDITS), ["Context", "Goal"]);
});

test("a developer's save the window cannot place counts as the reader's, as before saves named a member", () => {
  const unnamed = [{ section: "Goal", actor: PLAN_ACTOR.DEVELOPER }];

  assert.deepEqual(changedFor(DEAN.userId, unnamed), []);
  assert.deepEqual(changedFor(undefined, EDITS), ["Context"]);
});
