// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  FACTORY_WORLD_CALL_FAILURE,
  type FactoryWorldView as FactoryWorldAnswer,
} from "@luke/features/factory-world-view";
import type { FactoryWorld } from "@luke/features/factory-world-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
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
import { FlaskConicalIcon } from "lucide-react";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { runAppCommand, useAppCommand } from "../app-commands.js";
import { type SideBundles, sideBundles, worldBundleAtom } from "../bundle-loader.js";
import { rendererRuntime } from "../renderer-runtime.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { bundleLanded, landedBundles, onSideBundles } from "../testing/side-bundles.js";
import { tasksControl } from "../testing/tasks-control.js";
import type { FactorySceneModule, FactorySceneProps, SceneHover } from "./contract.js";
import type { WorldEntry } from "./registry.js";
import { PICK_KIND, type WorldModule, type WorldState } from "./world.js";
import { FactoryWorldPage } from "./world-page.js";

/**
 * world-page.test.ts -- a Factory world as the page draws it over a stand-in scene: the snapshot read for the listed workspace and read again while it stands, its loading, empty, and failed states, and the chrome every world shares, the pipeline bar's layers, the hover label, the card and its doors, and Esc stepping back to the overview before it leaves.
 *
 * The scene bundle is a stand-in recording what the page hands it, since
 * jsdom has no WebGL; the service is a script at the act boundary; the
 * snapshot is synthetic.
 */

const WORKSPACE: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

const TASK_ID = uuidOf(50);
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
  agents: [factoryAgentOf(1, { title: "Invites", taskId: TASK_ID, pullRequest: PULL_REQUEST })],
  shipped: [LATER_MERGE, EARLIER_MERGE],
  planned: [factoryPlannedOf(1, { title: "Invite by link" })],
});

/** A world no scene ever creates: the stand-in scene hands it nothing. */
const STAND_IN_WORLD: WorldModule = {
  create: () => ({ update: () => undefined, dispose: () => undefined }),
};

const ENTRY: WorldEntry = {
  key: "stand-in",
  name: "Stand-in",
  icon: FlaskConicalIcon,
  load: () => Promise.resolve({ world: STAND_IN_WORLD }),
};

/** What the stand-in scene was handed: the props it mounted with, each state after, and each call. */
interface Scene {
  props: FactorySceneProps | undefined;
  states: WorldState[];
  homes: number;
  shown: boolean[];
  unmounts: number;
}

let scene: Scene;
let bundles: SideBundles;
let root: Root | undefined;
/** How the next reads of the world answer, in order; the world itself once they are spent. */
let answers: FactoryWorldAnswer[] = [];
/** Every workspace whose world was read, in order. */
let asked: string[] = [];
/** Every door the card opened, in order. */
let opened: string[] = [];
/** How many times Esc reached past the world to leave Factory. */
let left = 0;

const STAND_IN_SCENE: FactorySceneModule = {
  mount: (_element, props) => {
    scene.props = props;
    scene.states.push(props.state);
    return {
      show: (state) => scene.states.push(state),
      setShown: (shown) => scene.shown.push(shown),
      home: () => {
        scene.homes += 1;
      },
      unmount: () => {
        scene.unmounts += 1;
      },
    };
  },
};

beforeAll(async () => {
  bundles = await Effect.runPromise(
    landedBundles({ factoryScene: () => Promise.resolve(STAND_IN_SCENE) }),
  );
  await Effect.runPromise(bundleLanded(worldBundleAtom(ENTRY.load)));
});

beforeEach(() => {
  scene = { props: undefined, states: [], homes: 0, shown: [], unmounts: 0 };
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
      if (request.kind !== ACT_KIND.FACTORY_WORLD) throw new Error(`unexpected ${request.kind}`);
      asked.push(request.payload.workspaceId);
      const value = answers.shift() ?? { world: WORLD };
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
    },
  });
});

afterEach(() => {
  pointed = undefined;
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The control the page is drawn over: the workspace listed, on screen, and every door recorded. */
function control(patch: Partial<TasksControl> = {}): TasksControl {
  const base = tasksControl();
  return tasksControl({
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
  return createElement(FactoryWorldPage, { tasks, scene: { world: ENTRY }, backOut });
}

/** Draws the page over `registry`, answering the redraw that draws it again with another control. */
function mount(tasks = control(), registry = AtomRegistry.make()) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const draw = (drawn: TasksControl) =>
    act(() =>
      root?.render(
        onRegistry(registry, onSideBundles(bundles, createElement(Page, { tasks: drawn }))),
      ),
    );
  draw(tasks);
  return { page: container, redraw: draw };
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The state the scene was last handed. */
function lastState(): WorldState {
  const state = scene.states.at(-1);
  assert.ok(state, "the scene was handed a state");
  return state;
}

function button(page: HTMLElement, name: string): HTMLButtonElement {
  const found = [...page.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === name || each.getAttribute("aria-label") === name,
  );
  assert.ok(found, `no button ${name}`);
  return found;
}

/** The pipeline bar as a reader scans it: each stage's words, and whether it is the one pressed. */
function pipeline(page: HTMLElement): string[] {
  return [...page.querySelectorAll<HTMLButtonElement>(".factory-world-pipeline button")].map(
    (stage) =>
      `${stage.textContent}${stage.getAttribute("aria-pressed") === "true" ? " (pressed)" : ""}`,
  );
}

/** The layers the world was last handed, those drawn by name. */
function drawn(): string[] {
  return Object.entries(lastState().layers)
    .filter(([, shown]) => shown)
    .map(([layer]) => layer);
}

let pointed: Element | undefined;

/** The pointer moving from where it was to a count, to another part of the bar (an arrow between counts), or off the bar onto the page. */
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

function arrow(page: HTMLElement): Element {
  const found = page.querySelector(".factory-world-flow");
  assert.ok(found);
  return found;
}

function hover(target: SceneHover | undefined): void {
  act(() => scene.props?.onHover(target));
}

function pick(kind: (typeof PICK_KIND)[keyof typeof PICK_KIND], id: string): void {
  act(() => scene.props?.onPick({ kind, id }));
}

test("the listed workspace's world is read as the page opens, and the scene is mounted over it with the pipeline bar counting it", async () => {
  const { page } = mount();
  await settle();
  assert.deepEqual(asked, [WORKSPACE.id]);
  assert.ok(scene.props, "the scene is mounted");
  assert.equal(scene.props.world, STAND_IN_WORLD);
  assert.deepEqual(
    lastState().view.zones.map((zone) => zone.path),
    ["apps/desktop", "apps/web", "packages/core"],
  );
  assert.equal(lastState().live, true);
  // Note that what the reading does not carry, the planned issues and the defects, reaches the world through the snapshot.
  assert.deepEqual(
    lastState().snapshot.planned.map((issue) => issue.identifier),
    ["ENG-1"],
  );
  assert.deepEqual(pipeline(page), ["1Planned", "1Building", "2Shipped", "0Defects"]);
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
  assert.equal(scene.props, undefined);
  act(() => root?.unmount());

  answers = [{ failure: FACTORY_WORLD_CALL_FAILURE.UNANSWERED }];
  const failed = mount();
  await settle();
  assert.match(failed.page.textContent ?? "", /The world could not be read\./u);
  act(() => button(failed.page, "Retry").click());
  await settle();
  assert.equal(asked.length, 3);
  assert.ok(failed.page.querySelector(".factory-world-pipeline"), "the world stands once read");
});

test("a press on an agent selects it: the card names its pull request and lines, lights its blast radius, and opens its page, its pull request on GitHub, and its task", async () => {
  const { page } = mount();
  await settle();
  pick(PICK_KIND.AGENT, AGENT_ID);
  assert.deepEqual(lastState().selected, { kind: PICK_KIND.AGENT, id: AGENT_ID });
  assert.deepEqual([...lastState().blast], [["apps/web", 0]]);
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
    `agent ${AGENT_ID} of ${TASK_ID}`,
    PULL_REQUEST.url,
    `task ${TASK_ID}`,
  ]);

  // A press on nothing lets the selection go.
  act(() => scene.props?.onPick(undefined));
  assert.equal(page.querySelector(".factory-world-card"), null);
  assert.equal(lastState().blast.size, 0);
});

test("Esc steps back to the overview, from a selection or a camera away from home, and leaves Factory only from there", async () => {
  const { page } = mount();
  await settle();
  assert.equal(page.querySelector(".factory-world-home"), null, "home stands only away from it");

  pick(PICK_KIND.ZONE, "apps/web");
  assert.ok(page.querySelector(".factory-world-home"));
  act(() => {
    runAppCommand(APP_COMMAND.EXIT_FACTORY);
  });
  assert.equal(lastState().selected, undefined);
  assert.equal(scene.homes, 1);
  assert.equal(left, 0);

  act(() => scene.props?.onAway(true));
  act(() => {
    runAppCommand(APP_COMMAND.EXIT_FACTORY);
  });
  assert.equal(scene.homes, 2);
  assert.equal(left, 0);
  assert.equal(page.querySelector(".factory-world-home"), null);

  act(() => {
    runAppCommand(APP_COMMAND.EXIT_FACTORY);
  });
  assert.equal(left, 1, "from the overview, Esc leaves");

  // The home button takes the same step.
  act(() => scene.props?.onAway(true));
  act(() => button(page, "Overview").click());
  assert.equal(scene.homes, 3);
});

test("the pointer resting on a zone names it in the label, and on nothing takes the label down", async () => {
  const { page } = mount();
  await settle();
  hover({ target: { kind: PICK_KIND.ZONE, id: "packages/core" }, at: { x: 40, y: 60 } });
  const label = page.querySelector(".factory-world-label");
  assert.ok(label);
  assert.match(label.textContent ?? "", /@acme\/core/u);
  assert.match(label.textContent ?? "", /packages\/core · 12 files/u);
  assert.deepEqual(lastState().hovered, { kind: PICK_KIND.ZONE, id: "packages/core" });
  hover(undefined);
  assert.equal(page.querySelector(".factory-world-label"), null);
});

test("the pointer resting on a count of the pipeline bar draws its layer alone, and leaving the bar draws every layer again", async () => {
  const { page } = mount();
  await settle();
  assert.deepEqual(drawn(), ["planned", "building", "shipped", "defects"]);
  pointTo(page, button(page, "2Shipped"));
  assert.deepEqual(drawn(), ["shipped"]);
  pointTo(page, button(page, "1Planned"));
  assert.deepEqual(drawn(), ["planned"]);
  pointTo(page, undefined);
  assert.deepEqual(drawn(), ["planned", "building", "shipped", "defects"]);
  assert.deepEqual(pipeline(page), ["1Planned", "1Building", "2Shipped", "0Defects"]);
});

test("a press on a count keeps its layer alone until it is pressed again, and another count's press moves it there", async () => {
  const { page } = mount();
  await settle();
  act(() => button(page, "2Shipped").click());
  pointTo(page, undefined);
  assert.deepEqual(pipeline(page), ["1Planned", "1Building", "2Shipped (pressed)", "0Defects"]);
  assert.deepEqual(drawn(), ["shipped"]);
  // Note that resting on another count previews it, and leaving goes back to the one pressed.
  pointTo(page, button(page, "1Building"));
  assert.deepEqual(drawn(), ["building"]);
  pointTo(page, undefined);
  assert.deepEqual(drawn(), ["shipped"]);
  act(() => button(page, "1Building").click());
  assert.deepEqual(pipeline(page), ["1Planned", "1Building (pressed)", "2Shipped", "0Defects"]);
  assert.deepEqual(drawn(), ["building"]);
  act(() => button(page, "1Building").click());
  assert.deepEqual(pipeline(page), ["1Planned", "1Building", "2Shipped", "0Defects"]);
  assert.deepEqual(drawn(), ["planned", "building", "shipped", "defects"]);
});

test("the pointer leaving a count for the arrow beside it ends that count's preview", async () => {
  const { page } = mount();
  await settle();
  pointTo(page, button(page, "2Shipped"));
  assert.deepEqual(drawn(), ["shipped"]);
  pointTo(page, arrow(page));
  assert.deepEqual(drawn(), ["planned", "building", "shipped", "defects"]);
  pointTo(page, undefined);
});

test("the pointer leaving the bar leaves the keyboard's preview standing, and the pointer's comes first while both rest", async () => {
  const { page } = mount();
  await settle();
  act(() => button(page, "0Defects").focus());
  pointTo(page, button(page, "1Planned"));
  assert.deepEqual(drawn(), ["planned"]);
  pointTo(page, undefined);
  assert.deepEqual(drawn(), ["defects"]);
});

test("the keyboard on a count previews its layer as the pointer does, and leaving the bar draws every layer again", async () => {
  const { page } = mount();
  await settle();
  act(() => button(page, "1Planned").focus());
  assert.deepEqual(drawn(), ["planned"]);
  act(() => button(page, "0Defects").focus());
  assert.deepEqual(drawn(), ["defects"]);
  act(() => button(page, "0Defects").blur());
  assert.deepEqual(drawn(), ["planned", "building", "shipped", "defects"]);
});

test("the world is drawn live as of its snapshot, with no clock to wind it back", async () => {
  const { page } = mount();
  await settle();
  assert.equal(page.querySelector('input[aria-label="Time"]'), null);
  assert.equal(lastState().live, true);
  assert.equal(lastState().snapshot.snapshotAt, WORLD.snapshotAt);
  assert.equal(lastState().view.timeline.length, 2);
});

test("the scene rests while the page is off screen, and is taken down as the page goes", async () => {
  const { redraw } = mount();
  await settle();
  redraw(control({ shown: false }));
  assert.equal(scene.shown.at(-1), false);
  act(() => root?.unmount());
  root = undefined;
  assert.equal(scene.unmounts, 1);
});

test("a world the Mac cannot draw, its WebGL refused or its setup thrown, says so in the world's place", async () => {
  const refusing: SideBundles = {
    ...bundles,
    factoryScene: sideBundles({
      factoryScene: () =>
        Promise.resolve({
          mount: () => {
            throw new Error("Error creating WebGL context.");
          },
        }),
    }).factoryScene,
  };
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        onSideBundles(refusing, createElement(Page, { tasks: control() })),
      ),
    ),
  );
  await settle();
  assert.match(container.textContent ?? "", /The world could not be shown\./u);
  assert.ok(container.querySelector(".factory-world-pipeline"), "the chrome still stands");
});

test("a scene bundle that could not be loaded says so in the world's place", async () => {
  const broken: SideBundles = {
    ...bundles,
    factoryScene: sideBundles({ factoryScene: () => Promise.reject(new Error("offline")) })
      .factoryScene,
  };
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        onSideBundles(broken, createElement(Page, { tasks: control() })),
      ),
    ),
  );
  await settle();
  assert.match(container.textContent ?? "", /The world could not be shown\./u);
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
