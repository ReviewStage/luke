// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeyRejection,
  type ProviderKeySummary,
} from "@sidecar/hosted/provider-key-wire";
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
import { PAST_SPINNER_DELAY, waitsIn } from "#testing/spinner";
import { ApiKeysSection } from "./api-keys-section";

/**
 * Settings › Coding agents › API keys over a bridge answering as the host would: a key is
 * pasted into a password field, sent once, and gone from the field once the
 * service keeps it; a kept key is drawn as the service's hint and status
 * alone; a refused save says why; a removal asks first. Synthetic keys.
 */

const PASTED = "sk-ant-api03-synthetic-0000000000000000wxyz";

const ANTHROPIC_KEPT: ProviderKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  hint: "sk-ant-…wxyz",
  addedAt: Date.UTC(2026, 9, 12, 12),
  status: PROVIDER_KEY_STATUS.VERIFIED,
  statusAt: Date.UTC(2026, 9, 12, 12),
};

/** The keys the test's service holds, read and written by the page. */
let stored: ProviderKeySummary[] = [];
/** Every act the page sent, in order. */
let sent: Act[] = [];
/** Why the service keeps nothing of the next save, where it refuses one. */
let refuseSave: ProviderKeyRejection | undefined;
/** Whether the read is answered with a failure rather than the keys. */
let refuseRead = false;
/** Whether the read is never answered, so the page stands reading. */
let holdRead = false;
/** Where a save is held unanswered until the test lets it go, rather than answered at once. */
let holdSaves: ((answer: ActOutcome) => void)[] | undefined;

const done = (value: ActResultFor<ActKind>): ActOutcome => ({
  status: ACT_OUTCOME_STATUS.DONE,
  value,
});

/** The bridge, answering the page's acts the way the host would. */
function answer(request: Act): Promise<ActOutcome> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.PROVIDER_KEYS_READ:
      if (holdRead) return new Promise(() => undefined);
      return Promise.resolve(
        done(refuseRead ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } : { keys: stored }),
      );
    case ACT_KIND.PROVIDER_KEYS_SAVE:
      if (holdSaves !== undefined) {
        const held = holdSaves;
        return new Promise((resolve) => held.push(resolve));
      }
      if (refuseSave !== undefined) {
        return Promise.resolve(done({ keys: stored, rejected: refuseSave }));
      }
      stored = [
        ...stored.filter((key) => key.provider !== request.payload.provider),
        ANTHROPIC_KEPT,
      ];
      return Promise.resolve(done({ keys: stored }));
    case ACT_KIND.PROVIDER_KEYS_REMOVE:
      stored = stored.filter((key) => key.provider !== request.payload.provider);
      return Promise.resolve(done({ keys: stored }));
    default:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  stored = [];
  sent = [];
  refuseSave = undefined;
  refuseRead = false;
  holdRead = false;
  holdSaves = undefined;
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
  const page = createElement(ApiKeysSection, { signedIn });
  act(() => root.render(registry === undefined ? page : onRegistry(registry, page)));
  await settle();
  return container;
}

const field = (page: HTMLElement, name: string) =>
  page.querySelector<HTMLInputElement>(`input[aria-label="${name} API key"]`) ??
  assert.fail(`no ${name} field`);

const button = (page: HTMLElement, words: string, within?: Element) =>
  [...(within ?? page).querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === words && each.closest("[inert]") === null,
  ) ?? assert.fail(`no ${words} button`);

/** Pastes a key into the provider's field and saves it. */
async function paste(page: HTMLElement, name: string, key: string): Promise<void> {
  const input = field(page, name);
  act(() => {
    input.value = key;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => input.form?.requestSubmit());
  await settle();
}

const rowOf = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll<HTMLElement>(".api-key-row")].find(
    (row) => row.querySelector("strong")?.textContent === name,
  ) ?? assert.fail(`no ${name} row`);

test("a pasted key is sent once from a password field, leaves the field once kept, and is drawn as the service's hint alone", async () => {
  const page = await mount();

  const input = field(page, "Anthropic");
  assert.equal(input.type, "password");
  assert.equal(input.autocomplete, "off");
  await paste(page, "Anthropic", PASTED);

  const saves = sent.filter((request) => request.kind === ACT_KIND.PROVIDER_KEYS_SAVE);
  assert.deepEqual(
    saves.map((request) => request.payload),
    [{ provider: PROVIDER_KEY_PROVIDER.ANTHROPIC, key: PASTED }],
  );
  const row = rowOf(page, "Anthropic");
  assert.match(row.textContent ?? "", /sk-ant-…wxyz · Added .* · Verified/u);
  assert.equal(row.querySelector("input"), null, "the kept key's row holds no field");
  assert.ok(!page.innerHTML.includes(PASTED), "the page holds the key nowhere once kept");
});

test("the page and its fields are kept out of the screen recording", async () => {
  const page = await mount();

  assert.ok(page.querySelector("section")?.classList.contains("ph-no-capture"));
  assert.ok(field(page, "OpenAI").classList.contains("ph-no-capture"));
});

test("a save the service refuses says why under the row and keeps nothing", async () => {
  refuseSave = PROVIDER_KEY_REJECTION.WRONG_PROVIDER;
  const page = await mount();

  await paste(page, "OpenAI", PASTED);

  assert.equal(
    rowOf(page, "OpenAI").querySelector('[role="alert"]')?.textContent,
    "This looks like an Anthropic key. Paste it into the Anthropic row.",
  );
  assert.ok(rowOf(page, "OpenAI").querySelector("input"), "the field stands for another try");
});

test("a key the provider refused, one out of quota, and one the service cannot read each ask for a hand", async () => {
  stored = [
    { ...ANTHROPIC_KEPT, status: PROVIDER_KEY_STATUS.UNREADABLE },
    {
      ...ANTHROPIC_KEPT,
      provider: PROVIDER_KEY_PROVIDER.OPENAI,
      hint: "sk-proj-…abcd",
      status: PROVIDER_KEY_STATUS.QUOTA_EXCEEDED,
    },
  ];
  const page = await mount();

  assert.equal(
    rowOf(page, "Anthropic").querySelector('[role="alert"]')?.textContent,
    "This key can no longer be read. Replace it.",
  );
  assert.equal(
    rowOf(page, "OpenAI").querySelector('[role="alert"]')?.textContent,
    "Out of quota or credit at OpenAI.",
  );
});

test("Replace opens the field over a kept key, and Remove asks before it removes", async () => {
  stored = [ANTHROPIC_KEPT];
  const page = await mount();

  act(() => button(page, "Replace", rowOf(page, "Anthropic")).click());
  assert.ok(field(page, "Anthropic"));
  act(() => button(page, "Cancel", rowOf(page, "Anthropic")).click());
  act(() => button(page, "Remove", rowOf(page, "Anthropic")).click());
  const askedBeforeRemoving = sent.some(
    (request) => request.kind === ACT_KIND.PROVIDER_KEYS_REMOVE,
  );
  act(() =>
    button(page, "Remove", rowOf(page, "Anthropic").querySelector("fieldset") ?? undefined).click(),
  );
  await settle();

  assert.equal(askedBeforeRemoving, false);
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.PROVIDER_KEYS_REMOVE)
      .map((request) => request.payload),
    [{ provider: PROVIDER_KEY_PROVIDER.ANTHROPIC }],
  );
  assert.ok(field(page, "Anthropic"), "a removed key's row offers the field again");
});

test("a read that fails offers to try again, and no account reads nothing", async () => {
  refuseRead = true;
  const failed = await mount();
  const signedOut = await mount(false);

  assert.equal(failed.querySelector('[role="alert"]')?.textContent, "Your keys could not be read.");
  assert.equal(
    signedOut.querySelector(".settings-note")?.textContent,
    "Sign in to add your own API keys.",
  );
  assert.equal(signedOut.querySelector("input"), null, "no field without an account to hold a key");
});

it.effect(
  "while the keys are read the page draws the spinner in their rows' place, saying Loading your keys to a reader",
  () =>
    Effect.gen(function* () {
      holdRead = true;
      const registry = yield* registryOnTestClock;
      const page = yield* Effect.promise(() => mount(true, registry));
      yield* TestClock.adjust(PAST_SPINNER_DELAY);
      yield* Effect.promise(settle);
      assert.deepEqual(waitsIn(page), [{ says: "Loading your keys", ring: true }]);
      assert.equal(page.querySelector('input[type="password"]'), null, "no rows before the read");
      assert.doesNotMatch(page.textContent ?? "", /Reading/u);
    }),
);

test("while one row's save is out, the other row waits, so two answers cannot land out of order", async () => {
  holdSaves = [];
  const page = await mount();

  await paste(page, "Anthropic", PASTED);
  const openAiSave = button(page, "Save", rowOf(page, "OpenAI"));
  const waited = openAiSave.disabled;
  const release = holdSaves[0] ?? assert.fail("the save was not sent");
  stored = [ANTHROPIC_KEPT];
  release({ status: ACT_OUTCOME_STATUS.DONE, value: { keys: stored } });
  await settle();

  assert.equal(waited, true);
  assert.equal(button(page, "Save", rowOf(page, "OpenAI")).disabled, false);
});
