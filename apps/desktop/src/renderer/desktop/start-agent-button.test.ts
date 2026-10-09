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

/** Presses a key on whatever holds focus, the way the keyboard does. */
function press(key: string): void {
  act(() => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/** Moves the pointer over an element. */
function hover(element: Element | null | undefined): void {
  act(() => element?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })));
}

/** A control over the catalog with Opus at high as the default, every Start and every write recorded. */
function standing() {
  const presses: (ModelChoice | undefined)[] = [];
  const writes: ModelChoice[] = [];
  const reads: string[] = [];
  const control = codingAgentsControl({
    models: MODELS,
    readModels: () => reads.push("models"),
    readDefault: () => {
      reads.push("default");
      return Promise.resolve({ choice: { model: "anthropic/claude-opus-5.5", effort: "high" } });
    },
    writeDefault: (choice) => {
      writes.push(choice);
      return Promise.resolve({ choice });
    },
    start: {
      available: true,
      reason: undefined,
      busy: false,
      note: undefined,
      onPress: (choice) => presses.push(choice),
    },
  });
  return { presses, writes, reads, control };
}

/** Opens the chevron's menu and lets its reads land. */
async function openMenu(page: HTMLElement): Promise<HTMLElement> {
  act(() => buttonNamed(page, "Choose a model to start with").click());
  await settle();
  const menu = page.querySelector<HTMLElement>(".plan-compose-menu");
  assert.ok(menu);
  return menu;
}

const effortRow = (menu: HTMLElement): HTMLButtonElement => {
  const row = menu.querySelector<HTMLButtonElement>(".plan-compose-menu-foot button");
  assert.ok(row, "the Effort row is pinned under the list");
  return row;
};

const submenuRows = (page: HTMLElement) =>
  [...page.querySelectorAll<HTMLElement>(".plan-compose-submenu [role=option]")].map((row) => [
    row.textContent,
    row.getAttribute("aria-current"),
  ]);

test("the main part starts on the default, naming nothing; the chevron's menu searches the models, newest first under their marks, the default checked with its effort beside it, and one Effort row pinned under the list in place of any Start", async () => {
  const { presses, reads, control } = standing();
  const page = mount(control);

  act(() => buttonNamed(page, "Start a coding agent").click());
  assert.deepEqual(presses, [undefined]);

  const menu = await openMenu(page);
  assert.deepEqual(reads, ["models", "default"]);
  const search = menu.querySelector<HTMLInputElement>('input[aria-label="Search models"]');
  assert.ok(search, "the search is the menu's first row");
  assert.ok(document.activeElement === search, "the search field holds focus");
  // Newest first within the provider, and the check on the default as read, not on the first row.
  const rows = [...menu.querySelectorAll<HTMLElement>('[role="option"]')];
  assert.deepEqual(
    rows.map((row) => row.querySelector(".plan-compose-menu-name")?.textContent),
    ["Claude Opus 5.5", "Claude Fable 5", "GPT-6.1 Sol"],
  );
  assert.ok(rows.every((row) => row.querySelector("svg.provider-mark")));
  assert.deepEqual(
    rows.map((row) => row.getAttribute("aria-current")),
    ["true", null, null],
  );
  assert.deepEqual(
    rows.map((row) => row.querySelector(".plan-compose-menu-detail")?.textContent),
    ["High", undefined, undefined],
    "the checked row says the effort it runs at, in sentence case",
  );
  assert.ok(rows[0]?.querySelector(".plan-compose-menu-end svg.credential-check"));

  // The foot is one Effort row naming the effort, and nothing starts from the menu.
  const foot = menu.querySelector<HTMLElement>(".plan-compose-menu-foot");
  assert.ok(foot, "the foot is drawn");
  assert.equal(foot.closest(".plan-compose-menu-list"), null, "the foot is not in the list");
  assert.equal(foot.querySelectorAll("button").length, 1);
  assert.equal(effortRow(menu).querySelector(".plan-compose-menu-name")?.textContent, "Effort");
  assert.equal(effortRow(menu).querySelector(".plan-compose-menu-detail")?.textContent, "High");
  assert.equal(menu.querySelector(".start-agent-with"), null, "no Start in the menu");
  assert.equal(menu.querySelector(".start-agent-efforts"), null, "no effort chips");
  assert.ok(
    [...menu.querySelectorAll("button")].every((button) => !button.textContent.startsWith("Start")),
  );

  // The search finds a model by its name or its provider.
  type(search, "gpt");
  assert.deepEqual(rowsOf(menu), ["GPT-6.1 Sol"]);
  type(search, "anthropic");
  assert.deepEqual(rowsOf(menu), ["Claude Opus 5.5High", "Claude Fable 5"]);
  type(search, "zzz");
  assert.deepEqual(rowsOf(menu), []);
  assert.equal(menu.querySelector(".plan-compose-menu-note")?.textContent, "No models match");
  assert.deepEqual(presses, [undefined], "nothing in the menu started anything");
});

test("a pick of a model keeps it as the default at the effort it was running, or the model's first where it lacks that one, and closes the menu", async () => {
  const { presses, writes, control } = standing();
  const page = mount(control);
  const menu = await openMenu(page);
  act(() => menu.querySelectorAll<HTMLElement>('[role="option"]')[2]?.click());
  assert.deepEqual(writes, [{ model: "openai/gpt-6.1-sol", effort: "low" }]);
  assert.equal(page.querySelector(".plan-compose-menu"), null, "the menu closed");
  assert.ok(
    document.activeElement === buttonNamed(page, "Choose a model to start with"),
    "focus is back on the chevron",
  );
  assert.deepEqual(presses, [], "a pick starts nothing");

  const again = await openMenu(page);
  act(() => again.querySelectorAll<HTMLElement>('[role="option"]')[1]?.click());
  assert.deepEqual(writes.at(-1), { model: "anthropic/claude-fable-5", effort: "high" });
});

test("the Effort row opens a submenu of the chosen model's efforts in sentence case on Right or the pointer, a pick keeps the effort and closes both, and Left or Escape close only the submenu", async () => {
  const { writes, control } = standing();
  const page = mount(control);
  const menu = await openMenu(page);
  assert.equal(page.querySelector(".plan-compose-submenu"), null);

  // Up from the first row wraps to the pinned row, and Right opens its submenu.
  press("ArrowUp");
  assert.equal(effortRow(menu).dataset["highlighted"], "true");
  press("ArrowRight");
  assert.deepEqual(submenuRows(page), [
    ["Low", null],
    ["High", "true"],
    ["Max", null],
  ]);
  press("ArrowLeft");
  assert.equal(page.querySelector(".plan-compose-submenu"), null, "Left closes the submenu");
  assert.ok(page.querySelector(".plan-compose-menu"), "and not the menu");
  assert.equal(effortRow(menu).dataset["highlighted"], "true");

  hover(effortRow(menu));
  assert.ok(page.querySelector(".plan-compose-submenu"), "the pointer opens it");
  press("Escape");
  assert.equal(page.querySelector(".plan-compose-submenu"), null, "Escape closes the submenu");
  assert.ok(page.querySelector(".plan-compose-menu"), "and not the menu");

  press("ArrowRight");
  press("ArrowDown");
  press("Enter");
  assert.deepEqual(writes, [{ model: "anthropic/claude-opus-5.5", effort: "max" }]);
  assert.equal(page.querySelector(".plan-compose-menu"), null, "a pick closes both");

  press("Escape");
  const again = await openMenu(page);
  hover(effortRow(again));
  const low = page.querySelector<HTMLElement>(".plan-compose-submenu [role=option]");
  act(() => low?.click());
  assert.deepEqual(writes.at(-1), { model: "anthropic/claude-opus-5.5", effort: "low" });
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
