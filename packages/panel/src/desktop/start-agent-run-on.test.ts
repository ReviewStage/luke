// @vitest-environment jsdom

import assert from "node:assert/strict";
import { type CatalogModel, MODEL_PROVIDER } from "@luke/features/models-wire";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import { StartAgentButton } from "./start-agent-button.js";

/**
 * start-agent-run-on.test.ts -- Start's Run on, with local agents on and the
 * service offering two of the account's Macs: a press starts in the cloud
 * until a Mac is picked, and on the one picked after, never another; and a
 * Mac picked is let go once a model no Mac runs is chosen. Note that it stands in a file of its own,
 * because a window reads its document once, and the gate reads the
 * experiment off that document.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installScrollIntoView();
  fakeAppPlatform({ assetBase: () => "https://luke.test/" });
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws Start over `control`. */
function mount(control: CodingAgentsControl): void {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(StartAgentButton, { control })));
}

const MODELS: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["high"],
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["high"],
  },
];

const STUDIO = "6f0c1d0e-6b1a-4d43-9a49-2b7b6f1f0a11";
const LAPTOP = "0b8e4c1a-2f6d-4f53-8a2e-9d1c7e5b3a40";

/** The button named `name`. */
function button(name: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (found === null) throw new Error(`no button named ${name}`);
  return found;
}

/** A key pressed in the menu's field, which holds its keys. */
function press(key: string): void {
  const field = document.querySelector<HTMLElement>('[role="combobox"]') ?? assert.fail("no field");
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
  });
}

/** Lets the window's document and the default's read land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

test("a press starts in the cloud until Run on picks a Mac, and on the Mac picked after, by its id", async () => {
  handState(experimentsOn(EXPERIMENT.LOCAL_AGENTS));
  const started: (string | undefined)[] = [];
  const control = codingAgentsControl({
    models: MODELS,
    macs: [
      { deviceId: STUDIO, name: "Studio" },
      { deviceId: LAPTOP, name: "Laptop" },
    ],
    readDefault: () => Promise.resolve({ choice: { model: MODELS[0]?.id ?? "", effort: "high" } }),
    start: {
      available: true,
      reason: undefined,
      busy: false,
      note: undefined,
      succeeded: false,
      onPress: (_choice, deviceId) => started.push(deviceId),
    },
  });
  mount(control);
  await settle();

  act(() => button("Start a coding agent").click());
  act(() => button("Choose a model to start with").click());
  await settle();
  // Note that the menu's keys stay in its field: up past Effort to Run on, right into its choices, down past Studio to Laptop.
  for (const key of ["ArrowUp", "ArrowUp", "ArrowRight", "ArrowDown", "ArrowDown", "Enter"]) {
    press(key);
  }
  await act(async () => button("Start a coding agent").click());

  expect(started).toEqual([undefined, LAPTOP]);
});

test("a Mac picked is let go once a model no Mac runs is chosen, so choosing Claude again starts in the cloud", async () => {
  const started: (string | undefined)[] = [];
  const control = codingAgentsControl({
    models: MODELS,
    macs: [{ deviceId: LAPTOP, name: "Laptop" }],
    readDefault: () => Promise.resolve({ choice: { model: MODELS[0]?.id ?? "", effort: "high" } }),
    start: {
      available: true,
      reason: undefined,
      busy: false,
      note: undefined,
      succeeded: false,
      onPress: (_choice, deviceId) => started.push(deviceId),
    },
  });
  mount(control);
  await settle();
  const pickModel = async (name: string) => {
    const chevron = button("Choose a model to start with");
    if (chevron.getAttribute("aria-expanded") !== "true") act(() => chevron.click());
    await settle();
    const row = [...document.querySelectorAll('[role="option"]')].find((each) =>
      each.textContent?.startsWith(name),
    );
    act(() => (row instanceof HTMLElement ? row : assert.fail(`no ${name}`)).click());
    await settle();
  };

  act(() => button("Choose a model to start with").click());
  await settle();
  for (const key of ["ArrowUp", "ArrowUp", "ArrowRight", "ArrowDown", "Enter"]) press(key);
  await pickModel("GPT-6.1 Sol");
  await pickModel("Opus 5.5");
  await act(async () => button("Start a coding agent").click());

  expect(started).toEqual([undefined]);
});
