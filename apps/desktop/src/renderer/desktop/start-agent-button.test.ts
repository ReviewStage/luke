// @vitest-environment jsdom

import assert from "node:assert/strict";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@sidecar/hosted/models-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { codingAgentsControl } from "#testing/plans-control";
import { START_NEEDS_REPOSITORY } from "../planning/coding-agent-model";
import type { CodingAgentsControl } from "../planning/use-coding-agents";
import { StartAgentButton } from "./start-agent-button";

const MODELS: readonly CatalogModel[] = [
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
  assert.equal(page.querySelector('[role="menu"]'), null);
});

test("the main part starts on the default, naming nothing; the chevron's menu lists each model under its mark, the chosen model's efforts, and starts with the choice", async () => {
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
  const menu = page.querySelector<HTMLElement>('[role="menu"]');
  assert.ok(menu);
  const rows = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  assert.deepEqual(
    rows.map((row) => row.textContent),
    ["Claude Opus 5.5", "GPT-6.1 Sol", "Start with Claude Opus 5.5 · high"],
  );
  assert.equal(rows[0]?.querySelector("svg.provider-mark") !== null, true);
  assert.equal(rows[1]?.querySelector("svg.provider-mark") !== null, true);
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

  // Another model lists its own efforts, falling to its first where it does not list the one chosen.
  act(() => rows[1]?.click());
  assert.deepEqual(
    [...menu.querySelectorAll<HTMLElement>(".start-agent-effort")].map((each) => each.textContent),
    ["low", "xhigh"],
  );
  act(() => {
    [...menu.querySelectorAll<HTMLElement>(".start-agent-effort")]
      .find((each) => each.textContent === "xhigh")
      ?.click();
  });
  const withChoice = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].at(-1);
  assert.equal(withChoice?.textContent, "Start with GPT-6.1 Sol · xhigh");
  act(() => withChoice?.click());
  assert.deepEqual(presses, [undefined, { model: "openai/gpt-6.1-sol", effort: "xhigh" }]);
  assert.equal(page.querySelector('[role="menu"]'), null);
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
