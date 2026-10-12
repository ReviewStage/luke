import assert from "node:assert/strict";
import {
  PLAN_FIELD,
  PLAN_FIELD_BAR,
  PLAN_FIELD_HEADING,
  PLAN_FIELD_PURPOSE,
} from "@sidecar/hosted/plan-template";
import { test } from "vitest";
import { PLANNING_INSTRUCTIONS, SCRIBE_INSTRUCTIONS } from "../server/hosted/brain-host/planning";

/**
 * The planning model asks about the plan's sections and the notetaker files
 * what was said under them, so the two must read each section the same way:
 * Luke asking for one thing while the notes file it under another is the
 * drift this holds against.
 */

test("the planning model and the notetaker are told each section's meaning in the same words, and the planning model its bar", () => {
  for (const field of Object.values(PLAN_FIELD)) {
    const purpose = PLAN_FIELD_PURPOSE[field];
    assert.ok(
      PLANNING_INSTRUCTIONS.includes(
        `- ${PLAN_FIELD_HEADING[field]}: ${purpose}\n  Done when: ${PLAN_FIELD_BAR[field]}`,
      ),
      `the planning model reads ${field} and its bar as the template does`,
    );
    assert.ok(
      SCRIBE_INSTRUCTIONS.includes(`- ${field}: ${purpose}`),
      `the notetaker reads ${field} as the template does`,
    );
  }
});
