// @vitest-environment jsdom

import assert from "node:assert/strict";
import { IDLE_PLANNING_VIEW } from "@sidecar/hosted/planning-view";
import { LIVE_STATUS } from "@sidecar/live";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND } from "#shared/messages/acts";
import { IDLE_VOICE_VIEW, VOICE_COMMAND, type VoiceView } from "#shared/messages/voice-view";
import { builtStylesheet, cssRules } from "#testing/css-rules";
import type { ActHandle } from "../act";
import {
  CALL_CARD_SURFACE,
  CallCard,
  CallCardDock,
  type CallCardInput,
  callControls,
  returnLabel,
} from "./call-card";
import { callCard } from "./call-card-model";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

let root: Root | undefined;
let container: HTMLElement;
/** Every act the card's presses told, in order. */
let told: unknown[][] = [];

beforeEach(() => {
  told = [];
  // Luke's face asks whether motion is reduced, which jsdom has no answer to.
  const ignore = () => undefined;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener: ignore, removeEventListener: ignore }),
  });
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

// SAFETY: the card's controls only call `tell`, and the test reads back exactly what each call was handed.
const tell = ((...sent: unknown[]) => {
  told.push(sent);
}) as ActHandle["tell"];

const LISTENING: VoiceView = {
  ...IDLE_VOICE_VIEW,
  voiceStatus: LIVE_STATUS.LISTENING,
  listening: true,
  callPlanId: INVITES,
};

/** What a window hands a card for one voice view. */
function input(view: VoiceView): CallCardInput {
  return {
    card: callCard({ view, planning: IDLE_PLANNING_VIEW }),
    speakerMuted: view.speakerMuted,
    controls: callControls(tell, view.speakerMuted),
  };
}

function draw(element: React.JSX.Element): void {
  act(() => root?.render(element));
}

function press(label: string): HTMLButtonElement {
  const button = container.querySelector(`button[aria-label="${label}"]`);
  assert.ok(button instanceof HTMLButtonElement, `no ${label} button`);
  act(() => button.click());
  return button;
}

test("the card is the call's plan, a way back named for it, and the call bar itself, and its controls tell their acts naming no plan", () => {
  draw(createElement(CallCard, { ...input(LISTENING), surface: CALL_CARD_SURFACE.SIDEBAR }));
  assert.equal(container.querySelector(".call-card-title")?.textContent, "Planning call");
  // The call bar's own row and words, not a look-alike of them.
  assert.equal(
    container.querySelector('.call-bar[data-call="true"] .call-status-word')?.textContent,
    "Listening",
  );
  press(returnLabel("Planning call"));
  assert.equal(press("Mute microphone").getAttribute("aria-pressed"), "false");
  assert.equal(press("Mute speaker").getAttribute("aria-pressed"), "false");
  press("End call");
  // There is no × to put a live call out of sight.
  assert.equal(container.querySelectorAll("button").length, 4);
  assert.deepEqual(told, [
    [ACT_KIND.CALL_SHOW_PLAN],
    [ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.TOGGLE_MICROPHONE }],
    [ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.MUTE_SPEAKER }],
    [ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.END_CALL }],
  ]);
});

test("in the floating window the plan's name is the drag handle and the way back is the same button, hinted by the system", () => {
  draw(
    createElement(CallCard, {
      ...input({
        ...LISTENING,
        voiceStatus: LIVE_STATUS.MUTED,
        listening: false,
        speakerMuted: true,
      }),
      surface: CALL_CARD_SURFACE.WINDOW,
    }),
  );
  assert.equal(container.querySelector(".call-status-word")?.textContent, "Muted");
  assert.equal(press("Unmute microphone").getAttribute("aria-pressed"), "true");
  assert.equal(press("Unmute speaker").getAttribute("aria-pressed"), "true");
  const back = press(returnLabel("Planning call"));
  assert.equal(back.title, "Open Planning call");
  assert.deepEqual(told, [
    [ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.TOGGLE_MICROPHONE }],
    [ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.UNMUTE_SPEAKER }],
    [ACT_KIND.CALL_SHOW_PLAN],
  ]);
});

test("a docked card slides out from the last call it was handed, and is gone once its slide ends", () => {
  const dock = (call: CallCardInput | undefined) =>
    draw(createElement(CallCardDock, { call, surface: CALL_CARD_SURFACE.SIDEBAR }));
  dock(undefined);
  assert.equal(container.querySelector(".call-card") === null, true);

  dock(input(LISTENING));
  const card = container.querySelector<HTMLElement>(".call-card");
  assert.equal(card?.dataset.leaving, "false");

  dock(undefined);
  const leaving = container.querySelector<HTMLElement>(".call-card");
  assert.equal(leaving?.dataset.leaving, "true");
  assert.equal(leaving?.querySelector(".call-status-word")?.textContent, "Listening");
  // Note that the end is sent under the prefixed name, because React reads
  // jsdom's missing AnimationEvent as an engine that only knows that one.
  act(() => {
    leaving?.dispatchEvent(new Event("webkitAnimationEnd", { bubbles: true }));
  });
  assert.equal(container.querySelector(".call-card") === null, true);

  // A call coming back mid-slide stays rather than leaving.
  dock(input(LISTENING));
  dock(undefined);
  dock(input(LISTENING));
  assert.equal(container.querySelector<HTMLElement>(".call-card")?.dataset.leaving, "false");
});

test("in the floating window the whole card drags the window and every button answers its own press", async () => {
  const rules = cssRules(await builtStylesheet());
  const regionOf = (selector: string) =>
    rules.find((rule) => rule.selectors.includes(selector))?.declarations.get("-webkit-app-region");
  assert.equal(regionOf('.call-card[data-surface="window"]'), "drag");
  assert.equal(regionOf('.call-card[data-surface="window"] button'), "no-drag");
});
