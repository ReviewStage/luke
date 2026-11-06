// @vitest-environment jsdom

import assert from "node:assert/strict";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeysAnswer,
} from "@repo/features/provider-key-wire";
import { ACT_KIND } from "@repo/host/acts";
import { type AppHostRead, type AppProviderKeyList, UNREAD } from "@repo/host/app-state";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@repo/settings/settings-views";
import { appSettingsWire, settingsView } from "@repo/settings/testing";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { OpenSettingsProvider } from "./open-settings.js";
import { OpenAiKeyProvider } from "./openai-key.js";
import { DictateButton } from "./tasks/dictation-strip.js";
import { useDictation } from "./tasks/use-dictation.js";
import { fakeActPort, quietHold } from "./testing/app-bridge.js";
import { handState } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";

const HINT = "Add an OpenAI key in Settings";
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

function Presses(): React.JSX.Element {
  const dictation = useDictation({ editor: NO_EDITOR, keywords: NO_KEYWORDS, onNote: ignore });
  return createElement(DictateButton, { dictation, disabled: false });
}

async function mount(held: AppHostRead<AppProviderKeyList>, signedIn = true) {
  const account = signedIn ? "dev@example.com" : undefined;
  handState(
    {},
    {
      settings: appSettingsWire(settingsView()),
      [LIVE_READ.PROVIDER_KEYS]: account === undefined ? {} : { [account]: held },
    },
  );
  let holds = 0;
  fakeActPort({
    [ACT_KIND.PROVIDER_KEYS_FOLLOW]: () => {
      holds += 1;
      return quietHold();
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
  return { opened, button, holds: () => holds };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

test("with no OpenAI key saved, Dictate says to add one in settings, and the press opens Codex's row in Settings › Agents rather than dictating", async () => {
  const page = await mount({ rows: { keys: [ANTHROPIC_KEY] } });
  const press = await vi.waitFor(
    () => page.button(HINT)[0] ?? assert.fail("the press says to add the key"),
  );
  assert.equal(page.button("Dictate").length, 0);
  assert.equal(press.disabled, false, "the press is the way to Settings");
  act(() => press.click());
  assert.deepEqual(page.opened, [{ page: SETTINGS_VIEW.AGENTS, section: SETTINGS_SECTION.CODEX }]);
});

test("with an OpenAI key saved, Dictate is offered", async () => {
  const page = await mount({ rows: { keys: [OPENAI_KEY] } });
  assert.equal(page.button(HINT).length, 0);
  assert.equal(page.button("Dictate").length, 1);
  assert.deepEqual(page.opened, []);
});

test("an OpenAI key the service can no longer open counts as none, while one OpenAI refused is still tried", async () => {
  const unreadable = await mount({
    rows: { keys: [{ ...OPENAI_KEY, status: PROVIDER_KEY_STATUS.UNREADABLE }] },
  });
  await vi.waitFor(() => assert.equal(unreadable.button(HINT).length, 1));
  act(() => roots.pop()?.unmount());

  const refused = await mount({
    rows: { keys: [{ ...OPENAI_KEY, status: PROVIDER_KEY_STATUS.INVALID }] },
  });
  await vi.waitFor(() => assert.equal(refused.button("Dictate").length, 1));
  assert.equal(refused.button(HINT).length, 0);
});

test("until the keys are read, when the read fails, and while no one is signed in, nothing is turned away", async () => {
  const unread = await mount(UNREAD);
  assert.equal(unread.button(HINT).length, 0, "a read still out disables nothing");
  assert.equal(unread.button("Dictate").length, 1);
  act(() => roots.pop()?.unmount());

  const failed = await mount({ failed: true });
  assert.equal(failed.button(HINT).length, 0, "a failed read disables nothing");
  assert.equal(failed.button("Dictate").length, 1);
  act(() => roots.pop()?.unmount());

  const signedOut = await mount({ rows: { keys: [] } }, false);
  assert.equal(signedOut.holds(), 0, "no one's keys are held");
  assert.equal(signedOut.button(HINT).length, 0);
});
