// @vitest-environment jsdom

import assert from "node:assert/strict";
import { IDLE_PLANNING_VIEW } from "@sidecar/hosted/planning-view";
import { LIVE_STATUS } from "@sidecar/live";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND } from "#shared/messages/acts";
import {
  IDLE_VOICE_VIEW,
  SILENT_VOICE_LEVELS,
  VOICE_COMMAND,
  type VoiceView,
} from "#shared/messages/voice-view";
import type { ActHandle } from "../act";
import { CallPillView, callControls, RETURN_TO_PLAN_LABEL } from "./call-pill";
import { callPill } from "./call-pill-model";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

let root: Root | undefined;

beforeEach(() => {
  // Luke's face asks whether motion is reduced, which jsdom has no answer to.
  const ignore = () => undefined;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener: ignore, removeEventListener: ignore }),
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The pill drawn over one voice view, and every act its presses told, in order. */
function drawPill(view: VoiceView) {
  const told: unknown[][] = [];
  // SAFETY: the pill's controls only call `tell`, and the test reads back exactly what each call was handed.
  const tell = ((...sent: unknown[]) => {
    told.push(sent);
  }) as ActHandle["tell"];
  const container = document.body.appendChild(document.createElement("div"));
  act(() => {
    root = createRoot(container);
    root.render(
      createElement(CallPillView, {
        pill: callPill({ view, planning: IDLE_PLANNING_VIEW }),
        speakerMuted: view.speakerMuted,
        levels: SILENT_VOICE_LEVELS,
        voiceActive: { developer: false, luke: false },
        controls: callControls(tell, view.speakerMuted),
      }),
    );
  });
  const press = (label: string) => {
    const button = container.querySelector(`button[aria-label="${label}"]`);
    assert.ok(button instanceof HTMLButtonElement, `no ${label} button`);
    act(() => button.click());
    return button;
  };
  return { container, told, press };
}

const LISTENING: VoiceView = {
  ...IDLE_VOICE_VIEW,
  voiceStatus: LIVE_STATUS.LISTENING,
  listening: true,
  callPlanId: INVITES,
};

test("each of the pill's four controls tells its act, and none names a plan", () => {
  const { told, press } = drawPill(LISTENING);
  press(RETURN_TO_PLAN_LABEL);
  assert.equal(press("Mute microphone").getAttribute("aria-pressed"), "false");
  assert.equal(press("Mute speaker").getAttribute("aria-pressed"), "false");
  press("End call");
  assert.deepEqual(told, [
    [ACT_KIND.CALL_SHOW_PLAN],
    [ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.TOGGLE_MICROPHONE }],
    [ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.MUTE_SPEAKER }],
    [ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.END_CALL }],
  ]);
});

test("a mute that is on is pressed and offers to undo itself, and the status says so", () => {
  const { container, told, press } = drawPill({
    ...LISTENING,
    voiceStatus: LIVE_STATUS.MUTED,
    listening: false,
    speakerMuted: true,
  });
  assert.equal(container.querySelector(".call-pill-status")?.textContent, "Muted");
  assert.equal(press("Unmute microphone").getAttribute("aria-pressed"), "true");
  assert.equal(press("Unmute speaker").getAttribute("aria-pressed"), "true");
  assert.deepEqual(told, [
    [ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.TOGGLE_MICROPHONE }],
    [ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.UNMUTE_SPEAKER }],
  ]);
});
