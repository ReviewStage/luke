import assert from "node:assert/strict";
import { LIVE_STATUS } from "@sidecar/live";
import type { WebContents } from "electron";
import { it } from "vitest";
import { AVATAR_END_REASON, AVATAR_OFF, AVATAR_STATUS } from "#shared/messages/avatar";
import {
  CALL_WINDOW_SHAPE,
  CALL_WINDOW_SIZE,
  CallWindowPresence,
  type CallWindowShape,
  callWindowReshaped,
} from "./call-window-presence";

const CALL = { voiceStatus: LIVE_STATUS.LISTENING, callPlanId: "plan_1" } as const;
const NO_CALL = { voiceStatus: LIVE_STATUS.IDLE, callPlanId: undefined } as const;
const STARTING = { status: AVATAR_STATUS.STARTING } as const;
const LIVE = { status: AVATAR_STATUS.LIVE } as const;
const ENDED = { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.MAX_DURATION } as const;

/** The presence over a surface that records what it was last told: the shape it stands in, or hidden. */
function presence() {
  let standing: CallWindowShape | undefined;
  const told: (CallWindowShape | undefined)[] = [];
  const decided = new CallWindowPresence({
    show: (shape) => {
      standing = shape;
      told.push(shape);
    },
    hide: () => {
      standing = undefined;
      told.push(undefined);
    },
  });
  // SAFETY: the presence reads a panel by identity alone.
  const panel = {} as WebContents;
  return { decided, panel, standing: () => standing, told };
}

it("draws the card only while no Luke window has the keyboard", () => {
  const { decided, panel, standing } = presence();
  decided.voiceChanged(CALL, AVATAR_OFF);
  assert.equal(standing(), CALL_WINDOW_SHAPE.CARD);
  decided.panelFocused(panel);
  assert.equal(standing(), undefined);
  decided.panelBlurred(panel);
  assert.equal(standing(), CALL_WINDOW_SHAPE.CARD);
});

it("holds the tile up for the whole call while the face starts and is live, a panel focused or not", () => {
  const { decided, panel, standing, told } = presence();
  decided.panelFocused(panel);
  decided.voiceChanged(CALL, STARTING);
  assert.equal(standing(), CALL_WINDOW_SHAPE.TILE);
  decided.voiceChanged(CALL, LIVE);
  decided.panelBlurred(panel);
  decided.panelFocused(panel);
  assert.deepEqual(told, [CALL_WINDOW_SHAPE.TILE], "told once, and only when the answer moved");
  decided.voiceChanged(NO_CALL, LIVE);
  assert.equal(standing(), undefined, "a face never outlives its call");
});

it("draws an ended face's tile where the card would stand, and the card once the face is off", () => {
  const { decided, panel, standing } = presence();
  decided.voiceChanged(CALL, LIVE);
  decided.panelFocused(panel);
  decided.voiceChanged(CALL, ENDED);
  assert.equal(standing(), undefined, "a panel draws the call once no face is showing");
  decided.panelBlurred(panel);
  assert.equal(standing(), CALL_WINDOW_SHAPE.TILE, "the tile is where the video restarts");
  decided.voiceChanged(CALL, AVATAR_OFF);
  assert.equal(standing(), CALL_WINDOW_SHAPE.CARD);
});

const WORK_AREA = { x: 0, y: 25, width: 1440, height: 800 } as const;
const card = CALL_WINDOW_SIZE[CALL_WINDOW_SHAPE.CARD];
const tile = CALL_WINDOW_SIZE[CALL_WINDOW_SHAPE.TILE];

it("grows the card into a 16:9 tile about its bottom-left corner, and back", () => {
  const bounds = { x: 100, y: 500, width: card.WIDTH, height: card.HEIGHT };
  const grown = callWindowReshaped({ bounds, shape: CALL_WINDOW_SHAPE.TILE, workArea: WORK_AREA });
  assert.deepEqual(grown, {
    x: 100,
    y: 500 + card.HEIGHT - tile.HEIGHT,
    width: tile.WIDTH,
    height: tile.HEIGHT,
  });
  // The tile less its shadow's room on each side is the 16:9 picture.
  assert.equal((tile.WIDTH - 16) / (tile.HEIGHT - 16), 16 / 9);
  const shrunk = callWindowReshaped({
    bounds: grown,
    shape: CALL_WINDOW_SHAPE.CARD,
    workArea: WORK_AREA,
  });
  assert.deepEqual(shrunk, bounds);
});

it("keeps a grown tile wholly on the display its card stood on", () => {
  const topRight = { x: 1440 - card.WIDTH, y: 25, width: card.WIDTH, height: card.HEIGHT };
  const grown = callWindowReshaped({
    bounds: topRight,
    shape: CALL_WINDOW_SHAPE.TILE,
    workArea: WORK_AREA,
  });
  assert.deepEqual(grown, { x: 1440 - tile.WIDTH, y: 25, width: tile.WIDTH, height: tile.HEIGHT });
});
