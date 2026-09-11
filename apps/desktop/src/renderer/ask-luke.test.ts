import assert from "node:assert/strict";
import { PRODUCT_ASK_OUTCOME } from "@sidecar/analytics";
import { BRAIN_ASK_REFUSAL } from "@sidecar/brain/requests";
import { test } from "vitest";
import { composerAfterAsk } from "./ask-luke";
import { ASK_UNSENT_REASON } from "./use-voice-view";

test("a refused ask keeps the draft and is counted as refused", () => {
  for (const reason of [...Object.values(BRAIN_ASK_REFUSAL), ASK_UNSENT_REASON]) {
    assert.deepEqual(
      composerAfterAsk(reason),
      { outcome: PRODUCT_ASK_OUTCOME.REFUSED, keepDraft: true },
      `${reason}: a refused ask is still the developer's words`,
    );
  }
});

test("an accepted ask empties the field and is counted as sent", () => {
  assert.deepEqual(composerAfterAsk(undefined), {
    outcome: PRODUCT_ASK_OUTCOME.SENT,
    keepDraft: false,
  });
});
