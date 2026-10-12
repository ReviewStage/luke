import assert from "node:assert/strict";
import { planMarkdown } from "@sidecar/hosted/plan-markdown";
import { PLAN_BOUNDS, type PlanDocument } from "@sidecar/hosted/plan-wire";
import { test } from "vitest";
import { ACT_KIND, parsedAct } from "./acts";

/** The copy act admits the Markdown of any document the store holds, so no saved plan is too long to copy. */
test("the longest plan the store holds is admitted whole by the copy act, and so is an empty one", () => {
  const longest: PlanDocument = { body: "b".repeat(PLAN_BOUNDS.MAX_BODY_CHARS), assumptions: [] };

  const name = "n".repeat(PLAN_BOUNDS.MAX_NAME_CHARS);
  const empty: PlanDocument = { body: "", assumptions: [] };
  const plans = [
    { name, document: longest },
    { name, document: empty },
  ];

  for (const plan of plans) {
    const words = planMarkdown(plan);
    const sent = { kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words } };
    assert.deepEqual(parsedAct(sent), sent);
  }
});
