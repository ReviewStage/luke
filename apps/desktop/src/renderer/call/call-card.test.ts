// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { LIVE_STATUS } from "@luke/live";
import { rendererRegistry } from "@luke/panel/renderer-runtime";
import { fakeActPortAnswering, fakeAppBridge, refusedOnPort } from "@luke/panel/testing/app-bridge";
import { stateWith } from "@luke/panel/testing/app-state";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { CALL_CONTROL_LABEL } from "@luke/ui";
import { IDLE_VOICE_VIEW, type VoiceView } from "@luke/voice/voice-view";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { CallWindowCard } from "./call-window-card";

/**
 * The floating call window's card: a press main refuses is said there.
 */

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40";

const LISTENING: VoiceView = {
  ...IDLE_VOICE_VIEW,
  voiceStatus: LIVE_STATUS.LISTENING,
  listening: true,
  call: { taskId: TASK_ID, agentId: AGENT_ID },
};

const roots: Root[] = [];

/** Every act the windows sent, as the bridge was handed it. */
let sent: { kind: string; payload?: unknown }[] = [];

beforeEach(() => {
  sent = [];
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** Main's document on a call in progress, as the call window is handed it. */
function onCall(): AppStateSnapshot {
  return { ...stateWith({}, { voice: { view: LISTENING } }), version: 1 };
}

/** The bridge as a panel meets it: the document given, every act written down. */
function handBridge(first: AppStateSnapshot): void {
  fakeAppBridge({
    requestAppState: () => Promise.resolve(first),
    onAppState: () => () => undefined,
    onCallWindowMoved: () => () => undefined,
  });
  fakeActPortAnswering((request) => {
    sent.push(request);
    return Promise.resolve(undefined);
  });
}

function mount(
  element: React.ReactElement,
  registry: AtomRegistry.AtomRegistry = AtomRegistry.make(),
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(registry, element)));
  return container;
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

function button(scope: Element, name: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find(
    (each) => each.getAttribute("aria-label") === name,
  );
  assert.ok(found, `${name} is offered`);
  return found;
}

const card = (page: HTMLElement) => page.querySelector<HTMLElement>("section.call-card");

test("a press main refuses in the floating call window is said there", async () => {
  handBridge(onCall());
  fakeActPortAnswering((request) => {
    sent.push(request);
    return Promise.reject(refusedOnPort("The voice window refused end-call."));
  });
  // The window's own registry, the one its presses' toasts are shown on.
  const page = mount(createElement(CallWindowCard), rendererRegistry);
  await settle();
  const windowCard = card(page);
  assert.ok(windowCard);

  act(() => button(windowCard, CALL_CONTROL_LABEL.END_CALL).click());
  await settle();
  assert.deepEqual(sent, [{ kind: "voice.command", payload: { command: "end-call" } }]);
  const stack = document.querySelector<HTMLElement>('section[aria-label="Notifications"]');
  const toasts = [...(stack?.querySelectorAll<HTMLElement>(".luke-toast") ?? [])];
  assert.deepEqual(
    toasts.map((toast) => toast.textContent),
    ["The voice window refused end-call."],
  );
});
