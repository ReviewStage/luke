import assert from "node:assert/strict";
import test from "node:test";
import {
  CONFIRM_STAGE,
  type ConfirmStage,
  type ConfirmSurroundings,
  confirmAsked,
  confirmStage,
  confirmWithdrawable,
} from "./confirm-state";

/** The only surroundings a question survives: its subject there, its surface open. */
const STANDS: ConfirmSurroundings = { subject: true, surfaceOpen: true };

const SURROUNDINGS: readonly ConfirmSurroundings[] = [
  STANDS,
  // A confirm left where a key used to be would be pointed at whatever is
  // stored there next.
  { subject: false, surfaceOpen: true },
  // The panel closes outright, and it also stands down to the slot to let
  // someone fetch a key — which is exactly when a question left standing would
  // be forgotten about, and be the first thing under the pointer next time.
  { subject: true, surfaceOpen: false },
  { subject: false, surfaceOpen: false },
];

/** What each stage draws, and whether it can still be taken back. */
const STAGES = [
  { stage: CONFIRM_STAGE.RESTING, asked: false, withdrawable: false },
  { stage: CONFIRM_STAGE.ASKING, asked: true, withdrawable: true },
  // An answer in flight still draws the confirm, so what was given stays on
  // screen saying what it is doing — and Cancel and Escape must not forget an
  // action already on its way out.
  { stage: CONFIRM_STAGE.ACTING, asked: true, withdrawable: false },
] as const;

test("a question stands until it is answered, and only a question can be taken back", () => {
  for (const { stage, asked, withdrawable } of STAGES) {
    for (const surroundings of SURROUNDINGS) {
      const survives = surroundings === STANDS || stage !== CONFIRM_STAGE.ASKING;
      assert.equal(
        confirmStage(stage, surroundings),
        survives ? stage : CONFIRM_STAGE.RESTING,
        `${stage} ${JSON.stringify(surroundings)}`,
      );
    }
    assert.equal(confirmWithdrawable(stage), withdrawable, `withdrawable ${stage}`);
    assert.equal(confirmAsked(stage), asked, `asked ${stage}`);
  }
});

test("an answer already sent finishes wherever it is", () => {
  // Folded the way the line folds it, one surrounding change at a time: the
  // question is raised, answered, and then everything that would have withdrawn
  // it happens under the action. It is no longer a question, so none of it
  // reaches the action: the line has to stay able to report what came back.
  let stage: ConfirmStage = confirmStage(CONFIRM_STAGE.ASKING, STANDS);
  assert.equal(stage, CONFIRM_STAGE.ASKING);
  stage = confirmStage(CONFIRM_STAGE.ACTING, { subject: true, surfaceOpen: false });
  assert.equal(stage, CONFIRM_STAGE.ACTING);
  stage = confirmStage(stage, { subject: false, surfaceOpen: false });
  assert.equal(stage, CONFIRM_STAGE.ACTING);
});
