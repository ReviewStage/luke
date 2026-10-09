// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import { type CatalogModel, MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import {
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActResultFor,
} from "#shared/messages/acts";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { CodingAgentsSection } from "./coding-agents-page";

const MODELS: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high", "max"],
  },
  {
    id: "anthropic/claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "xhigh"],
  },
  {
    id: "anthropic/claude-opus-5.5-fast",
    name: "Claude Opus 5.5 (Fast)",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high", "max"],
  },
];

/** The service's default as the test's bridge holds it, written by the page and read back by it. */
let stored = { model: "anthropic/claude-opus-5.5", effort: "high" };
/** Every act the page sent, in order. */
let sent: Act[] = [];
/** Whether a write is refused as a choice the catalog does not offer. */
let refuseWrites = false;
/** Whether the models read is answered with a failure rather than the catalog. */
let refuseModels = false;
/** Whether the default read is answered with a failure rather than the stored choice. */
let refuseDefaultRead = false;

/** A done outcome carrying one kind's own answer. */
const done = (value: ActResultFor<ActKind>): ActOutcome => ({
  status: ACT_OUTCOME_STATUS.DONE,
  value,
});

/** The bridge, answering the page's acts the way the host would. */
function answer(request: Act): Promise<ActOutcome> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.CODING_AGENTS_DEFAULT_READ:
      return Promise.resolve(
        done(
          refuseDefaultRead
            ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }
            : { choice: stored },
        ),
      );
    case ACT_KIND.CODING_AGENTS_MODELS:
      return Promise.resolve(
        done(refuseModels ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } : { models: MODELS }),
      );
    case ACT_KIND.CODING_AGENTS_DEFAULT_WRITE:
      if (refuseWrites) {
        return Promise.resolve(done({ failure: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE }));
      }
      stored = request.payload;
      return Promise.resolve(done({ choice: stored }));
    default:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  stored = { model: "anthropic/claude-opus-5.5", effort: "high" };
  sent = [];
  refuseWrites = false;
  refuseModels = false;
  refuseDefaultRead = false;
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: { act: answer, recordSurfaceEvent: () => undefined },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

async function mount(signedIn = true): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(CodingAgentsSection, { signedIn })));
  await settle();
  return container;
}

const chip = (page: HTMLElement) =>
  page.querySelector<HTMLButtonElement>(".settings-picker-chip") ?? assert.fail("no model chip");

const open = (page: HTMLElement) => act(() => chip(page).click());

const options = (page: HTMLElement) =>
  [...page.querySelectorAll<HTMLElement>('[role="option"]')].map((row) => row.textContent);

const efforts = (page: HTMLElement) =>
  [...page.querySelectorAll<HTMLElement>(".settings-segment")].map((each) => [
    each.textContent,
    each.getAttribute("aria-pressed"),
  ]);

/** Types into a field the way a key press does, through the setter React watches. */
function type(field: HTMLInputElement, words: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

const fastSwitch = (page: HTMLElement) =>
  page.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Fast"]') ??
  assert.fail("no Fast switch");

const searchField = () =>
  document.activeElement instanceof HTMLInputElement
    ? document.activeElement
    : assert.fail("the search field does not have focus");

test("the page reads the default and the models as it opens, and draws the model under its mark with the efforts it lists in sentence case", async () => {
  const page = await mount();

  assert.deepEqual(
    sent.map((request) => request.kind),
    [ACT_KIND.CODING_AGENTS_DEFAULT_READ, ACT_KIND.CODING_AGENTS_MODELS],
  );
  assert.equal(chip(page).textContent, "Claude Opus 5.5");
  assert.ok(chip(page).querySelector("svg.provider-mark"));
  assert.equal(page.querySelector("select"), null);
  assert.deepEqual(efforts(page), [
    ["Low", "false"],
    ["High", "true"],
    ["Max", "false"],
  ]);
});

test("the model menu opens on its search, lists every model under its mark newest first, and a pick keeps the effort the model lists, else its first", async () => {
  const page = await mount();

  open(page);
  const field = searchField();
  assert.equal(field.placeholder, "Search models");
  assert.deepEqual(options(page), ["Claude Opus 5.5", "Claude Sonnet 5.5", "GPT-6.1 Sol"]);
  assert.ok(
    [...page.querySelectorAll('[role="option"]')].every((row) =>
      row.querySelector("svg.provider-mark"),
    ),
  );
  assert.equal(
    page.querySelector('[role="option"][aria-current="true"]')?.textContent,
    "Claude Opus 5.5",
  );

  act(() => {
    [...page.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((row) => row.textContent === "GPT-6.1 Sol")
      ?.click();
  });
  await settle();
  assert.deepEqual(stored, { model: "openai/gpt-6.1-sol", effort: "low" });
  assert.equal(chip(page).textContent, "GPT-6.1 Sol");
  assert.equal(page.querySelector('[role="listbox"]'), null);
  assert.equal(document.activeElement, chip(page));
  assert.deepEqual(efforts(page), [
    ["Low", "true"],
    ["Extra high", "false"],
  ]);
});

test("the search filters the models by name and by provider", async () => {
  const page = await mount();
  open(page);

  type(searchField(), "sonnet");
  assert.deepEqual(options(page), ["Claude Sonnet 5.5"]);
  type(searchField(), "openai");
  assert.deepEqual(options(page), ["GPT-6.1 Sol"]);
  type(searchField(), "llama");
  assert.deepEqual(options(page), []);
  assert.match(page.querySelector('[role="listbox"]')?.textContent ?? "", /No models match/u);
});

test("arrows and Enter pick from the keyboard, and Escape closes the menu without reaching the window", async () => {
  const page = await mount();
  const reachedWindow: string[] = [];
  const listen = (event: KeyboardEvent) => reachedWindow.push(event.key);
  window.addEventListener("keydown", listen);

  open(page);
  press(searchField(), "ArrowDown");
  press(searchField(), "Enter");
  await settle();
  assert.deepEqual(stored, { model: "anthropic/claude-sonnet-5.5", effort: "high" });
  assert.equal(page.querySelector('[role="listbox"]'), null);

  open(page);
  press(searchField(), "Escape");
  assert.equal(page.querySelector('[role="listbox"]'), null);
  assert.equal(document.activeElement, chip(page));
  assert.ok(!reachedWindow.includes("Escape"));
  window.removeEventListener("keydown", listen);
});

test("choosing an effort writes the default once and draws what the service kept", async () => {
  const page = await mount();

  act(() => {
    [...page.querySelectorAll<HTMLElement>(".settings-segment")]
      .find((each) => each.textContent === "Max")
      ?.click();
  });
  await settle();
  assert.deepEqual(stored, { model: "anthropic/claude-opus-5.5", effort: "max" });
  assert.deepEqual(
    efforts(page).find(([, pressed]) => pressed === "true"),
    ["Max", "true"],
  );
  assert.equal(
    sent.filter((request) => request.kind === ACT_KIND.CODING_AGENTS_DEFAULT_WRITE).length,
    1,
  );
});

test("a models read that fails says so in the menu, and the stored effort still stands in its row", async () => {
  refuseModels = true;
  const page = await mount();

  assert.equal(chip(page).textContent, "Claude Opus 5.5");
  assert.deepEqual(efforts(page), [["High", "true"]]);
  open(page);
  assert.equal(
    page.querySelector('[role="listbox"] [role="alert"]')?.textContent,
    "The models could not be read. Open Settings again to try again.",
  );
  assert.deepEqual(options(page), []);
});

test("a retry whose models read fails does not keep the earlier catalog on offer", async () => {
  refuseDefaultRead = true;
  const page = await mount();
  assert.ok(page.querySelector('[role="alert"]'));

  refuseDefaultRead = false;
  refuseModels = true;
  act(() => {
    [...page.querySelectorAll<HTMLElement>("button")]
      .find((each) => each.textContent === "Try again")
      ?.click();
  });
  await settle();
  assert.deepEqual(efforts(page), [["High", "true"]]);
  open(page);
  assert.deepEqual(options(page), []);
  assert.equal(
    page.querySelector('[role="listbox"] [role="alert"]')?.textContent,
    "The models could not be read. Open Settings again to try again.",
  );
});

test("a stored model the catalog has stopped offering keeps its effort drawn rather than an empty row", async () => {
  stored = { model: "anthropic/claude-opus-4.1", effort: "max" };
  const page = await mount();

  assert.equal(chip(page).textContent, "Claude Opus 4.1");
  assert.deepEqual(efforts(page), [["Max", "true"]]);
});

test("a write the service refused leaves the default as it was and says so under the rows", async () => {
  const page = await mount();
  refuseWrites = true;

  act(() => {
    [...page.querySelectorAll<HTMLElement>(".settings-segment")]
      .find((each) => each.textContent === "Low")
      ?.click();
  });
  await settle();

  assert.deepEqual(stored, { model: "anthropic/claude-opus-5.5", effort: "high" });
  assert.deepEqual(
    efforts(page).find(([, pressed]) => pressed === "true"),
    ["High", "true"],
  );
  assert.match(page.querySelector('[role="alert"]')?.textContent ?? "", /could not be saved/u);
});

test("with no account signed in the page asks nothing and says to sign in", async () => {
  const page = await mount(false);
  assert.deepEqual(sent, []);
  assert.match(page.textContent ?? "", /Sign in to choose the model/u);
});

test("the model menu lists base models only, and the Fast switch under it stores the fast version's id and reads it back as its base with Fast on", async () => {
  const page = await mount();
  open(page);
  assert.deepEqual(options(page), ["Claude Opus 5.5", "Claude Sonnet 5.5", "GPT-6.1 Sol"]);
  type(searchField(), "fast");
  assert.deepEqual(options(page), [], "a fast version is never listed on its own");
  press(searchField(), "Escape");

  assert.equal(fastSwitch(page).getAttribute("aria-checked"), "false");
  assert.equal(fastSwitch(page).disabled, false);
  act(() => fastSwitch(page).click());
  await settle();
  assert.deepEqual(stored, { model: "anthropic/claude-opus-5.5-fast", effort: "high" });
  assert.equal(fastSwitch(page).getAttribute("aria-checked"), "true");
  assert.equal(chip(page).textContent, "Claude Opus 5.5", "the chip names the base model");

  // Read back from the service as stored: the base checked, Fast on.
  const reopened = await mount();
  assert.equal(chip(reopened).textContent, "Claude Opus 5.5");
  assert.equal(fastSwitch(reopened).getAttribute("aria-checked"), "true");
  open(reopened);
  const checked = reopened.querySelector<HTMLElement>('[role="option"][aria-current="true"]');
  assert.equal(checked?.textContent, "Claude Opus 5.5");
  press(searchField(), "Escape");

  // Sonnet lists no fast version: the pick drops Fast, and the switch rests saying why.
  open(reopened);
  act(() => reopened.querySelectorAll<HTMLElement>('[role="option"]')[1]?.click());
  await settle();
  assert.deepEqual(stored, { model: "anthropic/claude-sonnet-5.5", effort: "high" });
  assert.equal(fastSwitch(reopened).getAttribute("aria-checked"), "false");
  assert.equal(fastSwitch(reopened).disabled, true);
  assert.match(
    fastSwitch(reopened).closest(".settings-row")?.textContent ?? "",
    /No fast version of Claude Sonnet 5\.5/u,
  );
});
