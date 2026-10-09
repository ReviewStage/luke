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
import { CodingAgentsSection } from "./coding-agents-page";

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

/** The service's default as the test's bridge holds it, written by the page and read back by it. */
let stored = { model: "anthropic/claude-opus-5.5", effort: "high" };
/** Every act the page sent, in order. */
let sent: Act[] = [];
/** Whether a write is refused as a choice the catalog does not offer. */
let refuseWrites = false;

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
      return Promise.resolve(done({ choice: stored }));
    case ACT_KIND.CODING_AGENTS_MODELS:
      return Promise.resolve(done({ models: MODELS }));
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
  stored = { model: "anthropic/claude-opus-5.5", effort: "high" };
  sent = [];
  refuseWrites = false;
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

const efforts = (page: HTMLElement) =>
  [...page.querySelectorAll<HTMLElement>(".start-agent-effort")].map((each) => [
    each.textContent,
    each.getAttribute("aria-pressed"),
  ]);

test("the page reads the default and the models as it opens, and draws the model under its mark with the efforts it lists", async () => {
  const page = await mount();

  assert.deepEqual(
    sent.map((request) => request.kind),
    [ACT_KIND.CODING_AGENTS_DEFAULT_READ, ACT_KIND.CODING_AGENTS_MODELS],
  );
  const chip = page.querySelector<HTMLElement>(".settings-model-chip");
  assert.equal(chip?.textContent, "Claude Opus 5.5");
  assert.ok(chip?.querySelector("svg.provider-mark"));
  assert.deepEqual(efforts(page), [
    ["low", "false"],
    ["high", "true"],
    ["max", "false"],
  ]);
});

test("choosing an effort and a model each write the default once and draw what the service kept", async () => {
  const page = await mount();

  act(() => {
    [...page.querySelectorAll<HTMLElement>(".start-agent-effort")]
      .find((each) => each.textContent === "max")
      ?.click();
  });
  await settle();
  assert.deepEqual(stored, { model: "anthropic/claude-opus-5.5", effort: "max" });
  assert.deepEqual(
    efforts(page).find(([, pressed]) => pressed === "true"),
    ["max", "true"],
  );

  // The menu opens under the chip with every model under its mark; a model keeps the effort it lists, else its first.
  act(() => page.querySelector<HTMLElement>(".settings-model-chip")?.click());
  const rows = [...page.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  assert.deepEqual(
    rows.map((row) => row.textContent),
    ["Claude Opus 5.5", "GPT-6.1 Sol"],
  );
  assert.ok(rows.every((row) => row.querySelector("svg.provider-mark")));
  act(() => rows[1]?.click());
  await settle();
  assert.deepEqual(stored, { model: "openai/gpt-6.1-sol", effort: "low" });
  assert.equal(page.querySelector(".settings-model-chip")?.textContent, "GPT-6.1 Sol");
  assert.deepEqual(efforts(page), [
    ["low", "true"],
    ["xhigh", "false"],
  ]);
  assert.equal(
    sent.filter((request) => request.kind === ACT_KIND.CODING_AGENTS_DEFAULT_WRITE).length,
    2,
  );
});

test("a write the service refused leaves the default as it was and says so under the rows", async () => {
  const page = await mount();
  refuseWrites = true;

  act(() => {
    [...page.querySelectorAll<HTMLElement>(".start-agent-effort")]
      .find((each) => each.textContent === "low")
      ?.click();
  });
  await settle();

  assert.deepEqual(stored, { model: "anthropic/claude-opus-5.5", effort: "high" });
  assert.deepEqual(
    efforts(page).find(([, pressed]) => pressed === "true"),
    ["high", "true"],
  );
  assert.match(page.querySelector('[role="alert"]')?.textContent ?? "", /could not be saved/u);
});

test("with no account signed in the page asks nothing and says to sign in", async () => {
  const page = await mount(false);
  assert.deepEqual(sent, []);
  assert.match(page.textContent ?? "", /Sign in to choose the model/u);
});
