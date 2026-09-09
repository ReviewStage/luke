import assert from "node:assert/strict";
import test from "node:test";
import {
  REMOVAL_STAGE,
  type RemovalStage,
  removalAsked,
  removalStage,
  removalWithdrawable,
} from "./credential-removal";

const STAGES: readonly RemovalStage[] = Object.values(REMOVAL_STAGE);
const BOTH = [false, true] as const;

test("a question stands until it is answered, and only a question can be taken back", () => {
  for (const held of STAGES) {
    for (const stored of BOTH) {
      // The panel closes outright, and it also stands down to the slot to let
      // someone fetch a key — which is exactly when a question left standing
      // would be forgotten about.
      for (const panelOpen of BOTH) {
        assert.equal(
          removalStage(held, { stored, panelOpen }),
          held === REMOVAL_STAGE.ASKING && (!stored || !panelOpen)
            ? // A confirm left where a key used to be would be pointed at
              // whatever is stored there next, and one nobody is standing in
              // front of must not be waiting when the panel comes back.
              REMOVAL_STAGE.RESTING
            : held,
          `${held} stored=${stored} panelOpen=${panelOpen}`,
        );
      }
    }
    assert.equal(
      removalWithdrawable(held),
      // Cancel and Escape must not forget a delete that is already on its way
      // out, and a line at rest has no question to withdraw.
      held === REMOVAL_STAGE.ASKING,
      `withdrawable ${held}`,
    );
    assert.equal(
      removalAsked(held),
      // A delete in flight still draws the confirm, so the answer that was
      // given stays on screen saying what it is doing.
      held !== REMOVAL_STAGE.RESTING,
      `asked ${held}`,
    );
  }
});

test("a delete already sent finishes wherever it is", () => {
  // Folded the way the line folds it, one surrounding change at a time: the
  // question is raised on an open panel over a stored key, answered, and then
  // everything that would have withdrawn it happens at once. It is no longer a
  // question, so none of it reaches the delete: the line has to stay able to
  // report what came back.
  let stage: RemovalStage = REMOVAL_STAGE.RESTING;
  stage = removalStage(stage, { stored: true, panelOpen: true });
  assert.equal(stage, REMOVAL_STAGE.RESTING);
  stage = removalStage(REMOVAL_STAGE.ASKING, { stored: true, panelOpen: true });
  assert.equal(stage, REMOVAL_STAGE.ASKING);
  stage = removalStage(REMOVAL_STAGE.CLEARING, { stored: true, panelOpen: false });
  assert.equal(stage, REMOVAL_STAGE.CLEARING);
  stage = removalStage(stage, { stored: false, panelOpen: false });
  assert.equal(stage, REMOVAL_STAGE.CLEARING);
});
