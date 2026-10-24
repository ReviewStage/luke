// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHAPTERS_MODEL } from "@luke/features/chapters-model-choice";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeySummary,
  type ProviderKeysAnswer,
  type SubscriptionKeySummary,
} from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActKind, PortActResult } from "@luke/host/contract";
import { HOST_CAPABILITY, type HostCapability } from "@luke/settings";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE } from "@luke/settings/settings-anchors";
import { SETTINGS_SECTION } from "@luke/settings/settings-views";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES, handState, stateWith } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { CodingAgentsPage } from "./coding-agents-page.js";

/**
 * Settings › Agents' harnesses over a bridge answering as the service would:
 * each row's button says how its harness is connected, or Connect, or that
 * its plan needs a hand; its dialog's radio cards save and remove each
 * credential, and the checked radio is the plan's default for agents, sent
 * as the plan's `forAgents`. Nothing pasted stands on the page once kept or
 * reaches a log. Synthetic credentials throughout.
 */

/** Low-entropy fakes shaped as a pasted key and token are, built at run time. */
const KEY = ["sk", "ant", "api03", "synthetic".repeat(4)].join("-");
const TOKEN = ["sk", "ant", "oat01", "fake".repeat(8)].join("-");

const AT = Date.UTC(2026, 9, 20, 12);

const ANTHROPIC_KEY: ProviderKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  hint: "sk-ant-…wxyz",
  status: PROVIDER_KEY_STATUS.VERIFIED,
  addedAt: AT,
  statusAt: AT,
};

const CLAUDE_PLAN: SubscriptionKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
  hint: "sk-ant-oat01…fake",
  status: PROVIDER_KEY_STATUS.UNVERIFIED,
  addedAt: AT,
  statusAt: AT,
  forAgents: true,
};

const CHATGPT_PLAN: SubscriptionKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.OPENAI,
  kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
  hint: "ChatGPT",
  status: PROVIDER_KEY_STATUS.UNVERIFIED,
  addedAt: AT,
  statusAt: AT,
  forAgents: true,
};

/** What the test's service holds for the account. */
let held: ProviderKeysAnswer = { keys: [] };
/** Why the next save is refused, or nothing where it is kept. */
let refusal: (typeof PROVIDER_KEY_REJECTION)[keyof typeof PROVIDER_KEY_REJECTION] | undefined;
/** Every act the page sent, in order. */
let sent: AnyAct[] = [];

const done = (value: PortActResult<PortActKind>): FakeActAnswer => ({
  status: FAKE_ANSWER.DONE,
  value,
});

function answer(request: AnyAct): Promise<FakeActAnswer> {
  sent.push(request);
  const subscriptions = held.subscriptions ?? [];
  switch (request.kind) {
    case ACT_KIND.CODING_AGENTS_MODELS:
      return Promise.resolve(done({ models: [] }));
    case ACT_KIND.CODING_AGENTS_DEFAULT_READ:
      return Promise.resolve(done({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
    case ACT_KIND.CHAPTERS_MODEL_READ:
      return Promise.resolve(done({ model: CHAPTERS_MODEL.HAIKU }));
    case ACT_KIND.WEB_OPEN:
      return Promise.resolve(done(undefined));
    case ACT_KIND.PROVIDER_KEYS_READ:
      return Promise.resolve(done(held));
    case ACT_KIND.PROVIDER_KEYS_SAVE:
      if (refusal !== undefined) return Promise.resolve(done({ ...held, rejected: refusal }));
      held =
        request.payload.kind === PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN
          ? { ...held, subscriptions: [...subscriptions, CLAUDE_PLAN] }
          : {
              ...held,
              keys: [...held.keys, { ...ANTHROPIC_KEY, provider: request.payload.provider }],
            };
      return Promise.resolve(done(held));
    case ACT_KIND.PROVIDER_KEYS_REMOVE: {
      const kind = request.payload.kind;
      held =
        kind === undefined || kind === PROVIDER_KEY_KIND.API_KEY
          ? { ...held, keys: held.keys.filter((one) => one.provider !== request.payload.provider) }
          : { ...held, subscriptions: subscriptions.filter((one) => one.kind !== kind) };
      return Promise.resolve(done(held));
    }
    case ACT_KIND.PROVIDER_KEYS_FOR_AGENTS:
      held = {
        ...held,
        subscriptions: subscriptions.map((one) =>
          one.kind === request.payload.kind
            ? { ...one, forAgents: request.payload.forAgents }
            : one,
        ),
      };
      return Promise.resolve(done(held));
    case ACT_KIND.CHATGPT_SIGN_IN:
      held = { ...held, subscriptions: [...subscriptions, CHATGPT_PLAN] };
      return Promise.resolve(done(held));
    default:
      return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  held = { keys: [] };
  refusal = undefined;
  sent = [];
  window.localStorage.clear();
  fakeAppPlatform({ ...QUIET_PANEL, ...DESKTOP_LINKS });
  fakeActs({ act: answer });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The Agents page for an ordinary account, on a platform offering `capabilities`. */
async function mount(
  capabilities: readonly HostCapability[] = DESKTOP_CAPABILITIES,
): Promise<HTMLElement> {
  const base = stateWith({}, {});
  handState({}, { access: { admin: false }, run: { ...base.run, capabilities } });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(AtomRegistry.make(), createElement(CodingAgentsPage, { signedIn: true })),
    ),
  );
  await settle();
  return container;
}

/** A harness's row button's words, the check it may end in having none. */
const rowButton = (page: HTMLElement, harness: string) =>
  [...page.querySelectorAll<HTMLElement>(".luke-settings-row")]
    .find((row) => row.textContent?.startsWith(harness))
    ?.querySelector<HTMLButtonElement>("button") ?? assert.fail(`no ${harness} row`);

const button = (within: Element | Document, words: string) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) =>
      (each.textContent === words || each.getAttribute("aria-label") === words) &&
      each.closest("[inert]") === null,
  ) ?? assert.fail(`no ${words} button`);

async function press(within: Element | Document, words: string): Promise<void> {
  act(() => button(within, words).click());
  await settle();
}

/** Opens a harness's dialog from its row. */
async function open(page: HTMLElement, harness: string): Promise<HTMLElement> {
  act(() => rowButton(page, harness).click());
  await settle();
  return (
    [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((dialog) =>
      dialog.textContent?.startsWith(harness),
    ) ?? assert.fail(`no ${harness} dialog`)
  );
}

const radio = (dialog: Element, label: string) =>
  [...dialog.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((each) =>
    each.textContent?.startsWith(label),
  ) ?? assert.fail(`no ${label} radio`);

/** The card a radio heads. */
const card = (dialog: Element, label: string) =>
  radio(dialog, label).closest<HTMLElement>(".luke-choice-card") ?? assert.fail(`no ${label} card`);

/** The field a visible label names, as a reader finds it. */
function labelled(within: Element, words: string): HTMLInputElement {
  const label = [...within.querySelectorAll("label")].find((each) => each.textContent === words);
  const control = label?.control;
  assert.ok(control instanceof HTMLInputElement, `no field labelled ${words}`);
  return control;
}

/** Types into a field as a paste would. */
function paste(field: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Types into a field as a paste would, then submits its form. */
async function pasteAndSave(field: HTMLInputElement, value: string): Promise<void> {
  paste(field, value);
  act(() => field.form?.requestSubmit());
  await settle();
}

const question = () =>
  document.querySelector('[role="alertdialog"]') ?? assert.fail("no question stands");

const forAgentsSent = () =>
  sent
    .filter((each) => each.kind === ACT_KIND.PROVIDER_KEYS_FOR_AGENTS)
    .map((each) => each.payload);

test("each harness's row says how it is connected: nothing, its plan, its key, or a plan needing a hand", async () => {
  const empty = await mount();
  assert.match(empty.textContent ?? "", /Other members connect their own/u);
  assert.equal(rowButton(empty, "Claude").textContent, "Connect");
  assert.equal(rowButton(empty, "Codex").textContent, "Connect");
  for (const root of roots.splice(0)) act(() => root.unmount());

  held = {
    keys: [{ ...ANTHROPIC_KEY, provider: PROVIDER_KEY_PROVIDER.OPENAI }],
    subscriptions: [CLAUDE_PLAN],
  };
  const connected = await mount();
  assert.equal(rowButton(connected, "Claude").textContent, "Connected via subscription");
  assert.ok(rowButton(connected, "Claude").querySelector(".luke-settings-saved-mark"));
  assert.equal(rowButton(connected, "Codex").textContent, "Connected via API key");
  for (const root of roots.splice(0)) act(() => root.unmount());

  // The plan's default off with a key saved is the key, whatever the plan's state.
  held = {
    keys: [ANTHROPIC_KEY],
    subscriptions: [
      { ...CLAUDE_PLAN, forAgents: false, status: PROVIDER_KEY_STATUS.INVALID },
      { ...CHATGPT_PLAN, status: PROVIDER_KEY_STATUS.INVALID },
    ],
  };
  const attention = await mount();
  assert.equal(rowButton(attention, "Claude").textContent, "Connected via API key");
  assert.equal(rowButton(attention, "Codex").textContent, "Subscription needs reconnecting");
  assert.equal(rowButton(attention, "Codex").querySelector(".luke-settings-saved-mark"), null);
  for (const root of roots.splice(0)) act(() => root.unmount());

  held = {
    keys: [],
    subscriptions: [{ ...CLAUDE_PLAN, status: PROVIDER_KEY_STATUS.LIMIT_REACHED }],
  };
  assert.equal(rowButton(await mount(), "Claude").textContent, "Limit reached");
});

test("each harness's row stands where a link to its section lands, and Codex's says it holds the key calls run on", async () => {
  const page = await mount();
  const landed = (section: string) =>
    page.querySelector(`[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${section}"]`) ??
    assert.fail(`nothing stands at ${section}`);
  assert.ok(landed(SETTINGS_SECTION.CLAUDE).contains(rowButton(page, "Claude")));
  assert.ok(landed(SETTINGS_SECTION.CODEX).contains(rowButton(page, "Codex")));
  assert.match(landed(SETTINGS_SECTION.CODEX).textContent ?? "", /OpenAI key/u);
});

test("the dialog's radios pick the plan or the key as the default, sent as the plan's forAgents, and only a saved credential's radio is pressable", async () => {
  held = { keys: [], subscriptions: [CLAUDE_PLAN] };
  const page = await mount();
  let dialog = await open(page, "Claude");
  assert.equal(radio(dialog, "Subscription").getAttribute("aria-checked"), "true");
  assert.equal(radio(dialog, "API key").disabled, true, "no key saved, nothing to pick");
  await press(dialog, "Done");

  held = { keys: [ANTHROPIC_KEY], subscriptions: [CLAUDE_PLAN] };
  for (const root of roots.splice(0)) act(() => root.unmount());
  const both = await mount();
  dialog = await open(both, "Claude");
  act(() => radio(dialog, "API key").click());
  await settle();
  assert.deepEqual(forAgentsSent(), [
    {
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      forAgents: false,
    },
  ]);
  assert.equal(radio(dialog, "API key").getAttribute("aria-checked"), "true");
  assert.equal(radio(dialog, "Subscription").getAttribute("aria-checked"), "false");
  assert.equal(rowButton(both, "Claude").textContent, "Connected via API key");

  act(() => radio(dialog, "Subscription").click());
  await settle();
  assert.equal(forAgentsSent().at(-1)?.forAgents, true);
  assert.equal(radio(dialog, "Subscription").getAttribute("aria-checked"), "true");
  assert.equal(rowButton(both, "Claude").textContent, "Connected via subscription");
});

test("an API key is pasted into a masked field with an eye, sent once, drawn as its hint with a check, and removed from its ⋯ after asking", async () => {
  const logged = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
  const page = await mount();
  const dialog = await open(page, "Claude");
  const keyCard = card(dialog, "API key");
  const field = labelled(keyCard, "Anthropic API key");
  assert.equal(field.type, "password");
  assert.equal(field.autocomplete, "off");
  paste(field, KEY);
  await press(keyCard, "Show");
  assert.equal(field.type, "text", "Show reveals what is being pasted");
  await press(keyCard, "Hide");
  assert.equal(field.type, "password", "Hide masks it again");
  assert.ok(keyCard.querySelector('a[href="https://console.anthropic.com/settings/keys"]'));

  await pasteAndSave(field, `  ${KEY}  `);
  assert.deepEqual(
    sent.filter((each) => each.kind === ACT_KIND.PROVIDER_KEYS_SAVE).map((each) => each.payload),
    [{ provider: PROVIDER_KEY_PROVIDER.ANTHROPIC, key: KEY }],
  );
  const saved =
    card(dialog, "API key").querySelector<HTMLInputElement>(
      'input[aria-label="Anthropic API key"]',
    ) ?? assert.fail("no hint");
  assert.equal(saved.value, "sk-ant-…wxyz");
  assert.equal(saved.readOnly, true);
  assert.ok(radio(dialog, "API key").querySelector(".luke-settings-saved-mark"));
  assert.equal(radio(dialog, "API key").getAttribute("aria-checked"), "true");
  assert.equal(rowButton(page, "Claude").textContent, "Connected via API key");
  assert.ok(!document.body.innerHTML.includes(KEY), "the key stands nowhere once kept");
  for (const spy of logged) {
    assert.ok(spy.mock.calls.every((call) => !JSON.stringify(call).includes(KEY)));
  }
  assert.ok(dialog.querySelector(".ph-no-capture input"), "the dialog's fields are not recorded");

  await press(card(dialog, "API key"), "Anthropic key actions");
  const remove =
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Remove",
    ) ?? assert.fail("no Remove");
  act(() => remove.click());
  await settle();
  assert.equal(
    sent.some((each) => each.kind === ACT_KIND.PROVIDER_KEYS_REMOVE),
    false,
  );
  await press(question(), "Remove key");
  assert.deepEqual(
    sent.filter((each) => each.kind === ACT_KIND.PROVIDER_KEYS_REMOVE).map((each) => each.payload),
    [{ provider: PROVIDER_KEY_PROVIDER.ANTHROPIC }],
  );
  assert.equal(rowButton(page, "Claude").textContent, "Connect");
});

test("editing a saved API key shows Saved where the key would be, never the key, and offers no Show until one is typed", async () => {
  held = { keys: [ANTHROPIC_KEY], subscriptions: [] };
  const page = await mount();
  const dialog = await open(page, "Claude");
  const keyCard = card(dialog, "API key");
  await press(keyCard, "Edit key");
  const field = labelled(keyCard, "Anthropic API key");
  assert.equal(field.placeholder, "Saved");
  assert.equal(field.value, "");
  assert.equal(field.type, "password");
  assert.equal(button(keyCard, "Show").disabled, true, "there is nothing in the window to show");
  assert.ok(
    !keyCard.innerHTML.includes(ANTHROPIC_KEY.hint),
    "not even the hint stands over the field",
  );
  paste(field, KEY);
  assert.equal(button(keyCard, "Show").disabled, false);
});

test("a Claude setup-token is saved by its kind, refused with why, and disconnected after asking", async () => {
  refusal = PROVIDER_KEY_REJECTION.INVALID;
  const page = await mount();
  const dialog = await open(page, "Claude");
  const field = labelled(card(dialog, "Subscription"), "Claude setup-token");
  assert.equal(field.type, "password");
  assert.equal(field.placeholder, 'Paste the token from "claude setup-token"');
  await pasteAndSave(field, TOKEN);
  assert.match(dialog.textContent ?? "", /That isn't a Claude setup-token\./u);
  assert.equal(field.value, TOKEN, "a refused paste stands as pasted");

  refusal = undefined;
  act(() => field.form?.requestSubmit());
  await settle();
  assert.deepEqual(
    sent.filter((each) => each.kind === ACT_KIND.PROVIDER_KEYS_SAVE).at(-1)?.payload,
    {
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      key: TOKEN,
    },
  );
  const plan = card(dialog, "Subscription");
  assert.match(plan.textContent ?? "", /Connected/u);
  assert.doesNotMatch(
    dialog.textContent ?? "",
    /checked/iu,
    "an unchecked plan reads as a connected one",
  );
  assert.match(plan.textContent ?? "", /sk-ant-oat01…fake/u);
  assert.ok(radio(dialog, "Subscription").querySelector(".luke-settings-saved-mark"));
  assert.equal(rowButton(page, "Claude").textContent, "Connected via subscription");
  assert.ok(!document.body.innerHTML.includes(TOKEN));

  await press(plan, "Disconnect");
  await press(question(), "Disconnect");
  assert.deepEqual(
    sent.filter((each) => each.kind === ACT_KIND.PROVIDER_KEYS_REMOVE).map((each) => each.payload),
    [{ provider: PROVIDER_KEY_PROVIDER.ANTHROPIC, kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN }],
  );
  assert.equal(rowButton(page, "Claude").textContent, "Connect");
});

test("a Claude token Anthropic rejected says so in its card and offers Replace token, without the setup-token hint", async () => {
  held = { keys: [], subscriptions: [{ ...CLAUDE_PLAN, status: PROVIDER_KEY_STATUS.INVALID }] };
  const page = await mount();
  const dialog = await open(page, "Claude");
  const plan = card(dialog, "Subscription");
  assert.match(plan.textContent ?? "", /Anthropic rejected this token\./u);
  await press(plan, "Replace token");
  const field = labelled(plan, "Claude setup-token");
  assert.equal(field.placeholder, "Saved", "a saved token is said, not shown");
  assert.equal(field.value, "");
});

test("Codex's subscription signs in with ChatGPT on the desktop, meets the first sign-in with OpenAI's notice once, and disconnects after asking", async () => {
  const page = await mount();
  const dialog = await open(page, "Codex");
  assert.ok(dialog.querySelector('a[href="https://platform.openai.com/api-keys"]'));
  await press(card(dialog, "Subscription"), "Sign in with ChatGPT");
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.CHATGPT_SIGN_IN).length, 1);
  assert.ok(
    [...document.querySelectorAll('[role="dialog"]')].some((each) =>
      each.textContent?.includes("You're using your ChatGPT plan"),
    ),
  );
  await press(document, "Got it");
  assert.equal(rowButton(page, "Codex").textContent, "Connected via subscription");
  assert.equal(radio(dialog, "Subscription").getAttribute("aria-checked"), "true");

  await press(card(dialog, "Subscription"), "Disconnect");
  await press(question(), "Disconnect");
  assert.deepEqual(
    sent.filter((each) => each.kind === ACT_KIND.PROVIDER_KEYS_REMOVE).map((each) => each.payload),
    [{ provider: PROVIDER_KEY_PROVIDER.OPENAI, kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH }],
  );
  assert.equal(rowButton(page, "Codex").textContent, "Connect");
});

test("without the sign-in's loopback, Codex's subscription card stands disabled and says why, while its API key card works", async () => {
  const page = await mount(
    DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.CHATGPT_SIGN_IN),
  );
  const dialog = await open(page, "Codex");
  const plan = card(dialog, "Subscription");
  assert.equal(plan.textContent, "SubscriptionDesktop app only");
  assert.equal(radio(dialog, "Subscription").disabled, true);
  const field = labelled(card(dialog, "API key"), "OpenAI API key");
  await pasteAndSave(field, KEY.replace("sk-ant-api03", "sk-proj"));
  assert.equal(rowButton(page, "Codex").textContent, "Connected via API key");
});
