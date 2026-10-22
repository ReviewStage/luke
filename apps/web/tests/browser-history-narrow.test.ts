// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { RUN_PROFILE } from "@luke/host/app-state";
import { appStateFirstRead } from "@luke/panel/use-app-state";
import { Effect } from "effect";
import { act } from "react";
import { afterEach, vi } from "vitest";
import {
  addressBar,
  drawPanel,
  installPanelDoors,
  openAt,
  settle,
  travel,
  unmountPanels,
} from "./support/web-panel";

/**
 * On a phone's width the side panel opened over the plan is a step of the
 * tab's own history, shut by the task's Agents view, which the browser's Back shuts and its Forward opens
 * again, without a step of either's own; and the task's header leads with
 * the way back to the page it was opened from, the Tasks page where the tab
 * opened on the task. Its own file, because the panel's state lives as long as the page does, as a tab's
 * does.
 */

/** A task of the fixture run's, which its tasks profile opens with its side panel. */
const FIXTURE_TASK_PATH = "/personal/plan/0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60";

/** A phone's width, narrower than the panel stands two panes side by side at. */
const PHONE_WIDTH = 390;

/** The ⋯ heading the phone's task, whose menu leads with its views. */
function more(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>('.task-head [aria-label="Task actions"]');
  assert.ok(found, "the task's header holds its ⋯");
  return found;
}

/** The ⋯'s menu, opened. */
async function openMenu(): Promise<void> {
  if (more().getAttribute("aria-expanded") !== "true") await act(async () => more().click());
}

/** The phone's task view standing, Plan, Agents, or Activity, as the ⋯'s menu checks it, the menu closed again. */
async function standingView(): Promise<string | undefined> {
  await openMenu();
  const standing = [...document.querySelectorAll('[role="menuitemcheckbox"]')].find(
    (each) => each.getAttribute("aria-checked") === "true",
  )?.textContent;
  await act(async () => more().click());
  return standing ?? undefined;
}

/** The phone's task view named `name` in the ⋯'s menu, opened to press it. */
async function view(name: string): Promise<HTMLElement> {
  await openMenu();
  const found = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
    (each) => each.textContent === name,
  );
  assert.ok(found, `the task's ${name} view stands`);
  return found;
}

/** The way back leading the phone's task's header. */
function back(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(".task-head-back button");
  assert.ok(found, "the task's header leads with its way back");
  return found;
}

afterEach(() => {
  unmountPanels();
  vi.restoreAllMocks();
});

it.effect(
  "on a phone's width Agents and the browser's Back each shut the side panel opened over the plan, as Escape does, without a step of their own, and Forward opens it again",
  () =>
    Effect.gen(function* () {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, PHONE_WIDTH, 800),
      );
      openAt("/app");
      // The tasks profile opens the fixture's task with its side panel over it.
      installPanelDoors(RUN_PROFILE.TASKS);
      yield* appStateFirstRead;
      yield* Effect.promise(async () => {
        await drawPanel();
        const loaded = window.history.length;
        // The panel the tab opened with has no shut step behind it, so Agents takes its step in place.
        const agents = await view("Agents");
        await act(async () => agents.click());
        await settle();
        assert.equal(await standingView(), "Agents");
        assert.equal(addressBar(), FIXTURE_TASK_PATH);
        assert.equal(window.history.length, loaded, "Agents pushes nothing");
        const plan = await view("Plan");
        await act(async () => plan.click());
        await settle();
        const shown = addressBar();
        const entries = window.history.length;

        // Agents steps back to the plan's column as Back does, its traversal awaited so no later travel hears it.
        const shut = await view("Agents");
        await travel(() => shut.click());
        assert.equal(await standingView(), "Agents", "Agents shuts the side panel");
        assert.equal(addressBar(), FIXTURE_TASK_PATH);
        assert.equal(window.history.length, entries, "and pushes nothing");
        await travel(() => window.history.forward());
        assert.equal(addressBar(), shown, "Forward opens it again");

        await travel(() => window.history.back());
        assert.equal(await standingView(), "Agents", "Back shuts the side panel");
        assert.equal(addressBar(), FIXTURE_TASK_PATH);
        assert.equal(window.history.length, entries, "and pushes nothing");

        await travel(() => window.history.forward());
        assert.equal(await standingView(), "Plan", "Forward opens it again");
        assert.equal(addressBar(), shown);

        // Escape is one more way out, which steps back the same way.
        await travel(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
        assert.equal(await standingView(), "Agents", "Escape shuts the side panel");
        assert.equal(addressBar(), FIXTURE_TASK_PATH);
        assert.equal(window.history.length, entries, "and pushes nothing");
      });
    }),
);

it.effect(
  "on a phone's width a task the tab opened on, with no page behind it, leads with the way to the Tasks page, which Back leaves for the task again",
  () =>
    Effect.gen(function* () {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, PHONE_WIDTH, 800),
      );
      openAt("/app");
      installPanelDoors(RUN_PROFILE.TASKS);
      yield* appStateFirstRead;
      yield* Effect.promise(async () => {
        await drawPanel();
        const plan = await view("Plan");
        await act(async () => plan.click());
        await settle();
        assert.equal(back().textContent, "Tasks");
        assert.equal(
          document.querySelector(".desktop-shell > .title-bar-controls"),
          null,
          "the way back stands for the sidebar's toggle and New task",
        );

        await act(async () => back().click());
        await settle();
        assert.equal(document.querySelector(".task-head"), null, "the task is left");
        assert.ok(document.querySelector('[aria-label="Tasks"]'), "for the Tasks page");

        await travel(() => window.history.back());
        assert.equal(addressBar(), FIXTURE_TASK_PATH, "Back opens the task again");
        assert.equal(await standingView(), "Plan");
      });
    }),
);
