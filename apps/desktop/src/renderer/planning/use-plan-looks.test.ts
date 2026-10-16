// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  PLAN_ACTOR,
  type PlanSectionEdit,
  type Task,
  type TaskSummary,
} from "@luke/features/task-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { DOCUMENT_PLAN } from "#testing/document-plan";
import { NO_LOOKS, usePlanLooks, useReadMarks, useUnreadPlans } from "./use-plan-looks";

/**
 * use-plan-looks.test.ts -- the sections a reader is shown as changed since
 * they last looked: a teammate's saves, Luke's and an agent's, never the
 * reader's own; and a plan read the moment it opens, its changes still lit
 * for that visit.
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
  const plan: Task = {
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

test("a reader's id arriving while the plan stays open lights a teammate's saves read without it", () => {
  const plan: Task = {
    ...DOCUMENT_PLAN,
    sectionEdits: EDITS.map((edit) => ({ ...edit, at: LOOKED_AT + 1, duringCall: false })),
  };
  window.localStorage.setItem("luke.planLooks", JSON.stringify({ [plan.id]: LOOKED_AT }));
  let changed: readonly string[] = [];
  function Reader({ readerId }: { readerId: string | undefined }) {
    changed = [...usePlanLooks(plan, readerId).changed];
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const registry = AtomRegistry.make();
  act(() => root.render(onRegistry(registry, createElement(Reader, { readerId: undefined }))));
  assert.deepEqual([...changed].sort(), ["Context"]);

  act(() => root.render(onRegistry(registry, createElement(Reader, { readerId: DEAN.userId }))));
  assert.deepEqual([...changed].sort(), ["Approach", "Context"]);
});

/** The plan's sections lit and whether the sidebar reads it unread, as one window draws them with `plan` open or not. */
interface Drawn {
  changed: readonly string[];
  unread: boolean;
}

/** A window as a test drives it: what it drew last, a render with a plan open or none, and `summary` marked unread or read from a menu. */
interface TestWindow {
  readonly drawn: Drawn;
  readonly draw: (open: Task | undefined) => void;
  readonly mark: (unread: boolean) => void;
}

/** A window drawing `summary`'s row and, while `open` is given, that plan open, re-rendered by `draw`. */
function windowOn(summary: TaskSummary): TestWindow {
  const drawn: Drawn = { changed: [], unread: false };
  let marks: ReturnType<typeof useReadMarks> | undefined;
  function Window({ open }: { open: Task | undefined }) {
    drawn.changed = [...usePlanLooks(open, DEAN.userId).changed].sort();
    drawn.unread = useUnreadPlans([summary], { listRead: true, staged: false })(summary);
    marks = useReadMarks();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = (open: Task | undefined) =>
    act(() => root.render(onRegistry(registry, createElement(Window, { open }))));
  const mark = (unread: boolean) => act(() => marks?.mark(summary, unread));
  return { drawn, draw, mark };
}

test("a plan opened is read at once, and still lights what changed since the last look for that visit alone", () => {
  const plan: Task = {
    ...DOCUMENT_PLAN,
    updatedAt: LOOKED_AT + 1,
    sectionEdits: EDITS.map((edit) => ({ ...edit, at: LOOKED_AT + 1, duringCall: false })),
  };
  window.localStorage.setItem("luke.planLooks", JSON.stringify({ [plan.id]: LOOKED_AT }));
  window.localStorage.setItem("luke.planLooksSeeded", "1");
  const { drawn, draw } = windowOn(plan);

  draw(undefined);
  assert.deepEqual(drawn, { changed: [], unread: true });

  draw(plan);
  assert.deepEqual(drawn, { changed: ["Approach", "Context"], unread: false });

  draw(undefined);
  assert.deepEqual(drawn, { changed: [], unread: false });

  draw(plan);
  assert.deepEqual(drawn, { changed: [], unread: false });
});

test("a plan marked unread lights, as it next opens, what changed since its last look and nothing before it", () => {
  const plan: Task = {
    ...DOCUMENT_PLAN,
    updatedAt: LOOKED_AT + 1,
    sectionEdits: [
      { section: "Approach", actor: PLAN_ACTOR.DEVELOPER, by: CHARLES, at: LOOKED_AT - 1 },
      { section: "Context", actor: PLAN_ACTOR.NOTETAKER, at: LOOKED_AT + 1 },
    ].map((edit) => ({ ...edit, duringCall: false })),
  };
  window.localStorage.setItem("luke.planLooks", JSON.stringify({ [plan.id]: LOOKED_AT }));
  window.localStorage.setItem("luke.planLooksSeeded", "1");
  const { drawn, draw, mark } = windowOn(plan);

  draw(undefined);
  mark(true);
  assert.deepEqual(drawn, { changed: [], unread: true });

  draw(plan);
  assert.deepEqual(drawn, { changed: ["Context"], unread: false });
});

test("a save landing while the plan stays open is read as it lands, and stays read once the plan is left", () => {
  const plan: Task = { ...DOCUMENT_PLAN, updatedAt: LOOKED_AT };
  window.localStorage.setItem("luke.planLooks", JSON.stringify({ [plan.id]: LOOKED_AT }));
  window.localStorage.setItem("luke.planLooksSeeded", "1");
  const saved: Task = {
    ...plan,
    updatedAt: LOOKED_AT + 1,
    sectionEdits: [
      { section: "Context", actor: PLAN_ACTOR.NOTETAKER, at: LOOKED_AT + 1, duringCall: false },
    ],
  };
  const { drawn, draw } = windowOn(saved);

  draw(plan);
  draw(saved);
  assert.deepEqual(drawn, { changed: [], unread: false });

  draw(undefined);
  assert.deepEqual(drawn, { changed: [], unread: false });
});

test("a reader's id arriving mid-stay lights neither a save that landed during the stay nor a section dismissed", () => {
  const charles = { section: "Approach", actor: PLAN_ACTOR.DEVELOPER, by: CHARLES };
  const plan: Task = {
    ...DOCUMENT_PLAN,
    updatedAt: LOOKED_AT + 1,
    sectionEdits: [{ ...charles, at: LOOKED_AT + 1, duringCall: false }],
  };
  const saved: Task = {
    ...plan,
    updatedAt: LOOKED_AT + 2,
    sectionEdits: [
      { ...charles, at: LOOKED_AT + 1, duringCall: false },
      { section: "Context", actor: PLAN_ACTOR.NOTETAKER, at: LOOKED_AT + 2, duringCall: false },
    ],
  };
  const stay = (dismissing: boolean) => {
    window.localStorage.setItem("luke.planLooks", JSON.stringify({ [plan.id]: LOOKED_AT }));
    let looks = NO_LOOKS;
    function Reader({ open, readerId }: { open: Task; readerId: string | undefined }) {
      looks = usePlanLooks(open, readerId);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    roots.push(root);
    const registry = AtomRegistry.make();
    const draw = (open: Task, readerId: string | undefined) =>
      act(() => root.render(onRegistry(registry, createElement(Reader, { open, readerId }))));
    draw(plan, undefined);
    if (dismissing) act(() => looks.dismiss());
    draw(saved, undefined);
    draw(saved, DEAN.userId);
    return [...looks.changed];
  };

  assert.deepEqual(stay(false), ["Approach"]);
  assert.deepEqual(stay(true), []);
});
