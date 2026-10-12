// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { PLAN_ACTOR, type Plan, type PlanSectionEdit } from "@sidecar/hosted/plan-wire";
import { Clock, Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach } from "vitest";
import { captionStripProps } from "#testing/captions";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { DOCUMENT_PLAN } from "#testing/document-plan";
import { navigationHistory } from "#testing/navigation-history";
import { plansControl, versionHistoryControl } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { DesktopShell } from "../desktop/desktop-shell";
import { useSidebarCollapse } from "../desktop/sidebar-collapse";
import { PANEL_TAB } from "../panel-tabs";
import { PlanBody } from "./plan-body";
import { DOCUMENT_REGION, PLANS_PAGE } from "./planning-model";
import { PLAN_LOOK, usePlanLooks } from "./use-plan-looks";

/**
 * Who wrote each section of the open plan, and what changed since the
 * developer last looked at it, through the document as the window draws it.
 * Synthetic plans throughout; the last look is kept where the window keeps
 * it, so a remount is a later visit.
 */

/** When the developer last looked at the plan, on the service's clock. */
const LOOKED_AT = 1_000_000;

const PLAN: Plan = {
  ...DOCUMENT_PLAN,
  updatedAt: LOOKED_AT,
  lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: LOOKED_AT, duringCall: true },
  sectionEdits: [],
};

/** A save that last changed a section of the plan, by its heading. */
function edit(section: string, actor: PlanSectionEdit["actor"], at: number): PlanSectionEdit {
  const label = actor === PLAN_ACTOR.AGENT ? { label: "Command K board" } : undefined;
  return { section, actor, ...label, at, duringCall: actor === PLAN_ACTOR.NOTETAKER };
}

/** The plan with these saves since, the newest of them its last edit. */
function savedSince(edits: readonly PlanSectionEdit[]): Plan {
  const newest = edits.reduce((held, next) => (next.at > held.at ? next : held));
  const { section: _section, ...lastEdit } = newest;
  return { ...PLAN, sectionEdits: edits, lastEdit, updatedAt: newest.at };
}

const STORAGE_KEY = "luke.planLooks";

/** The developer's last look at the plan on this Mac, as an earlier visit kept it. */
function lookedAt(at: number, planId = PLAN.id): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ [planId]: at }));
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
  // The plan's version history stands in the document's place.
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
    const heading = section?.querySelector(".markdown-heading");
    return [heading?.textContent ?? "", byline.textContent ?? ""] as const;
  });
}

/** The heading of each section tinted as changed since the last look. */
function changed(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll(".plan-changed")].map(
    (section) => section.querySelector(".markdown-heading")?.textContent ?? "",
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
  "each section says who last changed it, known by its heading, and a section no save has changed says nothing",
  () =>
    Effect.gen(function* () {
      yield* TestClock.adjust(Duration.days(2));
      const now = yield* Clock.currentTimeMillis;
      const ago = (span: Duration.Input) => now - Duration.toMillis(span);
      const { container } = open(
        {
          ...PLAN,
          sectionEdits: [
            edit("Context", PLAN_ACTOR.NOTETAKER, ago(Duration.hours(2))),
            edit("Goal", PLAN_ACTOR.DEVELOPER, ago(Duration.minutes(5))),
            edit("Approach", PLAN_ACTOR.AGENT, ago(Duration.hours(26))),
            edit("Renamed since", PLAN_ACTOR.NOTETAKER, ago(Duration.minutes(3))),
            edit("Assumptions", PLAN_ACTOR.DEVELOPER, ago(Duration.minutes(1))),
          ],
        },
        yield* registryOnTestClock,
      );
      yield* landed;

      assert.deepEqual(bylines(container), [
        ["Context", "Edited by Luke during your call · 2h ago"],
        ["Goal", "Edited by you · 5m ago"],
        ["Approach", "Edited by Command K board · 1d ago"],
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
          edit("Approach", PLAN_ACTOR.NOTETAKER, LOOKED_AT - 1),
          edit("Context", PLAN_ACTOR.NOTETAKER, LOOKED_AT + 1),
          edit("Goal", PLAN_ACTOR.DEVELOPER, LOOKED_AT + 2),
          edit("Assumptions", PLAN_ACTOR.AGENT, LOOKED_AT + 3),
        ]),
        yield* registryOnTestClock,
      );

      assert.deepEqual(changed(container), ["Context", "Assumptions"]);
      assert.equal(changedNote(container), "Changed since you last looked · 2 sections");
    }),
);

it.effect("Dismiss clears the tint and the count, and the next visit shows nothing changed", () =>
  Effect.gen(function* () {
    lookedAt(LOOKED_AT);
    const plan = savedSince([edit("Context", PLAN_ACTOR.NOTETAKER, LOOKED_AT + 1)]);
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
      savedSince([edit("Context", PLAN_ACTOR.NOTETAKER, LOOKED_AT + 1)]),
      yield* registryOnTestClock,
    );

    assert.deepEqual(changed(container), []);
    assert.equal(changedNote(container), undefined);
  }),
);

it.effect("a plan held open for the look is seen: the next visit shows nothing changed", () =>
  Effect.gen(function* () {
    lookedAt(LOOKED_AT);
    const plan = savedSince([edit("Context", PLAN_ACTOR.NOTETAKER, LOOKED_AT + 1)]);
    const first = open(plan, yield* registryOnTestClock);
    yield* landed;
    yield* TestClock.adjust(PLAN_LOOK);
    yield* landed;
    assert.deepEqual(changed(first.container), ["Context"], "lit for the rest of the visit");
    first.leave();

    const again = open(plan, yield* registryOnTestClock);
    assert.deepEqual(changed(again.container), []);
  }),
);

it.effect(
  "the plan's version history standing in the document's place is still a stay on the plan, and counts toward the look",
  () =>
    Effect.gen(function* () {
      lookedAt(LOOKED_AT);
      const plan = savedSince([edit("Context", PLAN_ACTOR.NOTETAKER, LOOKED_AT + 1)]);
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

/** The window as the shell draws it over the open plan, with the plan's version history standing or not. */
function Window({ plan, versions }: { plan: Plan; versions: boolean }): React.JSX.Element {
  const sidebar = useSidebarCollapse(false);
  const ignore = () => undefined;
  return createElement(DesktopShell, {
    gates: {
      accountRequired: false,
      onBeginSignIn: ignore,
      onCancelSignIn: ignore,
      signInFace: { play: 0 },
    },
    tab: PANEL_TAB.PLANS,
    onTabChange: ignore,
    plans: plansControl({
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: plan.id,
      region: { kind: DOCUMENT_REGION.READY, plan },
      history: versionHistoryControl({ open: versions }),
    }),
    history: navigationHistory(),
    sidebar,
    call: undefined,
    captions: captionStripProps(),
    settings: settingsPanelProps(),
  });
}

it.effect(
  "the plan's version history is a stay on the plan: back from it is the same visit, still lit, and the time spent there counts toward the look",
  () =>
    Effect.gen(function* () {
      lookedAt(LOOKED_AT);
      const plan = savedSince([edit("Context", PLAN_ACTOR.NOTETAKER, LOOKED_AT + 1)]);
      const registry = yield* registryOnTestClock;
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      const draw = (versions: boolean) =>
        act(() => root.render(onRegistry(registry, createElement(Window, { plan, versions }))));
      draw(false);
      yield* landed;
      assert.deepEqual(changed(container), ["Context"]);

      draw(true);
      yield* landed;
      yield* TestClock.adjust(PLAN_LOOK);
      yield* landed;
      draw(false);
      yield* landed;
      assert.deepEqual(changed(container), ["Context"]);
      act(() => root.unmount());
      roots.splice(roots.indexOf(root), 1);

      assert.deepEqual(changed(open(plan, registry).container), []);
    }),
);

it.effect("a plan left before the look keeps its changes lit for the next visit", () =>
  Effect.gen(function* () {
    lookedAt(LOOKED_AT);
    const plan = savedSince([edit("Context", PLAN_ACTOR.NOTETAKER, LOOKED_AT + 1)]);
    const first = open(plan, yield* registryOnTestClock);
    yield* landed;
    yield* TestClock.adjust(Duration.subtract(PLAN_LOOK, Duration.millis(1)));
    yield* landed;
    first.leave();

    const again = open(plan, yield* registryOnTestClock);
    assert.deepEqual(changed(again.container), ["Context"]);
  }),
);

it.effect(
  'a section\'s "Edited by" opens the version history on the save it names, and opens no editor',
  () =>
    Effect.gen(function* () {
      const at = LOOKED_AT + 1;
      const shown: (number | undefined)[] = [];
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      const plan = savedSince([edit("Goal", PLAN_ACTOR.NOTETAKER, at)]);
      const onShowHistory = (save: number | undefined) => shown.push(save);
      const onEdit = () => Promise.resolve({ saved: true } as const);
      const body = createElement(PlanBody, { plan, live: false, onEdit, onShowHistory });
      const registry = yield* registryOnTestClock;
      act(() => root.render(onRegistry(registry, body)));
      const line = container.querySelector<HTMLButtonElement>("button.plan-unit-byline");
      assert.ok(line, "the section's line is a button");

      assert.match(
        line.getAttribute("aria-label") ?? "",
        /^Goal: Edited by Luke during your call · .+\. Show version history$/u,
      );
      act(() => line.click());
      assert.deepEqual(shown, [at]);
      assert.equal(container.querySelector(".plan-document-editor"), null, "no editor opened");
    }),
);

it.effect(
  "Luke's saves typed in while the plan is open are watched, not changes since the last look, on this visit or the next",
  () =>
    Effect.gen(function* () {
      lookedAt(LOOKED_AT);
      const first = open(PLAN, yield* registryOnTestClock);
      yield* landed;
      const live = savedSince([edit("Context", PLAN_ACTOR.NOTETAKER, LOOKED_AT + 1)]);
      first.redraw({
        ...live,
        document: { ...live.document, body: `${live.document.body}More.\n` },
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
