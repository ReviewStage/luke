import assert from "node:assert/strict";
import { test } from "vitest";
import {
  FAILURE_CONDITION,
  FAILURE_KIND,
  FAILURE_SURFACE,
  type ShownFailureSentry,
  sendShownFailure,
} from "./shown-failure.js";

/**
 * shown-failure.test.ts -- a failure nothing named, shown while the machine
 * had no network, is a log line at `warn` and opens no issue, as a Mac waking
 * from sleep offline shows its task list unread. A recording SDK stands in
 * for Sentry. Synthetic throughout.
 */

test("an unexpected failure shown offline sends a warning line and opens no issue", () => {
  const warned: string[] = [];
  const errored: string[] = [];
  const captured: Error[] = [];
  const recording: ShownFailureSentry = {
    captureException: (error) => {
      captured.push(error);
      return "event-fixture";
    },
    logger: { warn: (line) => warned.push(line), error: (line) => errored.push(line) },
    getActiveSpan: () => undefined,
    getCurrentScope: () => ({ getPropagationContext: () => ({ traceId: "trace-fixture" }) }),
  };

  const sent = sendShownFailure(recording, {
    surface: FAILURE_SURFACE.HOME_TASKS_READ,
    kind: FAILURE_KIND.UNEXPECTED,
    cause: FAILURE_CONDITION.UNREAD,
    about: {},
    state: { online: false, account: "signed-in" },
  });

  assert.deepEqual(warned, ["A failure was shown on home_tasks.read: unread"]);
  assert.deepEqual(errored, []);
  assert.deepEqual(captured, []);
  assert.deepEqual(sent, { traceId: "trace-fixture" });
});
