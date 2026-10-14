import {
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
  type AutomationRunSummary,
  GITHUB_TRIGGER_EVENT,
} from "@sidecar/hosted/automation-wire";
import { CODING_AGENT_STATUS } from "@sidecar/hosted/coding-agent-wire";
import { describe, expect, it } from "vitest";
import { GLYPH_STATE } from "../state-glyph";
import {
  firingText,
  RUN_TONE,
  reasonText,
  runGlyphState,
  runState,
  triggerText,
} from "./automation-words";

/**
 * How the Automations page says a trigger and a run: a schedule the picker
 * writes in words with its zone's city, any other cron as written, a GitHub
 * trigger with its filters, and a run's state read from its agent once it
 * started one, on its pill and on the glyph a list row wears.
 */

const schedule = (cron: string, timezone = "America/New_York") => ({
  kind: AUTOMATION_TRIGGER.SCHEDULE,
  cron,
  timezone,
});

const run = (overrides: Partial<AutomationRunSummary>): AutomationRunSummary => ({
  id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  firing: { kind: AUTOMATION_FIRING.MANUAL },
  status: AUTOMATION_RUN_STATUS.STARTED,
  reason: null,
  agent: null,
  firedAt: 0,
  settledAt: 0,
  ...overrides,
});

describe("an automation's words", () => {
  it("says a schedule the picker writes in words, with its zone's city, and any other cron as written", () => {
    expect(triggerText(schedule("0 9 * * 1-5"))).toBe("Weekdays at 9:00 · New York");
    expect(triggerText(schedule("30 14 * * *", "Europe/London"))).toBe(
      "Every day at 14:30 · London",
    );
    expect(triggerText(schedule("0 9 * * 1"))).toBe("Mondays at 9:00 · New York");
    expect(triggerText(schedule("0 * * * *"))).toBe("Every hour");
    expect(triggerText(schedule("*/30 9-17 * * 1-5"))).toBe("*/30 9-17 * * 1-5 · New York");
  });

  it("says a GitHub trigger with its filters, and a webhook as its call", () => {
    expect(
      triggerText({
        kind: AUTOMATION_TRIGGER.GITHUB,
        event: GITHUB_TRIGGER_EVENT.ISSUE_LABELED,
        labels: ["bug", "p1"],
      }),
    ).toBe("When an issue is labelled · labelled bug, p1");
    expect(
      triggerText({
        kind: AUTOMATION_TRIGGER.GITHUB,
        event: GITHUB_TRIGGER_EVENT.CHECK_FAILED,
        branches: ["main"],
      }),
    ).toBe("When a check fails · on main");
    expect(triggerText({ kind: AUTOMATION_TRIGGER.WEBHOOK })).toBe("When its webhook is called");
  });

  it("titles a run by what fired it, its issue or pull request by number and title", () => {
    expect(
      firingText({
        kind: AUTOMATION_FIRING.GITHUB,
        event: GITHUB_TRIGGER_EVENT.ISSUE_OPENED,
        repository: "acme/web",
        number: 12,
        title: "Crash on save",
      }),
    ).toBe("Issue #12 opened: Crash on save");
    expect(
      firingText({
        kind: AUTOMATION_FIRING.GITHUB,
        event: GITHUB_TRIGGER_EVENT.CHECK_FAILED,
        repository: "acme/web",
        branch: "main",
      }),
    ).toBe("Check failed on main");
    expect(firingText({ kind: AUTOMATION_FIRING.SCHEDULE, dueAt: 0 })).toBe("Scheduled run");
  });

  it("reads a run's pill from its agent once it started one, and from the run where it did not", () => {
    const agent = (status: (typeof CODING_AGENT_STATUS)[keyof typeof CODING_AGENT_STATUS]) => ({
      id: "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3",
      title: null,
      status,
    });
    expect(runState(run({ agent: agent(CODING_AGENT_STATUS.RUNNING) }))).toEqual({
      word: "Running",
      tone: RUN_TONE.WORKING,
    });
    expect(runState(run({ agent: agent(CODING_AGENT_STATUS.COMPLETED) })).tone).toBe(
      RUN_TONE.COMPLETE,
    );
    expect(
      runState(
        run({ status: AUTOMATION_RUN_STATUS.SKIPPED, reason: AUTOMATION_RUN_REASON.DAILY_CAP }),
      ),
    ).toEqual({ word: "Skipped", tone: RUN_TONE.ATTENTION });
    expect(reasonText(AUTOMATION_RUN_REASON.GITHUB_SIGN_IN)).toBe(
      "Sign in with GitHub again, then turn it back on.",
    );
    expect(reasonText(null)).toBeUndefined();
  });

  it("wears a run's glyph working while its agent works, failed where it could not start or its agent failed, and at rest for a skip", () => {
    const agent = (status: (typeof CODING_AGENT_STATUS)[keyof typeof CODING_AGENT_STATUS]) => ({
      id: "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3",
      title: null,
      status,
    });
    expect(runGlyphState(run({ agent: agent(CODING_AGENT_STATUS.RUNNING) }))).toBe(
      GLYPH_STATE.WORKING,
    );
    expect(runGlyphState(run({ agent: agent(CODING_AGENT_STATUS.FAILED) }))).toBe(
      GLYPH_STATE.FAILED,
    );
    expect(
      runGlyphState(
        run({ status: AUTOMATION_RUN_STATUS.FAILED, reason: AUTOMATION_RUN_REASON.MODEL }),
      ),
    ).toBe(GLYPH_STATE.FAILED);
    expect(
      runGlyphState(
        run({ status: AUTOMATION_RUN_STATUS.SKIPPED, reason: AUTOMATION_RUN_REASON.CONCURRENCY }),
      ),
    ).toBe(GLYPH_STATE.REST);
    expect(runGlyphState(run({ agent: agent(CODING_AGENT_STATUS.COMPLETED) }))).toBe(
      GLYPH_STATE.REST,
    );
  });
});
