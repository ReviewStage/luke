import assert from "node:assert/strict";
import { test } from "vitest";
import { CALL_VIDEO_STATUS, callVideoTile } from "./call-video-tile-model";

test("a live call draws the picture once one is handed, with nothing said over it", () => {
  const live = callVideoTile({ status: CALL_VIDEO_STATUS.LIVE, picture: true });
  assert.equal(live.picture, true);
  assert.equal(live.caption, undefined);
  assert.equal(live.videoOff, true);
  assert.equal(live.restart, false);
});

test("a live call with no picture handed, as in the smoke fixture, draws the still frame and says nothing", () => {
  const still = callVideoTile({ status: CALL_VIDEO_STATUS.LIVE, picture: false });
  assert.equal(still.picture, false);
  assert.equal(still.caption, undefined);
  assert.equal(still.videoOff, true);
});

test("a connecting video says it is starting over the still frame, even with a track already handed", () => {
  const connecting = callVideoTile({ status: CALL_VIDEO_STATUS.CONNECTING, picture: true });
  assert.equal(connecting.picture, false);
  assert.equal(connecting.caption, "Starting video");
  assert.equal(connecting.videoOff, true, "turning the video off is how a start is abandoned");
  assert.equal(connecting.restart, false);
});

test("an ended video offers to restart it, not to turn off what is already off", () => {
  const ended = callVideoTile({ status: CALL_VIDEO_STATUS.ENDED, picture: true });
  assert.equal(ended.picture, false, "a track still handed after the end is not drawn");
  assert.equal(ended.caption, "Video ended");
  assert.equal(ended.restart, true);
  assert.equal(ended.videoOff, false);
});
