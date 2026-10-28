// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE } from "@luke/features/agent-view";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeysAnswer,
} from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { OpenSettingsProvider } from "./open-settings.js";
import { OpenAiKeyProvider } from "./openai-key.js";
import { DictateButton } from "./tasks/dictation-strip.js";
import { useDictation } from "./tasks/use-dictation.js";
import { fakeActPort } from "./testing/app-bridge.js";
import { handState } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";

/**
 * Dictation runs on the account's own OpenAI API key, so an account known to
 * have none is offered no Dictate: it says to add the key in settings, and
 * its press opens Codex's row in Settings › Agents, where the OpenAI key is
 * saved. Until the keys are read, when a read fails, and while no one is
 * signed in, nothing is known and it stands as it always has. The window's
 * focus reads the keys again. Synthetic account and keys.
 */

const HINT = "Add an OpenAI key in settings";
const NO_EDITOR = { current: undefined };
const NO_KEYWORDS: readonly string[] = [];
const ignore = () => undefined;

const OPENAI_KEY = {
  provider: PROVIDER_KEY_PROVIDER.OPENAI,
  hint: "sk-…a1b2",
  status: PROVIDER_KEY_STATUS.VERIFIED,
} as ProviderKeysAnswer["keys"][number];

const ANTHROPIC_KEY = {
  ...OPENAI_KEY,
  provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
} as ProviderKeysAnswer["keys"][number];

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** A composer's Dictate, as any box draws it. */
function Presses(): React.JSX.Element {
  const dictation = useDictation({ editor: NO_EDITOR, keywords: NO_KEYWORDS, onNote: ignore });
  return createElement(DictateButton, { dictation, disabled: false });
}

/** The presses drawn for `account`, the keys read as `read` answers, recording what the presses opened. */
async function mount(read: () => Promise<unknown>, signedIn = true) {
  const account = signedIn ? "dev@example.com" : undefined;
  handState({}, { settings: appSettingsWire(settingsView()) });
  let reads = 0;
  fakeActPort({
    [ACT_KIND.PROVIDER_KEYS_READ]: () => {
      reads += 1;
      // SAFETY: each test answers the read in one of the shapes the port carries, or fails it.
      return read() as Promise<ProviderKeysAnswer>;
    },
  });
  const opened: SettingsLink[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          OpenSettingsProvider,
          { value: (link: SettingsLink) => opened.push(link) },
          createElement(OpenAiKeyProvider, {
            account,
            children: createElement(Presses),
          }),
        ),
      ),
    ),
  );
  await settle();
  const button = (label: string) =>
    container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`);
  return { opened, button, reads: () => reads };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

test("with no OpenAI key saved, Dictate says to add one in settings, and the press opens Codex's row in Settings › Agents rather than dictating", async () => {
  const page = await mount(() => Promise.resolve({ keys: [ANTHROPIC_KEY] }));
  const press = page.button(HINT)[0];
  assert.ok(press, "the press says to add the key");
  assert.equal(page.button("Dictate").length, 0);
  assert.equal(press.disabled, false, "the press is the way to Settings");
  act(() => press.click());
  assert.deepEqual(page.opened, [
    { page: SETTINGS_VIEW.CODING_AGENTS, section: SETTINGS_SECTION.CODEX },
  ]);
});

test("with an OpenAI key saved, Dictate is offered", async () => {
  const page = await mount(() => Promise.resolve({ keys: [OPENAI_KEY] }));
  assert.equal(page.button(HINT).length, 0);
  assert.equal(page.button("Dictate").length, 1);
  assert.deepEqual(page.opened, []);
});

test("an OpenAI key the service can no longer open counts as none, while one OpenAI refused is still tried", async () => {
  const unreadable = await mount(() =>
    Promise.resolve({ keys: [{ ...OPENAI_KEY, status: PROVIDER_KEY_STATUS.UNREADABLE }] }),
  );
  assert.equal(unreadable.button(HINT).length, 1);
  act(() => roots.pop()?.unmount());

  const refused = await mount(() =>
    Promise.resolve({ keys: [{ ...OPENAI_KEY, status: PROVIDER_KEY_STATUS.INVALID }] }),
  );
  assert.equal(refused.button(HINT).length, 0);
  assert.equal(refused.button("Dictate").length, 1);
});

test("until the keys are read, when the read fails, and while no one is signed in, nothing is turned away", async () => {
  const unread = await mount(() => new Promise(ignore));
  assert.equal(unread.button(HINT).length, 0, "a read still out disables nothing");
  assert.equal(unread.button("Dictate").length, 1);
  act(() => roots.pop()?.unmount());

  for (const failed of [
    () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    () => Promise.reject(new Error("The port is closed.")),
  ]) {
    const page = await mount(failed);
    assert.equal(page.button(HINT).length, 0, "a failed read disables nothing");
    assert.equal(page.button("Dictate").length, 1);
    act(() => roots.pop()?.unmount());
  }

  const signedOut = await mount(() => Promise.resolve({ keys: [] }), false);
  assert.equal(signedOut.reads(), 0, "no one's keys are read");
  assert.equal(signedOut.button(HINT).length, 0);
});

test("the window's focus reads the keys again, so a key saved elsewhere turns Dictate back", async () => {
  let keys: ProviderKeysAnswer["keys"] = [];
  const page = await mount(() => Promise.resolve({ keys }));
  assert.equal(page.button(HINT).length, 1);

  keys = [OPENAI_KEY];
  act(() => window.dispatchEvent(new Event("focus")));
  await settle();
  assert.equal(page.button(HINT).length, 0);
  assert.equal(page.button("Dictate").length, 1);
});
