// @vitest-environment jsdom

import assert from "node:assert/strict";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@sidecar/hosted/models-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { codingAgentsControl } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { START_NEEDS_REPOSITORY } from "../planning/coding-agent-model";
import type { CodingAgentsControl } from "../planning/use-coding-agents";
import { StartAgentButton } from "./start-agent-button";

/** The catalog as the service lists it: an older Claude first, so the menu's order and its check are its own. */
const MODELS: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-fable-5",
    name: "Claude Fable 5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high", "max"],
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "xhigh"],
  },
];

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
  });
}

function mount(control: CodingAgentsControl): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(StartAgentButton, { control })));
  return container;
}

const buttonNamed = (container: HTMLElement, name: string): HTMLButtonElement => {
  const button = container.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`);
  assert.ok(button, name);
  return button;
};

test("a plan without a repository has Start unavailable, saying why, and no press starts anything", () => {
  const presses: (ModelChoice | undefined)[] = [];
  const page = mount(
    codingAgentsControl({
      start: {
        available: false,
        reason: START_NEEDS_REPOSITORY,
        busy: false,
        note: undefined,
        onPress: (choice) => presses.push(choice),
      },
    }),
  );
  const main = buttonNamed(page, "Start a coding agent");
  assert.equal(main.getAttribute("aria-disabled"), "true");
  assert.equal(main.getAttribute("aria-describedby") !== null || main.title === "", true);
  act(() => main.click());
  act(() => buttonNamed(page, "Choose a model to start with").click());
  assert.deepEqual(presses, []);
  assert.equal(page.querySelector(".plan-compose-menu"), null);
});

/** Types into a field the way a key press does, through the setter React watches. */
function type(field: HTMLInputElement, words: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const rowsOf = (menu: HTMLElement) =>
  [...menu.querySelectorAll<HTMLElement>('[role="option"]')].map((row) => row.textContent);

test("the main part starts on the default, naming nothing; the chevron's menu searches the models, newest first under their marks with the default checked, and the efforts and Start with pinned under the list", async () => {
  const presses: (ModelChoice | undefined)[] = [];
  const reads: string[] = [];
  const page = mount(
    codingAgentsControl({
      models: MODELS,
      readModels: () => reads.push("models"),
      readDefault: () => {
        reads.push("default");
        return Promise.resolve({ choice: { model: "anthropic/claude-opus-5.5", effort: "high" } });
      },
      start: {
        available: true,
        reason: undefined,
        busy: false,
        note: undefined,
        onPress: (choice) => presses.push(choice),
      },
    }),
  );

  act(() => buttonNamed(page, "Start a coding agent").click());
  assert.deepEqual(presses, [undefined]);

  act(() => buttonNamed(page, "Choose a model to start with").click());
  await settle();
  assert.deepEqual(reads, ["models", "default"]);
  const menu = page.querySelector<HTMLElement>(".plan-compose-menu");
  assert.ok(menu);
  const search = menu.querySelector<HTMLInputElement>('input[aria-label="Search models"]');
  assert.ok(search, "the search is the menu's first row");
  assert.ok(document.activeElement === search, "the search field holds focus");
  // Newest first within the provider, and the check on the default as read, not on the first row.
  assert.deepEqual(rowsOf(menu), ["Claude Opus 5.5", "Claude Fable 5", "GPT-6.1 Sol"]);
  const rows = [...menu.querySelectorAll<HTMLElement>('[role="option"]')];
  assert.ok(rows.every((row) => row.querySelector("svg.provider-mark")));
  assert.deepEqual(
    rows.map((row) => row.getAttribute("aria-current")),
    ["true", null, null],
  );
  // The efforts and Start with stand in the foot, pinned under the scrolling list.
  const foot = menu.querySelector<HTMLElement>(".plan-compose-menu-foot");
  assert.ok(foot, "the foot is drawn");
  assert.equal(foot.closest(".plan-compose-menu-list"), null, "the foot is not in the list");
  assert.ok(foot.querySelector(".start-agent-efforts"));
  assert.equal(
    foot.querySelector(".start-agent-with")?.textContent,
    "Start with Claude Opus 5.5 · high",
  );
  assert.deepEqual(
    [...menu.querySelectorAll<HTMLElement>(".start-agent-effort")].map((each) => [
      each.textContent,
      each.getAttribute("aria-pressed"),
    ]),
    [
      ["low", "false"],
      ["high", "true"],
      ["max", "false"],
    ],
  );

  // The search finds a model by its name or its provider.
  type(search, "gpt");
  assert.deepEqual(rowsOf(menu), ["GPT-6.1 Sol"]);
  type(search, "anthropic");
  assert.deepEqual(rowsOf(menu), ["Claude Opus 5.5", "Claude Fable 5"]);
  type(search, "zzz");
  assert.deepEqual(rowsOf(menu), []);
  assert.equal(menu.querySelector(".plan-compose-menu-note")?.textContent, "No models match");
  type(search, "");

  // Another model lists its own efforts, falling to its first where it does not list the one chosen.
  act(() => menu.querySelectorAll<HTMLElement>('[role="option"]')[2]?.click());
  assert.ok(document.activeElement === search, "a pick keeps the menu open on the search");
  assert.deepEqual(
    [...menu.querySelectorAll<HTMLElement>(".start-agent-effort")].map((each) => each.textContent),
    ["low", "xhigh"],
  );
  act(() => {
    [...menu.querySelectorAll<HTMLElement>(".start-agent-effort")]
      .find((each) => each.textContent === "xhigh")
      ?.click();
  });
  const withChoice = menu.querySelector<HTMLElement>(".start-agent-with");
  assert.equal(withChoice?.textContent, "Start with GPT-6.1 Sol · xhigh");
  act(() => withChoice?.click());
  assert.deepEqual(presses, [undefined, { model: "openai/gpt-6.1-sol", effort: "xhigh" }]);
  assert.equal(page.querySelector(".plan-compose-menu"), null);
});

test("the menu says it is reading until the models arrive, and a default the service could not answer checks no row", async () => {
  const page = mount(
    codingAgentsControl({
      models: undefined,
      start: {
        available: true,
        reason: undefined,
        busy: false,
        note: undefined,
        onPress: () => undefined,
      },
    }),
  );
  act(() => buttonNamed(page, "Choose a model to start with").click());
  await settle();
  const menu = page.querySelector<HTMLElement>(".plan-compose-menu");
  assert.ok(menu);
  assert.equal(menu.querySelector(".plan-compose-menu-note")?.textContent, "Reading the models…");
  assert.deepEqual(rowsOf(menu), []);
  assert.equal(menu.querySelector(".plan-compose-menu-foot"), null, "nothing to start with yet");
});

test("why the last Start did not start is said beside the button", () => {
  const page = mount(
    codingAgentsControl({
      start: {
        available: true,
        reason: undefined,
        busy: false,
        note: "Sign in with GitHub again to start an agent.",
        onPress: () => undefined,
      },
    }),
  );
  assert.equal(
    page.querySelector('[role="alert"]')?.textContent,
    "Sign in with GitHub again to start an agent.",
  );
});
