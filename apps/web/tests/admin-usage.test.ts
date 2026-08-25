import assert from "node:assert/strict";
import test from "node:test";
import { activeUsageDays, defaultUsageDay } from "../src/admin-usage";

const daily = [
  { day: "2026-08-22", voiceCalls: 0, attentionReviews: 0 },
  { day: "2026-08-23", voiceCalls: 2, attentionReviews: 0 },
  { day: "2026-08-24", voiceCalls: 0, attentionReviews: 4 },
  { day: "2026-08-25", voiceCalls: 0, attentionReviews: 0 },
] as const;

test("the drill-down offers only days whose chart has activity", () => {
  assert.deepEqual(
    activeUsageDays(daily).map((point) => point.day),
    ["2026-08-23", "2026-08-24"],
  );
});

test("the drill-down defaults to the freshest active day, not today's zero-fill", () => {
  assert.equal(defaultUsageDay(daily), "2026-08-24");
  assert.equal(defaultUsageDay([]), "");
});
