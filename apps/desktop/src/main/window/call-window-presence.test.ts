import assert from "node:assert/strict";
import { LIVE_STATUS } from "@sidecar/live";
import type { WebContents } from "electron";
import { describe, it } from "vitest";
import { AVATAR_STATUS } from "#shared/messages/avatar";
import {
  CALL_VIDEO_BOUNDS,
  CALL_WINDOW_BOUNDS,
  CallWindowPresence,
  callWindowFrame,
} from "./call-window-presence";

const CALLING = { voiceStatus: LIVE_STATUS.LISTENING, callPlanId: "plan_1" } as const;
const HUNG_UP = { voiceStatus: LIVE_STATUS.IDLE, callPlanId: undefined } as const;

/** A surface that keeps what it was last told: whether it stands, and at which size. */
function surface() {
  const told: string[] = [];
  const held = { standing: false, video: false, told };
  return {
    held,
    show: () => {
      held.standing = true;
      told.push("show");
    },
    hide: () => {
      held.standing = false;
      told.push("hide");
    },
    fitVideo: (video: boolean) => {
      held.video = video;
      told.push(video ? "video" : "card");
    },
  };
}

// SAFETY: the presence reads a panel by identity alone.
const PANEL = {} as WebContents;

describe("the floating call window's presence", () => {
  it("hides the card while a panel has the keyboard, and keeps the video up through it", () => {
    const s = surface();
    const presence = new CallWindowPresence(s);
    presence.panelFocused(PANEL);
    presence.voiceChanged(CALLING, AVATAR_STATUS.OFF);
    assert.equal(s.held.standing, false);
    presence.voiceChanged(CALLING, AVATAR_STATUS.STARTING);
    assert.deepEqual(s.held, { standing: true, video: true, told: ["video", "show"] });
    presence.voiceChanged(CALLING, AVATAR_STATUS.LIVE);
    assert.equal(s.held.told.length, 2);
    presence.voiceChanged(CALLING, AVATAR_STATUS.ENDED);
    assert.deepEqual(s.held, {
      standing: false,
      video: false,
      told: ["video", "show", "hide", "card"],
    });
  });

  it("draws the card again once the avatar ends with no panel in front", () => {
    const s = surface();
    const presence = new CallWindowPresence(s);
    presence.voiceChanged(CALLING, AVATAR_STATUS.LIVE);
    presence.voiceChanged(CALLING, AVATAR_STATUS.ENDED);
    assert.deepEqual(s.held, { standing: true, video: false, told: ["video", "show", "card"] });
  });

  it("takes the video down with the call", () => {
    const s = surface();
    const presence = new CallWindowPresence(s);
    presence.voiceChanged(CALLING, AVATAR_STATUS.LIVE);
    presence.voiceChanged(HUNG_UP, AVATAR_STATUS.LIVE);
    assert.deepEqual(s.held, {
      standing: false,
      video: false,
      told: ["video", "show", "hide", "card"],
    });
  });
});

describe("the call window's frame", () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 850 };
  const card = (x: number, y: number) => ({
    x,
    y,
    width: CALL_WINDOW_BOUNDS.WIDTH,
    height: CALL_WINDOW_BOUNDS.HEIGHT,
  });

  it("grows the tile up from the card's bottom-left corner", () => {
    assert.deepEqual(callWindowFrame({ card: { x: 8, y: 775 }, video: true, workArea }), {
      x: 8,
      y: 775 + CALL_WINDOW_BOUNDS.HEIGHT - CALL_VIDEO_BOUNDS.HEIGHT,
      width: CALL_VIDEO_BOUNDS.WIDTH,
      height: CALL_VIDEO_BOUNDS.HEIGHT,
    });
  });

  it("pulls a tile that would grow off the work area back onto it, and puts the card back where it was", () => {
    const place = { x: 1170, y: 30 };
    assert.deepEqual(callWindowFrame({ card: place, video: true, workArea }), {
      x: 1440 - CALL_VIDEO_BOUNDS.WIDTH,
      y: 25,
      width: CALL_VIDEO_BOUNDS.WIDTH,
      height: CALL_VIDEO_BOUNDS.HEIGHT,
    });
    assert.deepEqual(callWindowFrame({ card: place, video: false, workArea }), card(1170, 30));
  });

  it("pulls the card back onto a work area that shrank while the tile was up", () => {
    const shrunk = { x: 0, y: 25, width: 1440, height: 725 };
    assert.deepEqual(
      callWindowFrame({ card: { x: 8, y: 775 }, video: false, workArea: shrunk }),
      card(8, 750 - CALL_WINDOW_BOUNDS.HEIGHT),
    );
  });
});
