// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { settingsView } from "@luke/settings/testing";
import { UPDATE_STATUS } from "@luke/settings/update";
import { MICROPHONE_STATUS, type MicrophoneStatus } from "@luke/voice/audio";
import { VOICE_KEYLESS_NOTE } from "@luke/voice/microphone-access";
import { type MicrophoneControl, NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { DESKTOP_CAPABILITIES } from "#testing/app-state";
import { onRegistry } from "#testing/copy-feedback";
import { SettingsPanel, type SettingsPanelProps } from "./settings-panel";

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
    shortcuts: {
      voiceHotkeyHeld: false,
      voiceChosen: false,
      voiceOff: false,
      onVoiceHotkeyChange: accepted,
      stopChosen: false,
      stopOff: false,
      onStopHotkeyChange: accepted,
      onCapture: ignore,
    },
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
      act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const each of roots.splice(0)) act(() => each.unmount());
  document.body.innerHTML = "";
});

test("while voice cannot run, the page says how to turn it on and offers nothing else", () => {
  const { container } = draw(microphoneAt(MICROPHONE_STATUS.GRANTED, { voiceAvailable: false }));

  assert.match(container.textContent ?? "", new RegExp(VOICE_KEYLESS_NOTE));
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

test("once the microphone is allowed, the conversation's controls stand under it", () => {
  const { container } = draw(microphoneAt(MICROPHONE_STATUS.GRANTED));

  assert.deepEqual(
    headings(container).filter((each) => each === "Permissions" || each === "Conversation"),
    ["Permissions", "Conversation"],
  );
  assert.equal(button(container, "Allow"), undefined);
});
