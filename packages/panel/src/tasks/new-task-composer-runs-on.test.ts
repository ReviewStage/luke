// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import { DEVICE_KIND, DEVICE_SETUP } from "@luke/features/device-agent-wire";
import { type MacOffer, MODEL_PROVIDER } from "@luke/features/models-wire";
import type { TaskRunsOnRequest } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { editorBundleLanded, installEditorLayout, pressInComposer } from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { MENTION_MENU_SIDE } from "./mention-picker.js";
import { NewTaskComposer } from "./new-task-composer.js";

/**
 * new-task-composer-runs-on.test.ts -- New task's Runs on, with local agents
 * on and two of the member's devices offered, one offline: the task starts on
 * the device picked, by its id, and the offline one cannot be picked, nor
 * one online but getting ready or not set up, which says so; a last pick
 * that is offline or getting ready as the card opens stays picked and says
 * so, never Cloud; a card takes a device picked in another card; and nothing
 * starts before the devices are read, a read that failed saying so with a
 * Retry that reads them again. Note
 * that it stands in a file of its own, because a window reads its document
 * once, and the gate reads the experiment off that document. Synthetic
 * throughout.
 */

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: { login: "acme", active: true },
  memberCount: 2,
};

const STUDIO = "6f0c1d0e-6b1a-4d43-9a49-2b7b6f1f0a11";
const BUILDER = "0b8e4c1a-2f6d-4f53-8a2e-9d1c7e5b3a40";

const roots: Root[] = [];

/** The devices the service holds for the card now, which the presence read answers the beats of. */
let offeredNow: readonly MacOffer[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  handState(experimentsOn(EXPERIMENT.LOCAL_AGENTS));
  // The service answers the shared presence read with no beat later than the lists carry.
  fakeActPort({
    [ACT_KIND.HOSTS_PRESENCE]: () =>
      Promise.resolve({
        devices: offeredNow.flatMap((device) =>
          device.seenAt === undefined
            ? []
            : [{ deviceId: device.deviceId, ageMs: Date.now() - device.seenAt }],
        ),
      }),
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The member's devices: the Studio, online unless said, and the build host, offline unless said. */
function devicesWith(studioSeenAt = Date.now(), builderSeenAt = 0): readonly MacOffer[] {
  return [
    {
      deviceId: STUDIO,
      name: "Studio",
      providers: [MODEL_PROVIDER.ANTHROPIC],
      kind: DEVICE_KIND.DESKTOP,
      seenAt: studioSeenAt,
    },
    {
      deviceId: BUILDER,
      name: "Build host",
      providers: [MODEL_PROVIDER.ANTHROPIC],
      kind: DEVICE_KIND.HOST,
      seenAt: builderSeenAt,
    },
  ];
}

/** What the card is offered: the devices as read, none before a read lands, and whether the last read failed; a read lists `reread`, else those devices again, unless `holdReads`, until the test lets reads land. */
interface Offered {
  devices: readonly MacOffer[] | undefined;
  modelsFailed?: boolean;
  reread?: readonly MacOffer[];
  holdReads?: boolean;
}

/** The card in Acme offering what `offered` holds, each start's Runs on written down; a read of the models lands as a new list, held until `letReadsLand` where `holdReads`. */
async function mount(offered: Offered = { devices: devicesWith() }) {
  offeredNow = offered.devices ?? [];
  const control = tasksControl();
  let { devices, modelsFailed = false } = offered;
  let readsLand = offered.holdReads !== true;
  const starts: (TaskRunsOnRequest | undefined)[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = () =>
    root.render(
      onRegistry(
        registry,
        createElement(NewTaskComposer, {
          newTask: {
            ...control.newTask,
            workspaces: [ACME],
            workspaceId: ACME.id,
            devices,
            modelsFailed,
            readModels: () => {
              if (!readsLand) return;
              devices = [...(offered.reread ?? offered.devices ?? [])];
              modelsFailed = false;
              draw();
            },
            start: (_name, _repository, _workspaceId, from) => {
              starts.push(from?.runsOn);
              return Promise.resolve(undefined);
            },
          },
          workspaceId: ACME.id,
          onLeave: () => undefined,
          listSide: MENTION_MENU_SIDE.ABOVE,
        }),
      ),
    );
  act(draw);
  await settle();
  const letReadsLand = () => {
    readsLand = true;
  };
  return { container, starts, letReadsLand };
}

/** The menu's row naming `name`. */
function row(name: string): HTMLElement {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes(name),
    ) ?? assert.fail(`Runs on lists ${name}`)
  );
}

test("a task starts on the device Runs on picked, by its id, and an offline device is listed but not picked", async () => {
  const { container, starts } = await mount();
  const chip = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="Runs on"]') ??
    assert.fail("the card draws Runs on");

  act(() => chip().click());
  await settle();
  assert.equal(row("Build host").getAttribute("aria-disabled"), "true");
  act(() => row("Studio").click());
  await settle();
  // ⌘Return on the empty box: a bare task, which carries where its agents run as any start does.
  pressInComposer(container, "Enter", { metaKey: true });
  await settle();

  assert.equal(chip().getAttribute("aria-label"), "Runs on: Studio");
  assert.deepEqual(starts, [{ machine: CODING_AGENT_MACHINE.DEVICE, deviceId: STUDIO }]);
});

test("a device online but still getting ready, or that couldn't set up, is listed saying so and not picked", async () => {
  const [studio, builder] = devicesWith(Date.now(), Date.now());
  assert.ok(studio !== undefined && builder !== undefined);
  const { container } = await mount({
    devices: [
      { ...studio, setup: DEVICE_SETUP.PREPARING },
      {
        ...builder,
        setup: DEVICE_SETUP.FAILED,
        setupFailure: "the sandbox image couldn't be downloaded",
      },
    ],
  });
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label^="Runs on"]')?.click());
  await settle();

  assert.deepEqual(
    [row("Studio"), row("Build host")].map((each) => [
      each.getAttribute("aria-disabled"),
      each.textContent?.includes("Getting ready…"),
      each.textContent?.includes("Couldn't set up"),
    ]),
    [
      ["true", true, false],
      ["true", false, true],
    ],
  );
});

test.each([
  { standing: "offline", studio: { seenAt: 0 }, chip: "Runs on: Studio · Offline" },
  {
    standing: "getting ready",
    studio: { setup: DEVICE_SETUP.PREPARING },
    chip: "Runs on: Studio · Getting ready…",
  },
])(
  "a last pick $standing as the card opens stays picked and says so, and the task starts on it, never in the cloud",
  async ({ studio, chip: label }) => {
    window.localStorage.setItem("luke.newTaskRunsOn", STUDIO);
    const [online, builder] = devicesWith();
    assert.ok(online !== undefined && builder !== undefined);
    const { container, starts } = await mount({ devices: [{ ...online, ...studio }, builder] });
    const chip =
      container.querySelector<HTMLButtonElement>('button[aria-label^="Runs on"]') ??
      assert.fail("the card draws Runs on");

    assert.equal(chip.getAttribute("aria-label"), label);
    pressInComposer(container, "Enter", { metaKey: true });
    await settle();

    assert.deepEqual(starts, [{ machine: CODING_AGENT_MACHINE.DEVICE, deviceId: STUDIO }]);
  },
);

test("a device picked in another card reaches this one", async () => {
  window.localStorage.setItem("luke.newTaskRunsOn", STUDIO);
  const offered = { devices: devicesWith(0, Date.now()) };
  const welcome = await mount(offered);
  const dialog = await mount(offered);
  act(() =>
    dialog.container.querySelector<HTMLButtonElement>('button[aria-label^="Runs on"]')?.click(),
  );
  await settle();
  act(() => row("Build host").click());
  await settle();
  pressInComposer(welcome.container, "Enter", { metaKey: true });
  await settle();

  assert.deepEqual(welcome.starts, [{ machine: CODING_AGENT_MACHINE.DEVICE, deviceId: BUILDER }]);
});

test("nothing starts before the devices are read, and a read that failed says so, with a Retry that reads them again", async () => {
  window.localStorage.setItem("luke.newTaskRunsOn", STUDIO);
  // A list read before the card opened, here one with no device, is no read of the card's own.
  const reading = await mount({ devices: [], holdReads: true });
  pressInComposer(reading.container, "Enter", { metaKey: true });
  await settle();
  assert.deepEqual(reading.starts, []);
  assert.match(reading.container.textContent ?? "", /Checking your devices/);

  const failed = await mount({
    devices: [],
    modelsFailed: true,
    reread: devicesWith(),
    holdReads: true,
  });
  pressInComposer(failed.container, "Enter", { metaKey: true });
  await settle();
  assert.deepEqual(failed.starts, []);
  assert.match(failed.container.textContent ?? "", /Couldn't read your devices/);
  const retry =
    [...failed.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Retry",
    ) ?? assert.fail("the card offers Retry");
  failed.letReadsLand();
  act(() => retry.click());
  await settle();
  pressInComposer(failed.container, "Enter", { metaKey: true });
  await settle();

  assert.deepEqual(failed.starts, [{ machine: CODING_AGENT_MACHINE.DEVICE, deviceId: STUDIO }]);
});
