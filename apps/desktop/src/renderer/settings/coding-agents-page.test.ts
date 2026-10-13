// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import { CONTEXT_WINDOW } from "@sidecar/hosted/coding-agent-wire";
import {
  type CatalogModel,
  FAST_WITHHELD,
  MODEL_PROVIDER,
  type ModelChoice,
  type ModelProvider,
} from "@sidecar/hosted/models-wire";
import { PROVIDER_KEY_STATUS, type ProviderKeyStatus } from "@sidecar/hosted/provider-key-wire";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
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
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { ringInside, sheetStyle } from "#testing/css-rules";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { PAST_SPINNER_DELAY, waitsIn } from "#testing/spinner";
import { CodingAgentsPage } from "./coding-agents-page";

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
  // An older Sonnet, which the menu lists only once a search reaches it.
  {
    id: "anthropic/claude-sonnet-5",
    name: "Claude Sonnet 5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
  {
    id: "anthropic/claude-opus-5.5-fast",
    name: "Claude Opus 5.5 (Fast)",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high", "max"],
  },
];

/** The catalog with GPT-6.1 Sol offering two windows, priced apart past 272K as OpenAI prices its long context. */
const WINDOWED: readonly CatalogModel[] = MODELS.map((model) =>
  model.id === "openai/gpt-6.1-sol"
    ? {
        ...model,
        contextWindows: { standardTokens: 272_000, longTokens: 1_050_000, longInputPriceFactor: 2 },
      }
    : model,
);

/** The catalog the bridge answers. */
let catalog = MODELS;
/** The service's default as the test's bridge holds it, written by the page and read back by it. */
let stored: ModelChoice = { model: "anthropic/claude-opus-5.5", effort: "high" };
/** Every act the page sent, in order. */
let sent: Act[] = [];
/** Whether a write is refused as a choice the catalog does not offer. */
let refuseWrites = false;
/** Whether the models read is answered with a failure rather than the catalog. */
let refuseModels = false;
/** Whether the default read is answered with a failure rather than the stored choice. */
let refuseDefaultRead = false;
/** The providers the account holds a key of its own for, as the keys read answers them. */
let ownKeys: readonly ModelProvider[] = [];
/** How the provider last answered each of those keys. */
let ownKeyStatus: ProviderKeyStatus = PROVIDER_KEY_STATUS.VERIFIED;
/** Whether the default read is never answered, so the page stands reading. */
let holdDefaultRead = false;

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
      if (holdDefaultRead) return new Promise(() => undefined);
      return Promise.resolve(
        done(
          refuseDefaultRead
            ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }
            : { choice: stored },
        ),
      );
    case ACT_KIND.CODING_AGENTS_MODELS:
      return Promise.resolve(
        done(
          refuseModels ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } : { models: catalog },
        ),
      );
    case ACT_KIND.PROVIDER_KEYS_READ:
      return Promise.resolve(
        done({
          keys: ownKeys.map((provider) => ({
            provider,
            hint: "sk-…test",
            addedAt: 1,
            status: ownKeyStatus,
            statusAt: 1,
          })),
        }),
      );
    case ACT_KIND.PROVIDER_KEYS_SAVE:
      ownKeys = [...ownKeys, request.payload.provider];
      return Promise.resolve(
        done({
          keys: ownKeys.map((provider) => ({
            provider,
            hint: "sk-…test",
            addedAt: 1,
            status: ownKeyStatus,
            statusAt: 1,
          })),
        }),
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
  catalog = MODELS;
  stored = { model: "anthropic/claude-opus-5.5", effort: "high" };
  sent = [];
  refuseWrites = false;
  refuseModels = false;
  refuseDefaultRead = false;
  ownKeys = [];
  ownKeyStatus = PROVIDER_KEY_STATUS.VERIFIED;
  holdDefaultRead = false;
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

/** The page, on the atoms `registry` holds where one is given. */
async function mount(signedIn = true, registry?: AtomRegistry): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const page = createElement(CodingAgentsPage, { signedIn });
  act(() => root.render(registry === undefined ? page : onRegistry(registry, page)));
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
    [
      ACT_KIND.CODING_AGENTS_DEFAULT_READ,
      ACT_KIND.CODING_AGENTS_MODELS,
      ACT_KIND.PROVIDER_KEYS_READ,
    ],
  );
  assert.equal(chip(page).textContent, "Opus 5.5");
  assert.ok(chip(page).querySelector("svg.provider-mark"), "Claude Code's mark");
  assert.equal(page.querySelector("select"), null);
  assert.deepEqual(efforts(page), [
    ["Low", "false"],
    ["High", "true"],
    ["Max", "false"],
  ]);
});

it.effect(
  "while the default is read the page draws the spinner in its rows' place, saying Loading your default to a reader",
  () =>
    Effect.gen(function* () {
      holdDefaultRead = true;
      const registry = yield* registryOnTestClock;
      const page = yield* Effect.promise(() => mount(true, registry));
      yield* TestClock.adjust(PAST_SPINNER_DELAY);
      yield* Effect.promise(settle);
      assert.deepEqual(waitsIn(page), [{ says: "Loading your default", ring: true }]);
      assert.equal(page.querySelector(".settings-picker-chip"), null, "no rows before the read");
      assert.doesNotMatch(page.textContent ?? "", /Reading/u);
    }),
);

test("the model menu opens on its search, lists the newest of each family under its harness's mark, and a pick keeps the effort the model lists, else its first", async () => {
  const page = await mount();

  open(page);
  const field = searchField();
  assert.equal(field.placeholder, "Search models");
  assert.deepEqual(options(page), ["Opus 5.5", "Sonnet 5.5", "GPT-6.1 Sol"]);
  assert.deepEqual(
    [...page.querySelectorAll('[role="option"]')].map((row) => {
      const mark = row.querySelector(".provider-mark");
      return mark instanceof HTMLImageElement ? mark.getAttribute("src") : mark?.tagName;
    }),
    ["svg", "svg", "marks/codex-16.png"],
    "Claude Code's traced mark for Anthropic's models, Codex's own art for OpenAI's",
  );
  assert.equal(page.querySelector('[role="option"][aria-current="true"]')?.textContent, "Opus 5.5");

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

test("the search filters every model, older versions included, by name, by the catalog's own name, and by provider", async () => {
  const page = await mount();
  open(page);

  type(searchField(), "sonnet");
  assert.deepEqual(options(page), ["Sonnet 5.5", "Sonnet 5"]);
  type(searchField(), "claude");
  assert.deepEqual(
    options(page),
    ["Opus 5.5", "Sonnet 5.5", "Sonnet 5"],
    "by the catalog's own name",
  );
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

test("the keyboard's ring on an effort's segment is drawn inside it, since its trough leaves no room around it", async () => {
  const styled = await sheetStyle();
  const page = await mount();
  const segments = [...page.querySelectorAll<HTMLElement>(".settings-segment")];

  assert.ok(segments.length > 1);
  assert.deepEqual(
    segments.filter((segment) => !ringInside(styled, segment)).map((each) => each.textContent),
    [],
  );
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

test("a model offering two windows draws a context row over the two, its whole window the default and saying what that costs, where the standard one is chosen and kept through an effort change; a model with one draws none", async () => {
  catalog = WINDOWED;
  stored = { model: "openai/gpt-6.1-sol", effort: "low" };
  const page = await mount();
  const segment = (label: string) =>
    [...page.querySelectorAll<HTMLElement>(".settings-segment")].find(
      (each) => each.textContent === label,
    );
  assert.deepEqual(efforts(page), [
    ["Low", "true"],
    ["Extra high", "false"],
    ["272K", "false"],
    ["1M", "true"],
  ]);
  assert.ok(page.textContent.includes("On 1M, prompts over 272K tokens cost 2× for input."));

  act(() => segment("272K")?.click());
  await settle();
  assert.deepEqual(stored, {
    model: "openai/gpt-6.1-sol",
    effort: "low",
    contextWindow: CONTEXT_WINDOW.STANDARD,
  });
  act(() => segment("Extra high")?.click());
  await settle();
  assert.deepEqual(stored, {
    model: "openai/gpt-6.1-sol",
    effort: "xhigh",
    contextWindow: CONTEXT_WINDOW.STANDARD,
  });
  assert.deepEqual(efforts(page).slice(2), [
    ["272K", "true"],
    ["1M", "false"],
  ]);
  act(() => segment("1M")?.click());
  await settle();
  assert.deepEqual(stored, { model: "openai/gpt-6.1-sol", effort: "xhigh" });

  stored = { model: "anthropic/claude-opus-5.5", effort: "high" };
  const other = await mount();
  assert.equal(
    [...other.querySelectorAll(".settings-segment")].some((each) => each.textContent === "1M"),
    false,
  );
});

test("a models read that fails says so in the menu, and the stored effort still stands in its row", async () => {
  refuseModels = true;
  const page = await mount();

  assert.equal(chip(page).textContent, "Opus 5.5");
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
      .find((each) => each.textContent === "Retry")
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

  assert.equal(chip(page).textContent, "Opus 4.1");
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

/** What the model row says under its name, if anything. */
function modelNote(page: HTMLElement): string | undefined {
  return (
    page.querySelector(".settings-picker")?.closest(".settings-row")?.querySelector("small")
      ?.textContent ?? undefined
  );
}

test("a key saved in the API keys group is what the model row says at once", async () => {
  const page = await mount();
  const note = () => modelNote(page);
  assert.equal(note(), undefined, "on Luke's key the row says nothing");

  const add = [...page.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) =>
      each.textContent === "Add key" &&
      each.closest(".menu-row")?.textContent?.includes("Anthropic"),
  );
  act(() => add?.click());
  const field =
    page.querySelector<HTMLInputElement>('input[aria-label="Anthropic API key"]') ??
    assert.fail("no Anthropic field");
  field.value = "sk-ant-api03-synthetic-0000000000000000wxyz";
  const form = field.closest("form") ?? assert.fail("no form around the field");
  act(() => form.requestSubmit());
  await settle();
  assert.equal(note(), "Runs on your own Anthropic key.");
});

test("with no account signed in the page asks nothing and says to sign in", async () => {
  const page = await mount(false);
  assert.deepEqual(sent, []);
  assert.match(page.textContent ?? "", /Sign in to choose the model/u);
});

test("the model menu lists base models only, and the Fast switch under it stores the fast version's id and reads it back as its base with Fast on", async () => {
  const page = await mount();
  open(page);
  assert.deepEqual(options(page), ["Opus 5.5", "Sonnet 5.5", "GPT-6.1 Sol"]);
  type(searchField(), "fast");
  assert.deepEqual(options(page), [], "a fast version is never listed on its own");
  press(searchField(), "Escape");

  assert.equal(fastSwitch(page).getAttribute("aria-checked"), "false");
  assert.equal(fastSwitch(page).disabled, false);
  act(() => fastSwitch(page).click());
  await settle();
  assert.deepEqual(stored, { model: "anthropic/claude-opus-5.5-fast", effort: "high" });
  assert.equal(fastSwitch(page).getAttribute("aria-checked"), "true");
  assert.equal(chip(page).textContent, "Opus 5.5", "the chip names the base model");

  // Read back from the service as stored: the base checked, Fast on.
  const reopened = await mount();
  assert.equal(chip(reopened).textContent, "Opus 5.5");
  assert.equal(fastSwitch(reopened).getAttribute("aria-checked"), "true");
  open(reopened);
  const checked = reopened.querySelector<HTMLElement>('[role="option"][aria-current="true"]');
  assert.equal(checked?.textContent, "Opus 5.5");
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
    /No fast version of Sonnet 5\.5/u,
  );
});

test("a key of the account's own saved on the page reads the models again, and the Fast switch rests saying the service withholds it for that key", async () => {
  const page = await mount();
  assert.equal(fastSwitch(page).disabled, false, "on Luke's key Opus offers Fast");

  // The service answers an account that runs Anthropic on its own key with no Anthropic fast version.
  catalog = MODELS.filter((model) => !model.id.endsWith("-fast")).map((model) =>
    model.id === "anthropic/claude-opus-5.5"
      ? { ...model, fastWithheld: FAST_WITHHELD.OWN_KEY }
      : model,
  );
  const add = [...page.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) =>
      each.textContent === "Add key" &&
      each.closest(".menu-row")?.textContent?.includes("Anthropic"),
  );
  act(() => add?.click());
  const field =
    page.querySelector<HTMLInputElement>('input[aria-label="Anthropic API key"]') ??
    assert.fail("no Anthropic field");
  field.value = "sk-ant-api03-synthetic-0000000000000000wxyz";
  const form = field.closest("form") ?? assert.fail("no form around the field");
  act(() => form.requestSubmit());
  await settle();

  assert.equal(fastSwitch(page).disabled, true);
  assert.equal(fastSwitch(page).getAttribute("aria-checked"), "false");
  assert.match(
    fastSwitch(page).closest(".settings-row")?.textContent ?? "",
    /Fast isn't available on your own API key\./u,
  );
});

test("the model row says the default runs on the account's own key where the provider accepted one, and that one it did not needs a hand", async () => {
  ownKeys = [MODEL_PROVIDER.ANTHROPIC];
  const own = await mount();
  ownKeys = [MODEL_PROVIDER.OPENAI];
  const luke = await mount();
  ownKeys = [MODEL_PROVIDER.ANTHROPIC];
  ownKeyStatus = PROVIDER_KEY_STATUS.UNREADABLE;
  const unusable = await mount();

  assert.equal(modelNote(own), "Runs on your own Anthropic key.");
  assert.equal(modelNote(luke), undefined);
  assert.equal(modelNote(unusable), "Your Anthropic key needs attention under API keys.");
});
