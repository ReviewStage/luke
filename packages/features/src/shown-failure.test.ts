import assert from "node:assert/strict";
import { test } from "vitest";
import { FAILURE_FACT } from "./failure-facts.js";
import {
  FAILURE_CONDITION,
  FAILURE_KIND,
  FAILURE_SURFACE,
  type ShownFailureSentry,
  sendShownFailure,
} from "./shown-failure.js";

/**
 * shown-failure.test.ts -- a failure nothing named, shown while the app did
 * not reach the service or whose own facts say its call got no answer, is a
 * log line at `warn` and opens no issue, as a Mac waking from sleep shows its
 * task list unread, or a phone that reads online with no signal shows its
 * inbox unread. A recording SDK stands in for Sentry. Synthetic throughout.
 */

const SIGNED_IN = "signed-in";

test.each([
  {
    shown: "offline",
    state: { online: false, connected: false, account: SIGNED_IN },
    cause: FAILURE_CONDITION.UNREAD,
    line: "A failure was shown on home_tasks.read: unread",
  },
  {
    shown: "online while the service's calls go unanswered",
    state: { online: true, connected: false, account: SIGNED_IN },
    cause: FAILURE_CONDITION.UNREAD,
    line: "A failure was shown on home_tasks.read: unread",
  },
  {
    shown: "connected, of a call that ended in a network fault",
    state: { online: true, connected: true, account: SIGNED_IN },
    cause: {
      failure: "unanswered",
      cause: { _tag: FAILURE_FACT.HOSTED_UNANSWERED, fault: "network", errorName: "TypeError" },
    },
    line: "A failure was shown on home_tasks.read: unanswered",
  },
  {
    shown: "connected, of a call that ran past its deadline",
    state: { online: true, connected: true, account: SIGNED_IN },
    cause: {
      failure: "unanswered",
      cause: { _tag: FAILURE_FACT.HOSTED_UNANSWERED, errorName: "TimeoutError" },
    },
    line: "A failure was shown on home_tasks.read: unanswered",
  },
])(
  "an unexpected failure shown $shown sends a warning line and opens no issue",
  ({ state, cause, line }) => {
    const warned: string[] = [];
    const errored: string[] = [];
    const captured: Error[] = [];
    const recording: ShownFailureSentry = {
      captureException: (error) => {
        captured.push(error);
        return "event-fixture";
      },
      logger: { warn: (said) => warned.push(said), error: (said) => errored.push(said) },
      getActiveSpan: () => undefined,
      getCurrentScope: () => ({ getPropagationContext: () => ({ traceId: "trace-fixture" }) }),
    };

    const sent = sendShownFailure(recording, {
      surface: FAILURE_SURFACE.HOME_TASKS_READ,
      kind: FAILURE_KIND.UNEXPECTED,
      cause,
      about: {},
      state,
    });

    assert.deepEqual(warned, [line]);
    assert.deepEqual(errored, []);
    assert.deepEqual(captured, []);
    assert.deepEqual(sent, { traceId: "trace-fixture" });
  },
);
