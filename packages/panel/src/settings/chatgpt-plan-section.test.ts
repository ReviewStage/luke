// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHAPTERS_MODEL } from "@luke/features/chapters-model-choice";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeysAnswer,
  type SubscriptionKeySummary,
} from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActKind, PortActResult } from "@luke/host/contract";
import { HOST_CAPABILITY, type HostCapability } from "@luke/settings";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES, handState, stateWith } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { CodingAgentsPage } from "./coding-agents-page.js";

/**
 * Settings › Coding agents › Codex over a bridge answering as the host would:
 * drawn on the desktop for an account in the native-agents cohort alone;
 * Continue with ChatGPT sends the press and nothing else, and the row draws
 * the service's hint and status of the sign-in that comes back; the first
 * sign-in on this Mac is met with OpenAI's notice once; Disconnect asks first,
 * removes the ChatGPT sign-in by its kind, and says plainly where OpenAI did
 * not confirm the session ended. Synthetic answers throughout.
 */

const CONNECTED: SubscriptionKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.OPENAI,
  kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
  hint: "ChatGPT",
  status: PROVIDER_KEY_STATUS.UNVERIFIED,
  addedAt: Date.UTC(2026, 9, 20, 12),
  statusAt: Date.UTC(2026, 9, 20, 12),
};

/** What the test's service holds for the account. */
let held: ProviderKeysAnswer = { keys: [] };
/** What the next sign-in answers. */
let signInAnswer: PortActResult<typeof ACT_KIND.CHATGPT_SIGN_IN> = {
  keys: [],
  subscriptions: [CONNECTED],
};
/** Whether the next removal comes back with OpenAI's revocation unconfirmed. */
let unconfirmed = false;
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
    case ACT_KIND.CHATGPT_SIGN_IN:
      if (
        !("cancelled" in signInAnswer || "refused" in signInAnswer || "failure" in signInAnswer)
      ) {
        held = signInAnswer;
      }
      return Promise.resolve(done(signInAnswer));
    case ACT_KIND.CHATGPT_SIGN_IN_CANCEL:
      return Promise.resolve(done(undefined));
    case ACT_KIND.PROVIDER_KEYS_FOR_AGENTS:
      held = {
        keys: [],
        subscriptions: (held.subscriptions ?? []).map((one) => ({
          ...one,
          forAgents: request.payload.forAgents,
        })),
      };
      return Promise.resolve(done(held));
    case ACT_KIND.PROVIDER_KEYS_REMOVE:
      held = unconfirmed ? { keys: [], revocationUnconfirmed: true } : { keys: [] };
      return Promise.resolve(done(held));
    default:
      return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  held = { keys: [] };
  signInAnswer = { keys: [], subscriptions: [CONNECTED] };
  unconfirmed = false;
  sent = [];
  window.localStorage.clear();
  fakeAppPlatform({ ...QUIET_PANEL, ...DESKTOP_LINKS });
  fakeActs({ act: answer });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The Coding agents page for an account in the cohort or not, on a platform offering `capabilities`. */
async function mount(
  options: { cohort?: boolean; capabilities?: readonly HostCapability[] } = {},
): Promise<HTMLElement> {
  const base = stateWith({}, {});
  handState(
    {},
    {
      access: { admin: false, nativeAgents: options.cohort ?? true },
      run: { ...base.run, capabilities: options.capabilities ?? DESKTOP_CAPABILITIES },
    },
  );
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

const codexGroup = (page: HTMLElement) =>
  [...page.querySelectorAll("section")].find((section) => section.textContent?.startsWith("Codex"));

const button = (within: Element | Document, words: string) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === words && each.closest("[inert]") === null,
  ) ?? assert.fail(`no ${words} button`);

async function press(within: Element | Document, words: string): Promise<void> {
  act(() => button(within, words).click());
  await settle();
}

/** The confirm dialog standing over the window. */
const question = () =>
  document.querySelector('[role="alertdialog"]') ?? assert.fail("no question stands");

const notice = () =>
  [...document.querySelectorAll('[role="dialog"]')].find((dialog) =>
    dialog.textContent?.includes("You're using your ChatGPT plan"),
  );

test("the Codex group stands on the desktop for an account in the cohort alone", async () => {
  assert.ok(codexGroup(await mount()), "a cohort account on the desktop sees it");
  for (const root of roots.splice(0)) act(() => root.unmount());
  assert.equal(
    codexGroup(await mount({ cohort: false })),
    undefined,
    "outside the cohort it is not drawn",
  );
  for (const root of roots.splice(0)) act(() => root.unmount());
  const browser = DESKTOP_CAPABILITIES.filter(
    (capability) => capability !== HOST_CAPABILITY.CHATGPT_SIGN_IN,
  );
  assert.equal(
    codexGroup(await mount({ capabilities: browser })),
    undefined,
    "a client that cannot take the loopback does not draw it",
  );
  assert.ok(
    sent.every((request) => request.kind !== ACT_KIND.CHATGPT_SIGN_IN),
    "nothing is signed in by drawing",
  );
});

test("Continue with ChatGPT sends the press alone, draws the sign-in as connected, and meets the first sign-in with OpenAI's notice once", async () => {
  const page = await mount();
  const group = codexGroup(page) ?? assert.fail("no Codex group");
  assert.match(group.textContent ?? "", /ChatGPT plan/u);
  assert.match(group.textContent ?? "", /instead of Luke's usage/u);

  await press(group, "Continue with ChatGPT");
  const signIns = sent.filter((request) => request.kind === ACT_KIND.CHATGPT_SIGN_IN);
  assert.deepEqual(signIns, [{ kind: ACT_KIND.CHATGPT_SIGN_IN }], "the press carries nothing");
  assert.match(codexGroup(page)?.textContent ?? "", /Connected · Added /u);
  const shown = notice() ?? assert.fail("no first-sign-in notice");
  assert.match(
    shown.textContent ?? "",
    /Eligible usage in Luke uses your ChatGPT plan\. Manage usage in your ChatGPT settings\./u,
  );
  await press(shown, "Got it");
  assert.equal(notice(), undefined);

  // Disconnected and connected again, the notice is not shown a second time.
  await press(codexGroup(page) ?? page, "Disconnect");
  await press(question(), "Disconnect");
  await press(codexGroup(page) ?? page, "Continue with ChatGPT");
  assert.match(codexGroup(page)?.textContent ?? "", /Connected/u);
  assert.equal(notice(), undefined);
});

test("Disconnect asks first, removes the ChatGPT sign-in by its kind, and says plainly when OpenAI didn't confirm it ended", async () => {
  held = { keys: [], subscriptions: [CONNECTED] };
  unconfirmed = true;
  const page = await mount();
  await press(codexGroup(page) ?? page, "Disconnect");
  assert.equal(
    sent.some((request) => request.kind === ACT_KIND.PROVIDER_KEYS_REMOVE),
    false,
    "nothing is removed before the question is answered",
  );
  await press(question(), "Disconnect");

  const removals = sent.filter((request) => request.kind === ACT_KIND.PROVIDER_KEYS_REMOVE);
  assert.deepEqual(
    removals.map((request) => request.payload),
    [{ provider: PROVIDER_KEY_PROVIDER.OPENAI, kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH }],
  );
  const words = codexGroup(page)?.textContent ?? "";
  assert.match(words, /OpenAI didn't confirm it ended/u);
  assert.match(words, /remove Luke in your ChatGPT settings/u);
  assert.ok(button(codexGroup(page) ?? page, "Continue with ChatGPT"));
});

test("a sign-in refused says why under the row, a withdrawn one says nothing, and neither shows the notice", async () => {
  const page = await mount();
  signInAnswer = { refused: "ChatGPT plan use wasn't enabled for Luke." };
  await press(codexGroup(page) ?? page, "Continue with ChatGPT");
  assert.match(codexGroup(page)?.textContent ?? "", /ChatGPT plan use wasn't enabled for Luke\./u);

  signInAnswer = { cancelled: true };
  await press(codexGroup(page) ?? page, "Continue with ChatGPT");
  assert.doesNotMatch(codexGroup(page)?.textContent ?? "", /wasn't enabled/u);
  assert.equal(notice(), undefined);
});

test("a sign-in OpenAI has since ended asks to connect again", async () => {
  held = { keys: [], subscriptions: [{ ...CONNECTED, status: PROVIDER_KEY_STATUS.INVALID }] };
  const page = await mount();
  const group = codexGroup(page) ?? assert.fail("no Codex group");
  assert.match(group.textContent ?? "", /ChatGPT ended this sign-in\./u);
  assert.ok(button(group, "Continue with ChatGPT"));
});

const planSwitch = (within: Element) => within.querySelector<HTMLElement>('[role="switch"]');

test("a connected sign-in's switch stands on, and turning it off sends the change by the ChatGPT kind and draws the service's word; a sign-in OpenAI ended shows no switch", async () => {
  held = { keys: [], subscriptions: [{ ...CONNECTED, status: PROVIDER_KEY_STATUS.INVALID }] };
  const ended = codexGroup(await mount()) ?? assert.fail("no Codex group");
  assert.equal(planSwitch(ended), null, "nothing to turn on a sign-in that can't pay");
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });

  held = { keys: [], subscriptions: [CONNECTED] };
  const group = codexGroup(await mount()) ?? assert.fail("no Codex group");
  const toggle = planSwitch(group) ?? assert.fail("no plan switch");
  assert.match(group.textContent ?? "", /Use my ChatGPT plan for coding agents/u);
  assert.equal(toggle.getAttribute("aria-checked"), "true");

  act(() => toggle.click());
  await settle();

  assert.deepEqual(
    sent
      .filter((each) => each.kind === ACT_KIND.PROVIDER_KEYS_FOR_AGENTS)
      .map((each) => each.payload),
    [
      {
        provider: PROVIDER_KEY_PROVIDER.OPENAI,
        kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
        forAgents: false,
      },
    ],
  );
  assert.equal(planSwitch(group)?.getAttribute("aria-checked"), "false");
});
