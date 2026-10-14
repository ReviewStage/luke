// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import { CONTEXT_WINDOW } from "@sidecar/hosted/coding-agent-wire";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@sidecar/hosted/models-wire";
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
import {
  focusedSegment,
  pressKeyIn,
  readSegmented,
  segment,
  segmentedGroup,
} from "#testing/segmented";
import { CodingAgentsPage } from "./coding-agents-page";

/**
 * Settings › Coding agents' Default model over a bridge answering as the host
 * would: Fast is a settings switch like every other, resting while its write
 * is out and saying a refusal under its own row with the switch left where
 * it stood, and Effort and Context are each a radio group a reader hears the
 * way they hear every segmented control. Synthetic catalog.
 */

const OPUS: CatalogModel = {
  id: "anthropic/claude-opus-5.5",
  name: "Claude Opus 5.5",
  provider: MODEL_PROVIDER.ANTHROPIC,
  efforts: ["low", "medium", "high"],
  contextWindows: { standardTokens: 200_000, longTokens: 1_000_000 },
};
const OPUS_FAST: CatalogModel = {
  ...OPUS,
  id: "anthropic/claude-opus-5.5-fast",
  name: "Claude Opus 5.5 (Fast)",
};

/** The default the test's service holds. */
let stored: ModelChoice = { model: OPUS.id, effort: "high" };
/** Every act the page sent, in order. */
let sent: Act[] = [];
/** Whether the service refuses the next write. */
let refuseWrite = false;

const done = (value: ActResultFor<ActKind>): ActOutcome => ({
  status: ACT_OUTCOME_STATUS.DONE,
  value,
});

/** The bridge, answering the page's acts the way the host would. */
function answer(request: Act): Promise<ActOutcome> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.PROVIDER_KEYS_READ:
      return Promise.resolve(done({ keys: [] }));
    case ACT_KIND.CODING_AGENTS_MODELS:
      return Promise.resolve(done({ models: [OPUS, OPUS_FAST] }));
    case ACT_KIND.CODING_AGENTS_DEFAULT_READ:
      return Promise.resolve(done({ choice: stored }));
    case ACT_KIND.CODING_AGENTS_DEFAULT_WRITE:
      if (refuseWrite) {
        return Promise.resolve(done({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
      }
      stored = request.payload;
      return Promise.resolve(done({ choice: stored }));
    default:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  stored = { model: OPUS.id, effort: "high" };
  sent = [];
  refuseWrite = false;
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
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

async function mount(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(CodingAgentsPage, { signedIn: true })));
  await settle();
  return container;
}

const fastSwitch = (page: HTMLElement) =>
  page.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Fast"]') ??
  assert.fail("no Fast switch");

/** The defaults the page asked the service to keep, in order. */
const written = () =>
  sent.flatMap((request) =>
    request.kind === ACT_KIND.CODING_AGENTS_DEFAULT_WRITE ? [request.payload] : [],
  );

test("a Fast the service refuses says so under Fast's own row, the switch left off and pressable again, as every settings switch's refusal does", async () => {
  const page = await mount();
  refuseWrite = true;

  act(() => fastSwitch(page).click());
  await settle();

  const alert = page.querySelector('[role="alert"]') ?? assert.fail("no refusal");
  assert.equal(alert.textContent, "The default could not be saved. Try again.");
  assert.equal(
    alert.previousElementSibling?.contains(fastSwitch(page)),
    true,
    "the refusal stands under the Fast row, not under the rows after it",
  );
  assert.equal(fastSwitch(page).getAttribute("aria-checked"), "false");
  assert.equal(fastSwitch(page).disabled, false);
  assert.deepEqual(written(), [{ model: OPUS_FAST.id, effort: "high" }]);
});

test("Effort and Context are each a radio group, the stored value checked and the one stop for Tab, and an arrow chooses the next option and keeps it", async () => {
  const page = await mount();
  const effort = segmentedGroup(page, "Effort");
  const context = segmentedGroup(page, "Context");

  assert.deepEqual(readSegmented(effort), {
    options: ["Low", "Medium", "High"],
    checked: ["High"],
    tabStops: ["High"],
  });
  assert.deepEqual(readSegmented(context), {
    options: ["200K", "1M"],
    checked: ["1M"],
    tabStops: ["1M"],
  });

  pressKeyIn(effort, "ArrowLeft");
  await settle();
  assert.equal(focusedSegment(), "Medium");
  act(() => segment(context, "200K").click());
  await settle();
  // A press on the option already chosen asks nothing of the service.
  act(() => segment(context, "200K").click());
  await settle();

  assert.deepEqual(readSegmented(segmentedGroup(page, "Effort")).checked, ["Medium"]);
  assert.deepEqual(readSegmented(segmentedGroup(page, "Context")).checked, ["200K"]);
  assert.deepEqual(written(), [
    { model: OPUS.id, effort: "medium" },
    { model: OPUS.id, effort: "medium", contextWindow: CONTEXT_WINDOW.STANDARD },
  ]);
});

test("a refusal goes once any row's save lands, Fast's after an effort is kept and the effort's after Fast is, since every row writes the one default", async () => {
  const page = await mount();
  const alerts = () => [...page.querySelectorAll('[role="alert"]')].map((each) => each.textContent);

  refuseWrite = true;
  act(() => fastSwitch(page).click());
  await settle();
  const fastRefused = alerts();
  refuseWrite = false;
  act(() => segment(segmentedGroup(page, "Effort"), "Low").click());
  await settle();
  const afterEffort = alerts();

  refuseWrite = true;
  act(() => segment(segmentedGroup(page, "Effort"), "Medium").click());
  await settle();
  const effortRefused = alerts();
  refuseWrite = false;
  act(() => fastSwitch(page).click());
  await settle();

  assert.deepEqual(fastRefused, ["The default could not be saved. Try again."]);
  assert.deepEqual(afterEffort, []);
  assert.deepEqual(effortRefused, ["The default could not be saved. Try again."]);
  assert.deepEqual(alerts(), []);
  assert.equal(fastSwitch(page).getAttribute("aria-checked"), "true");
});
