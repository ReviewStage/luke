// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { EMPTY_PLAN_FIELDS, planBody } from "@sidecar/hosted/plan-template";
import {
  PLAN_ACTOR,
  PLAN_FIELD,
  type Plan,
  type PlanFieldEdit,
  type PlanFields,
} from "@sidecar/hosted/plan-wire";
import { Clock, Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach } from "vitest";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { PlanBody } from "./plan-body";
import { PLAN_LOOK, usePlanLooks } from "./use-plan-looks";

/**
 * Who wrote each section of the open plan, and what changed since the
 * developer last looked at it, through the document as the window draws it.
 * Synthetic plans throughout; the last look is kept where the window keeps
 * it, so a remount is a later visit.
 */

const NAME = "Teammate invitations";

const FIELDS: PlanFields = {
  ...EMPTY_PLAN_FIELDS,
  goal: { problem: "- Only an admin can add a member.", outcome: "- Invites land by email." },
  scope: { included: "- Email invites.", excluded: null, constraints: null },
  rules: [
    { statement: "An invite expires after 7 days.", examples: null },
    { statement: "Only admins invite.", examples: null },
  ],
  decisions: "- Links are single use.",
};

/** When the developer last looked at the plan, on the service's clock. */
const LOOKED_AT = 1_000_000;

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: NAME,
  createdAt: 1,
  updatedAt: LOOKED_AT,
  repository: null,
  document: {
    body: planBody({ name: NAME }, FIELDS),
    assumptions: [{ text: "Members and admins can both invite." }],
  },
  fields: FIELDS,
  lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: LOOKED_AT, duringCall: true },
  fieldEdits: [],
};

function edit(field: PlanFieldEdit["field"], actor: PlanFieldEdit["actor"], at: number) {
  const label = actor === PLAN_ACTOR.AGENT ? { label: "Command K board" } : undefined;
  return { field, actor, ...label, at, duringCall: actor === PLAN_ACTOR.NOTETAKER };
}

/** The plan with these saves since, the newest of them its last edit. */
function savedSince(edits: readonly PlanFieldEdit[]): Plan {
  const newest = edits.reduce((held, next) => (next.at > held.at ? next : held));
  const { field: _field, ...lastEdit } = newest;
  return { ...PLAN, fieldEdits: edits, lastEdit, updatedAt: newest.at };
}

const STORAGE_KEY = "luke.planLooks";

/** The developer's last look at the plan on this Mac, as an earlier visit kept it. */
function lookedAt(at: number): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ [PLAN.id]: at }));
}

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  // A document arriving is drawn at once under reduced motion, which jsdom has no answer to.
  const ignore = () => undefined;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener: ignore, removeEventListener: ignore }),
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

/** The plan's region as the window draws it: the document, under the looks the region keeps. */
function Region({ plan, version }: { plan: Plan; version: boolean }): React.JSX.Element | null {
  const looks = usePlanLooks(plan);
  // A version chosen in the History tab is drawn in the document's place.
  if (version) return null;
  return createElement(PlanBody, {
    plan,
    live: false,
    onEdit: () => Promise.resolve({ saved: true } as const),
    looks,
  });
}

/** The document drawn over `plan`, its atoms on `registry`, so the test's clock is theirs. */
function open(plan: Plan, registry: AtomRegistry) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (next: Plan, version = false) => {
    const body = createElement(Region, { plan: next, version });
    act(() => root.render(onRegistry(registry, body)));
  };
  draw(plan);
  const leave = () => {
    act(() => root.unmount());
    roots.splice(roots.indexOf(root), 1);
  };
  return { container, redraw: draw, leave };
}

/** The heading each byline stands under, with the byline's words. */
function bylines(container: HTMLElement): readonly (readonly [string, string])[] {
  return [...container.querySelectorAll(".plan-unit-byline")].map((byline) => {
    const section = byline.parentElement;
    const heading = section?.querySelector(".markdown-heading, .plan-assumptions-heading");
    return [heading?.textContent ?? "", byline.textContent ?? ""] as const;
  });
}

/** The headings of the sections tinted as changed since the last look. */
function changed(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll(".plan-changed")].map(
    (section) =>
      section.querySelector(".markdown-heading, .plan-assumptions-heading")?.textContent ?? "",
  );
}

function changedNote(container: HTMLElement): string | undefined {
  return container.querySelector(".plan-changed-note span")?.textContent ?? undefined;
}

/** Lets what fell due land and redraw. */
const landed = Effect.promise(() =>
  act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  }),
);

it.effect(
  "each section says who last changed it, and a section no save has changed says nothing",
  () =>
    Effect.gen(function* () {
      yield* TestClock.adjust(Duration.days(2));
      const now = yield* Clock.currentTimeMillis;
      const ago = (span: Duration.Input) => now - Duration.toMillis(span);
      const { container } = open(
        {
          ...PLAN,
          fieldEdits: [
            edit(PLAN_FIELD.PROBLEM, PLAN_ACTOR.NOTETAKER, ago(Duration.hours(2))),
            edit(PLAN_FIELD.OUTCOME, PLAN_ACTOR.DEVELOPER, ago(Duration.minutes(5))),
            edit(PLAN_FIELD.DECISIONS, PLAN_ACTOR.AGENT, ago(Duration.hours(26))),
            edit(PLAN_FIELD.RULES, PLAN_ACTOR.NOTETAKER, ago(Duration.minutes(3))),
            edit(PLAN_FIELD.ASSUMPTIONS, PLAN_ACTOR.DEVELOPER, ago(Duration.minutes(1))),
          ],
        },
        yield* registryOnTestClock,
      );
      yield* landed;

      assert.deepEqual(bylines(container), [
        ["Problem", "Edited by Luke during your call · 2h ago"],
        ["Outcome", "Edited by you · 5m ago"],
        ["Rules", "Edited by Luke during your call · 3m ago"],
        ["Decisions", "Edited by Command K board · 1d ago"],
        ["Assumptions", "Edited by you · 1m ago"],
      ]);
    }),
);

it.effect(
  "the sections someone else changed after the last look are tinted and counted; the developer's own are not",
  () =>
    Effect.gen(function* () {
      lookedAt(LOOKED_AT);
      const { container } = open(
        savedSince([
          edit(PLAN_FIELD.INCLUDED, PLAN_ACTOR.NOTETAKER, LOOKED_AT - 1),
          edit(PLAN_FIELD.PROBLEM, PLAN_ACTOR.NOTETAKER, LOOKED_AT + 1),
          edit(PLAN_FIELD.RULES, PLAN_ACTOR.AGENT, LOOKED_AT + 2),
          edit(PLAN_FIELD.OUTCOME, PLAN_ACTOR.DEVELOPER, LOOKED_AT + 3),
          edit(PLAN_FIELD.ASSUMPTIONS, PLAN_ACTOR.NOTETAKER, LOOKED_AT + 4),
        ]),
        yield* registryOnTestClock,
      );

      assert.deepEqual(changed(container), [
        "Problem",
        "Rules",
        "Rule 1: An invite expires after 7 days.",
        "Rule 2: Only admins invite.",
        "Assumptions",
      ]);
      assert.equal(changedNote(container), "Changed since you last looked · 3 sections");
    }),
);

it.effect("Dismiss clears the tint and the count, and the next visit shows nothing changed", () =>
  Effect.gen(function* () {
    lookedAt(LOOKED_AT);
    const plan = savedSince([edit(PLAN_FIELD.PROBLEM, PLAN_ACTOR.NOTETAKER, LOOKED_AT + 1)]);
    const first = open(plan, yield* registryOnTestClock);
    assert.equal(changedNote(first.container), "Changed since you last looked · 1 section");

    const dismiss = [...first.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Dismiss",
    );
    act(() => dismiss?.click());
    assert.deepEqual(changed(first.container), []);
    assert.equal(changedNote(first.container), undefined);
    first.leave();

    assert.deepEqual(changed(open(plan, yield* registryOnTestClock).container), []);
  }),
);

it.effect("a plan never looked at on this Mac shows nothing changed", () =>
  Effect.gen(function* () {
    const { container } = open(
      savedSince([edit(PLAN_FIELD.PROBLEM, PLAN_ACTOR.NOTETAKER, LOOKED_AT + 1)]),
      yield* registryOnTestClock,
    );

    assert.deepEqual(changed(container), []);
    assert.equal(changedNote(container), undefined);
  }),
);

it.effect("a plan held open for the look is seen: the next visit shows nothing changed", () =>
  Effect.gen(function* () {
    lookedAt(LOOKED_AT);
    const plan = savedSince([edit(PLAN_FIELD.PROBLEM, PLAN_ACTOR.NOTETAKER, LOOKED_AT + 1)]);
    const first = open(plan, yield* registryOnTestClock);
    yield* landed;
    yield* TestClock.adjust(PLAN_LOOK);
    yield* landed;
    assert.deepEqual(changed(first.container), ["Problem"], "lit for the rest of the visit");
    first.leave();

    const again = open(plan, yield* registryOnTestClock);
    assert.deepEqual(changed(again.container), []);
  }),
);

it.effect(
  "a version drawn in the document's place is still a stay on the plan, and counts toward the look",
  () =>
    Effect.gen(function* () {
      lookedAt(LOOKED_AT);
      const plan = savedSince([edit(PLAN_FIELD.PROBLEM, PLAN_ACTOR.NOTETAKER, LOOKED_AT + 1)]);
      const first = open(plan, yield* registryOnTestClock);
      yield* landed;
      first.redraw(plan, true);
      yield* landed;
      yield* TestClock.adjust(PLAN_LOOK);
      yield* landed;
      first.leave();

      assert.deepEqual(changed(open(plan, yield* registryOnTestClock).container), []);
    }),
);

it.effect("a plan left before the look keeps its changes lit for the next visit", () =>
  Effect.gen(function* () {
    lookedAt(LOOKED_AT);
    const plan = savedSince([edit(PLAN_FIELD.PROBLEM, PLAN_ACTOR.NOTETAKER, LOOKED_AT + 1)]);
    const first = open(plan, yield* registryOnTestClock);
    yield* landed;
    yield* TestClock.adjust(Duration.subtract(PLAN_LOOK, Duration.millis(1)));
    yield* landed;
    first.leave();

    const again = open(plan, yield* registryOnTestClock);
    assert.deepEqual(changed(again.container), ["Problem"]);
  }),
);

it.effect(
  "Luke's saves typed in while the plan is open are watched, not changes since the last look, on this visit or the next",
  () =>
    Effect.gen(function* () {
      lookedAt(LOOKED_AT);
      const first = open(PLAN, yield* registryOnTestClock);
      yield* landed;
      const live = savedSince([edit(PLAN_FIELD.PROBLEM, PLAN_ACTOR.NOTETAKER, LOOKED_AT + 1)]);
      first.redraw({
        ...live,
        document: { ...live.document, body: planBody({ name: NAME }, FIELDS).concat("\nMore.") },
      });
      yield* landed;
      assert.deepEqual(changed(first.container), []);
      assert.equal(changedNote(first.container), undefined);
      yield* TestClock.adjust(PLAN_LOOK);
      yield* landed;
      first.leave();

      assert.deepEqual(changed(open(live, yield* registryOnTestClock).container), []);
    }),
);
