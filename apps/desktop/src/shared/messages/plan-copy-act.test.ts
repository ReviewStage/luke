import assert from "node:assert/strict";
import { planMarkdown } from "@sidecar/hosted/plan-markdown";
import { PLAN_BOUNDS, type PlanDocument } from "@sidecar/hosted/plan-wire";
import { test } from "vitest";
import { ACT_KIND, parsedAct } from "./acts";

/** The copy act admits the Markdown of any document the store holds, so no saved plan is too long to copy. */
test("the longest document the store holds is admitted whole by the copy act, and so is an empty one", () => {
  const longest: PlanDocument = {
    body: "b".repeat(PLAN_BOUNDS.MAX_BODY_CHARS),
    assumptions: Array.from({ length: PLAN_BOUNDS.MAX_ASSUMPTIONS }, () => ({
      text: "a".repeat(PLAN_BOUNDS.MAX_ASSUMPTION_CHARS),
    })),
  };

  for (const document of [longest, { body: "", assumptions: [] }]) {
    const words = planMarkdown(document);
    const sent = { kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words } };
    assert.deepEqual(parsedAct(sent), sent);
  }
});
