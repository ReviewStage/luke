import assert from "node:assert/strict";
import { planMarkdown } from "@sidecar/hosted/plan-markdown";
import {
  PLAN_BOUNDS,
  type PlanDocument,
  ROLLOUT_BASE,
  ROLLOUT_BOUNDS,
  type Rollout,
} from "@sidecar/hosted/plan-wire";
import { test } from "vitest";
import { ACT_KIND, parsedAct } from "./acts";

/** The copy act admits the Markdown of any document the store holds, so no saved plan is too long to copy. */
/** The text of a rollout item at its longest and drawn at its longest: every other line a heading the formatter escapes. */
const LONGEST_TEXT = "#\n".repeat(ROLLOUT_BOUNDS.MAX_TEXT_CHARS / 2).trim();

/** The longest rollout the store holds. */
const LONGEST_ROLLOUT: Rollout = Array.from({ length: ROLLOUT_BOUNDS.MAX_PULL_REQUESTS }, () => ({
  title: "t".repeat(ROLLOUT_BOUNDS.MAX_TITLE_CHARS),
  scope: LONGEST_TEXT,
  base: ROLLOUT_BASE.MAIN,
  acceptance: LONGEST_TEXT,
}));

test("the longest plan the store holds is admitted whole by the copy act, and so is an empty one", () => {
  const longest: PlanDocument = { body: "b".repeat(PLAN_BOUNDS.MAX_BODY_CHARS), assumptions: [] };

  const name = "n".repeat(PLAN_BOUNDS.MAX_NAME_CHARS);
  const empty: PlanDocument = { body: "", assumptions: [] };
  const plans = [
    { name, document: longest, rollout: LONGEST_ROLLOUT },
    { name, document: empty, rollout: [] },
  ];

  for (const plan of plans) {
    const words = planMarkdown(plan);
    const sent = { kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words } };
    assert.deepEqual(parsedAct(sent), sent);
  }
});
