// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { CONTEXT_WINDOW } from "@luke/features/coding-agent-wire";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@luke/features/models-wire";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeySummary,
} from "@luke/features/provider-key-wire";
import {
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActResultFor,
} from "@luke/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
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
 * way they hear every segmented control. Where the service withholds a fast
 * version because Anthropic never granted the key's organization fast mode,
 * Fast rests saying so, and on the account's own Anthropic key links to
 * where the organization asks Anthropic for it. Synthetic catalog and keys.
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

/** The account's own Anthropic key, as the service answers it. */
const OWN_ANTHROPIC: ProviderKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  hint: "sk-ant-…wxyz",
  addedAt: Date.UTC(2026, 9, 14, 12),
  status: PROVIDER_KEY_STATUS.VERIFIED,
  statusAt: Date.UTC(2026, 9, 14, 12),
};

/** The models the test's service offers, and the keys it holds for the account. */
let models: readonly CatalogModel[] = [OPUS, OPUS_FAST];
let keys: readonly ProviderKeySummary[] = [];
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
      return Promise.resolve(done({ keys }));
    case ACT_KIND.CODING_AGENTS_MODELS:
      return Promise.resolve(done({ models }));
    case ACT_KIND.WEB_OPEN:
      return Promise.resolve(done(undefined));
    case ACT_KIND.PROVIDER_KEYS_SAVE:
      // The replacement key's organization runs fast mode, so the service offers Opus's fast version again.
      // Note that the replacement keeps the same instant, as two saves inside one millisecond would.
      keys = [{ ...OWN_ANTHROPIC, hint: "sk-ant-…new1" }];
      models = [OPUS, OPUS_FAST];
      return Promise.resolve(done({ keys }));
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
  models = [OPUS, OPUS_FAST];
  keys = [];
  sent = [];
  refuseWrite = false;
  Object.defineProperty(window, "luke", {
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

/** The words that describe a control, in the order it names them. */
const descriptionOf = (control: HTMLElement) =>
  (control.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

/** What the page announces now: its alerts and its live regions that say something. */
const announced = (page: HTMLElement) =>
  [...page.querySelectorAll('[role="alert"], [aria-live]')]
    .map((each) => each.textContent ?? "")
    .filter((words) => words !== "");

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

  assert.deepEqual(announced(page), ["The default could not be saved. Try again."]);
  assert.equal(fastSwitch(page).getAttribute("aria-invalid"), "true");
  assert.match(
    descriptionOf(fastSwitch(page)),
    /The default could not be saved\. Try again\./u,
    "the refusal describes the Fast switch, not the rows after it",
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
  const alerts = () => announced(page);

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

/** The Fast row's words under its name, which describe its switch. */
const fastNote = (page: HTMLElement) =>
  document.getElementById(fastSwitch(page).getAttribute("aria-describedby")?.split(" ")[0] ?? "") ??
  assert.fail("no Fast note");

test("a model whose fast version the key's organization was never granted rests saying so, and on the account's own key links to where it asks Anthropic, opened in the browser", async () => {
  models = [{ ...OPUS, fastNotEnabled: true }];
  keys = [OWN_ANTHROPIC];
  const page = await mount();

  const note = fastNote(page);
  assert.match(
    note.textContent ?? "",
    /Fast isn't enabled for this key's Anthropic organization\./u,
  );
  const link = note.querySelector("a") ?? assert.fail("no Request access link");
  assert.equal(link.textContent, "Request access");

  act(() => link.click());
  await settle();
  assert.deepEqual(
    sent.filter((request) => request.kind === ACT_KIND.WEB_OPEN).map((request) => request.payload),
    [{ url: "https://claude.com/fast-mode" }],
  );
});

test("on Luke's key the resting Fast row says the same and links nowhere, since only the key's own organization can ask", async () => {
  models = [{ ...OPUS, fastNotEnabled: true }];
  const page = await mount();

  const note = fastNote(page);
  assert.match(
    note.textContent ?? "",
    /Fast isn't enabled for this key's Anthropic organization\./u,
  );
  assert.equal(note.querySelector("a"), null);
});

test("replacing the account's own Anthropic key reads the models again, so Fast follows the new key's organization", async () => {
  models = [{ ...OPUS, fastNotEnabled: true }];
  keys = [OWN_ANTHROPIC];
  const page = await mount();
  assert.equal(fastSwitch(page).disabled, true);

  act(() =>
    (
      page.querySelector<HTMLButtonElement>('[aria-label="Anthropic key actions"]') ??
      assert.fail("no Anthropic key actions")
    ).click(),
  );
  const edit =
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Edit key",
    ) ?? assert.fail("no Edit key");
  act(() => edit.click());
  const field =
    page.querySelector<HTMLInputElement>('input[aria-label="Anthropic API key"]') ??
    assert.fail("no Anthropic field");
  act(() => {
    field.value = "sk-ant-api03-synthetic-0000000000000000new1";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => field.form?.requestSubmit());
  await settle();

  assert.equal(fastSwitch(page).disabled, false);
});
