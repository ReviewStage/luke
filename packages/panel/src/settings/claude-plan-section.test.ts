// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHAPTERS_MODEL } from "@luke/features/chapters-model-choice";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeysAnswer,
  type SubscriptionKeySummary,
} from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActKind, PortActResult } from "@luke/host/contract";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { CodingAgentsPage } from "./coding-agents-page.js";

/**
 * Settings › Coding agents › Claude Code over a bridge answering as the host
 * would: drawn for an account in the native-agents cohort alone; Add token
 * grows a masked field, Save sends the pasted token once with its kind and
 * clears it, and the row draws the service's hint and status of what was
 * kept; nothing of the token stands on the page afterwards or is logged;
 * Disconnect asks first and removes the token by its kind. Synthetic answers
 * throughout.
 */

/** A low-entropy fake shaped as `claude setup-token` prints one, built at run time. */
const TOKEN = ["sk", "ant", "oat01", "fake".repeat(8)].join("-");
const HINT = "sk-ant-oat01…fake";

const CONNECTED: SubscriptionKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
  hint: HINT,
  status: PROVIDER_KEY_STATUS.UNVERIFIED,
  addedAt: Date.UTC(2026, 9, 20, 12),
  statusAt: Date.UTC(2026, 9, 20, 12),
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
  switch (request.kind) {
    case ACT_KIND.CODING_AGENTS_MODELS:
      return Promise.resolve(done({ models: [] }));
    case ACT_KIND.CODING_AGENTS_DEFAULT_READ:
      return Promise.resolve(done({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
    case ACT_KIND.CHAPTERS_MODEL_READ:
      return Promise.resolve(done({ model: CHAPTERS_MODEL.HAIKU }));
    case ACT_KIND.PROVIDER_KEYS_READ:
      return Promise.resolve(done(held));
    case ACT_KIND.PROVIDER_KEYS_SAVE:
      if (refusal !== undefined) return Promise.resolve(done({ ...held, rejected: refusal }));
      held = { keys: [], subscriptions: [CONNECTED] };
      return Promise.resolve(done(held));
    case ACT_KIND.PROVIDER_KEYS_REMOVE:
      held = { keys: [] };
      return Promise.resolve(done(held));
    case ACT_KIND.PROVIDER_KEYS_FOR_AGENTS:
      held = {
        keys: [],
        subscriptions: (held.subscriptions ?? []).map((one) => ({
          ...one,
          forAgents: request.payload.forAgents,
        })),
      };
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

/** The Coding agents page for an account in the cohort or not. */
async function mount(options: { cohort?: boolean } = {}): Promise<HTMLElement> {
  handState({}, { access: { admin: false, nativeAgents: options.cohort ?? true } });
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

const claudeGroup = (page: HTMLElement) =>
  [...page.querySelectorAll("section")].find((section) =>
    section.textContent?.startsWith("Claude Code"),
  );

const button = (within: Element | Document, words: string) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === words && each.closest("[inert]") === null,
  ) ?? assert.fail(`no ${words} button`);

async function press(within: Element | Document, words: string): Promise<void> {
  act(() => button(within, words).click());
  await settle();
}

/** Types into the group's token field as a paste would. */
async function paste(group: Element, value: string): Promise<HTMLInputElement> {
  const field = group.querySelector("input") ?? assert.fail("no token field");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
  return field;
}

/** The confirm dialog standing over the window. */
const question = () =>
  document.querySelector('[role="alertdialog"]') ?? assert.fail("no question stands");

test("the Claude Code group stands for an account in the cohort alone", async () => {
  const group = claudeGroup(await mount()) ?? assert.fail("a cohort account sees it");
  assert.match(group.textContent ?? "", /Claude plan/u);
  assert.match(group.textContent ?? "", /Run claude setup-token in a terminal, then paste/u);
  for (const root of roots.splice(0)) act(() => root.unmount());
  assert.equal(claudeGroup(await mount({ cohort: false })), undefined, "outside it, nothing");
});

test("Save sends the masked field's token once with its kind, then clears it, and nothing of it stands on the page or in a log", async () => {
  const logged = [
    vi.spyOn(console, "log"),
    vi.spyOn(console, "info"),
    vi.spyOn(console, "warn"),
    vi.spyOn(console, "error"),
    vi.spyOn(console, "debug"),
  ];
  const page = await mount();
  await press(claudeGroup(page) ?? page, "Add token");
  const field = await paste(claudeGroup(page) ?? page, `  ${TOKEN}  `);
  assert.equal(field.type, "password", "the field is masked");
  assert.equal(field.autocomplete, "off");

  await press(claudeGroup(page) ?? page, "Save");
  const saves = sent.filter((request) => request.kind === ACT_KIND.PROVIDER_KEYS_SAVE);
  assert.deepEqual(
    saves.map((request) => request.payload),
    [
      {
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
        kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
        key: TOKEN,
      },
    ],
  );

  const group = claudeGroup(page) ?? assert.fail("no Claude Code group");
  assert.equal(group.querySelector("input"), null, "the field is gone once the token is kept");
  assert.match(group.textContent ?? "", /Connected · sk-ant-oat01…fake · Added /u);
  assert.ok(!document.body.innerHTML.includes(TOKEN), "the token stands nowhere on the page");
  for (const spy of logged) {
    assert.ok(
      spy.mock.calls.every((call) => !JSON.stringify(call).includes(TOKEN)),
      "the token is never logged",
    );
  }
});

test("a token refused by shape says why under the field and leaves it as pasted", async () => {
  refusal = PROVIDER_KEY_REJECTION.INVALID;
  const page = await mount();
  await press(claudeGroup(page) ?? page, "Add token");
  await paste(claudeGroup(page) ?? page, TOKEN);
  await press(claudeGroup(page) ?? page, "Save");
  const group = claudeGroup(page) ?? assert.fail("no Claude Code group");
  assert.match(group.textContent ?? "", /That isn't a Claude setup-token\./u);
  assert.equal(group.querySelector("input")?.value, TOKEN);
});

test("Escape in the field closes it, but not while an input method is composing", async () => {
  const page = await mount();
  await press(claudeGroup(page) ?? page, "Add token");
  const field = await paste(claudeGroup(page) ?? page, TOKEN);
  // Safari's composition Escape: `isComposing` already false, code 229 still.
  const composingEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
  Object.defineProperty(composingEscape, "keyCode", { value: 229 });
  act(() => {
    field.dispatchEvent(composingEscape);
  });
  await settle();
  assert.equal(claudeGroup(page)?.querySelector("input")?.value, TOKEN, "the paste stands");

  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle();
  assert.equal(claudeGroup(page)?.querySelector("input"), null, "a plain Escape closes it");
});

test("Disconnect asks first and removes the setup-token by its kind", async () => {
  held = { keys: [], subscriptions: [CONNECTED] };
  const page = await mount();
  await press(claudeGroup(page) ?? page, "Disconnect");
  assert.equal(
    sent.some((request) => request.kind === ACT_KIND.PROVIDER_KEYS_REMOVE),
    false,
    "nothing is removed before the question is answered",
  );
  await press(question(), "Disconnect");
  const removals = sent.filter((request) => request.kind === ACT_KIND.PROVIDER_KEYS_REMOVE);
  assert.deepEqual(
    removals.map((request) => request.payload),
    [{ provider: PROVIDER_KEY_PROVIDER.ANTHROPIC, kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN }],
  );
  assert.ok(button(claudeGroup(page) ?? page, "Add token"));
});

test("a token Anthropic rejected says so and offers to replace it", async () => {
  held = { keys: [], subscriptions: [{ ...CONNECTED, status: PROVIDER_KEY_STATUS.INVALID }] };
  const page = await mount();
  const group = claudeGroup(page) ?? assert.fail("no Claude Code group");
  assert.match(group.textContent ?? "", /Anthropic rejected this token\./u);
  assert.ok(button(group, "Replace token"));
});

const planSwitch = (within: Element) =>
  within.querySelector<HTMLButtonElement>(
    '[role="switch"][aria-label="Use my Claude plan for coding agents"]',
  );

test("a connected plan's switch stands on, as connecting turns it, and turning it off sends the change by the plan's kind and draws the service's word; no plan, no switch", async () => {
  const empty = claudeGroup(await mount()) ?? assert.fail("no Claude Code group");
  assert.equal(planSwitch(empty), null, "nothing to turn before a plan is connected");
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });

  held = { keys: [], subscriptions: [CONNECTED] };
  const group = claudeGroup(await mount()) ?? assert.fail("no Claude Code group");
  const toggle = planSwitch(group) ?? assert.fail("no plan switch");
  assert.equal(toggle.getAttribute("aria-checked"), "true");

  act(() => toggle.click());
  await settle();

  assert.deepEqual(
    sent
      .filter((each) => each.kind === ACT_KIND.PROVIDER_KEYS_FOR_AGENTS)
      .map((each) => each.payload),
    [
      {
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
        kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
        forAgents: false,
      },
    ],
  );
  assert.equal(planSwitch(group)?.getAttribute("aria-checked"), "false");
});
