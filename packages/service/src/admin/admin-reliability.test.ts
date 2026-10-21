import assert from "node:assert/strict";
import { AUTOMATION_RUN_REASON } from "@luke/features/automation-wire";
import { CODING_AGENT_FAILURE } from "@luke/features/coding-agent-wire";
import { test } from "vitest";
import { type AdminReliabilitySource, buildAdminReliability } from "./admin-reliability.js";
import { ADMIN_METRICS_WINDOW } from "./http.js";

/**
 * The Reliability answer's shaping and its address: each day of the window
 * stands in the series whether or not anything ended on it, a day with
 * nothing ended reads no rate rather than a perfect one, the cards are the
 * series' own totals, the breakdowns come most first with their empty
 * classes gone, and only a week or a month is read.
 */

/** Noon on Oct 17; the week's window runs Oct 11 to Oct 17. */
const NOW = Date.UTC(2026, 9, 17, 12);

function source(overrides: Partial<AdminReliabilitySource["daily"]> = {}): AdminReliabilitySource {
  return {
    daily: {
      lukeTurns: new Map(),
      agentRuns: new Map(),
      abandonedTurns: new Map(),
      calls: new Map(),
      automationRuns: new Map(),
      ...overrides,
    },
    agentFailures: new Map([
      [CODING_AGENT_FAILURE.SANDBOX, 2],
      [CODING_AGENT_FAILURE.MODEL, 5],
      [CODING_AGENT_FAILURE.GITHUB, 0],
    ]),
    automationReasons: new Map([
      [AUTOMATION_RUN_REASON.CONCURRENCY, { skipped: 1, failed: 0 }],
      [AUTOMATION_RUN_REASON.UNAVAILABLE, { skipped: 0, failed: 3 }],
    ]),
    attention: { total: 0, accounts: [] },
    systemHealth: { database: { reachable: true, latencyMs: 3 }, integrations: [] },
  };
}

test("every window day stands in the series, and a day with nothing ended reads no rate", () => {
  const answer = buildAdminReliability(
    source({
      lukeTurns: new Map([
        ["2026-10-16", { failed: 1, total: 4 }],
        // A day before the window, which the source may hold and the answer must not count.
        ["2026-10-01", { failed: 9, total: 9 }],
      ]),
    }),
    NOW,
    ADMIN_METRICS_WINDOW.WEEK,
  );

  assert.deepEqual(
    answer.daily.map((day) => [day.day, day.lukeTurns]),
    [
      ["2026-10-11", null],
      ["2026-10-12", null],
      ["2026-10-13", null],
      ["2026-10-14", null],
      ["2026-10-15", null],
      ["2026-10-16", 0.25],
      ["2026-10-17", null],
    ],
  );
  assert.deepEqual(answer.headline.lukeTurns, { failed: 1, total: 4 });
});

test("the cards total the window's days, the automation card its skips beside its failures", () => {
  const answer = buildAdminReliability(
    source({
      abandonedTurns: new Map([
        ["2026-10-12", 2],
        ["2026-10-17", 1],
      ]),
      automationRuns: new Map([
        ["2026-10-12", { failed: 1, skipped: 2, total: 5 }],
        ["2026-10-13", { failed: 0, skipped: 1, total: 5 }],
      ]),
    }),
    NOW,
    ADMIN_METRICS_WINDOW.WEEK,
  );

  assert.equal(answer.headline.abandonedTurns, 3);
  assert.deepEqual(answer.headline.automationRuns, { failed: 1, skipped: 3, total: 10 });
});

test("the breakdowns come most first, a class with nothing counted left out", () => {
  const answer = buildAdminReliability(source(), NOW, ADMIN_METRICS_WINDOW.WEEK);

  assert.deepEqual(answer.agentFailures, [
    { failure: CODING_AGENT_FAILURE.MODEL, count: 5 },
    { failure: CODING_AGENT_FAILURE.SANDBOX, count: 2 },
  ]);
  assert.deepEqual(answer.automationReasons, [
    { reason: AUTOMATION_RUN_REASON.UNAVAILABLE, skipped: 0, failed: 3 },
    { reason: AUTOMATION_RUN_REASON.CONCURRENCY, skipped: 1, failed: 0 },
  ]);
});
