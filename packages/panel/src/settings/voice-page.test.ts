// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MOTION_DELAY_MS } from "@luke/brand";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeysAnswer,
} from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { settingsView } from "@luke/settings/testing";
import { UPDATE_STATUS } from "@luke/settings/update";
import { MICROPHONE_STATUS, type MicrophoneStatus } from "@luke/voice/audio";
import {
  type MicrophoneControl,
  NOTIFICATIONS_GRANTOR,
  NOTIFICATIONS_STATUS,
} from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { OpenSettingsProvider } from "../open-settings.js";
import { OpenAiKeyProvider } from "../openai-key.js";
import { FAKE_ANSWER, fakeActPort } from "../testing/app-bridge.js";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { SettingsPanel, type SettingsPanelProps } from "./settings-panel.js";

/**
 * Settings › Voice as the panel draws it, stage by stage: how to turn voice
 * on while it cannot run, then the microphone's permission with the one
 * control its answer allows, then the conversation's controls once Luke can
 * listen.
 */

const ignore = () => undefined;
const accepted = () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });

/** A signed-in account's Settings on the Voice page, every press but the microphone's ignored. */
function settingsOn(microphone: MicrophoneControl): SettingsPanelProps {
  return {
    account: {
      status: ACCOUNT_STATUS.SIGNED_IN,
      email: "dev@example.com",
      name: "Dev",
      provider: "github",
    },
    onSignOut: () => Promise.resolve(),
    onDeleteAccount: accepted,
    view: SETTINGS_VIEW.VOICE,
    onViewChange: ignore,
    microphone,
    notifications: {
      status: NOTIFICATIONS_STATUS.UNKNOWN,
      grantor: NOTIFICATIONS_GRANTOR.MACOS,
      packaged: true,
      onOpenSettings: ignore,
      onTest: ignore,
    },
    capabilities: DESKTOP_CAPABILITIES,
    updates: {
      update: {
        status: UPDATE_STATUS.IDLE,
        currentVersion: "1.0.0",
        installSupported: true,
        upToDate: false,
      },
      build: { packaged: true },
      onCheck: () => Promise.resolve(),
      onInstall: ignore,
      onOpenLatest: ignore,
    },
    settings: settingsView({ voiceAvailable: microphone.voiceAvailable }),
  };
}

/** The microphone's control at the given answer from macOS, its presses ignored. */
function microphoneAt(
  status: MicrophoneStatus,
  overrides: Partial<MicrophoneControl> = {},
): MicrophoneControl {
  return { status, voiceAvailable: true, onRequest: ignore, onOpenSettings: ignore, ...overrides };
}

const roots: Root[] = [];

/** Draws Settings on the Voice page and answers the container, and how to draw it again at another answer. */
function draw(microphone: MicrophoneControl) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const redraw = (next: MicrophoneControl) =>
    root.render(onRegistry(registry, createElement(SettingsPanel, settingsOn(next))));
  act(() => redraw(microphone));
  return { container, redraw };
}

function button(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (each) => each.getAttribute("aria-label") === name || each.textContent === name,
  );
}

function headings(container: HTMLElement): string[] {
  return [...container.querySelectorAll("h2")].map((each) => each.textContent ?? "");
}

beforeEach(() => {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: () => Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT }),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const each of roots.splice(0)) act(() => each.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

test("while voice cannot run, the page says how to turn it on and offers nothing else", () => {
  const { container } = draw(microphoneAt(MICROPHONE_STATUS.GRANTED, { voiceAvailable: false }));

  assert.match(container.textContent ?? "", /Voice is off: sign in to turn it on\./u);
  assert.ok(!headings(container).includes("Permissions"));
  assert.ok(!headings(container).includes("Conversation"));
  assert.equal(button(container, "Allow"), undefined);
});

test("before macOS has been asked, Allow asks, and the controls stand once macOS allows", () => {
  // Note that the request stands in for macOS's prompt, which answers by
  // handing the panel a granted microphone.
  const { container, redraw } = draw(
    microphoneAt(MICROPHONE_STATUS.NOT_DETERMINED, {
      onRequest: () => redraw(microphoneAt(MICROPHONE_STATUS.GRANTED)),
    }),
  );
  assert.equal(button(container, "Open Privacy & Security in System Settings"), undefined);
  assert.ok(!headings(container).includes("Conversation"));

  act(() => button(container, "Allow")?.click());

  assert.ok(headings(container).includes("Conversation"));
  assert.equal(button(container, "Allow"), undefined);
});

test("once macOS refused, the row says where to allow it and opens System Settings", () => {
  let opened = 0;
  const { container } = draw(
    microphoneAt(MICROPHONE_STATUS.DENIED, { onOpenSettings: () => (opened += 1) }),
  );

  act(() => button(container, "Open Privacy & Security in System Settings")?.click());

  assert.equal(opened, 1);
  assert.match(
    container.textContent ?? "",
    /Allow Luke in System Settings › Privacy & Security › Microphone\./,
  );
  assert.equal(button(container, "Allow"), undefined);
  assert.ok(!headings(container).includes("Conversation"));
});

test("resting on the System Settings glyph says its name, the words of what it opens", () => {
  const { container } = draw(microphoneAt(MICROPHONE_STATUS.DENIED));
  const glyph = button(container, "Open Privacy & Security in System Settings");

  restOn(glyph ?? assert.fail("no System Settings glyph"));

  assert.equal(
    document.querySelector('[role="tooltip"]')?.textContent,
    "Open Privacy & Security in System Settings",
  );
});

test("once the microphone is allowed, the conversation's controls stand under it", () => {
  const { container } = draw(microphoneAt(MICROPHONE_STATUS.GRANTED));

  assert.deepEqual(
    headings(container).filter((each) => each === "Permissions" || each === "Conversation"),
    ["Permissions", "Conversation"],
  );
  assert.equal(button(container, "Allow"), undefined);
});

test("Allow shows its ring once the request has been out the settle delay, and stops when it settles", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let answer: () => void = ignore;
  const { container } = draw(
    microphoneAt(MICROPHONE_STATUS.NOT_DETERMINED, {
      onRequest: () => new Promise<void>((settle) => (answer = settle)),
    }),
  );
  const ringIn = (each: HTMLElement) => each.querySelector(".luke-spinner-ring") !== null;

  act(() => button(container, "Allow")?.click());
  const busy = button(container, "Asking for access");
  assert.ok(busy);
  assert.equal(busy.getAttribute("aria-busy"), "true");
  act(() => vi.advanceTimersByTime(MOTION_DELAY_MS.SETTLE - 1));
  assert.equal(ringIn(busy), false);
  act(() => vi.advanceTimersByTime(1));
  assert.equal(ringIn(busy), true);

  await act(async () => answer());

  const allow = button(container, "Allow");
  assert.ok(allow);
  assert.equal(allow.getAttribute("aria-busy"), null);
  assert.equal(ringIn(allow), false);
});

/** Settings on the Voice page under the window's key reader, the account's keys read as `keys`, recording what Settings opened. */
async function drawWithKeys(keys: ProviderKeysAnswer["keys"]) {
  fakeActPort({ [ACT_KIND.PROVIDER_KEYS_READ]: () => Promise.resolve({ keys }) });
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
            account: "dev@example.com",
            children: createElement(
              SettingsPanel,
              settingsOn(microphoneAt(MICROPHONE_STATUS.GRANTED)),
            ),
          }),
        ),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return { container, opened };
}

test("with no OpenAI key saved, the page leads with where to add one, and its press opens Codex's row in Agents", async () => {
  const { container, opened } = await drawWithKeys([]);
  const words = container.textContent ?? "";
  assert.ok(words.indexOf("OpenAI key") < words.indexOf("Microphone"), "the key's row comes first");

  const add = button(container, "Add an OpenAI key") ?? assert.fail("the row offers to add one");
  act(() => add.click());
  assert.deepEqual(opened, [
    { page: SETTINGS_VIEW.CODING_AGENTS, section: SETTINGS_SECTION.CODEX },
  ]);
});

test("with an OpenAI key saved, the row points to it without showing any of it", async () => {
  const hint = "sk-…a1b2";
  const { container, opened } = await drawWithKeys([
    {
      provider: PROVIDER_KEY_PROVIDER.OPENAI,
      hint,
      status: PROVIDER_KEY_STATUS.VERIFIED,
      addedAt: 1,
      statusAt: 1,
    },
  ]);
  assert.equal(button(container, "Add an OpenAI key"), undefined);
  assert.ok(!(container.textContent ?? "").includes(hint), "no part of the key is drawn");

  const open = button(container, "Open in Agents") ?? assert.fail("the row opens where it is kept");
  act(() => open.click());
  assert.deepEqual(opened, [
    { page: SETTINGS_VIEW.CODING_AGENTS, section: SETTINGS_SECTION.CODEX },
  ]);
});
