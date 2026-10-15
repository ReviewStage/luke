import assert from "node:assert/strict";
import { LIVE_STATUS } from "@sidecar/live";
import type { WebContents } from "electron";
import { describe, it } from "vitest";
import { CallWindowPresence } from "./call-window-presence";

const CALLING = { voiceStatus: LIVE_STATUS.LISTENING, callPlanId: "plan_1" } as const;
const HUNG_UP = { voiceStatus: LIVE_STATUS.IDLE, callPlanId: undefined } as const;

/** A surface that keeps what it was told, in order. */
function surface() {
  const told: string[] = [];
  return { told, show: () => told.push("show"), hide: () => told.push("hide") };
}

// SAFETY: the presence reads a panel by identity alone.
const PANEL = {} as WebContents;

describe("the floating call window's presence", () => {
  it("draws the card while a call stands and no panel has the keyboard, and only then", () => {
    const s = surface();
    const presence = new CallWindowPresence(s);
    presence.panelFocused(PANEL);
    presence.voiceChanged(CALLING);
    assert.deepEqual(s.told, []);
    presence.panelBlurred(PANEL);
    presence.panelFocused(PANEL);
    presence.panelBlurred(PANEL);
    presence.voiceChanged(HUNG_UP);
    assert.deepEqual(s.told, ["show", "hide", "show", "hide"]);
  });

  it("keeps the card away through a blur arriving late from a panel that handed the keyboard to another", () => {
    const s = surface();
    const presence = new CallWindowPresence(s);
    // SAFETY: as above.
    const other = {} as WebContents;
    presence.voiceChanged(CALLING);
    presence.panelFocused(PANEL);
    presence.panelFocused(other);
    presence.panelBlurred(PANEL);
    assert.deepEqual(s.told, ["show", "hide"]);
  });
});
