import assert from "node:assert/strict";
import test from "node:test";
import {
  REMOVAL_STAGE,
  removalAsked,
  removalStage,
  removalWithdrawable,
} from "../src/renderer/credential-removal";

const A_KEY_ON_AN_OPEN_PANEL = { stored: true, panelOpen: true };
const A_KEY_THAT_IS_GONE = { stored: false, panelOpen: true };
// The panel closes outright, and it also stands down to the slot to let someone
// fetch a key — which is exactly when a question left standing would be
// forgotten about.
const A_PANEL_THAT_HAS_CLOSED = { stored: true, panelOpen: false };

test("a question stands until it is answered", () => {
  assert.equal(
    removalStage(REMOVAL_STAGE.ASKING, A_KEY_ON_AN_OPEN_PANEL),
    REMOVAL_STAGE.ASKING,
    "nothing about the line changed, so neither does what it is asking",
  );
});

test("the key going takes the question with it", () => {
  assert.equal(
    removalStage(REMOVAL_STAGE.ASKING, A_KEY_THAT_IS_GONE),
    REMOVAL_STAGE.RESTING,
    "a confirm left where a key used to be would be pointed at whatever is stored there next",
  );
});

test("the panel closing withdraws the question", () => {
  assert.equal(
    removalStage(REMOVAL_STAGE.ASKING, A_PANEL_THAT_HAS_CLOSED),
    REMOVAL_STAGE.RESTING,
    "a confirm nobody is standing in front of must not be waiting when the panel comes back",
  );
});

test("a delete already sent finishes wherever it is", () => {
  // It is no longer a question, so nothing that withdraws a question reaches
  // it: the line has to stay able to report what came back.
  assert.equal(
    removalStage(REMOVAL_STAGE.CLEARING, A_PANEL_THAT_HAS_CLOSED),
    REMOVAL_STAGE.CLEARING,
  );
  assert.equal(
    removalStage(REMOVAL_STAGE.CLEARING, { stored: false, panelOpen: false }),
    REMOVAL_STAGE.CLEARING,
  );
});

test("a line at rest is left at rest", () => {
  assert.equal(removalStage(REMOVAL_STAGE.RESTING, A_KEY_ON_AN_OPEN_PANEL), REMOVAL_STAGE.RESTING);
  assert.equal(removalStage(REMOVAL_STAGE.RESTING, A_KEY_THAT_IS_GONE), REMOVAL_STAGE.RESTING);
});

test("only a question can be taken back", () => {
  assert.equal(removalWithdrawable(REMOVAL_STAGE.ASKING), true);
  assert.equal(
    removalWithdrawable(REMOVAL_STAGE.CLEARING),
    false,
    "Cancel and Escape must not forget a delete that is already on its way out",
  );
  assert.equal(
    removalWithdrawable(REMOVAL_STAGE.RESTING),
    false,
    "there is no question to withdraw, so nothing withdraws one",
  );
});

test("the confirm is drawn from the moment it is asked until the answer lands", () => {
  assert.equal(removalAsked(REMOVAL_STAGE.RESTING), false);
  assert.equal(removalAsked(REMOVAL_STAGE.ASKING), true);
  assert.equal(
    removalAsked(REMOVAL_STAGE.CLEARING),
    true,
    "the answer that was given stays on screen saying what it is doing",
  );
});
