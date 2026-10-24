// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHAPTERS_MODEL } from "@luke/features/chapters-model-choice";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { CONTEXT_WINDOW } from "@luke/features/coding-agent-wire";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@luke/features/models-wire";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeySummary,
} from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActKind, PortActResult } from "@luke/host/contract";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { holdExits } from "@luke/ui/testing/held-exits";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { OpenSettingsProvider } from "../open-settings.js";
import { rendererRegistry } from "../renderer-runtime.js";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import {
  focusedSegment,
  pressKeyIn,
  readSegmented,
  segment,
  segmentedGroup,
} from "../testing/segmented.js";
import { newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { CodingAgentsPage } from "./coding-agents-page.js";

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

const SONNET: CatalogModel = {
  id: "anthropic/claude-sonnet-5.5",
  name: "Claude Sonnet 5.5",
  provider: MODEL_PROVIDER.ANTHROPIC,
  efforts: ["low", "high"],
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
let sent: AnyAct[] = [];
/** Whether the service refuses the next write. */
let refuseWrite = false;
/** Whether the service answers that it could not read the models. */
let refuseModels = false;

const done = (value: PortActResult<PortActKind>): FakeActAnswer => ({
  status: FAKE_ANSWER.DONE,
  value,
});

/** The bridge, answering the page's acts the way the host would. */
function answer(request: AnyAct): Promise<FakeActAnswer> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.CODING_AGENTS_MODELS:
      if (refuseModels) {
        return Promise.resolve(done({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
      }
      return Promise.resolve(done({ models }));
    case ACT_KIND.WEB_OPEN:
      return Promise.resolve(done(undefined));
    case ACT_KIND.CODING_AGENTS_DEFAULT_READ:
      return Promise.resolve(done({ choice: stored }));
    case ACT_KIND.CHAPTERS_MODEL_READ:
      return Promise.resolve(done({ model: CHAPTERS_MODEL.HAIKU }));
    case ACT_KIND.CHAPTERS_MODEL_WRITE:
      if (refuseWrite) {
        return Promise.resolve(done({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
      }
      return Promise.resolve(done({ model: request.payload.model }));
    case ACT_KIND.PROVIDER_KEYS_READ:
      return Promise.resolve(done({ keys }));
    case ACT_KIND.PROVIDER_KEYS_SAVE:
      // The replacement key's organization runs fast mode, so the service offers Opus's fast version again.
      // Note that the replacement keeps the same instant, as two saves inside one millisecond would.
      keys = [{ ...OWN_ANTHROPIC, hint: "sk-ant-…new1" }];
      models = [OPUS, OPUS_FAST];
      return Promise.resolve(done({ keys }));
    case ACT_KIND.CODING_AGENTS_DEFAULT_WRITE:
      if (refuseWrite) {
        return Promise.resolve(done({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
      }
      stored = request.payload;
      return Promise.resolve(done({ choice: stored }));
    default:
      return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];
let motion: ReturnType<typeof holdExits>;

beforeEach(() => {
  // jsdom runs no motion, so a Saved tick would be taken the moment it stood.
  motion = holdExits((element) => element.classList.contains("luke-saved-tick"));
  stored = { model: OPUS.id, effort: "high" };
  models = [OPUS, OPUS_FAST];
  keys = [];
  sent = [];
  refuseWrite = false;
  refuseModels = false;
  opened = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...DESKTOP_LINKS });
  fakeActs({ act: answer });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  motion.restore();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** Where the page opened Settings, as the window's opener heard it. */
let opened: SettingsLink[] = [];

async function mount(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        OpenSettingsProvider,
        { value: (link: SettingsLink) => opened.push(link) },
        createElement(
          Fragment,
          null,
          createElement(CodingAgentsPage, { signedIn: true }),
          onRegistry(rendererRegistry, createElement(ToastHost)),
        ),
      ),
    ),
  );
  await settle();
  return container;
}

const fastSwitch = (page: HTMLElement) =>
  page.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Fast"]') ??
  assert.fail("no Fast switch");

/** What the page announces now: its alerts and its error lines that say something. */
const announced = (page: HTMLElement) =>
  [...page.querySelectorAll('[role="alert"], [data-slot="field-error"]')]
    .map((each) => each.textContent ?? "")
    .filter((words) => words !== "");

/** The settings row a name heads. */
const rowOf = (page: HTMLElement, label: string) =>
  [...page.querySelectorAll<HTMLElement>(".luke-settings-row")].find((row) =>
    row.textContent?.startsWith(label),
  ) ?? assert.fail(`no ${label} row`);

/** What stands beside a row's name: its Saved tick and its Modified word. */
const marksIn = (row: HTMLElement) =>
  [...row.querySelectorAll(".luke-saved-tick, .luke-settings-changed-mark")].map(
    (each) => each.textContent ?? "",
  );

/** What a row says under itself about its last write. */
const errorsIn = (row: HTMLElement) =>
  [...row.querySelectorAll('[role="alert"], [data-slot="field-error"]')]
    .map((each) => each.textContent ?? "")
    .filter((words) => words !== "");

/** The defaults the page asked the service to keep, in order. */
const written = () =>
  sent.flatMap((request) =>
    request.kind === ACT_KIND.CODING_AGENTS_DEFAULT_WRITE ? [request.payload] : [],
  );

/** The placeholders standing for reads still out, each what it says it reads and how many rows it stands. */
const placeholders = (page: HTMLElement) =>
  [...page.querySelectorAll('[role="status"][aria-busy="true"]')].map((status) => [
    status.textContent,
    status.querySelectorAll(".luke-settings-row").length,
  ]);

test("while the default and the keys are read, placeholder rows stand in each group's place, and the rows land in theirs", async () => {
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  roots.push(root);
  act(() => root.render(createElement(CodingAgentsPage, { signedIn: true })));

  assert.deepEqual(placeholders(page), [
    ["Reading your keys", 2],
    ["Reading your default", 3],
    ["Reading your chapters model", 1],
  ]);
  await settle();
  assert.deepEqual(placeholders(page), []);
  assert.ok(fastSwitch(page));
});

test("a Fast the service refuses flips back and says so in a toast, the switch pressable again", async () => {
  const page = await mount();
  refuseWrite = true;

  act(() => fastSwitch(page).click());
  await settle();

  assert.equal(newestToastSays(), "The default could not be saved. Try again.");
  assert.deepEqual(announced(page), []);
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

test("a refused Effort or Context says so under its own row until that row's next save lands, and Fast's refusal is a toast that leaves no line behind", async () => {
  const page = await mount();
  const effort = () => errorsIn(rowOf(page, "Effort"));
  const context = () => errorsIn(rowOf(page, "Context"));

  refuseWrite = true;
  act(() => fastSwitch(page).click());
  await settle();
  const fastRefused = announced(page);
  refuseWrite = false;
  act(() => segment(segmentedGroup(page, "Effort"), "Low").click());
  await settle();

  refuseWrite = true;
  act(() => segment(segmentedGroup(page, "Effort"), "Medium").click());
  await settle();
  act(() => segment(segmentedGroup(page, "Context"), "200K").click());
  await settle();
  const refused = [effort(), context()];
  refuseWrite = false;
  act(() => segment(segmentedGroup(page, "Effort"), "High").click());
  await settle();
  const effortSaved = [effort(), context()];
  act(() => segment(segmentedGroup(page, "Context"), "200K").click());
  await settle();

  const refusal = "The default could not be saved. Try again.";
  assert.deepEqual(fastRefused, []);
  assert.deepEqual(refused, [[refusal], [refusal]]);
  assert.deepEqual(effortSaved, [[], [refusal]]);
  assert.deepEqual([effort(), context()], [[], []]);
  assert.equal(fastSwitch(page).getAttribute("aria-checked"), "false");
});

test("the model, Effort and Context rows each tick Saved once their write lands, Modified while they differ from a new account's default, and a refusal ticks nothing", async () => {
  models = [OPUS, OPUS_FAST, SONNET];
  const page = await mount();
  const marks = () => [
    marksIn(rowOf(page, "Default model")),
    marksIn(rowOf(page, "Effort")),
    marksIn(rowOf(page, "Context")),
  ];
  assert.deepEqual(marks(), [[], [], []]);

  refuseWrite = true;
  act(() => segment(segmentedGroup(page, "Effort"), "Low").click());
  await settle();
  assert.deepEqual(marks(), [[], [], []], "a refused write ticks nothing and changes nothing");
  refuseWrite = false;

  act(() => segment(segmentedGroup(page, "Effort"), "Low").click());
  await settle();
  assert.deepEqual(marks(), [[], ["Modified", "Saved"], []]);

  act(() => segment(segmentedGroup(page, "Context"), "200K").click());
  await settle();
  assert.deepEqual(marks(), [[], ["Modified", "Saved"], ["Modified", "Saved"]]);

  act(() => motion.finish());
  act(() =>
    (
      page.querySelector<HTMLButtonElement>('button[aria-label^="Default model: "]') ??
      assert.fail("no Default model chip")
    ).click(),
  );
  const menu =
    document.querySelector('[role="dialog"][aria-label="Default model"]') ?? assert.fail();
  const option = [...menu.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
    (each.textContent ?? "").startsWith("Sonnet 5.5"),
  );
  act(() => option?.click());
  await settle();
  assert.deepEqual(marksIn(rowOf(page, "Default model")), ["Modified", "Saved"]);
  assert.deepEqual(written().at(-1), { model: SONNET.id, effort: "low" });
});

test("the Chapters model ticks Saved beside Model once its write lands, within the page", async () => {
  const page = await mount();
  assert.deepEqual(marksIn(rowOf(page, "Model")), []);

  act(() => segment(segmentedGroup(page, "Chapters model"), "Sonnet 5.5").click());
  await settle();

  assert.deepEqual(marksIn(rowOf(page, "Model")), ["Modified", "Saved"]);
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

test("a GPT model whose ChatGPT plan pays draws no Fast row at all, while a Claude model on its plan keeps it", async () => {
  const sol: CatalogModel = {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
    fastWithheldByPlan: true,
  };
  models = [OPUS, OPUS_FAST, sol];
  stored = { model: sol.id, effort: "high" };
  const onGpt = await mount();
  assert.equal(onGpt.querySelector('[role="switch"][aria-label="Fast"]'), null);
  for (const root of roots.splice(0)) act(() => root.unmount());

  stored = { model: OPUS.id, effort: "high" };
  const onClaude = await mount();
  assert.ok(fastSwitch(onClaude));
});

test("replacing the account's own Anthropic key reads the models again, so Fast follows the new key's organization", async () => {
  models = [{ ...OPUS, fastNotEnabled: true }];
  keys = [OWN_ANTHROPIC];
  const page = await mount();
  assert.equal(fastSwitch(page).disabled, true);

  const row =
    [...page.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) =>
        each.textContent === "Manage" &&
        each.closest(".luke-settings-row")?.textContent?.startsWith("Claude"),
    ) ?? assert.fail("no Claude row button");
  act(() => row.click());
  act(() =>
    (
      document.querySelector<HTMLButtonElement>('[aria-label="Edit key"]') ??
      assert.fail("no Edit key")
    ).click(),
  );
  const label =
    [...document.querySelectorAll("label")].find(
      (each) => each.textContent === "Anthropic API key",
    ) ?? assert.fail("no Anthropic field");
  const field = label.control instanceof HTMLInputElement ? label.control : assert.fail();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      field,
      "sk-ant-api03-synthetic-0000000000000000new1",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => field.form?.requestSubmit());
  await settle();

  assert.equal(fastSwitch(page).disabled, false);
});

test("a catalog that could not be read says so in the Default model menu with Retry, and Retry reads it again", async () => {
  refuseModels = true;
  const page = await mount();
  assert.equal(placeholders(page).length, 0, "the page does not read for ever");

  act(() =>
    (
      page.querySelector<HTMLButtonElement>('button[aria-label^="Default model: "]') ??
      assert.fail()
    ).click(),
  );
  const menu =
    document.querySelector('[role="dialog"][aria-label="Default model"]') ?? assert.fail();
  assert.equal(
    menu.querySelector('[role="alert"]')?.textContent,
    "The models could not be read.Retry",
  );
  assert.doesNotMatch(menu.textContent ?? "", /Open Settings again/u);
  const reads = () => sent.filter((request) => request.kind === ACT_KIND.CODING_AGENTS_MODELS);
  const before = reads().length;

  refuseModels = false;
  act(() =>
    (
      menu.querySelector<HTMLButtonElement>('[role="alert"] button') ?? assert.fail("no Retry")
    ).click(),
  );
  await settle();

  assert.equal(reads().length, before + 1, "Retry asks the service for the models again");
  assert.equal(menu.querySelector('[role="alert"]'), null);
  assert.ok(menu.querySelectorAll('[role="option"]').length > 0, "the models are listed");
});

test("a default nothing pays for, as Claude on an OpenAI key alone, says it cannot run under Model with Connect Claude, which lands on Claude's row, as picking another such model does", async () => {
  const gpt: CatalogModel = {
    id: "openai/gpt-6.1",
    name: "GPT-6.1",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
  };
  const sonnet: CatalogModel = {
    id: "anthropic/claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
    credentialMissing: true,
  };
  models = [{ ...OPUS, credentialMissing: true }, sonnet, gpt];
  const page = await mount();
  const claudeRow: SettingsLink = {
    page: SETTINGS_VIEW.CODING_AGENTS,
    section: SETTINGS_SECTION.CLAUDE,
  };

  const picker =
    page.querySelector<HTMLButtonElement>('button[aria-label^="Default model: "]') ?? assert.fail();
  const row = picker.closest(".luke-settings-row") ?? assert.fail("no Model row");
  assert.match(
    row.textContent ?? "",
    /Opus 5\.5 cannot run until you connect Claude with a subscription or an API key\./u,
  );
  const connect =
    [...row.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => each.textContent === "Connect Claude",
    ) ?? assert.fail("no Connect Claude under Model");
  act(() => connect.click());
  assert.deepEqual(opened, [claudeRow]);

  act(() => picker.click());
  const menu =
    document.querySelector('[role="dialog"][aria-label="Default model"]') ?? assert.fail();
  const option = [...menu.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
    (each.textContent ?? "").startsWith("Sonnet 5.5"),
  );
  assert.match(option?.textContent ?? "", /Connect Claude/u);
  act(() => option?.click());
  await settle();

  assert.deepEqual(opened, [claudeRow, claudeRow]);
  assert.deepEqual(written(), [], "a model nothing pays for is never kept as the default");
});
