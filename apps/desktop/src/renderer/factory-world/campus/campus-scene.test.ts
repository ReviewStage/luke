// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import type { FactoryWorld } from "@luke/features/factory-world-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  areaOf,
  FACTORY_NOW,
  factoryAgentOf,
  factoryPlannedOf,
  factoryPullRequestOf,
  factoryShippedOf,
  factoryWorldOf,
  factoryZoneOf,
  HOUR_MS,
  uuidOf,
} from "@luke/ui/testing";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { onRegistry } from "#testing/copy-feedback";
import { onSideBundles } from "#testing/side-bundles";
import { tasksControl } from "#testing/tasks-control";
import { runAppCommand, useAppCommand } from "../../app-commands";
import { sideBundles } from "../../bundle-loader";
import type { TasksControl } from "../../tasks/use-tasks-tab";
import { FactoryWorldPage } from "../world-page";

/**
 * campus-scene.test.ts -- the campus as the Factory page draws it: a building for each listed task of the snapshot's repository and a container for each open pull request, with no Three.js loaded; a press on a building opening its card and its door to the task; a layer switched off hidden; the Town and Districts layouts; motion held still; and Esc stepping back before it leaves.
 *
 * The service is a script at the act boundary and the snapshot synthetic;
 * jsdom lays nothing out, so the campus draws at its first scale.
 */

const WORKSPACE: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

function taskOf(n: number, name: string, repository: string | null = "acme/factory"): TaskSummary {
  return {
    id: uuidOf(100 + n),
    workspaceId: WORKSPACE.id,
    name,
    createdAt: FACTORY_NOW - (10 - n) * HOUR_MS,
    updatedAt: FACTORY_NOW,
    repository,
  };
}

const INVITES = taskOf(1, "Invite your teammates");
const SEARCH = taskOf(2, "Improve search ranking");
const ELSEWHERE = taskOf(3, "Another repository's task", "acme/other");
const SHIPPED = taskOf(4, "Polish empty states");

/** A web app over a core: an agent at work on invites with its pull request open, one on search going up, a merge, and an issue planned. */
const WORLD: FactoryWorld = factoryWorldOf({
  zones: [factoryZoneOf("packages/core"), factoryZoneOf("apps/web", ["packages/core"])],
  agents: [
    factoryAgentOf(1, {
      taskId: INVITES.id,
      status: CODING_AGENT_STATUS.COMPLETED,
      pullRequest: factoryPullRequestOf({
        number: 3501,
        checks: CHECK_SUMMARY.FAILING,
        areas: [areaOf("apps/web", 300)],
      }),
    }),
    factoryAgentOf(2, { taskId: SEARCH.id }),
  ],
  shipped: [
    factoryShippedOf(3400, FACTORY_NOW - HOUR_MS, {
      taskId: SHIPPED.id,
      areas: [areaOf("packages/core", 40)],
    }),
  ],
  planned: [factoryPlannedOf(1, { title: "Invite by link", zonePaths: ["apps/web"] })],
});

let root: Root | undefined;
let opened: string[] = [];
let left = 0;
let sceneLoads = 0;
let reducedMotion = false;

beforeEach(() => {
  opened = [];
  left = 0;
  sceneLoads = 0;
  reducedMotion = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: reducedMotion && query.includes("reduced-motion"),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  fakeAppBridge({
    act: (request: Act) => {
      if (request.kind !== ACT_KIND.FACTORY_WORLD) throw new Error(`unexpected ${request.kind}`);
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { world: WORLD } });
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function Page({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  const backOut = useRef<(() => boolean) | undefined>(undefined);
  useAppCommand(APP_COMMAND.EXIT_FACTORY, () => {
    if (backOut.current?.() !== true) left += 1;
  });
  return createElement(FactoryWorldPage, { tasks, scene: { campus: true }, backOut });
}

/** Draws the campus, its Three.js scene's importer counting every load it is asked for. */
async function mount(): Promise<HTMLElement> {
  const tasks = tasksControl({
    tasks: [INVITES, SEARCH, ELSEWHERE, SHIPPED],
    workspace: WORKSPACE,
    shown: true,
    onSelect: (taskId) => opened.push(`task ${taskId}`),
  });
  const bundles = sideBundles({
    factoryScene: () => {
      sceneLoads += 1;
      return Promise.withResolvers<never>().promise;
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(AtomRegistry.make(), onSideBundles(bundles, createElement(Page, { tasks }))),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return container;
}

function labels(page: HTMLElement, selector: string): string[] {
  return [...page.querySelectorAll(selector)].map((each) => each.getAttribute("aria-label") ?? "");
}

function press(element: Element | null | undefined): void {
  assert.ok(element, "something to press");
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function button(page: HTMLElement, name: string): HTMLButtonElement {
  const found = [...page.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === name || each.getAttribute("aria-label") === name,
  );
  assert.ok(found, `no button ${name}`);
  return found;
}

function scene(page: HTMLElement): SVGSVGElement {
  const found = page.querySelector<SVGSVGElement>(".factory-campus-scene");
  assert.ok(found, "the campus stands");
  return found;
}

test("the campus stands a building for each listed task of the snapshot's repository and a container for each open pull request and merge, and loads no Three.js", async () => {
  const page = await mount();
  assert.deepEqual(labels(page, ".factory-campus-building").sort(), [
    "Improve search ranking: at work",
    "Invite your teammates: waiting on you",
    "Polish empty states: shipped",
  ]);
  assert.deepEqual(labels(page, ".factory-campus-container").sort(), [
    "Pull request #3400: 40 additions, 0 deletions",
    "Pull request #3501: 300 additions, 0 deletions",
  ]);
  assert.deepEqual(labels(page, ".factory-campus-blueprint"), ["Planned: ENG-1, Invite by link"]);
  assert.match(page.textContent ?? "", /Merge gate/u);
  assert.match(page.textContent ?? "", /Shipped since /u);
  assert.equal(sceneLoads, 0, "the campus never asks for the Three.js scene");
});

test("a press on a building opens it: its card names the task, lights its blast radius, and opens the task", async () => {
  const page = await mount();
  press(page.querySelector('[aria-label="Invite your teammates: waiting on you"]'));
  const card = page.querySelector(".factory-world-card");
  assert.ok(card, "the card stands");
  assert.match(card.textContent ?? "", /Invite your teammates/u);
  assert.match(card.textContent ?? "", /Waiting on you · 1 agent/u);
  assert.match(card.textContent ?? "", /1 touched/u);
  assert.ok(
    page.querySelector(".factory-campus-building[data-open] .factory-campus-inside"),
    "only the open building draws its inside",
  );
  assert.equal(page.querySelectorAll(".factory-campus-inside").length, 1);
  act(() => button(page, "Open task").click());
  assert.deepEqual(opened, [`task ${INVITES.id}`]);
});

test("a press on a container at the gate selects its agent's pull request", async () => {
  const page = await mount();
  press(page.querySelector('[aria-label="Pull request #3501: 300 additions, 0 deletions"]'));
  assert.match(page.querySelector(".factory-world-card")?.textContent ?? "", /#3501/u);
});

test("a layer switched off is hidden on the campus without drawing it again, and switched on stands again", async () => {
  const page = await mount();
  const shippedChip = page.querySelector('.factory-world-pipeline [data-layer="shipped"]');
  const building = page.querySelector(".factory-campus-building");
  press(shippedChip);
  assert.ok(scene(page).hasAttribute("data-hide-shipped"));
  assert.equal(
    page.querySelector(".factory-campus-building"),
    building,
    "the buildings were not drawn again",
  );
  press(shippedChip);
  assert.equal(scene(page).hasAttribute("data-hide-shipped"), false);
});

test("Districts stand each zone with something in it as a district, and Town lays the plots out without them", async () => {
  const page = await mount();
  assert.deepEqual(labels(page, ".factory-campus-district").sort(), [
    "Not in code yet",
    "core district",
    "web district",
  ]);
  act(() => page.querySelector<HTMLElement>('[role="radio"][aria-checked="false"]')?.click());
  assert.equal(page.querySelectorAll(".factory-campus-district").length, 0);
  assert.equal(page.querySelectorAll(".factory-campus-building").length, 3);
  act(() => page.querySelector<HTMLElement>('[role="radio"][aria-checked="false"]')?.click());
  assert.equal(page.querySelectorAll(".factory-campus-district").length, 3);
});

test("held still, a working building's smoke stands rather than loops", async () => {
  const moving = await mount();
  assert.ok(moving.querySelector(".factory-campus-smoke"), "smoke loops while motion runs");
  act(() => root?.unmount());
  reducedMotion = true;
  const still = await mount();
  assert.equal(still.querySelector(".factory-campus-smoke"), null);
  assert.ok(
    still.querySelector('.factory-campus-sign[data-layer="building"] circle'),
    "the smoke still stands",
  );
});

test("Esc closes an open building first, and leaves Factory only from the overview", async () => {
  const page = await mount();
  press(page.querySelector(".factory-campus-building"));
  assert.ok(page.querySelector(".factory-world-card"));
  act(() => runAppCommand(APP_COMMAND.EXIT_FACTORY));
  assert.equal(page.querySelector(".factory-world-card"), null);
  assert.equal(left, 0);
  act(() => runAppCommand(APP_COMMAND.EXIT_FACTORY));
  assert.equal(left, 1);
});

test("a shipped task's card says shipped, as its building does", async () => {
  const page = await mount();
  press(page.querySelector('[aria-label="Polish empty states: shipped"]'));
  assert.match(page.querySelector(".factory-world-card")?.textContent ?? "", /Shipped · 0 agents/u);
});

test("a press that leaves the campus before it drags, and is let go outside, never pans it once the pointer comes back", async () => {
  const page = await mount();
  const svg = scene(page);
  const camera = page.querySelector<SVGGElement>(".factory-campus-camera");
  const before = camera?.style.transform;
  const pointer = (type: string, x: number, buttons: number) =>
    act(() =>
      svg.dispatchEvent(
        new MouseEvent(type, { bubbles: true, clientX: x, clientY: 10, button: 0, buttons }),
      ),
    );
  pointer("pointerdown", 10, 1);
  pointer("pointerout", 12, 1);
  act(() => svg.dispatchEvent(new MouseEvent("pointerleave", { clientX: 12, clientY: 10 })));
  pointer("pointermove", 200, 0);
  assert.equal(camera?.style.transform, before);
});
