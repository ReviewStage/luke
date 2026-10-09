// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
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
  // The fast version lists fewer levels than its base.
  {
    id: "anthropic/claude-opus-5.5-fast",
    name: "Claude Opus 5.5 (Fast)",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
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

/** The hover line the main part shows on a pointer resting on it, or nothing where it shows none. */
function hoverLine(page: HTMLElement): string | undefined {
  const main = buttonNamed(page, "Start a coding agent");
  act(() => main.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
  const pill = document.body.querySelector<HTMLElement>('[role="tooltip"]')?.textContent;
  act(() => {
    main.dispatchEvent(
      new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
    );
  });
  return pill ?? undefined;
}

/** A control over the catalog with Opus at high as the default, every Start and every write recorded. */
function standing(stored: ModelChoice = { model: "anthropic/claude-opus-5.5", effort: "high" }) {
  const presses: (ModelChoice | undefined)[] = [];
  const writes: ModelChoice[] = [];
  const reads: string[] = [];
  const control = codingAgentsControl({
    models: MODELS,
    readModels: () => reads.push("models"),
    // The service answers the last write, as the real one keeps it.
    readDefault: () => {
      reads.push("default");
      return Promise.resolve({ choice: writes.at(-1) ?? stored });
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

const fastRow = (menu: HTMLElement): HTMLButtonElement => {
  const row = menu.querySelector<HTMLButtonElement>('.plan-compose-menu-foot [role="switch"]');
  assert.ok(row, "the Fast row is pinned under the list");
  return row;
};

const submenuRows = (page: HTMLElement) =>
  [...page.querySelectorAll<HTMLElement>(".plan-compose-submenu [role=option]")].map((row) => [
    row.textContent,
    row.getAttribute("aria-current"),
  ]);

test("the main part starts on the default, naming nothing, and says the default on hover; the chevron's menu searches the base models, newest first under their marks, the default checked with its effort beside it, and Effort and Fast rows pinned under the list in place of any Start", async () => {
  const { presses, reads, control } = standing();
  const page = mount(control);
  await settle();
  assert.deepEqual(reads, ["models", "default"], "read as the button mounts, for its hover line");
  assert.equal(hoverLine(page), "Claude Opus 5.5 · High");

  act(() => buttonNamed(page, "Start a coding agent").click());
  assert.deepEqual(presses, [undefined]);

  const menu = await openMenu(page);
  assert.deepEqual(reads, ["models", "default", "models", "default"]);
  const search = menu.querySelector<HTMLInputElement>('input[aria-label="Search models"]');
  assert.ok(search, "the search is the menu's first row");
  assert.ok(document.activeElement === search, "the search field holds focus");
  // Newest first within the provider, the fast version folded into its model, and the check on the default as read, not on the first row.
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

  // The foot is the Effort row naming the effort and the Fast switch, and nothing starts from the menu.
  const foot = menu.querySelector<HTMLElement>(".plan-compose-menu-foot");
  assert.ok(foot, "the foot is drawn");
  assert.equal(foot.closest(".plan-compose-menu-list"), null, "the foot is not in the list");
  assert.equal(foot.querySelectorAll("button").length, 2);
  assert.equal(effortRow(menu).querySelector(".plan-compose-menu-name")?.textContent, "Effort");
  assert.equal(effortRow(menu).querySelector(".plan-compose-menu-detail")?.textContent, "High");
  assert.equal(fastRow(menu).getAttribute("aria-checked"), "false");
  assert.equal(fastRow(menu).getAttribute("aria-disabled"), null, "Opus has a fast version");
  assert.equal(menu.querySelector(".start-agent-with"), null, "no Start in the menu");
  assert.equal(menu.querySelector(".start-agent-efforts"), null, "no effort chips");
  assert.ok(
    [...menu.querySelectorAll("button")].every((button) => !button.textContent.startsWith("Start")),
  );

  // The search finds a model by its name or its provider, and never a fast version on its own.
  type(search, "gpt");
  assert.deepEqual(rowsOf(menu), ["GPT-6.1 Sol"]);
  type(search, "anthropic");
  assert.deepEqual(rowsOf(menu), ["Claude Opus 5.5High", "Claude Fable 5"]);
  type(search, "fast");
  assert.deepEqual(rowsOf(menu), []);
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

  // The default now stands at low, which Fable lists, so the pick keeps it.
  const again = await openMenu(page);
  act(() => again.querySelectorAll<HTMLElement>('[role="option"]')[1]?.click());
  assert.deepEqual(writes.at(-1), { model: "anthropic/claude-fable-5", effort: "low" });
});

test("the Effort row opens a submenu of the chosen model's efforts in sentence case on Right or the pointer, a pick keeps the effort and closes both, and Left or Escape close only the submenu", async () => {
  const { writes, control } = standing();
  const page = mount(control);
  const menu = await openMenu(page);
  assert.equal(page.querySelector(".plan-compose-submenu"), null);

  // Up from the first row wraps past the Fast row to the Effort row, and Right opens its submenu.
  press("ArrowUp");
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

test("the Fast switch keeps the model's fast version as the default without closing the menu, and the checked row and the hover line say so", async () => {
  const { writes, control } = standing();
  const page = mount(control);
  const menu = await openMenu(page);
  act(() => fastRow(menu).click());
  assert.deepEqual(writes, [{ model: "anthropic/claude-opus-5.5-fast", effort: "high" }]);
  assert.ok(page.querySelector(".plan-compose-menu"), "the menu stays open");
  assert.equal(fastRow(menu).getAttribute("aria-checked"), "true");
  const checked = menu.querySelector<HTMLElement>('[role="option"][aria-current="true"]');
  assert.equal(checked?.querySelector(".plan-compose-menu-name")?.textContent, "Claude Opus 5.5");
  assert.equal(checked?.querySelector(".plan-compose-menu-detail")?.textContent, "High · Fast");

  // Enter on the highlighted switch turns it back; the menu still stands.
  press("ArrowUp");
  assert.equal(
    fastRow(menu).dataset["highlighted"],
    "true",
    "Up from the first row wraps to the last pinned row",
  );
  press("Enter");
  assert.deepEqual(writes.at(-1), { model: "anthropic/claude-opus-5.5", effort: "high" });
  assert.ok(page.querySelector(".plan-compose-menu"));
  assert.equal(fastRow(menu).getAttribute("aria-checked"), "false");
});

test("a stored fast version shows its base model checked with Fast on, and a pick of a model without a fast version turns Fast off", async () => {
  const { writes, control } = standing({ model: "anthropic/claude-opus-5.5-fast", effort: "high" });
  const page = mount(control);
  await settle();
  assert.equal(hoverLine(page), "Claude Opus 5.5 · High · Fast");
  const menu = await openMenu(page);
  const checked = menu.querySelector<HTMLElement>('[role="option"][aria-current="true"]');
  assert.equal(checked?.querySelector(".plan-compose-menu-name")?.textContent, "Claude Opus 5.5");
  assert.equal(checked?.querySelector(".plan-compose-menu-detail")?.textContent, "High · Fast");
  assert.equal(fastRow(menu).getAttribute("aria-checked"), "true");
  // The Effort row and its submenu list the fast version's own levels.
  hover(effortRow(menu));
  assert.deepEqual(submenuRows(page), [
    ["Low", null],
    ["High", "true"],
  ]);
  press("Escape");

  // Fable lists no fast version: the pick stores its base id, at high, which it lists.
  act(() => menu.querySelectorAll<HTMLElement>('[role="option"]')[1]?.click());
  assert.deepEqual(writes, [{ model: "anthropic/claude-fable-5", effort: "high" }]);
  assert.equal(page.querySelector(".plan-compose-menu"), null);

  const again = await openMenu(page);
  assert.equal(fastRow(again).getAttribute("aria-checked"), "false");
  assert.equal(fastRow(again).getAttribute("aria-disabled"), "true", "Fable has no fast version");
  act(() => fastRow(again).click());
  assert.equal(writes.length, 1, "a muted switch turns nothing");
  assert.ok(page.querySelector(".plan-compose-menu"));
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

test("Fast re-checks the effort against the fast version's own levels, falling to the nearest below, and off again against the base's", async () => {
  const { writes, control } = standing({ model: "anthropic/claude-opus-5.5", effort: "max" });
  const page = mount(control);
  const menu = await openMenu(page);
  assert.equal(effortRow(menu).querySelector(".plan-compose-menu-detail")?.textContent, "Max");

  // The fast version lists no max: on lands on high, the nearest below, and the row says so.
  act(() => fastRow(menu).click());
  assert.deepEqual(writes, [{ model: "anthropic/claude-opus-5.5-fast", effort: "high" }]);
  assert.equal(effortRow(menu).querySelector(".plan-compose-menu-detail")?.textContent, "High");
  hover(effortRow(menu));
  assert.deepEqual(submenuRows(page), [
    ["Low", null],
    ["High", "true"],
  ]);
  press("Escape");

  // Off re-checks against the base, which lists high, so it is kept and the base's levels return.
  act(() => fastRow(menu).click());
  assert.deepEqual(writes.at(-1), { model: "anthropic/claude-opus-5.5", effort: "high" });
  hover(effortRow(menu));
  assert.deepEqual(submenuRows(page), [
    ["Low", null],
    ["High", "true"],
    ["Max", null],
  ]);
});

test("an Extra high carried to a model listing low, medium, and high lands on High", async () => {
  const models: readonly CatalogModel[] = [
    ...MODELS,
    {
      id: "anthropic/claude-sonnet-5.5",
      name: "Claude Sonnet 5.5",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["low", "medium", "high"],
    },
  ];
  const { writes, control } = standing({ model: "openai/gpt-6.1-sol", effort: "xhigh" });
  const page = mount({ ...control, models });
  const menu = await openMenu(page);
  const sonnet = [...menu.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (row) => row.textContent === "Claude Sonnet 5.5",
  );
  act(() => sonnet?.click());
  assert.deepEqual(writes, [{ model: "anthropic/claude-sonnet-5.5", effort: "high" }]);
});

test("a change the service refused gives way to the default it still holds, on the checked row and the hover line alike", async () => {
  const { control } = standing();
  let refuse = false;
  const page = mount({
    ...control,
    writeDefault: (choice) =>
      Promise.resolve(refuse ? { failure: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE } : { choice }),
  });
  const menu = await openMenu(page);
  refuse = true;
  act(() => fastRow(menu).click());
  assert.equal(fastRow(menu).getAttribute("aria-checked"), "true", "drawn at once");
  await settle();
  assert.equal(
    fastRow(menu).getAttribute("aria-checked"),
    "false",
    "and back as the service refused",
  );
  const checked = menu.querySelector<HTMLElement>('[role="option"][aria-current="true"]');
  assert.equal(checked?.querySelector(".plan-compose-menu-detail")?.textContent, "High");
  press("Escape");
  assert.equal(hoverLine(page), "Claude Opus 5.5 · High");
});
