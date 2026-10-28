import assert from "node:assert/strict";
import { test } from "vitest";
import { NATIVE_MOMENT } from "./native-moments.js";
import { heldProjection, projectMoments } from "./native-projection.js";

test("a call of a tool the record does not hold is reported, but the harness's own ToolSearch is left out without a word", () => {
  const reports: string[] = [];
  projectMoments(
    heldProjection(null),
    ["ToolSearch", "SendMessage"].map((name, index) => ({
      kind: NATIVE_MOMENT.TOOL_STARTED,
      callId: `toolu_${index}`,
      name,
      input: {},
    })),
    {
      conversationId: "c_projection",
      sequence: 0,
      now: 0,
      model: undefined,
      registered: () => false,
      report: (said) => reports.push(said),
    },
  );
  assert.deepEqual(reports, ["A call to SendMessage names no stored tool and is not recorded."]);
});
