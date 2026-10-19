// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeyRejection,
  type ProviderKeySummary,
} from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActKind, PortActPayload, PortActResult } from "@luke/host/contract";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { ApiKeysSection } from "./api-keys-section.js";

/**
 * Settings › Coding agents › API keys over a bridge answering as the host would: a key is
 * pasted into a password field, sent once, and gone from the field once the
 * service keeps it; a kept key is drawn as the service's hint and status
 * alone, its Edit key and Remove key behind its ⋯; a refused save says why;
 * a removal asks first, in the confirm dialog. Synthetic keys.
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
let sent: { kind: PortActKind; payload: unknown }[] = [];
/** Why the service keeps nothing of the next save, where it refuses one. */
let refuseSave: ProviderKeyRejection | undefined;
/** Whether the read is answered with a failure rather than the keys. */
let refuseRead = false;
/** Whether the read is never answered, so the page stands reading. */
let holdRead = false;

type KeysAnswer = PortActResult<typeof ACT_KIND.PROVIDER_KEYS_READ>;

/** The act port, answering the page's asks of its keys the way the host would. */
function answerKeys(): void {
  fakeActPort({
    [ACT_KIND.PROVIDER_KEYS_READ]: (payload) => {
      sent.push({ kind: ACT_KIND.PROVIDER_KEYS_READ, payload });
      if (holdRead) return new Promise<KeysAnswer>(() => undefined);
      return Promise.resolve(
        refuseRead ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } : { keys: stored },
      );
    },
    [ACT_KIND.PROVIDER_KEYS_SAVE]: (
      payload: PortActPayload<typeof ACT_KIND.PROVIDER_KEYS_SAVE>,
    ) => {
      sent.push({ kind: ACT_KIND.PROVIDER_KEYS_SAVE, payload });
      if (refuseSave !== undefined) {
        return Promise.resolve({ keys: stored, rejected: refuseSave });
      }
      stored = [...stored.filter((key) => key.provider !== payload.provider), ANTHROPIC_KEPT];
      return Promise.resolve({ keys: stored });
    },
    [ACT_KIND.PROVIDER_KEYS_REMOVE]: (payload) => {
      sent.push({ kind: ACT_KIND.PROVIDER_KEYS_REMOVE, payload });
      stored = stored.filter((key) => key.provider !== payload.provider);
      return Promise.resolve({ keys: stored });
    },
  });
}

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  stored = [];
  sent = [];
  refuseSave = undefined;
  refuseRead = false;
  holdRead = false;
  answerKeys();
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
  const page = createElement(ApiKeysSection, { signedIn, onKeys: () => undefined });
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
    // Note that the value goes through the element's own setter, as typing does, so React hears it.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, key);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => input.form?.requestSubmit());
  await settle();
}

const rowOf = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll<HTMLElement>(".menu-row")].find((row) =>
    row.textContent?.startsWith(name),
  ) ?? assert.fail(`no ${name} row`);

function addKey(page: HTMLElement, name: string): void {
  act(() => button(page, "Add key", rowOf(page, name)).click());
}

test("a pasted key is sent once from a password field, leaves the field once kept, and is drawn as the service's hint alone", async () => {
  const page = await mount();

  addKey(page, "Anthropic");
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
  assert.match(row.textContent ?? "", /Verified · sk-ant-…wxyz · Added /u);
  assert.equal(page.querySelector("input"), null, "the kept key's row holds no field");
  assert.ok(!page.innerHTML.includes(PASTED), "the page holds the key nowhere once kept");
});

test("the page and its fields are kept out of the screen recording", async () => {
  const page = await mount();

  addKey(page, "OpenAI");
  assert.ok(
    page.querySelector(".ph-no-capture section"),
    "the group is under the unrecorded class",
  );
  assert.ok(field(page, "OpenAI").closest(".ph-no-capture"), "the field is under it too");
});
