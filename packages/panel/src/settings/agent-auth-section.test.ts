// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { CHAPTERS_MODEL } from "@repo/features/chapters-model-choice";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeySummary,
  type ProviderKeysAnswer,
  type SubscriptionKeySummary,
} from "@repo/features/provider-key-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppHostRead, AppProviderKeyList } from "@repo/host/app-state";
import type { PortActKind, PortActResult } from "@repo/host/contract";
import { HOST_CAPABILITY, type HostCapability } from "@repo/settings";
import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE } from "@repo/settings/settings-anchors";
import { SETTINGS_SECTION } from "@repo/settings/settings-views";
import { BUTTON_VARIANT, SETTINGS_ROW_STATE } from "@repo/ui";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES, handHostReads, handState, stateWith } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { AgentConnectSection } from "./agent-auth-section.js";
import { AgentsPage } from "./agents-page.js";

/**
 * Settings › Agents' harnesses over a bridge answering as the service would:
 * each row's button says how its harness is connected, or Connect, or that
 * its plan needs a hand; its dialog's rows save and remove each credential,
 * and while both are saved its default control picks the one new agents
 * use, sent as the plan's `forAgents`. Nothing pasted stands on the page once kept or
 * reaches a log. Setup's same rows connect in place, with no dialog.
 * Synthetic credentials throughout.
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
/** The ChatGPT sign-in's answer while it is held open, as a sign-in waits on the browser. */
let signInOpen: PromiseWithResolvers<FakeActAnswer> | undefined;
/** How the keys the host holds are delivered to the window again, as each write's own answer lays them. */
let deliverKeys: (next: AppHostRead<AppProviderKeyList>) => void = () => undefined;

/** A write's answer of the keys, laid where the host holds them before it answers, as the host lays it. */
function written(value: ProviderKeysAnswer): Promise<FakeActAnswer> {
  deliverKeys({ rows: value });
  return Promise.resolve(done(value));
}

const done = (value: PortActResult<PortActKind>): FakeActAnswer => ({
  status: FAKE_ANSWER.DONE,
  value,
});

function answer(request: AnyAct): Promise<FakeActAnswer> {
  sent.push(request);
  const subscriptions = held.subscriptions ?? [];
  switch (request.kind) {
    case ACT_KIND.AGENTS_MODELS:
      return Promise.resolve(done({ models: [] }));
    case ACT_KIND.AGENTS_DEFAULT_READ:
      return Promise.resolve(done({ failure: AGENT_CALL_FAILURE.UNANSWERED }));
    case ACT_KIND.CHAPTERS_MODEL_READ:
      return Promise.resolve(done({ model: CHAPTERS_MODEL.HAIKU }));
    case ACT_KIND.WEB_OPEN:
      return Promise.resolve(done(undefined));
    case ACT_KIND.PROVIDER_KEYS_SAVE:
      if (refusal !== undefined) return Promise.resolve(done({ ...held, rejected: refusal }));
      held =
        request.payload.kind === PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN
          ? { ...held, subscriptions: [...subscriptions, CLAUDE_PLAN] }
          : {
              ...held,
              keys: [...held.keys, { ...ANTHROPIC_KEY, provider: request.payload.provider }],
            };
      return written(held);
    case ACT_KIND.PROVIDER_KEYS_REMOVE: {
      const kind = request.payload.kind;
      held =
        kind === undefined || kind === PROVIDER_KEY_KIND.API_KEY
          ? { ...held, keys: held.keys.filter((one) => one.provider !== request.payload.provider) }
          : { ...held, subscriptions: subscriptions.filter((one) => one.kind !== kind) };
      return written(held);
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
      return written(held);
    case ACT_KIND.CHATGPT_SIGN_IN_CANCEL:
      // Ending a sign-in answers it as canceled, as the host does.
      signInOpen?.resolve(done({ cancelled: true }));
      signInOpen = undefined;
      return Promise.resolve(done(undefined));
    case ACT_KIND.CHATGPT_SIGN_IN:
      if (signInOpen !== undefined) return signInOpen.promise;
      held = { ...held, subscriptions: [...subscriptions, CHATGPT_PLAN] };
      return written(held);
    default:
      return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  held = { keys: [] };
  refusal = undefined;
  sent = [];
  signInOpen = undefined;
  deliverKeys = () => undefined;
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
  deliverKeys = handHostReads({ keys: { rows: held } }).deliverKeys;
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(onRegistry(AtomRegistry.make(), createElement(AgentsPage, { signedIn: true }))),
  );
  await settle();
  return container;
}

/** Setup's Connect an agent, and whether either harness stood connected after each answer. */
async function mountSetup(): Promise<{ page: HTMLElement; connected: boolean[] }> {
  const base = stateWith({}, {});
  handState(
    {},
    { access: { admin: false }, run: { ...base.run, capabilities: DESKTOP_CAPABILITIES } },
  );
  deliverKeys = handHostReads({ keys: { rows: held } }).deliverKeys;
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const connected: boolean[] = [];
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentConnectSection, { onConnected: (now) => connected.push(now) }),
      ),
    ),
  );
  await settle();
  return { page: container, connected };
}

/** A harness's row button, or the link it draws in a button's place, the check it may end in having none. */
const rowButton = (page: HTMLElement, harness: string) =>
  [...page.querySelectorAll<HTMLElement>(".ui-settings-row")]
    .find((row) => row.textContent?.startsWith(harness))
    ?.querySelector<HTMLElement>("button, a") ?? assert.fail(`no ${harness} row`);

/** What a harness's row says under its name, and in which tint, or nothing where it says nothing. */
const rowState = (page: HTMLElement, harness: string) => {
  const line = rowButton(page, harness)
    .closest(".ui-settings-row")
    ?.querySelector<HTMLElement>(".ui-settings-row-state");
  return line === null || line === undefined
    ? undefined
    : { words: line.textContent, state: line.dataset.state };
};

const connectedWith = (words: string) => ({ words, state: SETTINGS_ROW_STATE.CONNECTED });
const needsHand = (words: string) => ({ words, state: SETTINGS_ROW_STATE.ATTENTION });

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

/** The dialog's row a label names. */
const row = (dialog: Element, label: string) =>
  [...dialog.querySelectorAll<HTMLElement>(".ui-settings-row")].find(
    (each) => each.querySelector(".ui-settings-row-label")?.textContent === label,
  ) ?? assert.fail(`no ${label} row`);

/** What a dialog's row says of its credential under its name, and in which tint. */
const lineOf = (within: Element) => {
  const line = within.querySelector<HTMLElement>(".ui-settings-row-state");
  return line === null ? undefined : { words: line.textContent, state: line.dataset.state };
};

/** An option of the default's control, by its words. */
const choice = (dialog: Element, label: string) =>
  [...dialog.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (each) => each.textContent === label,
  ) ?? assert.fail(`no ${label} choice`);

/** The field a visible label names, as a reader finds it. */
function labeled(within: Element, words: string): HTMLInputElement {
  const label = [...within.querySelectorAll("label")].find((each) => each.textContent === words);
  const control = label?.control;
  assert.ok(control instanceof HTMLInputElement, `no field labeled ${words}`);
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

/**
 * The question standing at the one open dialog's foot, never in a card of
 * its own over it, with what the dialog holds stilled behind it.
 */
function question(): HTMLElement {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  assert.equal(dialogs.length, 1, "the question opens no card over the dialog");
  const dialog = dialogs[0] ?? assert.fail("no dialog");
  assert.ok(dialog.querySelector('[data-slot="dialog-body"][inert]'), "the dialog stands still");
  assert.ok(
    [...dialog.querySelectorAll("button")].every((each) => each.textContent !== "Done"),
    "the foot's own answer gives way to the question",
  );
  return dialog.querySelector<HTMLElement>('[role="group"]') ?? assert.fail("no question stands");
}

/** The act a question asks, as its look says what it costs. */
const actLook = (words: string) => button(question(), words).getAttribute("data-variant");

const forAgentsSent = () =>
  sent
    .filter((each) => each.kind === ACT_KIND.PROVIDER_KEYS_FOR_AGENTS)
    .map((each) => each.payload);

test("each harness's row names the credential in use, then what is wrong with it, beside the fix: Connect, Manage, Sign in again, or Manage usage", async () => {
  const empty = await mount();
  assert.equal(rowButton(empty, "Claude").textContent, "Connect");
  assert.equal(rowButton(empty, "Codex").textContent, "Connect");
  assert.equal(rowButton(empty, "Codex").getAttribute("aria-label"), "Connect Codex");
  const notConnected = { words: "Not connected", state: SETTINGS_ROW_STATE.PLAIN };
  assert.deepEqual(rowState(empty, "Claude"), notConnected);
  assert.deepEqual(rowState(empty, "Codex"), notConnected);
  for (const root of roots.splice(0)) act(() => root.unmount());

  held = {
    keys: [{ ...ANTHROPIC_KEY, provider: PROVIDER_KEY_PROVIDER.OPENAI, hint: "sk-proj-…7Qx2" }],
    subscriptions: [CLAUDE_PLAN],
  };
  const connected = await mount();
  assert.equal(rowButton(connected, "Claude").textContent, "Manage");
  assert.equal(rowButton(connected, "Codex").textContent, "Manage");
  assert.equal(rowButton(connected, "Claude").getAttribute("aria-label"), "Manage Claude");
  assert.equal(rowButton(connected, "Codex").getAttribute("aria-label"), "Manage Codex");
  const described = (harness: string) =>
    (rowButton(connected, harness).getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent)
      .join(" ");
  assert.match(described("Claude"), /Claude plan/u);
  assert.deepEqual(rowState(connected, "Claude"), connectedWith("Claude plan"));
  assert.deepEqual(rowState(connected, "Codex"), connectedWith("OpenAI API key sk-proj-…7Qx2"));
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
  assert.deepEqual(rowState(attention, "Claude"), connectedWith("Anthropic API key sk-ant-…wxyz"));
  assert.deepEqual(rowState(attention, "Codex"), needsHand("ChatGPT plan · Signed out"));
  assert.equal(rowButton(attention, "Codex").textContent, "Sign in again");
  assert.equal(rowButton(attention, "Codex").getAttribute("aria-label"), "Sign in to Codex again");
  for (const root of roots.splice(0)) act(() => root.unmount());

  // A plan at its limit says so after its name; only ChatGPT's offers Manage usage, which opens ChatGPT's usage settings.
  held = {
    keys: [],
    subscriptions: [
      { ...CLAUDE_PLAN, status: PROVIDER_KEY_STATUS.LIMIT_REACHED },
      { ...CHATGPT_PLAN, status: PROVIDER_KEY_STATUS.LIMIT_REACHED },
    ],
  };
  const limited = await mount();
  assert.deepEqual(rowState(limited, "Claude"), needsHand("Claude plan · Usage limit reached"));
  assert.equal(rowButton(limited, "Claude").textContent, "Manage");
  assert.deepEqual(rowState(limited, "Codex"), needsHand("ChatGPT plan · Usage limit reached"));
  assert.equal(rowButton(limited, "Codex").textContent, "Manage usage");
  assert.equal(rowButton(limited, "Codex").getAttribute("aria-label"), "Manage Codex usage");
  act(() => rowButton(limited, "Codex").click());
  await settle();
  assert.deepEqual(
    sent.filter((each) => each.kind === ACT_KIND.WEB_OPEN).map((each) => each.payload),
    [{ url: "https://chatgpt.com/settings/usage" }],
  );
  assert.equal(document.querySelector('[role="dialog"]'), null, "Manage usage opens no dialog");
});

test("each harness's row stands where a link to its section lands", async () => {
  const page = await mount();
  const landed = (section: string) =>
    page.querySelector(`[${SETTINGS_SEARCH_ANCHOR_ATTRIBUTE}="${section}"]`) ??
    assert.fail(`nothing stands at ${section}`);
  assert.ok(landed(SETTINGS_SECTION.CLAUDE).contains(rowButton(page, "Claude")));
  assert.ok(landed(SETTINGS_SECTION.CODEX).contains(rowButton(page, "Codex")));
});

test("while both credentials are saved, the dialog's own default control picks the plan or the key, sent as the plan's forAgents; with one saved, none stands", async () => {
  held = { keys: [], subscriptions: [CLAUDE_PLAN] };
  const page = await mount();
  let dialog = await open(page, "Claude");
  assert.equal(dialog.querySelector('[role="radio"]'), null, "one credential is the one used");
  await press(dialog, "Done");

  held = { keys: [ANTHROPIC_KEY], subscriptions: [CLAUDE_PLAN] };
  for (const root of roots.splice(0)) act(() => root.unmount());
  const both = await mount();
  dialog = await open(both, "Claude");
  assert.equal(
    row(dialog, "New Claude agents use")
      .querySelector('[role="radiogroup"]')
      ?.getAttribute("aria-label"),
    "New Claude agents use",
  );
  assert.equal(choice(dialog, "Claude plan").getAttribute("aria-checked"), "true");
  act(() => choice(dialog, "API key").click());
  await settle();
  assert.deepEqual(forAgentsSent(), [
    {
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      forAgents: false,
    },
  ]);
  assert.equal(choice(dialog, "API key").getAttribute("aria-checked"), "true");
  assert.equal(choice(dialog, "Claude plan").getAttribute("aria-checked"), "false");
  assert.deepEqual(rowState(both, "Claude"), connectedWith("Anthropic API key sk-ant-…wxyz"));

  act(() => choice(dialog, "Claude plan").click());
  await settle();
  assert.equal(forAgentsSent().at(-1)?.forAgents, true);
  assert.equal(choice(dialog, "Claude plan").getAttribute("aria-checked"), "true");
  assert.deepEqual(rowState(both, "Claude"), connectedWith("Claude plan"));
});

test("an API key is pasted into a masked field with an eye under its row, sent once, said as Saved with its hint, and removed with its row's Remove after asking", async () => {
  const logged = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
  const page = await mount();
  const dialog = await open(page, "Claude");
  const keyCard = row(dialog, "Anthropic API key");
  assert.match(keyCard.textContent ?? "", /Billed by Anthropic per token\./u);
  const field = labeled(keyCard, "API key");
  assert.equal(field.type, "password");
  assert.equal(field.autocomplete, "off");
  assert.ok(
    !keyCard.textContent?.includes("Saving replaces"),
    "with no key stored there is nothing to replace",
  );
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
  assert.deepEqual(lineOf(row(dialog, "Anthropic API key")), connectedWith("Saved sk-ant-…wxyz"));
  assert.equal(row(dialog, "Anthropic API key").querySelector("input"), null, "the field closes");
  assert.deepEqual(rowState(page, "Claude"), connectedWith("Anthropic API key sk-ant-…wxyz"));
  assert.ok(!document.body.innerHTML.includes(KEY), "the key stands nowhere once kept");
  for (const spy of logged) {
    assert.ok(spy.mock.calls.every((call) => !JSON.stringify(call).includes(KEY)));
  }
  assert.ok(dialog.querySelector(".ph-no-capture input"), "the dialog's fields are not recorded");

  await press(row(dialog, "Anthropic API key"), "Remove Anthropic API key");
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

test("a saved key's row draws its hint from the keys the host holds, the window asking for none of its own", async () => {
  held = { keys: [ANTHROPIC_KEY], subscriptions: [] };
  const page = await mount();
  assert.deepEqual(rowState(page, "Claude"), connectedWith("Anthropic API key sk-ant-…wxyz"));
  const dialog = await open(page, "Claude");
  assert.deepEqual(lineOf(row(dialog, "Anthropic API key")), connectedWith("Saved sk-ant-…wxyz"));
  assert.deepEqual(
    sent.map((each) => each.kind).filter((kind) => kind.startsWith("providerKeys.")),
    [ACT_KIND.PROVIDER_KEYS_FOLLOW],
  );
});

test("replacing a saved API key opens a New key field showing Saved where the key would be, offers no Show until one is typed, and turns the row's end into Cancel", async () => {
  held = { keys: [ANTHROPIC_KEY], subscriptions: [] };
  const page = await mount();
  const dialog = await open(page, "Claude");
  const keyCard = row(dialog, "Anthropic API key");
  await press(keyCard, "Replace Anthropic API key");
  const field = labeled(keyCard, "New key");
  assert.ok(document.activeElement === field, "Replace puts the focus in the field");
  assert.equal(field.placeholder, "Saved");
  assert.match(keyCard.textContent ?? "", /Saving replaces the key Vespin holds\./u);
  assert.equal(field.value, "");
  assert.equal(field.type, "password");
  assert.equal(button(keyCard, "Show").disabled, true, "there is nothing in the window to show");
  paste(field, KEY);
  assert.equal(button(keyCard, "Show").disabled, false);
  await press(keyCard, "Cancel");
  assert.equal(keyCard.querySelector("input"), null, "Cancel closes the field");
  assert.ok(!document.body.innerHTML.includes(KEY), "and drops what was pasted");
});

test("a Claude setup-token is saved by its kind, refused with why, and disconnected after asking", async () => {
  refusal = PROVIDER_KEY_REJECTION.INVALID;
  const page = await mount();
  const dialog = await open(page, "Claude");
  const field = labeled(row(dialog, "Claude plan"), "Claude setup-token");
  assert.equal(field.type, "password");
  assert.equal(field.placeholder, 'Paste the token from "claude setup-token"');
  assert.ok(
    !dialog.textContent?.includes("Saving replaces"),
    "with no token stored there is nothing to replace",
  );
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
  const plan = row(dialog, "Claude plan");
  assert.deepEqual(lineOf(plan), connectedWith("Connected"));
  assert.deepEqual(rowState(page, "Claude"), connectedWith("Claude plan"));
  assert.ok(!document.body.innerHTML.includes(TOKEN));

  await press(plan, "Disconnect");
  assert.match(question().textContent ?? "", /Disconnect your Claude plan\?/u);
  assert.equal(actLook("Disconnect"), "danger", "a deleted token is past undoing");
  await press(question(), "Disconnect");
  assert.deepEqual(
    sent.filter((each) => each.kind === ACT_KIND.PROVIDER_KEYS_REMOVE).map((each) => each.payload),
    [{ provider: PROVIDER_KEY_PROVIDER.ANTHROPIC, kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN }],
  );
  assert.equal(rowButton(page, "Claude").textContent, "Connect");
});

test("a harness's dialog opens on the first field it draws, the setup-token's, else the API key's", async () => {
  const page = await mount();
  const claude = await open(page, "Claude");
  assert.ok(document.activeElement === labeled(claude, "Claude setup-token"), "the setup-token");
  act(() => button(document, "Done").click());
  await settle();

  const codex = await open(page, "Codex");
  assert.ok(document.activeElement === labeled(codex, "API key"), "the API key");
});

test("with both credentials kept, Disconnect's question giving way to the setup-token form leaves focus on its field", async () => {
  held = { keys: [{ ...ANTHROPIC_KEY }], subscriptions: [CLAUDE_PLAN] };
  const page = await mount();
  const dialog = await open(page, "Claude");

  act(() => {
    button(row(dialog, "Claude plan"), "Disconnect").focus();
    button(row(dialog, "Claude plan"), "Disconnect").click();
  });
  await settle();
  await press(question(), "Disconnect");
  assert.ok(
    document.activeElement === labeled(dialog, "Claude setup-token"),
    "the field has focus",
  );
});

test("a Claude token Anthropic rejected says so in its row and offers Replace token, without the setup-token hint", async () => {
  held = { keys: [], subscriptions: [{ ...CLAUDE_PLAN, status: PROVIDER_KEY_STATUS.INVALID }] };
  const page = await mount();
  assert.deepEqual(rowState(page, "Claude"), needsHand("Claude plan · Needs attention"));
  const dialog = await open(page, "Claude");
  const plan = row(dialog, "Claude plan");
  assert.deepEqual(lineOf(plan), needsHand("Anthropic rejected this token. Paste a new one."));
  await press(plan, "Replace token");
  const field = labeled(plan, "Claude setup-token");
  assert.equal(field.placeholder, "Saved", "a saved token is said, not shown");
  assert.match(plan.textContent ?? "", /Saving replaces the token Vespin holds\./u);
  assert.equal(field.value, "");
});

test("a ChatGPT sign-in OpenAI no longer honors says it signed out of ChatGPT, and its row's Sign in again opens the dialog on Continue with ChatGPT", async () => {
  held = { keys: [], subscriptions: [{ ...CHATGPT_PLAN, status: PROVIDER_KEY_STATUS.INVALID }] };
  const page = await mount();
  assert.deepEqual(rowState(page, "Codex"), needsHand("ChatGPT plan · Signed out"));
  const dialog = await open(page, "Codex");
  assert.deepEqual(lineOf(row(dialog, "ChatGPT plan")), needsHand("Signed out of ChatGPT."));
  assert.ok(
    document.activeElement === button(row(dialog, "ChatGPT plan"), "Continue with ChatGPT"),
    "Continue with ChatGPT has focus",
  );
});

test("Codex's ChatGPT plan continues with ChatGPT on the desktop, meets the first sign-in with OpenAI's notice once, and disconnects after asking", async () => {
  const page = await mount();
  const dialog = await open(page, "Codex");
  assert.ok(dialog.querySelector('a[href="https://platform.openai.com/api-keys"]'));
  await press(row(dialog, "ChatGPT plan"), "Continue with ChatGPT");
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.CHATGPT_SIGN_IN).length, 1);
  assert.equal(
    document.querySelectorAll('[role="dialog"]').length,
    1,
    "OpenAI's notice opens no card over the dialog",
  );
  assert.match(row(dialog, "ChatGPT plan").textContent ?? "", /You're using your ChatGPT plan/u);
  await press(row(dialog, "ChatGPT plan"), "Got it");
  assert.doesNotMatch(dialog.textContent ?? "", /You're using your ChatGPT plan/u);
  assert.deepEqual(rowState(page, "Codex"), connectedWith("ChatGPT plan"));
  assert.deepEqual(lineOf(row(dialog, "ChatGPT plan")), connectedWith("Connected"));

  await press(row(dialog, "ChatGPT plan"), "Disconnect");
  assert.equal(actLook("Disconnect"), "danger", "an ended sign-in is past undoing");
  await press(question(), "Disconnect");
  assert.deepEqual(
    sent.filter((each) => each.kind === ACT_KIND.PROVIDER_KEYS_REMOVE).map((each) => each.payload),
    [{ provider: PROVIDER_KEY_PROVIDER.OPENAI, kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH }],
  );
  assert.equal(rowButton(page, "Codex").textContent, "Connect");
});

test("a ChatGPT sign-in waiting on the browser says so without trailing dots, beside a quiet Cancel that ends it", async () => {
  signInOpen = Promise.withResolvers();
  const page = await mount();
  const dialog = await open(page, "Codex");
  await press(row(dialog, "ChatGPT plan"), "Continue with ChatGPT");
  const waiting = button(row(dialog, "ChatGPT plan"), "Waiting for ChatGPT");
  assert.match(
    row(dialog, "ChatGPT plan").textContent ?? "",
    /Finish signing in in your browser\./u,
  );
  assert.equal(waiting.getAttribute("aria-busy"), "true");
  const cancel = button(row(dialog, "ChatGPT plan"), "Cancel");
  assert.equal(cancel.getAttribute("data-variant"), BUTTON_VARIANT.QUIET);
  await press(row(dialog, "ChatGPT plan"), "Cancel");
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.CHATGPT_SIGN_IN_CANCEL).length, 1);
});

test("without the sign-in's loopback, Codex's ChatGPT plan row offers nothing and says why, while its API key row works", async () => {
  const page = await mount(
    DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.CHATGPT_SIGN_IN),
  );
  const dialog = await open(page, "Codex");
  const plan = row(dialog, "ChatGPT plan");
  assert.equal(plan.textContent, "ChatGPT planDesktop app only");
  assert.equal(plan.querySelector("button"), null);
  const field = labeled(row(dialog, "OpenAI API key"), "API key");
  await pasteAndSave(field, KEY.replace("sk-ant-api03", "sk-proj"));
  assert.deepEqual(rowState(page, "Codex"), connectedWith("OpenAI API key sk-ant-…wxyz"));
});

test("setup connects Claude in place, with no dialog: Connect opens one row at a time on the plan's setup-token beside a choice of the key, Cancel closes it, and a saved token closes it to its state line", async () => {
  const { page, connected } = await mountSetup();
  assert.match(row(page, "Claude").textContent ?? "", /Claude plan or Anthropic API key/u);
  assert.match(row(page, "Codex").textContent ?? "", /ChatGPT plan or OpenAI API key/u);

  await press(row(page, "Claude"), "Connect Claude");
  assert.equal(document.querySelector('[role="dialog"]'), null, "the row opens in place");
  assert.equal(choice(page, "Claude plan").getAttribute("aria-checked"), "true");
  const field = labeled(row(page, "Claude"), "Claude setup-token");
  assert.ok(document.activeElement === field, "the setup-token's field has focus");
  assert.match(
    row(page, "Claude").textContent ?? "",
    /Run claude setup-token in a terminal, then paste what it prints\./u,
  );
  act(() => choice(page, "API key").click());
  await settle();
  assert.match(row(page, "Claude").textContent ?? "", /Billed by Anthropic per token\./u);
  assert.ok(labeled(row(page, "Claude"), "Anthropic API key"));

  await press(row(page, "Codex"), "Connect Codex");
  assert.equal(row(page, "Claude").querySelector("input"), null, "one row stands open");
  await press(row(page, "Codex"), "Cancel");
  assert.equal(row(page, "Codex").querySelector("input, [role='radio']"), null, "Cancel closes it");
  assert.ok(document.activeElement === button(page, "Connect Codex"), "and hands focus back");

  await press(row(page, "Claude"), "Connect Claude");
  await pasteAndSave(labeled(row(page, "Claude"), "Claude setup-token"), TOKEN);
  assert.equal(row(page, "Claude").querySelector("input"), null, "connecting closes the row");
  assert.deepEqual(lineOf(row(page, "Claude")), connectedWith("Claude plan"));
  assert.equal(button(row(page, "Claude"), "Manage Claude").textContent, "Manage");
  assert.equal(connected.at(-1), true, "setup hears an agent connected");
  assert.ok(!document.body.innerHTML.includes(TOKEN));
});

test("setup's Codex row continues with ChatGPT in place, says where to finish while it waits, ends a waiting sign-in with its Cancel, and meets the first sign-in with OpenAI's notice under the closed row", async () => {
  signInOpen = Promise.withResolvers();
  const { page } = await mountSetup();
  await press(row(page, "Codex"), "Connect Codex");
  assert.ok(document.activeElement === button(page, "Continue with ChatGPT"));
  await press(row(page, "Codex"), "Continue with ChatGPT");
  assert.match(row(page, "Codex").textContent ?? "", /Finish signing in in your browser\./u);
  assert.equal(button(page, "Waiting for ChatGPT").getAttribute("aria-busy"), "true");
  await press(row(page, "Codex"), "Cancel");
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.CHATGPT_SIGN_IN_CANCEL).length, 1);

  await press(row(page, "Codex"), "Connect Codex");
  await press(row(page, "Codex"), "Continue with ChatGPT");
  assert.deepEqual(lineOf(row(page, "Codex")), connectedWith("ChatGPT plan"));
  assert.equal(row(page, "Codex").querySelector("[role='radio']"), null, "connecting closes it");
  assert.match(row(page, "Codex").textContent ?? "", /You're using your ChatGPT plan/u);
  await press(row(page, "Codex"), "Got it");
  assert.doesNotMatch(page.textContent ?? "", /You're using your ChatGPT plan/u);
});

test("setup's row in place asks before removing a held key, over the window since no dialog holds it", async () => {
  held = { keys: [ANTHROPIC_KEY], subscriptions: [] };
  const { page } = await mountSetup();
  assert.deepEqual(lineOf(row(page, "Claude")), connectedWith("Anthropic API key sk-ant-…wxyz"));
  await press(row(page, "Claude"), "Manage Claude");
  assert.equal(choice(page, "API key").getAttribute("aria-checked"), "true", "on the key in use");
  await press(row(page, "Claude"), "Remove Anthropic API key");
  assert.equal(sent.filter((each) => each.kind === ACT_KIND.PROVIDER_KEYS_REMOVE).length, 0);
  const asked =
    document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]') ??
    assert.fail("no question asks");
  assert.match(asked.textContent ?? "", /Remove your Anthropic API key\?/u);
  await press(asked, "Remove key");
  assert.deepEqual(
    sent.filter((each) => each.kind === ACT_KIND.PROVIDER_KEYS_REMOVE).map((each) => each.payload),
    [{ provider: PROVIDER_KEY_PROVIDER.ANTHROPIC }],
  );
  assert.match(row(page, "Claude").textContent ?? "", /Claude plan or Anthropic API key/u);
});
