import assert from "node:assert/strict";
import test from "node:test";
import {
  REMOVAL_STAGE,
  type RemovalStage,
  type RemovalSurroundings,
  removalAsked,
  removalStage,
  removalWithdrawable,
} from "./credential-removal";

/** The only surroundings a question survives: its key still stored, its panel still open. */
const STANDS: RemovalSurroundings = { stored: true, panelOpen: true };

const SURROUNDINGS: readonly RemovalSurroundings[] = [
  STANDS,
  // A confirm left where a key used to be would be pointed at whatever is
  // stored there next.
  { stored: false, panelOpen: true },
  // The panel closes outright, and it also stands down to the slot to let
  // someone fetch a key — which is exactly when a question left standing would
  // be forgotten about, and be the first thing under the pointer next time.
  { stored: true, panelOpen: false },
  { stored: false, panelOpen: false },
];

/** What each stage draws, and whether it can still be taken back. */
const STAGES = [
  { stage: REMOVAL_STAGE.RESTING, asked: false, withdrawable: false },
  { stage: REMOVAL_STAGE.ASKING, asked: true, withdrawable: true },
  // A delete in flight still draws the confirm, so the answer that was given
  // stays on screen saying what it is doing — and Cancel and Escape must not
  // forget a delete that is already on its way out.
  { stage: REMOVAL_STAGE.CLEARING, asked: true, withdrawable: false },
] as const;

test("a question stands until it is answered, and only a question can be taken back", () => {
  for (const { stage, asked, withdrawable } of STAGES) {
    for (const surroundings of SURROUNDINGS) {
      const survives = surroundings === STANDS || stage !== REMOVAL_STAGE.ASKING;
      assert.equal(
        removalStage(stage, surroundings),
        survives ? stage : REMOVAL_STAGE.RESTING,
        `${stage} ${JSON.stringify(surroundings)}`,
      );
    }
    assert.equal(removalWithdrawable(stage), withdrawable, `withdrawable ${stage}`);
    assert.equal(removalAsked(stage), asked, `asked ${stage}`);
  }
});

test("a delete already sent finishes wherever it is", () => {
  // Folded the way the line folds it, one surrounding change at a time: the
  // question is raised, answered, and then everything that would have
  // withdrawn it happens under the delete. It is no longer a question, so none
  // of it reaches the delete: the line has to stay able to report what came
  // back.
  let stage: RemovalStage = removalStage(REMOVAL_STAGE.ASKING, STANDS);
  assert.equal(stage, REMOVAL_STAGE.ASKING);
  stage = removalStage(REMOVAL_STAGE.CLEARING, { stored: true, panelOpen: false });
  assert.equal(stage, REMOVAL_STAGE.CLEARING);
  stage = removalStage(stage, { stored: false, panelOpen: false });
  assert.equal(stage, REMOVAL_STAGE.CLEARING);
});
