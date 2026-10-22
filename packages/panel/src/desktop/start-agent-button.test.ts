// @vitest-environment jsdom

import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@luke/features/models-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import { StartAgentButton } from "./start-agent-button.js";

/**
 * start-agent-button.test.ts -- the task toolbar's Start: its main part
 * starts an agent and closes the model menu its chevron opened, and a press
 * it refuses while an agent is starting still closes the menu and starts
 * nothing, and what the menu picks is what the next press starts on, the
 * account's default left as it stands.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installScrollIntoView();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws Start over `control`, answering a redraw over another control. */
function mount(control: CodingAgentsControl): (next: CodingAgentsControl) => void {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(StartAgentButton, { control })));
  return (next) => act(() => root.render(createElement(StartAgentButton, { control: next })));
}

/** The button named `name`. */
function button(name: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (found === null) throw new Error(`no button named ${name}`);
  return found;
}

function menuOpen(): boolean {
  return button("Choose a model to start with").getAttribute("aria-expanded") === "true";
}

/** A task Start can run on, counting its presses into `started`. */
function startable(started: string[], busy = false): CodingAgentsControl {
  return codingAgentsControl({
    start: {
      available: true,
      reason: undefined,
      busy,
      note: undefined,
      onPress: () => started.push("start"),
    },
  });
}

test("the main part starts an agent and closes the model menu", () => {
  const started: string[] = [];
  mount(startable(started));

  act(() => button("Choose a model to start with").click());
  expect(menuOpen()).toBe(true);
  act(() => button("Start a coding agent").click());

  expect(started).toEqual(["start"]);
  expect(menuOpen()).toBe(false);
});

test("a press refused while an agent is starting closes the model menu and starts nothing", () => {
  const started: string[] = [];
  const redraw = mount(startable(started));

  act(() => button("Choose a model to start with").click());
  redraw(startable(started, true));
  expect(menuOpen()).toBe(true);
  act(() => button("Starting").click());

  expect(started).toEqual([]);
  expect(menuOpen()).toBe(false);
});

const MODELS: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
  {
    id: "anthropic/claude-opus-5.5-fast",
    name: "Claude Opus 5.5 (Fast)",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
];

const DEFAULT: ModelChoice = { model: "anthropic/claude-opus-5.5", effort: "high" };

test("a press with nothing picked names no choice, and one after a pick starts on the pick", async () => {
  const started: (ModelChoice | undefined)[] = [];
  mount(
    codingAgentsControl({
      models: MODELS,
      readDefault: () => Promise.resolve({ choice: DEFAULT }),
      start: {
        available: true,
        reason: undefined,
        busy: false,
        note: undefined,
        onPress: (choice) => started.push(choice),
      },
    }),
  );
  await act(async () => {});

  act(() => button("Start a coding agent").click());
  expect(started).toEqual([undefined]);

  act(() => button("Choose a model to start with").click());
  await act(async () => {});
  const fast = document.querySelector<HTMLButtonElement>('[role="switch"]');
  if (fast === null) throw new Error("the menu offers no Fast");
  act(() => fast.click());
  await act(async () => button("Start a coding agent").click());

  expect(started).toEqual([undefined, { model: "anthropic/claude-opus-5.5-fast", effort: "high" }]);
});
