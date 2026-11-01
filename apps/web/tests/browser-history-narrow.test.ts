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
 * On a phone's width the side panel opened over the task's Overview is a step of the
 * tab's own history, shut by the task's Overview view, which the browser's Back shuts and its Forward opens
 * again, without a step of either's own; and the task's header leads with
 * the way back to the page it was opened from, the Tasks page where the tab
 * opened on the task. Its own file, because the panel's state lives as long as the page does, as a tab's
 * does.
 */

/** A task of the fixture run's, which its tasks profile opens on its Overview. */
const FIXTURE_TASK_PATH = "/personal/plan/0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60";

/** A phone's width, narrower than the panel stands two panes side by side at. */
const PHONE_WIDTH = 390;

/** The phone's task views under its header: Overview, its agent, and Activity, in that order. */
function views(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[aria-label="Task views"] [role="radio"]')];
}

/** Where each view the tests name stands in the row, its middle one named for the task's agent. */
const VIEW_AT = { Overview: 0, Agents: 1, Activity: 2 } as const;

/** The phone's task view standing, Overview, Agents, or Activity, as the row of views checks it. */
async function standingView(): Promise<string | undefined> {
  await act(async () => undefined);
  const at = views().findIndex((each) => each.getAttribute("aria-checked") === "true");
  return Object.entries(VIEW_AT).find(([, index]) => index === at)?.[0];
}

/** The phone's task view named `name` in the row of views, to press it. */
async function view(name: keyof typeof VIEW_AT): Promise<HTMLElement> {
  const found = views()[VIEW_AT[name]];
  assert.ok(found, `the task's ${name} view stands`);
  return found;
}

/** The way back leading the phone's task's header. */
function back(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(".task-head .luke-toolbar-lead button");
  assert.ok(found, "the task's header leads with its way back");
  return found;
}

afterEach(() => {
  unmountPanels();
  vi.restoreAllMocks();
});

it.effect(
  "on a phone's width Overview and the browser's Back each shut the side panel opened over the plan, as Escape does, without a step of their own, and Forward opens it again",
  () =>
    Effect.gen(function* () {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, PHONE_WIDTH, 800),
      );
      openAt("/app");
      // The tasks profile opens the fixture's task on its Overview, its side panel shut.
      installPanelDoors(RUN_PROFILE.TASKS);
      yield* appStateFirstRead;
      yield* Effect.promise(async () => {
        await drawPanel();
        assert.equal(await standingView(), "Overview");
        assert.equal(addressBar(), FIXTURE_TASK_PATH);
        // Activity opens the panel on its list, which opens the plan's Comments over the Overview.
        const activity = await view("Activity");
        await act(async () => activity.click());
        await settle();
        const comments = [
          ...document.querySelectorAll<HTMLElement>(".side-panel-activity .luke-list-row-main"),
        ].find((each) => each.textContent?.includes("Comments"));
        assert.ok(comments, "Activity offers the plan's Comments");
        await act(async () => comments.click());
        await settle();
        const shown = addressBar();
        const entries = window.history.length;

        // Overview steps back to the column as Back does, its traversal awaited so no later travel hears it.
        const shut = await view("Overview");
        await travel(() => shut.click());
        assert.equal(await standingView(), "Overview", "Overview shuts the side panel");
        assert.equal(addressBar(), FIXTURE_TASK_PATH);
        assert.equal(window.history.length, entries, "and pushes nothing");
        await travel(() => window.history.forward());
        assert.equal(addressBar(), shown, "Forward opens it again");

        await travel(() => window.history.back());
        assert.equal(await standingView(), "Overview", "Back shuts the side panel");
        assert.equal(addressBar(), FIXTURE_TASK_PATH);
        assert.equal(window.history.length, entries, "and pushes nothing");

        await travel(() => window.history.forward());
        assert.equal(await standingView(), "Activity", "Forward opens it again");
        assert.equal(addressBar(), shown);

        // Escape is one more way out, which steps back the same way.
        await travel(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
        assert.equal(await standingView(), "Overview", "Escape shuts the side panel");
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
        assert.equal(await standingView(), "Overview");
        assert.equal(back().textContent, "Tasks");

        await act(async () => back().click());
        await settle();
        assert.equal(document.querySelector(".task-head"), null, "the task is left");
        assert.ok(document.querySelector('[aria-label="Tasks"]'), "for the Tasks page");

        await travel(() => window.history.back());
        assert.equal(addressBar(), FIXTURE_TASK_PATH, "Back opens the task again");
        assert.equal(await standingView(), "Overview");
      });
    }),
);
