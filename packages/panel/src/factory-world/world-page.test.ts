// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  FACTORY_WORLD_CALL_FAILURE,
  type FactoryWorldView as FactoryWorldAnswer,
} from "@luke/features/factory-world-view";
import type { FactoryWorld } from "@luke/features/factory-world-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, type Act } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  areaOf,
  DAY_MS,
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
import { Clock, Context, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { runAppCommand, useAppCommand } from "../app-commands.js";
import { rendererRuntime } from "../renderer-runtime.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { WORLD_LAYER } from "./world.js";
import { FactoryWorldPage } from "./world-page.js";

/**
 * world-page.test.ts -- the Factory page over the campus: the snapshot read for the listed workspace and read again while it stands, its loading, empty, and failed states, and the chrome over the campus, the pipeline bar's layers, the hover label, the card and its doors, and Esc stepping back to the overview before it leaves.
 *
 * The service is a script at the act boundary; the snapshot is synthetic;
 * jsdom lays nothing out, so the campus draws at its first scale.
 */

const WORKSPACE: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

const TASK: TaskSummary = {
  id: uuidOf(50),
  workspaceId: WORKSPACE.id,
  name: "Invites",
  createdAt: FACTORY_NOW - DAY_MS,
  updatedAt: FACTORY_NOW,
  repository: "acme/factory",
};
const AGENT_ID = uuidOf(1);

const PULL_REQUEST = factoryPullRequestOf({
  number: 3501,
  title: "feat(web): invite a teammate",
  areas: [areaOf("apps/web", 120)],
});
const EARLIER_MERGE = factoryShippedOf(3400, FACTORY_NOW - 2 * DAY_MS, {
  title: "fix(core): keep the ledger",
  areas: [areaOf("packages/core", 40)],
});
const LATER_MERGE = factoryShippedOf(3450, FACTORY_NOW - HOUR_MS, {
  title: "feat(desktop): draw the world",
  areas: [areaOf("apps/desktop", 300)],
});

/** A repository of a core two apps depend on, one agent building in the web app, two merges, and an issue planned. */
const WORLD: FactoryWorld = factoryWorldOf({
  zones: [
    factoryZoneOf("packages/core", [], { label: "@acme/core", files: 12 }),
    factoryZoneOf("apps/web", ["packages/core"]),
    factoryZoneOf("apps/desktop", ["packages/core"]),
  ],
  agents: [factoryAgentOf(1, { title: "Invites", taskId: TASK.id, pullRequest: PULL_REQUEST })],
  shipped: [LATER_MERGE, EARLIER_MERGE],
  planned: [factoryPlannedOf(1, { title: "Invite by link" })],
});

let root: Root | undefined;
/** How the next reads of the world answer, in order; the world itself once they are spent. */
let answers: FactoryWorldAnswer[] = [];
/** Every workspace whose world was read, in order. */
let asked: string[] = [];
/** Every door the card opened, in order. */
let opened: string[] = [];
/** How many times Esc reached past the campus to leave Factory. */
let left = 0;

beforeEach(() => {
  answers = [];
  asked = [];
  opened = [];
  left = 0;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  fakeAppBridge({
    act: (request: Act) => {
      throw new Error(`unexpected ${request.kind}`);
    },
  });
  fakeActPort({
    [ACT_KIND.FACTORY_WORLD]: (payload) => {
      asked.push(payload.workspaceId);
      return Promise.resolve(answers.shift() ?? { world: WORLD });
    },
  });
});

afterEach(() => {
  pointed = undefined;
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The control the page is drawn over: the workspace and its task listed, on screen, and every door recorded. */
function control(patch: Partial<TasksControl> = {}): TasksControl {
  const base = tasksControl();
  return tasksControl({
    tasks: [TASK],
    workspace: WORKSPACE,
    shown: true,
    onSelect: (taskId) => opened.push(`task ${taskId}`),
    onShowAgent: (taskId, agentId) => opened.push(`agent ${agentId} of ${taskId}`),
    agentView: { ...base.agentView, onOpen: (agentId) => opened.push(`agent ${agentId}`) },
    repositories: { ...base.repositories, openGitHub: (url) => opened.push(url) },
    ...patch,
  });
}

/** The page as Factory draws it, its Esc offered as Factory offers it: a step back toward the overview, else out. */
function Page({ tasks }: { tasks: TasksControl }): React.JSX.Element {
  const backOut = useRef<(() => boolean) | undefined>(undefined);
  useAppCommand(APP_COMMAND.EXIT_FACTORY, () => {
    if (backOut.current?.() !== true) left += 1;
  });
  return createElement(FactoryWorldPage, { tasks, backOut });
}

/** Draws the page over `registry`, answering the redraw that draws it again with another control. */
function mount(tasks = control(), registry = AtomRegistry.make()) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const draw = (drawn: TasksControl) =>
    act(() => root?.render(onRegistry(registry, createElement(Page, { tasks: drawn }))));
  draw(tasks);
  return { page: container, redraw: draw };
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

function button(page: HTMLElement, name: string): HTMLButtonElement {
  const found = [...page.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === name || each.getAttribute("aria-label") === name,
  );
  assert.ok(found, `no button ${name}`);
  return found;
}

function campus(page: HTMLElement): SVGSVGElement {
  const found = page.querySelector<SVGSVGElement>(".factory-campus-scene");
  assert.ok(found, "the campus stands");
  return found;
}

function press(element: Element | null | undefined): void {
  assert.ok(element, "something to press");
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

/** The radio group of the layers. */
function layers(page: HTMLElement): HTMLElement {
  const found = page.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Layers"]');
  assert.ok(found, "the layers are a radio group");
  return found;
}

/** The pipeline bar as a reader scans it: each stage's words, and whether it is the one chosen. */
function pipeline(page: HTMLElement): string[] {
  return [...layers(page).querySelectorAll<HTMLElement>('[role="radio"]')].map(
    (stage) =>
      `${stage.textContent}${stage.getAttribute("aria-checked") === "true" ? " (chosen)" : ""}`,
  );
}

/** The stage of the layer named `name`. */
function stage(page: HTMLElement, name: string): HTMLButtonElement {
  const found = [...layers(page).querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (each) => each.textContent?.startsWith(name),
  );
  assert.ok(found, `no stage ${name}`);
  return found;
}

/** The layers the campus draws, by name: those it does not hide. */
function drawn(page: HTMLElement): string[] {
  const svg = campus(page);
  return Object.values(WORLD_LAYER).filter((layer) => !svg.hasAttribute(`data-hide-${layer}`));
}

let pointed: Element | undefined;

/** The pointer moving from where it was to a stage, to another part of the bar (a gap between stages), or off the bar onto the page. */
function pointTo(page: HTMLElement, to: Element | undefined): void {
  const target = to ?? page;
  act(() => {
    pointed?.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: target }));
    target.dispatchEvent(
      new MouseEvent("pointerover", { bubbles: true, relatedTarget: pointed ?? page }),
    );
  });
  pointed = to;
}

/** The container at the gate holding the agent's pull request. */
function gateContainer(page: HTMLElement): Element | null {
  return page.querySelector('[aria-label="Pull request #3501: 120 additions, 0 deletions"]');
}

test("the listed workspace's world is read as the page opens, and the campus is drawn over it with the pipeline bar counting it", async () => {
  const { page } = mount();
  await settle();
  assert.deepEqual(asked, [WORKSPACE.id]);
  assert.ok(campus(page));
  assert.deepEqual(pipeline(page), ["Planned1", "Building1", "Shipped2", "Defects0"]);
  assert.equal(page.querySelector('input[aria-label="Time"]'), null, "no clock winds it back");
});

test("until the world is read only a wait stands; a workspace with no repository says so; a read that failed says so, and Retry reads it again", async () => {
  answers = [{ world: null }];
  const empty = mount();
  assert.equal(
    empty.page.querySelector(".factory-world-stage"),
    null,
    "nothing drawn before the read",
  );
  await settle();
  assert.match(empty.page.textContent ?? "", /No repository to draw yet/u);
  assert.equal(empty.page.querySelector(".factory-campus-scene"), null);
  act(() => root?.unmount());

  answers = [{ failure: FACTORY_WORLD_CALL_FAILURE.UNANSWERED }];
  const failed = mount();
  await settle();
  assert.match(failed.page.textContent ?? "", /The world could not be read\./u);
  act(() => button(failed.page, "Retry").click());
  await settle();
  assert.equal(asked.length, 3);
  assert.ok(failed.page.querySelector(".factory-world-pipeline"), "the campus stands once read");
});

test("a press on an agent's pull request selects the agent: the card names its pull request and lines, lights its blast radius, and opens its page, its pull request on GitHub, and its task", async () => {
  const { page } = mount();
  await settle();
  press(gateContainer(page));
  const card = page.querySelector(".factory-world-card");
  assert.ok(card, "the card stands");
  assert.match(card.textContent ?? "", /feat\(web\): invite a teammate/u);
  assert.match(card.textContent ?? "", /Working · #3501/u);
  assert.match(card.textContent ?? "", /\+120/u);
  assert.match(card.textContent ?? "", /1 touched/u);

  act(() => button(page, "Open agent").click());
  act(() => button(page, "#3501").click());
  act(() => button(page, "Open task").click());
  assert.deepEqual(opened, [
    `agent ${AGENT_ID} of ${TASK.id}`,
    PULL_REQUEST.url,
    `task ${TASK.id}`,
  ]);

  // A press on nothing lets the selection go.
  press(campus(page));
  assert.equal(page.querySelector(".factory-world-card"), null);
});

test("Esc steps back to the overview from a selection, and leaves Factory only from there; the home button takes the same step", async () => {
  const { page } = mount();
  await settle();
  assert.equal(page.querySelector(".factory-world-home"), null, "home stands only away from it");

  press(gateContainer(page));
  assert.ok(page.querySelector(".factory-world-home"));
  act(() => {
    runAppCommand(APP_COMMAND.EXIT_FACTORY);
  });
  assert.equal(page.querySelector(".factory-world-card"), null);
  assert.equal(page.querySelector(".factory-world-home"), null);
  assert.equal(left, 0);

  act(() => {
    runAppCommand(APP_COMMAND.EXIT_FACTORY);
  });
  assert.equal(left, 1, "from the overview, Esc leaves");

  press(gateContainer(page));
  act(() => button(page, "Overview").click());
  assert.equal(page.querySelector(".factory-world-card"), null);
  assert.equal(page.querySelector(".factory-world-home"), null);
});

test("the pointer resting on a building names its task in the label, and leaving the campus takes the label down", async () => {
  const { page } = mount();
  await settle();
  const building = page.querySelector(".factory-campus-building");
  assert.ok(building);
  act(() => building.dispatchEvent(new MouseEvent("pointermove", { bubbles: true })));
  // Note that the campus reads a hover once a frame.
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const label = page.querySelector(".factory-world-label");
  assert.ok(label);
  assert.match(label.textContent ?? "", /Invites/u);
  act(() =>
    building.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: page })),
  );
  assert.ok(page.querySelector(".factory-world-label") === null, "the label is taken down");
});

test("the pointer resting on a stage of the pipeline bar draws its layer alone, and leaving the bar draws every layer again", async () => {
  const { page } = mount();
  await settle();
  assert.deepEqual(drawn(page), ["planned", "building", "shipped", "defects"]);
  pointTo(page, stage(page, "Shipped"));
  assert.deepEqual(drawn(page), ["shipped"]);
  pointTo(page, stage(page, "Planned"));
  assert.deepEqual(drawn(page), ["planned"]);
  pointTo(page, undefined);
  assert.deepEqual(drawn(page), ["planned", "building", "shipped", "defects"]);
  assert.deepEqual(pipeline(page), ["Planned1", "Building1", "Shipped2", "Defects0"]);
});

test("the layers are a radio group whose press keeps a layer alone until it is pressed again, and another stage's press moves it there", async () => {
  const { page } = mount();
  await settle();
  act(() => stage(page, "Shipped").click());
  pointTo(page, undefined);
  assert.deepEqual(pipeline(page), ["Planned1", "Building1", "Shipped2 (chosen)", "Defects0"]);
  assert.deepEqual(drawn(page), ["shipped"]);
  // Note that resting on another stage previews it, and leaving goes back to the one chosen.
  pointTo(page, stage(page, "Building"));
  assert.deepEqual(drawn(page), ["building"]);
  pointTo(page, undefined);
  assert.deepEqual(drawn(page), ["shipped"]);
  act(() => stage(page, "Building").click());
  assert.deepEqual(pipeline(page), ["Planned1", "Building1 (chosen)", "Shipped2", "Defects0"]);
  assert.deepEqual(drawn(page), ["building"]);
  act(() => stage(page, "Building").click());
  assert.deepEqual(pipeline(page), ["Planned1", "Building1", "Shipped2", "Defects0"]);
  assert.deepEqual(drawn(page), ["planned", "building", "shipped", "defects"]);
});

test("the pointer leaving a stage for a gap in the bar ends that stage's preview", async () => {
  const { page } = mount();
  await settle();
  pointTo(page, stage(page, "Shipped"));
  assert.deepEqual(drawn(page), ["shipped"]);
  pointTo(page, layers(page));
  assert.deepEqual(drawn(page), ["planned", "building", "shipped", "defects"]);
  pointTo(page, undefined);
});

test("the pointer leaving the bar leaves the keyboard's preview standing, and the pointer's comes first while both rest", async () => {
  const { page } = mount();
  await settle();
  act(() => stage(page, "Defects").focus());
  pointTo(page, stage(page, "Planned"));
  assert.deepEqual(drawn(page), ["planned"]);
  pointTo(page, undefined);
  assert.deepEqual(drawn(page), ["defects"]);
});

test("the keyboard on a stage previews its layer as the pointer does, and leaving the bar draws every layer again", async () => {
  const { page } = mount();
  await settle();
  act(() => stage(page, "Planned").focus());
  assert.deepEqual(drawn(page), ["planned"]);
  act(() => stage(page, "Defects").focus());
  assert.deepEqual(drawn(page), ["defects"]);
  act(() => stage(page, "Defects").blur());
  assert.deepEqual(drawn(page), ["planned", "building", "shipped", "defects"]);
});

test("the layers are one tab stop, and the arrows move the choice along it, drawing the layer they land on", async () => {
  const { page } = mount();
  await settle();
  const stops = () =>
    [...layers(page).querySelectorAll<HTMLElement>('[role="radio"]')].filter(
      (each) => each.tabIndex === 0,
    );
  assert.deepEqual(
    stops().map((each) => each.textContent),
    ["Planned1"],
  );
  act(() => stage(page, "Planned").focus());
  act(() => {
    stage(page, "Planned").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  assert.deepEqual(pipeline(page), ["Planned1", "Building1 (chosen)", "Shipped2", "Defects0"]);
  assert.equal(document.activeElement, stage(page, "Building"));
  assert.deepEqual(drawn(page), ["building"]);
  assert.deepEqual(
    stops().map((each) => each.textContent),
    ["Building1"],
  );
});

test("an arrow moving the choice leaves the preview of the stage the pointer rests on standing", async () => {
  const { page } = mount();
  await settle();
  act(() => stage(page, "Shipped").focus());
  pointTo(page, stage(page, "Planned"));
  act(() => {
    stage(page, "Shipped").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  assert.deepEqual(pipeline(page), ["Planned1", "Building1", "Shipped2", "Defects0 (chosen)"]);
  assert.deepEqual(drawn(page), ["planned"]);
  pointTo(page, undefined);
  assert.deepEqual(drawn(page), ["defects"]);
});

/** A registry whose runtime reads `clock`, so the page's minute moves on the test's own time. */
function registryOn(clock: Clock.Clock): AtomRegistry.AtomRegistry {
  return AtomRegistry.make({
    initialValues: [[rendererRuntime, AsyncResult.success(Context.make(Clock.Clock, clock))]],
  });
}

it.effect(
  "the world is read again every three minutes it stands on screen, and not while it is off screen",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.now());
      const { redraw } = mount(control(), registryOn(yield* Clock.Clock));
      yield* Effect.promise(settle);
      assert.equal(asked.length, 1);
      yield* TestClock.adjust("2 minutes");
      yield* Effect.promise(settle);
      assert.equal(asked.length, 1, "not yet");
      yield* TestClock.adjust("1 minute");
      yield* Effect.promise(settle);
      assert.equal(asked.length, 2, "read again at three minutes");
      redraw(control({ shown: false }));
      yield* TestClock.adjust("6 minutes");
      yield* Effect.promise(settle);
      assert.equal(asked.length, 2, "nothing read off screen");
    }),
);
