import assert from "node:assert/strict";
import { LIVE_STATUS } from "@luke/live";
import { AVATAR_END_REASON, AVATAR_OFF, AVATAR_STATUS } from "@luke/voice/avatar";
import type { WebContents } from "electron";
import { describe, it } from "vitest";
import {
  CALL_WINDOW_BOUNDS,
  CallWindowPresence,
  callWindowCard,
  callWindowFrame,
} from "./call-window-presence";

const CALLING = {
  view: { voiceStatus: LIVE_STATUS.LISTENING, callPlanId: "plan_1" },
  avatar: AVATAR_OFF,
} as const;
const HUNG_UP = {
  view: { voiceStatus: LIVE_STATUS.IDLE, callPlanId: undefined },
  avatar: AVATAR_OFF,
} as const;

/** A surface that keeps what it was told, in order. */
function surface() {
  const told: string[] = [];
  return {
    told,
    show: () => told.push("show"),
    hide: () => told.push("hide"),
    fitVideo: (video: boolean) => told.push(video ? "fit video" : "fit card"),
  };
}

/** A display's work area under a menu bar, a 1512×945 laptop's. */
const LAPTOP = { x: 0, y: 25, width: 1512, height: 920 } as const;

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

  it("grows the window for the avatar while it stands on the call, and back once it is down", () => {
    const s = surface();
    const presence = new CallWindowPresence(s);
    presence.voiceChanged(CALLING);
    presence.voiceChanged({ ...CALLING, avatar: { status: AVATAR_STATUS.STARTING } });
    presence.voiceChanged({ ...CALLING, avatar: { status: AVATAR_STATUS.LIVE } });
    presence.voiceChanged({
      ...CALLING,
      avatar: { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.ERROR },
    });
    presence.voiceChanged({ ...CALLING, avatar: { status: AVATAR_STATUS.LIVE } });
    // A call that ends leaves no tile, whatever the avatar last said.
    presence.voiceChanged({ ...HUNG_UP, avatar: { status: AVATAR_STATUS.LIVE } });
    assert.deepEqual(s.told, ["show", "fit video", "fit card", "fit video", "fit card", "hide"]);
  });

  it("fits the window before it shows, so it never shows at the size it is leaving", () => {
    const s = surface();
    const presence = new CallWindowPresence(s);
    presence.panelFocused(PANEL);
    presence.voiceChanged({ ...CALLING, avatar: { status: AVATAR_STATUS.LIVE } });
    presence.panelBlurred(PANEL);
    assert.deepEqual(s.told, ["fit video", "show"]);
  });
});

describe("the floating call window's frame", () => {
  const card = { x: 8, y: LAPTOP.y + LAPTOP.height - CALL_WINDOW_BOUNDS.HEIGHT - 8 };

  it("grows upward by the avatar's tile, the card's controls kept where they were, and shrinks back", () => {
    const alone = callWindowFrame({ card, video: false, workAreas: [LAPTOP] });
    assert.deepEqual(alone, { ...card, width: 264, height: 92 });
    const grown = callWindowFrame({ card, video: true, workAreas: [LAPTOP] });
    assert.deepEqual(grown, { x: card.x, y: card.y - 129, width: 264, height: 221 });
    assert.equal(grown.y + grown.height, alone.y + alone.height);
    assert.deepEqual(callWindowCard(grown), card);
    assert.deepEqual(
      callWindowFrame({ card: callWindowCard(grown), video: false, workAreas: [LAPTOP] }),
      alone,
    );
  });

  it("keeps the grown window on its display: a card under the menu bar grows downward instead", () => {
    const high = { x: 600, y: LAPTOP.y + 20 };
    const grown = callWindowFrame({ card: high, video: true, workAreas: [LAPTOP] });
    assert.deepEqual(grown, { x: 600, y: LAPTOP.y, width: 264, height: 221 });
    // On a second display above the laptop's, the same rule holds there.
    const above = { x: 0, y: -1080, width: 1920, height: 1080 } as const;
    const onTop = callWindowFrame({
      card: { x: 40, y: -1075 },
      video: true,
      workAreas: [LAPTOP, above],
    });
    assert.equal(onTop.y, above.y);
  });
});
